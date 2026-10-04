package arch_test

import (
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The no-content-access test (PRD 05 §6, D-3; plan item 21), run on every commit: no role the server
// runs as reads the content of a household its connection is not in. It connects as each of them,
// the request role, the migrate role, the meter role and the staff role, and
//
//   - finds that none is a superuser or bypasses row-level security, the attributes that would pass
//     every policy, so that what follows holds of the role however it connects;
//   - as the request role and the migrate role, which hold every column, reads each of household A's
//     rows in every tenant table by its key, with no household in context and in household B's, and
//     finds none: row-level security, forced on the owner too, is what keeps them out;
//   - as the meter role and the staff role, which read across households, selects every column of
//     every tenant table that is not one the role is granted, and is refused: what those roles read
//     of another household is the columns that name, count, size or schedule its rows (test 11), or
//     that are metadata (test 12), and no query of theirs reaches a column that is not.
//
// PowerSync's replication role is left out: it is D-3's one exception (D-93), the sync service's own
// credential, which no staff member or tool connects with, and the read-path isolation test holds it
// instead.
//
// The reads run in a transaction the administrator opened, SET LOCAL ROLE, as the isolation test's
// do: the same privileges and the same policies as each role's own connection, with the fixture
// visible without being committed. A table with no row of household A fails the isolation test, so
// every tenant table is read here.
func TestNoRoleReadsAnotherHouseholdsContent(t *testing.T) {
	ctx := t.Context()
	for _, role := range db.Roles {
		conn, err := pgx.Connect(ctx, testsupport.Open(t).URL(role))
		if err != nil {
			t.Fatalf("connect as %s: %v", role, err)
		}
		var (
			user          string
			super, bypass bool
		)
		err = conn.QueryRow(ctx, "SELECT current_user::text, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user").
			Scan(&user, &super, &bypass)
		_ = conn.Close(ctx)
		if err != nil {
			t.Fatalf("%s: %v", role, err)
		}
		if user != role || super || bypass {
			t.Errorf("connected as %s: the role is %s, superuser %t, bypasses row-level security %t", role, user, super, bypass)
		}
	}

	tx := adminTx(t)
	execFile(t, tx, filepath.Join("testdata", "isolation"), "fixture.sql")
	tables := tenantTables(t, tx)
	if len(tables) == 0 {
		t.Fatal("no tenant table to read")
	}

	as := func(role, household, user string) {
		t.Helper()
		if _, err := tx.Exec(ctx,
			"SELECT set_config('role', $1, true), set_config('app.household_id', $2, true), set_config('app.user_id', $3, true)",
			role, household, user); err != nil {
			t.Fatal(err)
		}
	}
	for _, role := range []string{db.RoleApp, db.RoleMigrate} {
		for name, context := range map[string][2]string{"no household": {"", ""}, "household B": {householdB, ownerB}} {
			as(role, context[0], context[1])
			for _, tb := range tables {
				var n int
				if err := tx.QueryRow(ctx, fmt.Sprintf("SELECT count(*) FROM %s WHERE %s = $1", tb.ident, pgx.Identifier{tb.household}.Sanitize()),
					householdA).Scan(&n); err != nil {
					t.Fatalf("%s as %s: %v", tb.name, role, err)
				}
				// The household's own row and its memberships are read outside any household by a member
				// of it, which household B's owner is: with no caller, or in household B, they are not.
				if n != 0 {
					t.Errorf("%s: %s, with %s in context, reads %d of household A's rows", tb.name, role, name, n)
				}
			}
		}
	}

	for role, granted := range map[string]func(table string) []string{
		db.RoleMeter: func(table string) []string {
			if columns, ok := meterColumns[table]; ok {
				return columns
			}
			return []string{"household_id"}
		},
		db.RoleStaff: func(table string) []string { return staffColumns[table] },
	} {
		as(role, "", "")
		for _, tb := range tables {
			readable := granted(tb.name)
			for _, column := range tb.columns {
				if slices.Contains(readable, column) {
					continue
				}
				if err := refused(t, tx, fmt.Sprintf("SELECT %s FROM %s LIMIT 1", pgx.Identifier{column}.Sanitize(), tb.ident)); err != nil {
					t.Errorf("%s.%s as %s: %v", tb.name, column, role, err)
				}
			}
		}
	}
}

// tenantTable is a table that holds households' rows, as the catalog describes it: the column that
// names a row's household, and every column.
type tenantTable struct {
	name, ident, household string
	columns                []string
}

// tenantTables returns every table that holds households' rows, the tables exemptions does not call
// global, its own-policy tables among them, in name order.
func tenantTables(t *testing.T, tx pgx.Tx) []tenantTable {
	t.Helper()
	rows, err := tx.Query(t.Context(), `
		SELECT n.nspname, c.relname,
		  array(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
		  AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
		ORDER BY n.nspname, c.relname`)
	if err != nil {
		t.Fatal(err)
	}
	var (
		out          []tenantTable
		schema, name string
		columns      []string
	)
	if _, err := pgx.ForEachRow(rows, []any{&schema, &name, &columns}, func() error {
		e, exempted := exemptions[schema+"."+name]
		if exempted && !e.ownPolicy {
			return nil
		}
		out = append(out, tenantTable{
			name: schema + "." + name, ident: pgx.Identifier{schema, name}.Sanitize(), household: e.column(), columns: slices.Clone(columns),
		})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return out
}

// refused runs query in a savepoint of tx, as the role tx is set to, and returns nil when PostgreSQL
// refuses it for want of a privilege, and what happened instead otherwise. The savepoint is rolled
// back either way, so that a refusal does not end tx.
func refused(t *testing.T, tx pgx.Tx, query string) error {
	t.Helper()
	sp, err := tx.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	rows, err := sp.Query(t.Context(), query)
	if err == nil {
		rows.Close()
		err = rows.Err()
	}
	if rbErr := sp.Rollback(t.Context()); rbErr != nil {
		t.Fatal(rbErr)
	}
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return errors.New("the role reads it")
	case errors.As(err, &pgErr) && pgErr.Code == "42501":
		return nil
	}
	return fmt.Errorf("refused, but not for want of a privilege: %s", strings.TrimSpace(err.Error()))
}
