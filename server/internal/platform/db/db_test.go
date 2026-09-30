package db_test

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

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
		"GRANT household_migrate, household_app, household_meter, household_powersync TO household_test_managed_admin WITH ADMIN OPTION",
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

// PowerSync's replication role is D-3's one exception (D-93): it holds REPLICATION, to stream the
// write-ahead log, and BYPASSRLS, to read the tables it replicates past their row-level security,
// and nothing else an administrator's role would.
func TestPowerSyncsRoleReplicatesAndIsNothingMore(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	var super, bypass, replication, createRole, createDB, login bool
	if err := admin.QueryRow(t.Context(),
		"SELECT rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname = $1",
		db.RolePowerSync).Scan(&super, &bypass, &replication, &createRole, &createDB, &login); err != nil {
		t.Fatal(err)
	}
	if super || !bypass || !replication || createRole || createDB || !login {
		t.Errorf("%s: superuser %t, bypassrls %t, replication %t, createrole %t, createdb %t, login %t",
			db.RolePowerSync, super, bypass, replication, createRole, createDB, login)
	}
}

// Only an administrator that holds REPLICATION and BYPASSRLS may give them (ADR 0004), which a
// managed database's may not: bootstrap then fails, naming what the administrator lacks, rather
// than making a role PowerSync cannot replicate as. The role and the administrator are made in a
// transaction the test rolls back.
func TestCreateRolesNamesWhatAnAdministratorLacksForPowerSync(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	tx, err := admin.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	for _, stmt := range []string{
		"SELECT pg_advisory_xact_lock(" + strconv.FormatInt(db.CatalogLock, 10) + ")",
		// The role drifted: a REPLICATION taken away, which bootstrap must give back.
		"ALTER ROLE household_powersync NOREPLICATION",
		"CREATE ROLE household_test_managed_admin NOLOGIN CREATEROLE BYPASSRLS",
		"GRANT household_migrate, household_app, household_meter, household_powersync TO household_test_managed_admin WITH ADMIN OPTION",
		"SET LOCAL ROLE household_test_managed_admin",
	} {
		if _, err := tx.Exec(t.Context(), stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	err = db.CreateRoles(t.Context(), tx, testsupport.Passwords)
	if err == nil || !strings.HasSuffix(err.Error(), "household_test_managed_admin lacks REPLICATION") {
		t.Fatalf("CreateRoles as an administrator without REPLICATION: %v", err)
	}
}

// statements records every statement a connection sends, with its arguments.
type statements struct{ sent []string }

func (s *statements) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	s.sent = append(s.sent, fmt.Sprint(data.SQL, data.Args))
	return ctx
}

func (*statements) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// A role statement's text is not private: PostgreSQL logs one that fails in full by
// default, and statement logging logs every one. CreateRoles sends each role's SCRAM secret
// and never its password, and the secret stored is that password's. The roles change in a
// transaction the test rolls back.
func TestCreateRolesSendsNoPassword(t *testing.T) {
	cfg, err := pgx.ParseConfig(testsupport.AdminURL())
	if err != nil {
		t.Fatal(err)
	}
	traced := &statements{}
	cfg.Tracer = traced
	admin, err := pgx.ConnectConfig(t.Context(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	tx, err := admin.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	passwords := db.Passwords{Migrate: "never-sent-migrate", App: "never-sent-app", Meter: "never-sent-meter", PowerSync: "never-sent-powersync"}
	if err := db.CreateRoles(t.Context(), tx, passwords); err != nil {
		t.Fatalf("CreateRoles: %v", err)
	}
	for _, s := range traced.sent {
		if strings.Contains(s, "never-sent") {
			t.Errorf("a statement carries a password: %s", s)
		}
	}
	for _, role := range db.ManagedRoles() {
		var stored string
		if err := tx.QueryRow(t.Context(), "SELECT rolpassword FROM pg_authid WHERE rolname = $1", role).Scan(&stored); err != nil {
			t.Fatal(err)
		}
		// SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>
		_, rest, _ := strings.Cut(stored, "$")
		params, _, _ := strings.Cut(rest, "$")
		count, encodedSalt, _ := strings.Cut(params, ":")
		iterations, err := strconv.Atoi(count)
		if err != nil {
			t.Fatalf("%s stores %q, not a SCRAM secret", role, stored)
		}
		salt, err := base64.StdEncoding.DecodeString(encodedSalt)
		if err != nil {
			t.Fatalf("%s stores %q, not a SCRAM secret", role, stored)
		}
		if want, err := db.ScramSecret(passwords.Of(role), salt, iterations); err != nil || stored != want {
			t.Errorf("%s stores %q, want the secret of its password, %q (%v)", role, stored, want, err)
		}
	}
}

// The secret PostgreSQL derives from a password itself (RFC 5802, RFC 7677), computed
// independently with Python's hashlib and hmac for a fixed salt.
func TestScramSecretIsTheOnePostgreSQLDerives(t *testing.T) {
	salt := make([]byte, 16)
	for i := range salt {
		salt[i] = byte(i)
	}
	got, err := db.ScramSecret("household_app", salt, 4096)
	want := "SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$" +
		"M7tCItLxEflmRdxeBVwT8GxANdr83m7cfBdo/10HMWk=:samGcdp6/DvAAdphf/5vcaRPMitfwWIYqiZSniPUrwg="
	if err != nil || got != want {
		t.Fatalf("ScramSecret = %q, %v; want %q", got, err, want)
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

// PowerSync's bucket storage is a database of its own, owned by a role of its own, which only that
// role and the administrator may connect to; prepared again, it changes nothing. The role and the
// database are the cluster's, so they go once the test is done.
func TestPrepareStorageMakesADatabaseOfItsOwn(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	suffix := strconv.FormatInt(int64(os.Getpid()), 10) + "_" + strconv.FormatInt(time.Now().UnixNano()%1_000_000, 10)
	storage := db.Storage{Role: "household_test_storage_" + suffix, Password: "storage", Database: "household_test_buckets_" + suffix}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{storage.Database}.Sanitize()+" WITH (FORCE)")
		_, _ = admin.Exec(ctx, "DROP ROLE IF EXISTS "+pgx.Identifier{storage.Role}.Sanitize())
	})
	for range 2 {
		if err := db.PrepareStorage(t.Context(), admin, storage); err != nil {
			t.Fatal(err)
		}
	}
	var owner string
	var acl []string
	if err := admin.QueryRow(t.Context(), "SELECT pg_get_userbyid(datdba), datacl::text[] FROM pg_database WHERE datname = $1",
		storage.Database).Scan(&owner, &acl); err != nil {
		t.Fatal(err)
	}
	if owner != storage.Role {
		t.Errorf("the bucket storage is owned by %s, want %s", owner, storage.Role)
	}
	for _, entry := range acl {
		if strings.HasPrefix(entry, "=") {
			t.Errorf("PUBLIC keeps %q on the bucket storage", entry)
		}
	}
	for _, role := range db.ManagedRoles() {
		var can bool
		if err := admin.QueryRow(t.Context(), "SELECT has_database_privilege($1, $2, 'CONNECT')", role, storage.Database).Scan(&can); err != nil || can {
			t.Errorf("%s may connect to the bucket storage (%v)", role, err)
		}
	}
	var replication, bypass bool
	if err := admin.QueryRow(t.Context(), "SELECT rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1", storage.Role).
		Scan(&replication, &bypass); err != nil || replication || bypass {
		t.Errorf("the storage's role: replication %t, bypassrls %t (%v)", replication, bypass, err)
	}
}

// Two bootstraps at once prepare one bucket storage: the database is made outside any transaction,
// and the second preparation waits for the first rather than finding it missing too and failing to
// make it again. The role and the database are the cluster's, so they go once the test is done.
func TestPrepareStorageTwiceAtOnce(t *testing.T) {
	admins := []*pgx.Conn{connect(t, testsupport.AdminURL()), connect(t, testsupport.AdminURL()), connect(t, testsupport.AdminURL())}
	suffix := strconv.FormatInt(int64(os.Getpid()), 10) + "_" + strconv.FormatInt(time.Now().UnixNano()%1_000_000, 10)
	storage := db.Storage{Role: "household_test_storage_" + suffix, Password: "storage", Database: "household_test_racing_" + suffix}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = admins[0].Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{storage.Database}.Sanitize()+" WITH (FORCE)")
		_, _ = admins[0].Exec(ctx, "DROP ROLE IF EXISTS "+pgx.Identifier{storage.Role}.Sanitize())
	})
	errs := make(chan error, len(admins))
	for _, admin := range admins {
		go func() { errs <- db.PrepareStorage(t.Context(), admin, storage) }()
	}
	for range admins {
		if err := <-errs; err != nil {
			t.Errorf("a preparation beside another: %v", err)
		}
	}
	var owner string
	if err := admins[0].QueryRow(t.Context(), "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = $1", storage.Database).
		Scan(&owner); err != nil || owner != storage.Role {
		t.Errorf("the bucket storage is owned by %q, want %s (%v)", owner, storage.Role, err)
	}
}

