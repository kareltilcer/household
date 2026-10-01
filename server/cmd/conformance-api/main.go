// Command conformance-api serves the API the sync conformance suite runs against (plan item 13,
// packages/sync/conformance, internal/conformance): the server's own, household-api's, with the
// conformance module registered beside the modules it serves, and the suite's sign-in around it. It
// is the suite's alone, never deployed, and every default below is a loopback development value of
// the suite's stack.
//
//	conformance-api setup   migrate the conformance module into the stack's database
//	conformance-api serve   serve the API
//
// setup runs after `household-api bootstrap` and `household-api migrate` against the same database.
// Configuration comes from the environment, as household-api's does (internal/platform/config), with
// the defaults of the stack (packages/sync/conformance/stack) in place of the development ones:
//
//	HOUSEHOLD_DATABASE_URL          the request role, for serve
//	HOUSEHOLD_METER_DATABASE_URL    the meter role, for serve's files workers
//	HOUSEHOLD_MIGRATE_DATABASE_URL  the migrate role, for setup
//	HOUSEHOLD_HTTP_ADDR             where serve listens (127.0.0.1:8091)
//	HOUSEHOLD_POWERSYNC_URL         PowerSync, as a client reaches it (http://127.0.0.1:8090)
package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/conformance"
	"github.com/kareltilcer/household/server/internal/modules"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
)

// defaults are the stack's, each a loopback development value its compose file and its PowerSync
// configuration repeat.
var defaults = map[string]string{ //nolint:gosec // G101: loopback development values for a stack that is never deployed, as .env.example's are.
	config.DatabaseURLVar:        "postgres://household_app:household_app@127.0.0.1:5442/household?sslmode=disable",
	config.MigrateDatabaseURLVar: "postgres://household_migrate:household_migrate@127.0.0.1:5442/household?sslmode=disable",
	config.MeterDatabaseURLVar:   "postgres://household_meter:household_meter@127.0.0.1:5442/household?sslmode=disable",
	config.HTTPAddrVar:           "127.0.0.1:8091",
	config.PowerSyncURLVar:       "http://127.0.0.1:8090",
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
	env := func(name string) (string, bool) {
		if v, ok := lookup(name); ok && v != "" {
			return v, true
		}
		v, ok := defaults[name]
		return v, ok
	}
	var command config.Command
	switch {
	case len(args) == 1 && args[0] == "setup":
		command = config.Migrate
	case len(args) == 1 && args[0] == "serve":
		command = config.Serve
	default:
		_, _ = fmt.Fprintln(stderr, "usage: conformance-api setup|serve")
		return 2
	}
	cfg, err := config.Load(command, env)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 2
	}
	log := logging.New(stdout, cfg.LogLevel)
	if command == config.Migrate {
		err = setup(ctx, cfg)
	} else {
		err = serve(ctx, cfg, log)
	}
	if err != nil {
		log.LogAttrs(ctx, slog.LevelError, "command failed", slog.Any("error", err))
		return 1
	}
	return 0
}

func setup(ctx context.Context, cfg *config.Config) error {
	migrateConfig, err := pgx.ParseConfig(cfg.MigrateDatabaseURL)
	if err != nil {
		return err
	}
	migrate := stdlib.OpenDB(*migrateConfig)
	defer func() { _ = migrate.Close() }()
	return conformance.Migrate(ctx, migrate)
}

func serve(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	registry, err := module.NewRegistry(append(modules.All(), conformance.Module{})...)
	if err != nil {
		return err
	}
	return app.Run(ctx, cfg, log, registry, "conformance-api", conformance.Around(cfg.TokenKeys), nil)
}
