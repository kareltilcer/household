// Package testsupport holds what the server's tests share. Tests run against a real
// PostgreSQL and never a mock (PL-3): row-level security, SET LOCAL and the change feed
// cannot be exercised any other way.
package testsupport

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// DatabaseURLEnv names the variable that points the tests at PostgreSQL. CI sets it for
// its service container; locally it is optional.
const DatabaseURLEnv = "HOUSEHOLD_TEST_DATABASE_URL"

// DefaultDatabaseURL is the postgres service in docker-compose.yml, so a fresh clone
// needs no configuration once `pnpm run up` has started it. It names 127.0.0.1, the only
// address compose publishes on: `localhost` can resolve to ::1 first, where another
// PostgreSQL on the machine would answer instead.
//
//nolint:gosec // G101: the compose default, public and bound to 127.0.0.1; not a secret.
const DefaultDatabaseURL = "postgres://postgres:postgres@127.0.0.1:5432/household?sslmode=disable"

// DatabaseURL returns the value of DatabaseURLEnv when it is set and not empty, and
// DefaultDatabaseURL otherwise.
func DatabaseURL() string {
	if url := os.Getenv(DatabaseURLEnv); url != "" {
		return url
	}
	return DefaultDatabaseURL
}

// Connect opens a connection to the test database and closes it when t finishes.
//
// An unreachable server fails the test instead of skipping it. A suite that skips its
// database tests when the database is missing reports green while testing nothing, and
// nearly everything this server does is a database test.
func Connect(t testing.TB) *pgx.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, DatabaseURL())
	if err != nil {
		t.Fatalf("connect to the test database (start it with `pnpm run up`, or set %s): %v",
			DatabaseURLEnv, err)
	}
	t.Cleanup(func() {
		// t.Context() is already cancelled when cleanups run.
		_ = conn.Close(context.Background())
	})
	return conn
}
