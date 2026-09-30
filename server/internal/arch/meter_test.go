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

// Architecture test 11 (PRD 01 §2.3, §10; plan item 14, ADR 0015): the meter role, which reads
// across households, holds no privilege on any table, view or sequence but SELECT on columns that
// name a row's household or count, size or schedule its rows: the sampler learns how much each
// household keeps, and whose, never what it wrote. Its read policy (enable_metering) admits it to
// every row of a tenant table, and architecture test 2 holds it to reading; this holds it to the
// columns. A table-wide SELECT would reach every column, one added later included, so only
// column grants pass.
func TestMeterReadsOnlyWhatCounts(t *testing.T) {
	for _, v := range meterViolations(t, adminTx(t), "", meterColumns) {
		t.Error(v)
	}
}

// The same check against deliberate violations: testdata/meter/tables.sql grants the meter role
// what it may and may not hold, and want.txt is every violation the test must report.
func TestMeterReadsOnlyWhatCountsCatchesEachViolation(t *testing.T) {
	tx := adminTx(t)
	if _, err := tx.Exec(t.Context(), "SET LOCAL ROLE "+db.RoleMigrate); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("testdata", "meter")
	execFile(t, tx, dir, "tables.sql")
	got := meterViolations(t, tx, "arch_testdata", map[string][]string{
		"arch_testdata.sized": {"household_id", "byte_size"},
	})
	want := lines(t, os.DirFS(dir), "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// meterColumns are the columns the meter role may read beyond household_id, which it may read on
// every table that has one: the tenant root's id, which lists the households, and what the sampler
// sums and the files workers schedule by.
var meterColumns = map[string][]string{
	"public.households": {"id"},
	"public.files":      {"household_id", "module", "variant", "byte_size", "owner_id"},
	"public.file_jobs":  {"household_id", "run_at"},
}

// meterViolations returns each privilege the meter role holds in schema, or in every schema that
// is not PostgreSQL's own when schema is "", that allowed does not name: allowed names a table's
// readable columns, household_id for one it does not name. A sequence's USAGE is among them, since
// it draws the sequence's next value, a write, and so is a table's MAINTAIN (PostgreSQL 17), which
// locks it against every write and vacuums, reindexes or refreshes it; the CASE asks each relation
// only for the privileges its kind has, which PostgreSQL's functions refuse to be asked for otherwise.
func meterViolations(t *testing.T, tx pgx.Tx, schema string, allowed map[string][]string) []string {
	t.Helper()
	rows, err := tx.Query(t.Context(), `
		SELECT n.nspname || '.' || c.relname,
		  array(SELECT p FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN', 'USAGE']) AS p
		        WHERE CASE WHEN c.relkind = 'S' AND p IN ('SELECT', 'UPDATE', 'USAGE') THEN has_sequence_privilege($2::name, c.oid, p)
		                   WHEN c.relkind <> 'S' AND p <> 'USAGE' THEN has_table_privilege($2::name, c.oid, p)
		                   ELSE false END),
		  array(SELECT a.attname || ' ' || p
		        FROM pg_attribute a, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p
		        WHERE c.relkind <> 'S' AND a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
		          AND has_column_privilege($2::name, c.oid, a.attnum, p)
		        ORDER BY a.attnum, p)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
		  AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
		  AND ($1 = '' OR n.nspname = $1)
		ORDER BY n.nspname, c.relname`, schema, db.RoleMeter)
	if err != nil {
		t.Fatal(err)
	}
	var (
		out            []string
		name           string
		whole, columns []string
	)
	if _, err := pgx.ForEachRow(rows, []any{&name, &whole, &columns}, func() error {
		if len(whole) > 0 {
			out = append(out, fmt.Sprintf("%s: the meter role holds %s on all of it; grant it SELECT on the columns it counts by, one at a time",
				name, strings.Join(whole, ", ")))
			return nil
		}
		readable, ok := allowed[name]
		if !ok {
			readable = []string{"household_id"}
		}
		for _, grant := range columns {
			column, privilege, _ := strings.Cut(grant, " ")
			switch {
			case privilege != "SELECT":
				out = append(out, fmt.Sprintf("%s.%s: the meter role holds %s on it; it only reads", name, column, privilege))
			case !slices.Contains(readable, column):
				out = append(out, fmt.Sprintf("%s.%s: the meter role reads it, and it neither names a household nor counts, sizes or schedules rows",
					name, column))
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return out
}
