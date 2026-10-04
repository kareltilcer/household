package arch_test

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/privacy"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The erasure test (FR-PR6, PRD 05 §5, D-6; plan item 20), run on every commit: as the request role,
// in household A's context, the household is erased as the nightly job erases one (privacy.EraseRows:
// every registered module's EraseSource, then the household's own row), and no table that holds
// households' rows holds a row of it afterwards, while household B keeps every row it had. The
// isolation fixture has a row of household A in every tenant table, which the isolation test holds
// it to, so a new tenant table that does not hang from its household's row, and that no module
// erases, fails here: its rows would outlive a deleted household, where no member could ever read
// or delete them again.
func TestErasingAHouseholdLeavesNoRowOfIt(t *testing.T) {
	tx := adminTx(t)
	execFile(t, tx, filepath.Join("testdata", "isolation"), "fixture.sql")
	for _, v := range erasureViolations(t, tx) {
		t.Error(v)
	}
}

// The erasure test against a deliberate violation: testdata/erasure/violations.sql adds, beside the
// fixture's, a tenant table whose rows name their household without hanging from it, and want.txt is
// what the test must report.
func TestErasingAHouseholdLeavesNoRowOfItCatchesAViolation(t *testing.T) {
	tx := adminTx(t)
	execFile(t, tx, filepath.Join("testdata", "isolation"), "fixture.sql")
	dir := filepath.Join("testdata", "erasure")
	execFile(t, tx, dir, "violations.sql")
	got := erasureViolations(t, tx)
	want := lines(t, os.DirFS(dir), "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// erasureViolations erases household A on tx, which must be the administrator's, with the fixture
// loaded, and returns each table that still holds a row of it, and each that lost a row of
// household B's.
func erasureViolations(t *testing.T, tx pgx.Tx) []string {
	t.Helper()
	ctx := t.Context()
	rows, err := tx.Query(ctx, `
		SELECT n.nspname, c.relname,
		  array(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
		  AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
		ORDER BY n.nspname, c.relname`)
	if err != nil {
		t.Fatal(err)
	}
	type target struct {
		name, ident, column string
	}
	var targets []target
	var schema, name string
	var columns []string
	if _, err := pgx.ForEachRow(rows, []any{&schema, &name, &columns}, func() error {
		e, exempted := exemptions[schema+"."+name]
		// A global table that names a household, an export or a diagnostic bundle, is held to it too,
		// but the platform's own log, which is kept past the household it names (FR-PS2).
		if (exempted && !e.ownPolicy && !slices.Contains(columns, "household_id")) || !slices.Contains(columns, e.column()) || e.outlives {
			return nil
		}
		targets = append(targets, target{name: schema + "." + name, ident: pgx.Identifier{schema, name}.Sanitize(), column: e.column()})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	count := func(tb target, household string) int {
		var n int
		if err := tx.QueryRow(ctx, fmt.Sprintf("SELECT count(*) FROM %s WHERE %s = $1", tb.ident, pgx.Identifier{tb.column}.Sanitize()),
			household).Scan(&n); err != nil {
			t.Fatalf("%s: %v", tb.name, err)
		}
		return n
	}
	kept := map[string]int{}
	for _, tb := range targets {
		kept[tb.name] = count(tb, householdB)
	}

	// As the request role, in household A's context, with no caller: as the nightly job runs.
	if _, err := tx.Exec(ctx,
		"SELECT set_config('role', $1, true), set_config('app.household_id', $2, true), set_config('app.user_id', '', true)",
		db.RoleApp, householdA); err != nil {
		t.Fatal(err)
	}
	a := uuid.MustParse(householdA)
	if err := privacy.EraseRows(tenant.Assume(ctx, nil, a, uuid.Nil, ""), tx, registry(t), a); err != nil {
		t.Fatalf("erase household A: %v", err)
	}
	if _, err := tx.Exec(ctx, "RESET ROLE"); err != nil {
		t.Fatal(err)
	}

	var out []string
	for _, tb := range targets {
		if n := count(tb, householdA); n != 0 {
			out = append(out, fmt.Sprintf("%s keeps %d of household A's rows once the household is erased; "+
				"its rows must go with their household's, by a foreign key that cascades from it, or be erased by their module", tb.name, n))
		}
		if n := count(tb, householdB); n != kept[tb.name] {
			out = append(out, fmt.Sprintf("%s held %d of household B's rows and holds %d once household A is erased", tb.name, kept[tb.name], n))
		}
	}
	return out
}
