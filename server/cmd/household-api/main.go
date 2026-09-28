// Command household-api is the Household server (PRD 01 §1). It has three commands:
//
//	household-api [serve]     serve the API as the request role (the default)
//	household-api migrate     apply pending migrations and load the reference data as the migrate role, at deploy time
//	household-api bootstrap   create the roles and prepare the database, as an administrator
//
// Configuration comes from the environment; internal/platform/config lists it, and
// .env.example documents the development defaults.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/modules"
	"github.com/kareltilcer/household/server/internal/platform/breach"
	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/password"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/reference"
	"github.com/kareltilcer/household/server/internal/platform/session"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	// The first signal starts a graceful shutdown. Once it has, the signals are the
	// process's own again, so a second one ends it rather than waiting out the shutdown.
	context.AfterFunc(ctx, stop)
	code := run(ctx, os.Args[1:], config.FromOS, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// run runs the command args name and returns the process's exit status: 0, 1 when the
// command failed, 2 when it could not start.
func run(ctx context.Context, args []string, getenv config.Getenv, stdout, stderr io.Writer) int {
	command := config.Serve
	switch len(args) {
	case 0:
	case 1:
		command = config.Command(args[0])
	default:
		_, _ = fmt.Fprintln(stderr, "usage: household-api [serve|migrate|bootstrap]")
		return 2
	}
	cfg, err := config.Load(command, getenv)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 2
	}
	log := logging.New(stdout, cfg.LogLevel)
	slog.SetDefault(log)

	switch command {
	case config.Serve:
		err = serve(ctx, cfg, log, nil)
	case config.Migrate:
		err = migrate(ctx, cfg, log)
	case config.Bootstrap:
		err = bootstrap(ctx, cfg, log)
	}
	if err != nil {
		log.LogAttrs(ctx, slog.LevelError, "command failed", slog.String("env", string(cfg.Env)), slog.Any("error", err))
		return 1
	}
	return 0
}

// serve serves the API until ctx ends. listening, when not nil, receives the address once
// the server listens.
func serve(ctx context.Context, cfg *config.Config, log *slog.Logger, listening chan<- net.Addr) error {
	registry, err := module.NewRegistry(modules.All()...)
	if err != nil {
		return err
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL, "household-api")
	if err != nil {
		return err
	}
	defer pool.Close()
	c, err := contract.Load()
	if err != nil {
		return err
	}
	background := identity.NewBackground(log, 4, 1024, time.Minute)
	accounts, closeAccounts, err := newAccounts(ctx, cfg, log, pool, background)
	if err != nil {
		return err
	}
	defer closeAccounts()
	router, err := app.NewRouter(app.Deps{
		Logger:       log,
		Contract:     c,
		Health:       health.New(log, 2*time.Second, health.Database(pool)),
		Pool:         pool,
		Modules:      registry,
		MaxBodyBytes: cfg.MaxBodyBytes,
		BodyTimeout:  cfg.BodyTimeout,
		Accounts:     accounts,
	})
	if err != nil {
		return err
	}

	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", cfg.HTTPAddr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.HTTPAddr, err)
	}
	log.LogAttrs(ctx, slog.LevelInfo, "serving",
		slog.String("env", string(cfg.Env)), slog.String("addr", ln.Addr().String()))
	if listening != nil {
		listening <- ln.Addr()
	}
	served := app.Serve(ctx, log, app.NewServer(router, log), ln, cfg.ShutdownTimeout)
	// The emails the last requests queued go out before the process ends, within the same grace.
	closeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownTimeout)
	defer cancel()
	return errors.Join(served, background.Close(closeCtx))
}

