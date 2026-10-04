// Command household-api is the Household server (PRD 01 §1). It has four commands:
//
//	household-api [serve]     serve the API as the request role (the default)
//	household-api migrate     apply pending migrations and load the reference data as the migrate role, at deploy time
//	household-api bootstrap   create the roles and prepare the database, as an administrator
//	household-api staff grant <email> <support|platform_admin>
//	household-api staff revoke <email>
//	                          make an account one of the platform's staff, or take it out of them, as the request role
//
// Configuration comes from the environment; internal/platform/config lists it, and
// .env.example documents the development defaults.
package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/modules"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/reference"
	"github.com/kareltilcer/household/server/internal/platform/staff"
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
	if len(args) > 0 {
		command = config.Command(args[0])
	}
	// Only the staff command takes arguments of its own.
	var change *staffChange
	if command == config.Staff {
		change = parseStaffChange(args[1:])
	}
	if (command == config.Staff && change == nil) || (command != config.Staff && len(args) > 1) {
		_, _ = fmt.Fprintln(stderr, usage)
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
	case config.Staff:
		err = manageStaff(ctx, cfg, log, *change)
	}
	if err != nil {
		log.LogAttrs(ctx, slog.LevelError, "command failed", slog.String("env", string(cfg.Env)), slog.Any("error", err))
		return 1
	}
	return 0
}

// usage is what a command line the server cannot read is answered with.
const usage = `usage: household-api [serve|migrate|bootstrap]
       household-api staff grant <email> <support|platform_admin>
       household-api staff revoke <email>`

// staffChange is what the staff command is asked for: an account, by its address, made one of the
// platform's staff with role, or, with no role, taken out of them.
type staffChange struct {
	email string
	role  staff.Role
}

// parseStaffChange reads the staff command's arguments, or returns nil for ones it cannot read.
func parseStaffChange(args []string) *staffChange {
	switch len(args) {
	case 3:
		if grant := [3]string(args); grant[0] == "grant" {
			role, err := staff.ParseRole(grant[2])
			if err != nil {
				return nil
			}
			return &staffChange{email: grant[1], role: role}
		}
	case 2:
		if revoke := [2]string(args); revoke[0] == "revoke" {
			return &staffChange{email: revoke[1]}
		}
	}
	return nil
}

// manageStaff makes the account change names one of the platform's staff, or takes it out of them,
// as the operator: how the first platform_admin is made, when nobody could make one through the API
// yet. The account is one with a verified address, and it is admitted to nothing until its second
// step is on. It is recorded in the platform's log as the operator's.
func manageStaff(ctx context.Context, cfg *config.Config, log *slog.Logger, change staffChange) error {
	pool, err := db.Open(ctx, cfg.DatabaseURL, "household-api-staff")
	if err != nil {
		return err
	}
	defer pool.Close()
	if change.role == "" {
		if err := staff.Revoke(ctx, pool, change.email); err != nil {
			return err
		}
		log.LogAttrs(ctx, slog.LevelInfo, "taken out of the platform's staff", slog.String("env", string(cfg.Env)))
		return nil
	}
	if err := staff.Grant(ctx, pool, change.email, change.role, time.Now()); err != nil {
		return err
	}
	log.LogAttrs(ctx, slog.LevelInfo, "made one of the platform's staff", slog.String("env", string(cfg.Env)),
		slog.String("role", string(change.role)))
	return nil
}

// serve serves the API until ctx ends. listening, when not nil, receives the address once
// the server listens.
func serve(ctx context.Context, cfg *config.Config, log *slog.Logger, listening chan<- net.Addr) error {
	registry, err := module.NewRegistry(modules.All()...)
	if err != nil {
		return err
	}
	return app.Run(ctx, cfg, log, registry, "household-api", nil, listening)
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
		if r.Kept > 0 || r.Held > 0 {
			// A record the files dropped stays served; a data change that meant to withdraw it did not.
			// And a record an administrator edited stays as they left it, while the files say otherwise
			// (D-148): the files' value is not the one served until they agree.
			level = slog.LevelWarn
		}
		log.LogAttrs(ctx, level, "reference data loaded", slog.String("dataset", r.Dataset),
			slog.Int64("version", r.Version), slog.Int("inserted", r.Inserted), slog.Int("updated", r.Updated),
			slog.Int("kept", r.Kept), slog.Int("held", r.Held), slog.Int("released", r.Released))
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
		{cfg.StaffDatabaseURL, &passwords.Staff},
		{cfg.ReplicationDatabaseURL, &passwords.PowerSync},
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
	for _, role := range db.ManagedRoles() {
		log.LogAttrs(ctx, slog.LevelInfo, "role ready", slog.String("role", role))
	}
	if cfg.PowerSyncStorageURL == "" {
		return nil
	}
	storage, err := pgconn.ParseConfig(cfg.PowerSyncStorageURL)
	if err != nil {
		return err
	}
	if err := db.PrepareStorage(ctx, admin, db.Storage{Role: storage.User, Password: storage.Password, Database: storage.Database}); err != nil {
		return err
	}
	log.LogAttrs(ctx, slog.LevelInfo, "PowerSync's bucket storage ready", slog.String("database", storage.Database))
	return nil
}
