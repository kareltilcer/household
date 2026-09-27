package db_test

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

func connect(t *testing.T, url string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(t.Context(), url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

// PRD 01 §2.3 and D-3: no role the server uses is a superuser or may bypass row-level
// security, and there is no other way in.
func TestTheRolesCannotBypassRowLevelSecurity(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	for _, role := range db.Roles {
		var super, bypass, createRole, createDB, login bool
		err := admin.QueryRow(t.Context(),
			"SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname = $1", role,
		).Scan(&super, &bypass, &createRole, &createDB, &login)
		if err != nil {
			t.Fatalf("%s: %v", role, err)
		}
		if super || bypass || createRole || createDB || !login {
			t.Errorf("%s: superuser %t, bypassrls %t, createrole %t, createdb %t, login %t", role, super, bypass, createRole, createDB, login)
		}
	}
}

// A BYPASSRLS granted by hand does not survive the next bootstrap. Role changes are
// transactional, so the test makes and checks them in a transaction it rolls back, and no
// other test on the cluster ever sees the grant.
func TestCreateRolesRestoresTheAttributes(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	tx, err := admin.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	// The lock CreateRoles would take anyway, taken before the role is touched: a test
	// process setting up its database alters the same role.
	if _, err := tx.Exec(t.Context(), "SELECT pg_advisory_xact_lock($1)", db.CatalogLock); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(t.Context(), "ALTER ROLE household_app BYPASSRLS CREATEDB"); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateRoles(t.Context(), tx, testsupport.Passwords); err != nil {
		t.Fatalf("CreateRoles: %v", err)
	}
	var bypass, createDB bool
	if err := tx.QueryRow(t.Context(), "SELECT rolbypassrls, rolcreatedb FROM pg_roles WHERE rolname = 'household_app'").Scan(&bypass, &createDB); err != nil {
		t.Fatal(err)
	}
	if bypass || createDB {
		t.Fatalf("after CreateRoles: bypassrls %t, createdb %t", bypass, createDB)
	}
}

// A managed database's administrator may create roles but is no superuser, and PostgreSQL
// 16 and later refuse a NOSUPERUSER, NOREPLICATION or NOBYPASSRLS clause from it. The
// bootstrap after the first must still run: roles whose attributes have not drifted get
// only their password set. The administrator exists only in the transaction the test
// rolls back.
func TestCreateRolesRunsAgainForAnAdministratorWhoIsNoSuperuser(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	tx, err := admin.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	for _, stmt := range []string{
		"SELECT pg_advisory_xact_lock(" + strconv.FormatInt(db.CatalogLock, 10) + ")",
		"CREATE ROLE household_test_managed_admin NOLOGIN CREATEROLE",
		"GRANT household_migrate, household_app, household_meter TO household_test_managed_admin WITH ADMIN OPTION",
		"SET LOCAL ROLE household_test_managed_admin",
	} {
		if _, err := tx.Exec(t.Context(), stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	if err := db.CreateRoles(t.Context(), tx, testsupport.Passwords); err != nil {
		t.Fatalf("CreateRoles as a non-superuser administrator: %v", err)
	}
}

func TestCreateRolesRefusesAMissingPassword(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	tx, err := admin.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	passwords := testsupport.Passwords
	passwords.Meter = ""
	if err := db.CreateRoles(t.Context(), tx, passwords); err == nil || !strings.Contains(err.Error(), "household_meter") {
		t.Fatalf("CreateRoles without the meter's password: %v", err)
	}
}

func TestBootstrapIsSafeToRunAgain(t *testing.T) {
	d := testsupport.Open(t)
	admin := connect(t, testsupport.AdminURL())
	for range 2 {
		if err := db.Bootstrap(t.Context(), admin, d.Name, testsupport.Passwords); err != nil {
			t.Fatalf("Bootstrap: %v", err)
		}
	}
	var owner string
	var acl []string
	if err := admin.QueryRow(t.Context(),
		"SELECT pg_get_userbyid(datdba), datacl::text[] FROM pg_database WHERE datname = $1", d.Name,
	).Scan(&owner, &acl); err != nil {
		t.Fatal(err)
	}
	if owner != db.RoleMigrate {
		t.Errorf("the database is owned by %s, want %s", owner, db.RoleMigrate)
	}
	for _, entry := range acl {
		if strings.HasPrefix(entry, "=") {
			t.Errorf("PUBLIC keeps %q on the database", entry)
		}
	}
	if err := db.Bootstrap(t.Context(), admin, "", testsupport.Passwords); err == nil {
		t.Error("Bootstrap without a database succeeded")
	}
}

// The request role reads and writes the rows of what the migrate role creates, and
// creates nothing itself.
func TestTheRequestRoleUsesTablesAndCreatesNone(t *testing.T) {
	d := testsupport.Open(t)
	migrate := connect(t, d.URL(db.RoleMigrate))
	if _, err := migrate.Exec(t.Context(), "CREATE TABLE privileges_probe (id bigint PRIMARY KEY, note text)"); err != nil {
		t.Fatalf("the migrate role cannot create a table: %v", err)
	}

	app := connect(t, d.URL(db.RoleApp))
	for _, stmt := range []string{
		"INSERT INTO privileges_probe VALUES (1, 'a')",
		"UPDATE privileges_probe SET note = 'b' WHERE id = 1",
		"SELECT note FROM privileges_probe",
		"DELETE FROM privileges_probe WHERE id = 1",
	} {
		if _, err := app.Exec(t.Context(), stmt); err != nil {
			t.Errorf("as the request role, %s: %v", stmt, err)
		}
	}
	for _, stmt := range []string{
		"CREATE TABLE app_made (id bigint)",
		"DROP TABLE privileges_probe",
		"ALTER TABLE privileges_probe ADD COLUMN extra text",
		"TRUNCATE privileges_probe",
		"SET ROLE household_migrate",
	} {
		_, err := app.Exec(t.Context(), stmt)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Errorf("as the request role, %s: %v; want insufficient_privilege (42501)", stmt, err)
		}
	}

	meter := connect(t, d.URL(db.RoleMeter))
	if _, err := meter.Exec(t.Context(), "SELECT count(*) FROM privileges_probe"); err == nil {
		t.Error("the meter role reads a table nobody granted it")
	}
}

func TestMigrateAppliesEachMigrationOnce(t *testing.T) {
	cfg, err := pgx.ParseConfig(testsupport.Open(t).URL(db.RoleMigrate))
	if err != nil {
		t.Fatal(err)
	}
	sqlDB := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { _ = sqlDB.Close() })

	// The package's database was cloned from a template the platform block already ran on.
	results, err := db.Migrate(t.Context(), sqlDB, db.Platform())
	if err != nil || len(results) != 0 {
		t.Fatalf("Migrate on a migrated database: %d applied, %v", len(results), err)
	}

	later := db.Block{Name: "later", Number: 98, FS: fstest.MapFS{
		"98001_later.sql": {Data: []byte("-- +goose Up\nCREATE TABLE later_probe (id bigint);\n")},
	}}
	if results, err := db.Migrate(t.Context(), sqlDB, db.Platform(), later); err != nil || len(results) != 1 {
		t.Fatalf("Migrate with block 98: %d applied, %v", len(results), err)
	}

	// A block numbered below one that has run: a module merged after another, whose
	// migrations have lower versions. Allowed, since blocks own disjoint tables.
	earlier := db.Block{Name: "earlier", Number: 97, FS: fstest.MapFS{
		"97001_earlier.sql": {Data: []byte("-- +goose Up\nCREATE TABLE earlier_probe (id bigint);\n")},
	}}
	results, err = db.Migrate(t.Context(), sqlDB, db.Platform(), later, earlier)
	if err != nil || len(results) != 1 || results[0].Source.Version != 97001 {
		t.Fatalf("Migrate with block 97 after 98: %v, %v", results, err)
	}

	// A run that fails partway still reports what it applied before the failure, which
	// stays applied: the deploy's log is where an operator learns it.
	failing := db.Block{Name: "failing", Number: 96, FS: fstest.MapFS{
		"96001_applies.sql": {Data: []byte("-- +goose Up\nCREATE TABLE applies_probe (id bigint);\n")},
		"96002_fails.sql":   {Data: []byte("-- +goose Up\nSELECT * FROM no_such_table;\n")},
	}}
	results, err = db.Migrate(t.Context(), sqlDB, db.Platform(), later, earlier, failing)
	if err == nil || len(results) != 1 || results[0].Source.Version != 96001 {
		t.Fatalf("Migrate with a failing migration: %v, %v", results, err)
	}
}

func TestAssembleRefusesWhatIsNotAForwardOnlyBlock(t *testing.T) {
	up := []byte("-- +goose Up\nSELECT 1;\n")
	block := func(number int, files map[string][]byte) db.Block {
		fsys := fstest.MapFS{}
		for name, data := range files {
			fsys[name] = &fstest.MapFile{Data: data}
		}
		return db.Block{Name: "b" + string(rune('a'+number%26)), Number: number, FS: fsys}
	}
	for name, blocks := range map[string][]db.Block{
		"number 0":        {block(0, map[string][]byte{"00001_a.sql": up})},
		"number 100":      {block(100, map[string][]byte{"100001_a.sql": up})},
		"shared number":   {block(20, map[string][]byte{"20001_a.sql": up}), {Name: "other", Number: 20, FS: fstest.MapFS{}}},
		"shared name":     {{Name: "x", Number: 20, FS: fstest.MapFS{}}, {Name: "x", Number: 21, FS: fstest.MapFS{}}},
		"another block's": {block(20, map[string][]byte{"21001_a.sql": up})},
		"sequence 000":    {block(20, map[string][]byte{"20000_a.sql": up})},
		"no description":  {block(20, map[string][]byte{"20001.sql": up})},
		"CamelCase name":  {block(20, map[string][]byte{"20001_AddThing.sql": up})},
		"not SQL":         {block(20, map[string][]byte{"README.md": []byte("x")})},
		"a Down section":  {block(20, map[string][]byte{"20001_a.sql": []byte("-- +goose Up\nSELECT 1;\n-- +goose Down\nSELECT 2;\n")})},
		// goose reads annotations regardless of case and spacing.
		"a lowercase Down": {block(20, map[string][]byte{"20001_a.sql": []byte("-- +goose Up\nSELECT 1;\n-- +goose down\nSELECT 2;\n")})},
		"a Down unspaced":  {block(20, map[string][]byte{"20001_a.sql": []byte("-- +goose Up\nSELECT 1;\n--+goose Down\nSELECT 2;\n")})},
		"no Up annotation": {block(20, map[string][]byte{"20001_a.sql": []byte("SELECT 1;\n")})},
		"a subdirectory":   {block(20, map[string][]byte{"sub/20001_a.sql": up})},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := db.Assemble(blocks...); err == nil {
				t.Fatal("Assemble succeeded")
			}
		})
	}
	lowerUp := []byte("-- +goose up\nSELECT 1;\n")
	if _, err := db.Assemble(db.Platform(), block(20, map[string][]byte{"20001_a.sql": up, "20002_b_c.sql": lowerUp})); err != nil {
		t.Fatalf("Assemble refused good blocks: %v", err)
	}
}