// newAccounts builds the account surfaces (item 8) from cfg, and returns what closes them.
func newAccounts(ctx context.Context, cfg *config.Config, log *slog.Logger, pool *pgxpool.Pool,
	background *identity.Background,
) (app.Accounts, func(), error) {
	closeAll := func() {}
	catalogs, err := i18n.Default()
	if err != nil {
		return app.Accounts{}, closeAll, err
	}
	// One hash at once per CPU the process may use: GOMAXPROCS follows a container's CPU limit,
	// where NumCPU counts the host's, each hash holding 64 MiB.
	hasher, err := password.New(password.Default, runtime.GOMAXPROCS(0))
	if err != nil {
		return app.Accounts{}, closeAll, err
	}
	var breached func(string) (bool, error)
	if cfg.BreachedPasswords != "" {
		corpus, err := breach.Open(cfg.BreachedPasswords)
		if err != nil {
			return app.Accounts{}, closeAll, err
		}
		closeAll = func() { _ = corpus.Close() }
		breached = corpus.Contains
	} else {
		// Only development gets this far without a corpus (config).
		log.LogAttrs(ctx, slog.LevelWarn, "breached-password screening is off: no corpus configured")
	}
	sender, err := mail.NewSMTP(cfg.SMTPURL, cfg.MailFrom)
	if err != nil {
		return app.Accounts{}, closeAll, err
	}
	origins, err := session.NewOrigins(cfg.AllowedOrigins...)
	if err != nil {
		return app.Accounts{}, closeAll, err
	}
	sessions := session.NewStore(pool, origins, log, nil)
	id, err := identity.New(identity.Config{
		Pool: pool, Log: log, Hasher: hasher, Breached: breached,
		Throttles: ratelimit.NewThrottles(pool, nil), Sessions: sessions, Mail: sender, Catalogs: catalogs,
		WebURL: cfg.WebURL, ClientIP: clientip.New(cfg.TrustedProxies), Later: background.Run,
	})
	if err != nil {
		return app.Accounts{}, closeAll, err
	}
	return app.Accounts{
		Identity: id, Sessions: sessions, Origins: origins,
		UserLimit:      ratelimit.NewBuckets(ratelimit.PerUser, nil),
		HouseholdLimit: ratelimit.NewBuckets(ratelimit.PerHousehold, nil),
	}, closeAll, nil
}

// migrate applies every pending migration, the platform's and each module's, logging each one
// it applies, and then loads the reference data the binary carries into the tables they made,
// logging what the load did to each dataset.
func migrate(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	registry, err := module.NewRegistry(modules.All()...)
	if err != nil {
		return err
	}
	connConfig, err := pgx.ParseConfig(cfg.MigrateDatabaseURL)
	if err != nil {
		return err
	}
	sqlDB := stdlib.OpenDB(*connConfig)
	defer func() { _ = sqlDB.Close() }()
	results, err := db.Migrate(ctx, sqlDB, append([]db.Block{db.Platform()}, registry.Blocks()...)...)
	for _, r := range results {
		log.LogAttrs(ctx, slog.LevelInfo, "migration applied", slog.String("migration", r.Source.Path))
	}
	if err != nil {
		return err
	}
	log.LogAttrs(ctx, slog.LevelInfo, "migrations up to date", slog.String("env", string(cfg.Env)))

	conn, err := pgx.ConnectConfig(ctx, connConfig)
	if err != nil {
		return fmt.Errorf("connect as the migrate role: %w", err)
	}
	defer func() { _ = conn.Close(context.Background()) }()
	reports, err := reference.Load(ctx, conn, reference.Files())
	if err != nil {
		return err
	}
	for _, r := range reports {
		level := slog.LevelInfo
		if r.Kept > 0 {
			// A record the files dropped stays served; a data change that meant to withdraw it did not.
			level = slog.LevelWarn
		}
		log.LogAttrs(ctx, level, "reference data loaded", slog.String("dataset", r.Dataset),
			slog.Int64("version", r.Version), slog.Int("inserted", r.Inserted), slog.Int("updated", r.Updated),
			slog.Int("kept", r.Kept))
	}
	return nil
}

// bootstrap creates the roles with the passwords their connection strings carry, and
// prepares the database those strings name.
func bootstrap(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	database, err := config.Database(cfg.DatabaseURL)
	if err != nil {
		return err
	}
	var passwords db.Passwords
	for _, p := range []struct {
		url  string
		into *string
	}{
		{cfg.MigrateDatabaseURL, &passwords.Migrate},
		{cfg.DatabaseURL, &passwords.App},
		{cfg.MeterDatabaseURL, &passwords.Meter},
	} {
		if *p.into, err = config.Password(p.url); err != nil {
			return err
		}
	}
	admin, err := pgx.Connect(ctx, cfg.AdminDatabaseURL)
	if err != nil {
		return fmt.Errorf("connect as the administrator: %w", err)
	}
	defer func() { _ = admin.Close(context.Background()) }()
	if err := db.Bootstrap(ctx, admin, database, passwords); err != nil {
		return err
	}
	for _, role := range db.Roles {
		log.LogAttrs(ctx, slog.LevelInfo, "role ready", slog.String("role", role))
	}
	return nil
}
