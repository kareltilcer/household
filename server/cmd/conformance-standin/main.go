// Command conformance-standin serves the stand-ins the sync conformance suite runs against until
// plan items 13 and 14 build the real ones (packages/sync/conformance, internal/conformance). It
// is the suite's alone: never deployed, and every default below is a loopback development value.
//
//	conformance-standin setup   migrate the conformance module and prepare PowerSync's roles, publication and storage
//	conformance-standin serve   serve the stand-in API
//
// setup runs after `household-api bootstrap` and `household-api migrate` against the same
// database. Configuration comes from the environment:
//
//	HOUSEHOLD_DATABASE_URL          the request role, for serve, and the database setup prepares
//	HOUSEHOLD_MIGRATE_DATABASE_URL  the migrate role, for setup
//	HOUSEHOLD_ADMIN_DATABASE_URL    the administrator, for setup
//	CONFORMANCE_STANDIN_ADDR        where serve listens (127.0.0.1:8091)
//	CONFORMANCE_POWERSYNC_URL       PowerSync, as a client reaches it (http://127.0.0.1:8090)
//	CONFORMANCE_POWERSYNC_KEY       the HS256 key PowerSync verifies its tokens with, as powersync.yaml holds it
//	CONFORMANCE_API_KEY             the HS256 key of the stand-in's own tokens
//	CONFORMANCE_REPLICATION_URL     the role PowerSync replicates as, as powersync.yaml names it
//	CONFORMANCE_STORAGE_URL         PowerSync's bucket storage, as powersync.yaml names it
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
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/conformance"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/logging"
)

// The defaults, each a loopback development value that the suite's compose file and
// powersync.yaml repeat.
var defaults = map[string]string{ //nolint:gosec // G101: loopback development values for a stack that is never deployed, as .env.example's are.
	config.DatabaseURLVar:         "postgres://household_app:household_app@127.0.0.1:5442/household?sslmode=disable",
	config.MigrateDatabaseURLVar:  "postgres://household_migrate:household_migrate@127.0.0.1:5442/household?sslmode=disable",
	config.AdminDatabaseURLVar:    "postgres://postgres:postgres@127.0.0.1:5442/household?sslmode=disable",
	"CONFORMANCE_STANDIN_ADDR":    "127.0.0.1:8091",
	"CONFORMANCE_POWERSYNC_URL":   "http://127.0.0.1:8090",
	"CONFORMANCE_POWERSYNC_KEY":   "household-conformance-powersync-key-not-a-secret",
	"CONFORMANCE_API_KEY":         "household-conformance-standin-api-key-not-a-secret",
	"CONFORMANCE_REPLICATION_URL": "postgres://conformance_powersync:conformance_powersync@127.0.0.1:5442/household",
	"CONFORMANCE_STORAGE_URL":     "postgres://conformance_powersync_storage:conformance_powersync_storage@127.0.0.1:5442/powersync_storage",
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	context.AfterFunc(ctx, stop)
	code := run(ctx, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// run runs the command args name and returns the process's exit status: 0, 1 when the command
// failed, 2 when it could not start.
func run(ctx context.Context, args []string, lookup config.Getenv, stdout, stderr io.Writer) int {
	env := func(name string) string {
		if v, ok := lookup(name); ok && v != "" {
			return v
		}
		return defaults[name]
	}
	log := logging.New(stdout, slog.LevelInfo)
	var err error
	switch {
	case len(args) == 1 && args[0] == "setup":
		err = setup(ctx, env)
	case len(args) == 1 && args[0] == "serve":
		err = serve(ctx, env, log)
	default:
		_, _ = fmt.Fprintln(stderr, "usage: conformance-standin setup|serve")
		return 2
	}
	if err != nil {
		log.LogAttrs(ctx, slog.LevelError, "command failed", slog.Any("error", err))
		return 1
	}
	return 0
}

func setup(ctx context.Context, env func(string) string) error {
	migrateConfig, err := pgx.ParseConfig(env(config.MigrateDatabaseURLVar))
	if err != nil {
		return err
	}
	migrate := stdlib.OpenDB(*migrateConfig)
	defer func() { _ = migrate.Close() }()
	if err := conformance.Migrate(ctx, migrate); err != nil {
		return err
	}
	database, err := config.Database(env(config.DatabaseURLVar))
	if err != nil {
		return err
	}
	replication, err := pgconn.ParseConfig(env("CONFORMANCE_REPLICATION_URL"))
	if err != nil {
		return err
	}
	storage, err := pgconn.ParseConfig(env("CONFORMANCE_STORAGE_URL"))
	if err != nil {
		return err
	}
	admin, err := pgx.Connect(ctx, env(config.AdminDatabaseURLVar))
	if err != nil {
		return fmt.Errorf("connect as the administrator: %w", err)
	}
	defer func() { _ = admin.Close(context.Background()) }()
	return conformance.Setup(ctx, admin, database, conformance.Roles{
		Replication: replication.User, ReplicationPassword: replication.Password,
		Storage: storage.User, StoragePassword: storage.Password, StorageDatabase: storage.Database,
	})
}

func serve(ctx context.Context, env func(string) string, log *slog.Logger) error {
	pool, err := db.Open(ctx, env(config.DatabaseURLVar), "conformance-standin")
	if err != nil {
		return err
	}
	defer pool.Close()
	c, err := contract.Load()
	if err != nil {
		return err
	}
	standIn, err := conformance.New(conformance.Config{
		Pool: pool, Logger: log, Contract: c,
		PowerSyncURL: env("CONFORMANCE_POWERSYNC_URL"),
		PowerSyncKey: []byte(env("CONFORMANCE_POWERSYNC_KEY")),
		APIKey:       []byte(env("CONFORMANCE_API_KEY")),
		MaxBodyBytes: 1 << 20,
	})
	if err != nil {
		return err
	}
	router, err := standIn.Router()
	if err != nil {
		return err
	}
	addr := env("CONFORMANCE_STANDIN_ADDR")
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", addr, err)
	}
	log.LogAttrs(ctx, slog.LevelInfo, "serving", slog.String("addr", ln.Addr().String()))
	err = app.Serve(ctx, log, app.NewServer(router, log), ln, 10*time.Second)
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}
