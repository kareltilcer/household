package testsupport

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// Passwords are the role passwords the tests log in with, which they set on the cluster's
// roles. They are the local development defaults in .env.example, so the tests and a
// locally running server agree.
var Passwords = db.Passwords{
	Migrate: "household_migrate",
	App:     "household_app",
	Meter:   "household_meter",
}

// Blocks are the migrations the template database is built from.
var Blocks = []db.Block{db.Platform()}

// templateFormat changes when the way a template is prepared changes, so that templates
// built the old way are rebuilt rather than reused.
const templateFormat = "1"

// staleAfter is how old a test database must be before a later run drops it as left over
// by a run that was killed before it could clean up.
const staleAfter = 6 * time.Hour

const (
	templatePrefix = "household_template_"
	clonePrefix    = "household_test_"
)

// Database is one test package's database: a clone of a template built by migrating an
// empty database with Blocks.
type Database struct {
	Name string
}

var current *Database

// Main creates this package's database, runs the package's tests, drops the database and
// exits. A package whose tests call Open calls it from TestMain:
//
//	func TestMain(m *testing.M) { testsupport.Main(m) }
//
// A cluster that cannot be reached fails the package; it does not skip it.
func Main(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	d, err := create(ctx)
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "testsupport: create the test database (start PostgreSQL with `pnpm run up`, or set %s): %v\n", DatabaseURLEnv, err)
		return 1
	}
	current = d
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := drop(ctx, d.Name); err != nil {
			fmt.Fprintf(os.Stderr, "testsupport: drop %s: %v\n", d.Name, err)
		}
	}()
	return m.Run()
}

// Open returns this package's database. It fails the test when the package's TestMain
// does not call Main.
func Open(t testing.TB) *Database {
	t.Helper()
	if current == nil {
		t.Fatal("testsupport: this package's TestMain must call testsupport.Main")
	}
	return current
}

// URL returns the connection string for role on this database.
func (d *Database) URL(role string) string {
	u, err := databaseURL(d.Name, role)
	if err != nil {
		panic(err) // create parsed the same URL already.
	}
	return u
}

// AdminURL returns the connection string for the cluster's administrator: the role and
// the maintenance database HOUSEHOLD_TEST_DATABASE_URL names. Anything that alters the
// roles connects here, never to a test database, because the lock that keeps two such
// sessions apart (db.CatalogLock) is an advisory lock, and those are scoped to a database.
func AdminURL() string { return DatabaseURL() }

// Pool returns a pool on this database connected as role, closed when t finishes.
func (d *Database) Pool(t testing.TB, role string) *pgxpool.Pool {
	t.Helper()
	pool, err := db.Open(t.Context(), d.URL(role), "household-test")
	if err != nil {
		t.Fatalf("open a pool as %s: %v", role, err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// databaseURL rewrites DatabaseURL to name database and, unless role is empty, to log in
// as role with its test password.
func databaseURL(database, role string) (string, error) {
	u, err := url.Parse(DatabaseURL())
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return "", fmt.Errorf("%s must be a postgres:// URL", DatabaseURLEnv)
	}
	u.Path = "/" + database
	if role != "" {
		password := map[string]string{
			db.RoleMigrate: Passwords.Migrate,
			db.RoleApp:     Passwords.App,
			db.RoleMeter:   Passwords.Meter,
		}[role]
		if password == "" {
			return "", fmt.Errorf("no test password for role %q", role)
		}
		u.User = url.UserPassword(role, password)
	}
	return u.String(), nil
}

// create makes sure the roles and the template exist, and clones the template.
func create(ctx context.Context) (*Database, error) {
	if _, err := databaseURL("x", ""); err != nil {
		return nil, err
	}
	admin, err := pgx.Connect(ctx, DatabaseURL())
	if err != nil {
		return nil, err
	}
	defer func() { _ = admin.Close(context.Background()) }()
	unlock, err := lockCatalog(ctx, admin)
	if err != nil {
		return nil, err
	}
	defer unlock()

	if err := pgx.BeginFunc(ctx, admin, func(tx pgx.Tx) error {
		return db.CreateRoles(ctx, tx, Passwords)
	}); err != nil {
		return nil, fmt.Errorf("roles: %w", err)
	}

	template, err := templateName()
	if err != nil {
		return nil, err
	}
	if err := ensureTemplate(ctx, admin, template); err != nil {
		return nil, fmt.Errorf("template %s: %w", template, err)
	}
	sweep(ctx, admin, template)

	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	name := clonePrefix + strconv.FormatInt(time.Now().Unix(), 10) + "_" + hex.EncodeToString(suffix)
	if err := exec(ctx, admin, "CREATE DATABASE %I TEMPLATE %I", name, template); err != nil {
		return nil, fmt.Errorf("clone: %w", err)
	}
	if err := pgx.BeginFunc(ctx, admin, func(tx pgx.Tx) error {
		return db.PrepareDatabase(ctx, tx, name)
	}); err != nil {
		return nil, fmt.Errorf("prepare %s: %w", name, err)
	}
	return &Database{Name: name}, nil
}

// templateName names the template after what built it, so a change to any migration
// builds a new one and a template is never reused for a schema it does not have.
func templateName() (string, error) {
	fsys, err := db.Assemble(Blocks...)
	if err != nil {
		return "", err
	}
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte(templateFormat))
	for _, e := range entries {
		data, err := fs.ReadFile(fsys, e.Name())
		if err != nil {
			return "", err
		}
		_, _ = fmt.Fprintf(h, "\x00%s\x00%d\x00", e.Name(), len(data))
		h.Write(data)
	}
	return templatePrefix + hex.EncodeToString(h.Sum(nil))[:16], nil
}

// ensureTemplate builds the template unless it exists. It builds under another name and
// renames the result, so a build that dies halfway leaves nothing a later run would take
// for a finished template.
func ensureTemplate(ctx context.Context, admin *pgx.Conn, template string) error {
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT FROM pg_database WHERE datname = $1)", template).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	build := template + "_build"
	if err := exec(ctx, admin, "DROP DATABASE IF EXISTS %I WITH (FORCE)", build); err != nil {
		return err
	}
	if err := exec(ctx, admin, "CREATE DATABASE %I", build); err != nil {
		return err
	}
	if err := pgx.BeginFunc(ctx, admin, func(tx pgx.Tx) error {
		return db.PrepareDatabase(ctx, tx, build)
	}); err != nil {
		return err
	}
	if err := migrate(ctx, build); err != nil {
		return err
	}
	return exec(ctx, admin, "ALTER DATABASE %I RENAME TO %I", build, template)
}

