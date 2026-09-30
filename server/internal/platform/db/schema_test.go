package db_test

import (
	"context"
	"errors"
	"io/fs"
	"maps"
	"os"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
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

// Migration 01013 gives every membership that exists when it runs the grants the member list shows,
// and a child profile its PIN's lock, in every household at once, moving each membership's version
// once. It runs as the migrate role, which row-level security holds as it holds any other, so its
// backfill lifts FORCE from the two tables it reads for its one statement; FORCE is back on both
// once it commits. The test migrates a database of its own to the migration before, gives it two
// households' members, and migrates it the rest of the way.
func TestTheMembershipsThatExistAreGivenTheirGrants(t *testing.T) {
	ctx := t.Context()
	admin := connect(t, testsupport.AdminURL())
	fresh := &testsupport.Database{Name: "household_test_backfill_" + strconv.Itoa(os.Getpid()) + "_" +
		strconv.FormatInt(time.Now().UnixNano()%1_000_000, 10)}
	quoted := pgx.Identifier{fresh.Name}.Sanitize()
	// Made, and first connected to, under the catalog's lock, which another package's sweep of the
	// test databases nobody is connected to takes as well; dropped under it too.
	catalog := func(locked bool) {
		fn := "pg_advisory_unlock"
		if locked {
			fn = "pg_advisory_lock"
		}
		if _, err := admin.Exec(context.Background(), "SELECT "+fn+"($1)", db.CatalogLock); err != nil {
			t.Fatalf("%s: %v", fn, err)
		}
	}
	catalog(true)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		catalog(true)
		defer catalog(false)
		if _, err := admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+quoted+" WITH (FORCE)"); err != nil {
			t.Errorf("drop %s: %v", fresh.Name, err)
		}
	})
	if err := pgx.BeginFunc(ctx, admin, func(tx pgx.Tx) error { return db.PrepareDatabase(ctx, tx, fresh.Name) }); err != nil {
		t.Fatal(err)
	}
	// The administrator, whom no policy holds, arranges the rows.
	rows := connect(t, fresh.URL(""))
	catalog(false)

	cfg, err := pgx.ParseConfig(fresh.URL(db.RoleMigrate))
	if err != nil {
		t.Fatal(err)
	}
	migrate := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { _ = migrate.Close() })
	platform := db.Platform()
	before := fstest.MapFS{}
	entries, err := fs.ReadDir(platform.FS, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() >= "01013" {
			continue
		}
		data, err := fs.ReadFile(platform.FS, e.Name())
		if err != nil {
			t.Fatal(err)
		}
		before[e.Name()] = &fstest.MapFile{Data: data}
	}
	if _, err := db.Migrate(ctx, migrate, db.Block{Name: platform.Name, Number: platform.Number, FS: before}); err != nil {
		t.Fatalf("migrate to 01012: %v", err)
	}

	type member struct {
		household, user uuid.UUID
		role            access.Role
		stored          map[string]access.Level
		// failures are a child profile's wrong PINs since its last right one.
		failures int
	}
	home, cottage := idgen.New(), idgen.New()
	members := []member{
		{household: home, user: idgen.New(), role: access.Owner},
		{household: home, user: idgen.New(), role: access.Member,
			stored: map[string]access.Level{access.Finance: access.Manage, "tasks": access.View}},
		{household: home, user: idgen.New(), role: access.Child, failures: 10,
			stored: map[string]access.Level{access.Finance: access.Manage, "garden": access.Contribute}},
		{household: cottage, user: idgen.New(), role: access.Owner},
		{household: cottage, user: idgen.New(), role: access.Child, failures: 3},
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := rows.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`INSERT INTO country_profiles (code, name, currency, vat_standard_percent, default_units, first_day_of_week, holiday_set,
		inspection_label, document_type_set) VALUES ('CZ', '{"en": "Czechia"}', 'CZK', 21, 'metric', 1, 'cz', 'STK', 'cz')`)
	for _, h := range []uuid.UUID{home, cottage} {
		exec(testsupport.InsertHousehold, h)
	}
	for _, m := range members {
		exec("INSERT INTO users (id, display_name) VALUES ($1, 'Member')", m.user)
		exec(testsupport.InsertMember, m.household, m.user, string(m.role))
		for module, level := range m.stored {
			exec("INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)",
				m.household, m.user, module, level.String())
		}
		if m.role == access.Child {
			exec("INSERT INTO credentials (user_id, type, secret, failures) VALUES ($1, 'child_pin', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA', $2)",
				m.user, m.failures)
		}
	}

	if _, err := db.Migrate(ctx, migrate, platform); err != nil {
		t.Fatalf("migrate the rest of the way: %v", err)
	}
	modules, err := pgx.CollectRows(func() pgx.Rows {
		r, err := rows.Query(ctx, "SELECT id FROM modules")
		if err != nil {
			t.Fatal(err)
		}
		return r
	}(), pgx.RowTo[string])
	if err != nil || len(modules) == 0 {
		t.Fatalf("the modules: %v %v", modules, err)
	}
	for _, m := range members {
		var (
			grants  map[string]string
			locked  bool
			version int64
		)
		if err := rows.QueryRow(ctx, "SELECT grants, pin_locked, version FROM memberships WHERE household_id = $1 AND user_id = $2",
			m.household, m.user).Scan(&grants, &locked, &version); err != nil {
			t.Fatal(err)
		}
		want := map[string]string{}
		for _, module := range modules {
			level := access.Manage
			if m.role != access.Owner {
				level = min(m.stored[module], access.Ceiling(m.role, module))
			}
			want[module] = level.String()
		}
		if !maps.Equal(grants, want) || locked != (m.failures >= 10) || version != 2 {
			t.Errorf("a %s: grants %v, pin_locked %t, version %d; want %v, %t, 2", m.role, grants, locked, version, want, m.failures >= 10)
		}
	}
	var forced int
	if err := rows.QueryRow(ctx, `
		SELECT count(*) FROM pg_class WHERE oid IN ('memberships'::regclass, 'module_grants'::regclass) AND relforcerowsecurity`,
	).Scan(&forced); err != nil || forced != 2 {
		t.Errorf("%d of memberships and module_grants force row-level security once 01013 has run, want 2 (%v)", forced, err)
	}
}
