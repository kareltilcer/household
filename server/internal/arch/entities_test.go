package arch_test

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/arch/testdata/entities"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Architecture test 5 (PRD 01 §10, PRD 03 §2.5, D-24, D-82): every sync entity a module declares
// states its merge policy and its access, a state_set its key and resolution, and an additive
// series any invariant it carries, as sync.Violations holds them; and its table carries the
// base columns, as add_entity_columns makes them, which is the sync-ready schema gate G-A
// requires of every module's first migration. The registry refuses a module whose declarations
// break the first of these, naming each violation, when the server starts and when this
// package's TestMain builds it; this test reads each entity's table.
func TestSyncEntitiesAreDeclaredAndSyncReady(t *testing.T) {
	for _, v := range baseColumnViolations(t, adminTx(t), registry(t).Entities()) {
		t.Error(v)
	}
}

// Test 5's descriptor rules against deliberate violations: testdata/entities declares entities
// that break them and some that keep them, and declared.txt is every violation it must report.
func TestSyncEntitiesAreDeclaredCatchesEachViolation(t *testing.T) {
	declared := entities.Declared()
	modules := make([]string, 0, len(declared))
	for m := range declared {
		modules = append(modules, m)
	}
	sort.Strings(modules)
	var got []string
	for _, m := range modules {
		got = append(got, sync.Violations(m, declared[m])...)
	}
	want := lines(t, os.DirFS(filepath.Join("testdata", "entities")), "declared.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// Test 5's table rules against deliberate violations: testdata/entities/tables.sql makes, in a
// transaction that is rolled back, tables for entities that break them and one that keeps
// them, and tables.txt is every violation the test must report.
func TestSyncEntitiesAreSyncReadyCatchesEachViolation(t *testing.T) {
	tx := adminTx(t)
	if _, err := tx.Exec(t.Context(), "SET LOCAL ROLE "+db.RoleMigrate); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("testdata", "entities")
	execFile(t, tx, dir, "tables.sql")
	got := baseColumnViolations(t, tx, entities.Tabled())
	want := lines(t, os.DirFS(dir), "tables.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// baseColumns are the base columns every entity's table carries, as add_entity_columns makes
// them, with their types as PostgreSQL prints them back, in the order they are checked. id and
// household_id are the module's own to declare.
var baseColumns = []struct{ name, kind string }{
	{"id", "uuid NOT NULL"},
	{"household_id", "uuid NOT NULL"},
	{"version", "bigint NOT NULL"},
	{"created_by", "uuid"},
	{"created_at", "timestamp with time zone NOT NULL"},
	{"updated_by", "uuid"},
	{"updated_at", "timestamp with time zone NOT NULL"},
	{"deleted_at", "timestamp with time zone"},
}

// baseColumnViolations returns each entity whose table, read from PostgreSQL's catalog in tx,
// does not exist, lacks a base column or gives it another type, is not keyed on id alone, or
// has no touch_entity trigger to grow its version on every update.
func baseColumnViolations(t *testing.T, tx pgx.Tx, es []sync.Entity) []string {
	t.Helper()
	ctx := t.Context()
	var out []string
	for _, e := range es {
		bad := func(format string, args ...any) { out = append(out, e.Name+": "+fmt.Sprintf(format, args...)) }
		var (
			oid     *uint32
			key     []string
			touched bool
		)
		if err := tx.QueryRow(ctx, `
			SELECT c.oid,
			  coalesce((SELECT array_agg(a.attname::text ORDER BY k.ord)
			            FROM pg_index i
			            CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
			            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
			            WHERE i.indrelid = c.oid AND i.indisprimary), '{}'),
			  EXISTS (SELECT FROM pg_trigger g
			          WHERE g.tgrelid = c.oid AND g.tgfoid = 'public.touch_entity'::regproc AND g.tgenabled <> 'D'
			            AND g.tgtype & 19 = 19)
			FROM (SELECT to_regclass($1)::oid AS oid) r
			LEFT JOIN pg_class c ON c.oid = r.oid`, e.Table).Scan(&oid, &key, &touched); err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		if oid == nil {
			bad("%s does not exist", e.Table)
			continue
		}
		rows, err := tx.Query(ctx, `
			SELECT a.attname::text, format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
			FROM pg_attribute a
			WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped`, *oid)
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		columns := map[string]string{}
		var name, kind string
		if _, err := pgx.ForEachRow(rows, []any{&name, &kind}, func() error {
			columns[name] = kind
			return nil
		}); err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		for _, c := range baseColumns {
			switch got, ok := columns[c.name]; {
			case !ok:
				bad("%s has no %s column; add the base columns with add_entity_columns", e.Table, c.name)
			case got != c.kind:
				bad("%s.%s is %s; it must be %s", e.Table, c.name, got, c.kind)
			}
		}
		if !slices.Equal(key, []string{"id"}) {
			bad("%s's primary key is not id alone, which the client generates", e.Table)
		}
		if !touched {
			bad("%s has no touch_entity trigger, so its version does not grow on an update", e.Table)
		}
	}
	return out
}