// The bucket storage's role is its own: PrepareStorage brings the role it is given down to a storage
// role's attributes and password, so it refuses the administrator's, which would lose what it
// prepares the cluster with, and a role the server or PowerSync's replication logs in as, before it
// alters anything.
func TestPrepareStorageRefusesARoleThatIsNotItsOwn(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	var administrator string
	var attributes []bool
	read := func() []bool {
		var super, createRole, createDB bool
		if err := admin.QueryRow(t.Context(), "SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1", administrator).
			Scan(&super, &createRole, &createDB); err != nil {
			t.Fatal(err)
		}
		return []bool{super, createRole, createDB}
	}
	if err := admin.QueryRow(t.Context(), "SELECT current_user::text").Scan(&administrator); err != nil {
		t.Fatal(err)
	}
	attributes = read()
	database := "household_test_refused_" + strconv.FormatInt(int64(os.Getpid()), 10)
	for _, role := range []string{administrator, db.RolePowerSync, db.RoleApp} {
		err := db.PrepareStorage(t.Context(), admin, db.Storage{Role: role, Password: "storage", Database: database})
		if err == nil || !strings.Contains(err.Error(), "a role of its own") {
			t.Errorf("the bucket storage owned by %s: %v", role, err)
		}
	}
	if got := read(); !slices.Equal(got, attributes) {
		t.Errorf("the administrator's superuser, createrole and createdb went from %v to %v", attributes, got)
	}
	var exists bool
	if err := admin.QueryRow(t.Context(), "SELECT EXISTS (SELECT FROM pg_database WHERE datname = $1)", database).Scan(&exists); err != nil || exists {
		t.Errorf("a refused storage made its database (%v)", err)
	}
}

