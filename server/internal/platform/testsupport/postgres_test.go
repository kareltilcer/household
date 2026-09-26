package testsupport_test

import (
	"runtime"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// outcome stands in for the test that Connect is handed, and records whether Connect
// failed or skipped it. Like the real methods, each ends the calling goroutine.
type outcome struct {
	testing.TB
	failed, skipped bool
}

func (o *outcome) Fatalf(string, ...any) { o.failed = true; runtime.Goexit() }
func (o *outcome) Fatal(...any)          { o.failed = true; runtime.Goexit() }
func (o *outcome) FailNow()              { o.failed = true; runtime.Goexit() }
func (o *outcome) Skipf(string, ...any)  { o.skipped = true; runtime.Goexit() }
func (o *outcome) Skip(...any)           { o.skipped = true; runtime.Goexit() }
func (o *outcome) SkipNow()              { o.skipped = true; runtime.Goexit() }

// A suite that skips when the database is missing reports green while testing nothing, so
// an unreachable server has to fail the test.
func TestConnectFailsWhenTheDatabaseIsUnreachable(t *testing.T) {
	// Nothing listens on port 1, so the connection is refused.
	t.Setenv(testsupport.DatabaseURLEnv,
		"postgres://postgres:postgres@127.0.0.1:1/household?sslmode=disable&connect_timeout=5")
	got := &outcome{TB: t}
	done := make(chan struct{})
	go func() {
		defer close(done)
		testsupport.Connect(got)
	}()
	<-done
	if !got.failed || got.skipped {
		t.Fatalf("Connect to an unreachable server: failed %t, skipped %t; want it to fail the test",
			got.failed, got.skipped)
	}
}

func TestDatabaseURLPrefersTheEnvironment(t *testing.T) {
	t.Setenv(testsupport.DatabaseURLEnv, "postgres://db.test:5432/ci")
	if got := testsupport.DatabaseURL(); got != "postgres://db.test:5432/ci" {
		t.Errorf("DatabaseURL() = %q, want the value of %s", got, testsupport.DatabaseURLEnv)
	}

	t.Setenv(testsupport.DatabaseURLEnv, "")
	if got := testsupport.DatabaseURL(); got != testsupport.DefaultDatabaseURL {
		t.Errorf("DatabaseURL() with %s empty = %q, want the compose default", testsupport.DatabaseURLEnv, got)
	}
}

// The compose service and the CI service container both run PostgreSQL 17, the major the
// server is built on (PRD 01 §1, PL-2). A test suite green against another major proves
// nothing about row-level security or planner behaviour on the one that ships.
func TestTheTestDatabaseIsPostgres17(t *testing.T) {
	conn := testsupport.Connect(t)
	var version int
	if err := conn.QueryRow(t.Context(), `SELECT current_setting('server_version_num')::int`).Scan(&version); err != nil {
		t.Fatalf("read server_version_num: %v", err)
	}
	if major := version / 10000; major != 17 {
		t.Fatalf("the test database runs PostgreSQL %d; Household runs on 17", major)
	}
}
