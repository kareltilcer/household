package testsupport_test

import (
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

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