// A database that exists and is not the storage role's, the cluster's maintenance database or
// another application's, is refused before anything changes: PrepareStorage would otherwise revoke
// PUBLIC's connections to it, and PowerSync could keep no buckets in it. The database is the
// cluster's, so it goes once the test is done.
func TestPrepareStorageRefusesADatabaseItDoesNotOwn(t *testing.T) {
	admin := connect(t, testsupport.AdminURL())
	suffix := strconv.FormatInt(int64(os.Getpid()), 10) + "_" + strconv.FormatInt(time.Now().UnixNano()%1_000_000, 10)
	storage := db.Storage{Role: "household_test_storage_" + suffix, Password: "storage", Database: "household_test_foreign_" + suffix}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{storage.Database}.Sanitize()+" WITH (FORCE)")
		_, _ = admin.Exec(ctx, "DROP ROLE IF EXISTS "+pgx.Identifier{storage.Role}.Sanitize())
	})
	// The administrator's, as another application's would be, open to PUBLIC as a database is made.
	if _, err := admin.Exec(t.Context(), "CREATE DATABASE "+pgx.Identifier{storage.Database}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	err := db.PrepareStorage(t.Context(), admin, storage)
	if err == nil || !strings.Contains(err.Error(), "a database of its own") {
		t.Fatalf("a database the storage's role does not own: %v", err)
	}
	var public, role bool
	if err := admin.QueryRow(t.Context(), `
		SELECT has_database_privilege('public', $1, 'CONNECT'), EXISTS (SELECT FROM pg_roles WHERE rolname = $2)`,
		storage.Database, storage.Role).Scan(&public, &role); err != nil {
		t.Fatal(err)
	}
	if !public || role {
		t.Errorf("a refused storage changed the cluster: PUBLIC may connect %t, the role made %t", public, role)
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
	// The package's database outlives the test, and `go test -count=2` runs it again.
	t.Cleanup(func() { _, _ = migrate.Exec(context.Background(), "DROP TABLE IF EXISTS privileges_probe") })

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
	// The package's database outlives the test, and `go test -count=2` runs it again: the
	// blocks below are undone, their tables and their goose versions both.
	t.Cleanup(func() {
		for _, stmt := range []string{
			"DROP TABLE IF EXISTS later_probe, earlier_probe, applies_probe",
			"DELETE FROM goose_db_version WHERE version_id IN (96001, 97001, 98001)",
		} {
			if _, err := sqlDB.ExecContext(context.Background(), stmt); err != nil {
				t.Errorf("clean up, %s: %v", stmt, err)
			}
		}
	})

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
