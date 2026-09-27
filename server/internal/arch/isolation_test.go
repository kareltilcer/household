package arch_test

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// The tenant isolation test (FR-NF4, PRD 07 §4), run on every commit: as the request role, in
// household B's context, it reads each of household A's rows in every tenant table by its
// primary key, and finds none. A tenant table is any table exemptions does not call global, its
// own-policy tables included, so a new table without a policy fails it, which is the point; so
// does a new table with no row of household A in the fixture, since a read of a table that
// holds nothing proves nothing.
//
// The reads run as household_app in a transaction the administrator opened, SET LOCAL ROLE, as
// the server's own transactions run (tenant.InTx): the same privileges and the same policies as
// connecting as household_app, with the fixture visible without being committed.
func TestTenantIsolation(t *testing.T) {
	tx := adminTx(t)
	execFile(t, tx, filepath.Join("testdata", "isolation"), "fixture.sql")
	for _, v := range isolationViolations(t, tx) {
		t.Error(v)
	}
}

// The isolation test against deliberate violations: testdata/isolation/violations.sql adds
// tenant tables it must fail beside the fixture's, and want.txt is every violation it must
// report.
func TestTenantIsolationCatchesEachViolation(t *testing.T) {
	tx := adminTx(t)
	dir := filepath.Join("testdata", "isolation")
	execFile(t, tx, dir, "fixture.sql")
	execFile(t, tx, dir, "violations.sql")
	got := isolationViolations(t, tx)
	want := lines(t, os.DirFS(dir), "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// The fixture's two households, and the owner of each.
const (
	householdA = "01900000-0000-7000-8000-00000000000a"
	householdB = "01900000-0000-7000-8000-00000000000b"
	ownerA     = "01900000-0000-7000-8000-0000000000a1"
	ownerB     = "01900000-0000-7000-8000-0000000000b1"
)

// householdKey names the column that says which household a row belongs to, where it is not
// household_id: the tenant root's own id.
var householdKey = map[string]string{"public.households": "id"}

// isolationViolations returns each violation of the isolation test on tx, which must be the
// administrator's, with the fixture loaded.
func isolationViolations(t *testing.T, tx pgx.Tx) []string {
	t.Helper()
	ctx := t.Context()
	rows, err := tx.Query(ctx, `
		SELECT n.nspname, c.relname,
		  coalesce((SELECT array_agg(a.attname::text ORDER BY k.ord)
		            FROM pg_index i
		            CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
		            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
		            WHERE i.indrelid = c.oid AND i.indisprimary), '{}'),
		  array(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r', 'p')
		  AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
		ORDER BY n.nspname, c.relname`)
	if err != nil {
		t.Fatal(err)
	}
	type target struct {
		name    string
		ident   string
		key     []string
		columns []string
		rows    [][]string
	}
	var targets []*target
	var schema, name string
	var key, columns []string
	if _, err := pgx.ForEachRow(rows, []any{&schema, &name, &key, &columns}, func() error {
		targets = append(targets, &target{
			name: schema + "." + name, ident: pgx.Identifier{schema, name}.Sanitize(),
			key: slices.Clone(key), columns: slices.Clone(columns),
		})
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	var out []string
	var checked []*target
	for _, tb := range targets {
		if e, ok := exemptions[tb.name]; ok && !e.ownPolicy {
			continue
		}
		column := householdKey[tb.name]
		if column == "" {
			column = "household_id"
		}
		switch {
		case !slices.Contains(tb.columns, column):
			out = append(out, tb.name+" has no "+column+" column to tell household A's rows by")
			continue
		case len(tb.key) == 0:
			out = append(out, tb.name+" has no primary key to read a row by")
			continue
		}
		// As the administrator, which passes every policy: household A's rows, by key.
		var casts []string
		for _, k := range tb.key {
			casts = append(casts, pgx.Identifier{k}.Sanitize()+"::text")
		}
		rows, err := tx.Query(ctx, fmt.Sprintf("SELECT ARRAY[%s] FROM %s WHERE %s = $1",
			strings.Join(casts, ", "), tb.ident, pgx.Identifier{column}.Sanitize()), householdA)
		if err != nil {
			t.Fatalf("%s: %v", tb.name, err)
		}
		if tb.rows, err = pgx.CollectRows(rows, pgx.RowTo[[]string]); err != nil {
			t.Fatalf("%s: %v", tb.name, err)
		}
		if len(tb.rows) == 0 {
			out = append(out, tb.name+" has no row of household A; the isolation fixture must hold one")
			continue
		}
		checked = append(checked, tb)
	}

	// As the request role: household B must read none of them, and household A each of them, or
	// reading none proves nothing.
	count := func(tb *target, row []string) int {
		var conds []string
		args := make([]any, len(row))
		for i, k := range tb.key {
			conds = append(conds, fmt.Sprintf("%s::text = $%d", pgx.Identifier{k}.Sanitize(), i+1))
			args[i] = row[i]
		}
		var n int
		if err := tx.QueryRow(ctx, fmt.Sprintf("SELECT count(*) FROM %s WHERE %s", tb.ident, strings.Join(conds, " AND ")),
			args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", tb.name, err)
		}
		return n
	}
	enter := func(household, user string) {
		if _, err := tx.Exec(ctx,
			"SELECT set_config('role', $1, true), set_config('app.household_id', $2, true), set_config('app.user_id', $3, true)",
			db.RoleApp, household, user); err != nil {
			t.Fatal(err)
		}
	}
	enter(householdB, ownerB)
	for _, tb := range checked {
		for _, row := range tb.rows {
			if count(tb, row) != 0 {
				out = append(out, fmt.Sprintf("%s: household B reads household A's row (%s)", tb.name, strings.Join(row, ", ")))
			}
		}
	}
	enter(householdA, ownerA)
	for _, tb := range checked {
		for _, row := range tb.rows {
			if count(tb, row) != 1 {
				out = append(out, fmt.Sprintf("%s: household A cannot read its own row (%s), so the read proves nothing",
					tb.name, strings.Join(row, ", ")))
			}
		}
	}
	if _, err := tx.Exec(ctx, "RESET ROLE"); err != nil {
		t.Fatal(err)
	}
	return out
}
