package db_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// migrateTx opens a transaction as the migrate role on the package's database, rolled back when
// t finishes, so that what a test creates in it is never seen by another.
func migrateTx(t *testing.T) pgx.Tx {
	t.Helper()
	conn := connect(t, testsupport.Open(t).URL(db.RoleMigrate))
	tx, err := conn.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	return tx
}

// add_entity_columns gives a table the base columns only once it has the two a module declares
// itself: id uuid alone as its primary key, and household_id uuid NOT NULL.
func TestAddEntityColumnsNeedsTheModulesOwnColumns(t *testing.T) {
	for name, tc := range map[string]struct {
		table string
		want  string
	}{
		"no primary key":               {"(id uuid, household_id uuid NOT NULL)", "needs id uuid PRIMARY KEY"},
		"a text key":                   {"(id text PRIMARY KEY, household_id uuid NOT NULL)", "needs id uuid PRIMARY KEY"},
		"a composite key":              {"(id uuid, household_id uuid NOT NULL, PRIMARY KEY (household_id, id))", "needs id uuid PRIMARY KEY"},
		"no household":                 {"(id uuid PRIMARY KEY)", "needs household_id uuid NOT NULL"},
		"a household that may be NULL": {"(id uuid PRIMARY KEY, household_id uuid)", "needs household_id uuid NOT NULL"},
	} {
		t.Run(name, func(t *testing.T) {
			tx := migrateTx(t)
			if _, err := tx.Exec(t.Context(), "CREATE TABLE entity_probe "+tc.table); err != nil {
				t.Fatal(err)
			}
			_, err := tx.Exec(t.Context(), "SELECT add_entity_columns('entity_probe')")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("add_entity_columns: %v, want an error saying %q", err, tc.want)
			}
		})
	}
}

// The feed is partitioned by month, and a row lands in the partition of the month it occurred
// in; a row whose month has no partition yet lands in the default one rather than failing. Each
// partition the maintenance adds is held to the tenant isolation and reached by the request role
// only through its parent.
func TestTheFeedIsPartitionedByMonth(t *testing.T) {
	tx := migrateTx(t)
	ctx := t.Context()
	if _, err := tx.Exec(ctx, "SELECT sync_changes_add_partitions(3)"); err != nil {
		t.Fatalf("adding partitions that exist: %v", err)
	}
	var household string
	if err := tx.QueryRow(ctx, "SELECT gen_random_uuid()::text").Scan(&household); err != nil {
		t.Fatal(err)
	}
	// The migrate role owns the tables, and is held to their policies like anyone: it writes in
	// the household's context.
	if _, err := tx.Exec(ctx, "SELECT set_config('app.household_id', $1, true)", household); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, testsupport.InsertHousehold, household); err != nil {
		t.Fatal(err)
	}
	for _, occurred := range []string{"now()", "now() + interval '10 years'"} {
		if _, err := tx.Exec(ctx, `
			INSERT INTO sync_changes (household_id, entity_type, entity_id, op, row_version, module, payload, occurred_at)
			VALUES ($1, 'tasks.card', gen_random_uuid(), 'upsert', 1, 'tasks', '{}', `+occurred+`)`, household); err != nil {
			t.Fatalf("a change at %s: %v", occurred, err)
		}
	}
	rows, err := tx.Query(ctx, `
		SELECT tableoid::regclass::text FROM sync_changes WHERE household_id = $1 ORDER BY occurred_at`, household)
	if err != nil {
		t.Fatal(err)
	}
	partitions, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	var thisMonth string
	if err := tx.QueryRow(ctx, "SELECT 'sync_changes_y' || to_char(now() AT TIME ZONE 'UTC', 'YYYY\"m\"MM')").Scan(&thisMonth); err != nil {
		t.Fatal(err)
	}
	if len(partitions) != 2 || partitions[0] != thisMonth || partitions[1] != "sync_changes_default" {
		t.Fatalf("the changes landed in %v, want [%s sync_changes_default]", partitions, thisMonth)
	}

	// The template this database was cloned from may have been migrated in an earlier month, and
	// kept its partitions from then: which partitions exist beyond this month and the three after
	// it depends on when, so the test counts rather than expects a number.
	var total, ahead, isolated, reachable int
	if err := tx.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE c.relname IN (
		         SELECT 'sync_changes_y' || to_char(m, 'YYYY"m"MM')
		         FROM generate_series(date_trunc('month', now() AT TIME ZONE 'UTC'),
		                              date_trunc('month', now() AT TIME ZONE 'UTC') + interval '3 months', interval '1 month') m)),
		       count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity
		                          AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation')),
		       count(*) FILTER (WHERE has_table_privilege($1::name, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
		FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'sync_changes'::regclass`, db.RoleApp).Scan(&total, &ahead, &isolated, &reachable); err != nil {
		t.Fatal(err)
	}
	if ahead != 4 || isolated != total || reachable != 0 {
		t.Fatalf("%d of this month and the three after it have a partition, %d of the %d partitions are isolated, %d reachable by the request role",
			ahead, isolated, total, reachable)
	}
}

// The request role may not add a partition, nor call what does: it creates nothing.
func TestTheRequestRoleCannotAddPartitions(t *testing.T) {
	app := connect(t, testsupport.Open(t).URL(db.RoleApp))
	_, err := app.Exec(t.Context(), "SELECT sync_changes_add_partitions(24)")
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Fatalf("as the request role, sync_changes_add_partitions: %v; want insufficient_privilege (42501)", err)
	}
}