// migrate applies Blocks to database as the migrate role, as a deploy does.
func migrate(ctx context.Context, database string) error {
	u, err := databaseURL(database, db.RoleMigrate)
	if err != nil {
		return err
	}
	cfg, err := pgx.ParseConfig(u)
	if err != nil {
		return err
	}
	// Closed before the rename that follows, which fails while any session is connected.
	sqlDB := stdlib.OpenDB(*cfg)
	defer func() { _ = sqlDB.Close() }()
	_, err = db.Migrate(ctx, sqlDB, Blocks...)
	return err
}

// sweep drops templates for other migration sets, half-built templates, and test databases
// left behind by runs that were killed, as long as nothing is connected to them. A
// template is only ever built under db.CatalogLock, which the caller holds, so a *_build
// database found here is one whose build died. A failure is not the run's concern: the
// next run sweeps again.
func sweep(ctx context.Context, admin *pgx.Conn, keep string) {
	rows, err := admin.Query(ctx, `
		SELECT datname FROM pg_database d
		WHERE (datname LIKE 'household\_template\_%' OR datname LIKE 'household\_test\_%')
		  AND NOT EXISTS (SELECT FROM pg_stat_activity a WHERE a.datname = d.datname)`)
	if err != nil {
		return
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-staleAfter).Unix()
	for _, name := range names {
		switch {
		case name == keep:
			continue
		case strings.HasPrefix(name, clonePrefix):
			stamp, _, _ := strings.Cut(strings.TrimPrefix(name, clonePrefix), "_")
			if created, err := strconv.ParseInt(stamp, 10, 64); err != nil || created > cutoff {
				continue
			}
		}
		_ = exec(ctx, admin, "DROP DATABASE IF EXISTS %I", name)
	}
}

// drop removes a test database, disconnecting any session a test left open.
func drop(ctx context.Context, name string) error {
	admin, err := pgx.Connect(ctx, DatabaseURL())
	if err != nil {
		return err
	}
	defer func() { _ = admin.Close(context.Background()) }()
	unlock, err := lockCatalog(ctx, admin)
	if err != nil {
		return err
	}
	defer unlock()
	return exec(ctx, admin, "DROP DATABASE IF EXISTS %I WITH (FORCE)", name)
}

// lockCatalog takes db.CatalogLock for the session, so that creating and dropping
// databases never runs beside a bootstrap altering the roles that own them, nor beside
// another test process doing the same: `go test ./...` runs packages in parallel, and
// CREATE DATABASE cannot copy a template another session is connected to.
func lockCatalog(ctx context.Context, admin *pgx.Conn) (unlock func(), err error) {
	if _, err := admin.Exec(ctx, "SELECT pg_advisory_lock($1)", db.CatalogLock); err != nil {
		return nil, fmt.Errorf("lock: %w", err)
	}
	return func() {
		_, _ = admin.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", db.CatalogLock)
	}, nil
}

// exec runs a statement whose identifiers are quoted by PostgreSQL's format(). CREATE
// and DROP DATABASE take no bind parameters and cannot run in a transaction.
func exec(ctx context.Context, conn *pgx.Conn, format string, identifiers ...string) error {
	args := []any{format}
	placeholders := ""
	for i, id := range identifiers {
		args = append(args, id)
		placeholders += ", $" + strconv.Itoa(i+2) + "::text"
	}
	var stmt string
	if err := conn.QueryRow(ctx, "SELECT format($1::text"+placeholders+")", args...).Scan(&stmt); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, stmt); err != nil {
		return fmt.Errorf("%s: %w", stmt, err)
	}
	return nil
}
