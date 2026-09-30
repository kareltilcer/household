package db

import (
	"context"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/text/secure/precis"
)

// The three roles of PRD 01 §2.3, which the server runs as. None is a superuser or may bypass
// row-level security; there is deliberately no support role and no bypass role (D-3). The one
// exception D-93 makes is no role of the server's: RolePowerSync, PowerSync's own.
const (
	// RoleMigrate owns the database and every table in it, and is used only to migrate,
	// at deploy time. As owner it would bypass row-level security, which is why every
	// tenant table forces it (PRD 01 §2.2).
	RoleMigrate = "household_migrate"
	// RoleApp serves every request. It owns nothing and creates nothing; it reads and
	// writes rows through the privileges the platform migration block grants it.
	RoleApp = "household_app"
	// RoleMeter is the nightly storage and usage sampler, which reads aggregate columns
	// only (item 14 grants them).
	RoleMeter = "household_meter"
)

// RolePowerSync is the role PowerSync replicates as (ADR 0001, D-93): REPLICATION, to stream the
// write-ahead log, and BYPASSRLS, since every tenant table forces row-level security and PowerSync
// sets no tenant, so that without it the engine could read no table's first snapshot. BYPASSRLS
// grants no privilege: it queries through a SELECT on each table of the powersync publication, which
// the migration that publishes the table grants (replicate), and on no other. REPLICATION is held to
// none of those grants: logical decoding checks no table's privileges, so whoever holds the
// credential may open a replication slot of their own, with an output plugin such as test_decoding,
// and read every change to every table of the database, the account tables among them. The grants
// bound what PowerSync queries; the credential is as sensitive as the database's own. It is D-3's one
// exception, the sync service's own credential, which no staff member or tool connects with; the
// generated streams and the read-path isolation test hold the tenant boundary it passes.
const RolePowerSync = "household_powersync"

// Roles lists the three roles the server runs as.
var Roles = []string{RoleMigrate, RoleApp, RoleMeter}

// managed are the roles CreateRoles makes, each with the attributes it holds: the three the server
// runs as, and PowerSync's.
var managed = []struct {
	role  string
	wants roleAttributes
}{
	{RoleMigrate, roleAttributes{login: true}},
	{RoleApp, roleAttributes{login: true}},
	{RoleMeter, roleAttributes{login: true}},
	{RolePowerSync, roleAttributes{login: true, replication: true, bypassRLS: true}},
}

// ManagedRoles lists the roles CreateRoles makes, in the order it makes them: the three the server
// runs as, and PowerSync's.
func ManagedRoles() []string {
	out := make([]string, len(managed))
	for i, m := range managed {
		out[i] = m.role
	}
	return out
}

// Passwords are the login passwords Bootstrap sets, one per role.
type Passwords struct {
	Migrate, App, Meter, PowerSync string
}

// Of returns role's password, or "" for a role that is not one of the four.
func (p Passwords) Of(role string) string {
	switch role {
	case RoleMigrate:
		return p.Migrate
	case RoleApp:
		return p.App
	case RoleMeter:
		return p.Meter
	case RolePowerSync:
		return p.PowerSync
	}
	return ""
}

// CatalogLock is the advisory lock key that serialises changes to the three roles and to
// the databases they own. CreateRoles and PrepareDatabase hold it for their transaction;
// the tests hold it while they create and drop databases. PostgreSQL does not queue these
// behind one another: two ALTER ROLEs on one role, or an ALTER ROLE beside a CREATE or DROP
// DATABASE, fail with "tuple concurrently updated".
//
// An advisory lock is scoped to the database of the session that takes it, so it
// serialises only sessions connected to the same database. Every administrator connection
// that alters roles connects to one: the database of HOUSEHOLD_ADMIN_DATABASE_URL, and in
// the tests the maintenance database HOUSEHOLD_TEST_DATABASE_URL names.
const CatalogLock int64 = 0x686f7573_65686f6c // "househol"

// roleAttributes are a role's attributes, as pg_roles reports them: those a role holds, and those
// CreateRoles gives each role it makes (managed), whatever it held before. Bootstrap creates a
// role with them and restores any that drifted on a role that already exists, so a BYPASSRLS
// granted by hand does not survive a deploy.
type roleAttributes struct {
	login, super, createDB, createRole, replication, bypassRLS bool
}

// roleClauses are the clauses that make a role wants from one that is have: every attribute when
// create, else only those that differ. PostgreSQL 16 and later refuse a SUPERUSER, REPLICATION or
// BYPASSRLS clause, the NO form included, from an administrator without that attribute, which a
// managed database's administrator is: restating every clause would fail each run after the
// first. A clause that did drift is still named, and fails loudly when the administrator cannot
// undo it.
func roleClauses(wants, have roleAttributes, create bool) string {
	var out string
	for _, c := range []struct {
		wants, have bool
		yes, no     string
	}{
		{wants.login, have.login, "LOGIN", "NOLOGIN"},
		{wants.super, have.super, "SUPERUSER", "NOSUPERUSER"},
		{wants.createDB, have.createDB, "CREATEDB", "NOCREATEDB"},
		{wants.createRole, have.createRole, "CREATEROLE", "NOCREATEROLE"},
		{wants.replication, have.replication, "REPLICATION", "NOREPLICATION"},
		{wants.bypassRLS, have.bypassRLS, "BYPASSRLS", "NOBYPASSRLS"},
	} {
		if !create && c.wants == c.have {
			continue
		}
		if c.wants {
			out += c.yes + " "
		} else {
			out += c.no + " "
		}
	}
	return out
}

// grantable returns why the administrator tx is connected as cannot give role REPLICATION and
// BYPASSRLS, "" when it can: PostgreSQL lets only a superuser, or a role holding each attribute,
// grant it (ADR 0004), and a managed database's administrator may hold neither.
func grantable(ctx context.Context, tx pgx.Tx, role string) (string, error) {
	var admin string
	var a roleAttributes
	if err := tx.QueryRow(ctx,
		"SELECT rolname, rolsuper, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user",
	).Scan(&admin, &a.super, &a.replication, &a.bypassRLS); err != nil {
		return "", fmt.Errorf("look up the administrator: %w", err)
	}
	if a.super {
		return "", nil
	}
	var missing []string
	if !a.replication {
		missing = append(missing, "REPLICATION")
	}
	if !a.bypassRLS {
		missing = append(missing, "BYPASSRLS")
	}
	if len(missing) == 0 {
		return "", nil
	}
	return fmt.Sprintf("%s needs REPLICATION and BYPASSRLS, which only an administrator holding them may give, and %s lacks %s",
		role, admin, strings.Join(missing, " and ")), nil
}

// Bootstrap creates the three roles and PowerSync's, or restores an existing one's attributes
// and sets its password, and then prepares database: the migrate role owns it, and only the four
// roles and the caller may connect to it. It runs as a role that may create roles, a
// superuser locally and in CI, and is safe to run again.
//
// No password travels in a statement, only its SCRAM secret (see scramSecret), so neither
// statement logging nor the log of a statement that failed can record one.
func Bootstrap(ctx context.Context, admin *pgx.Conn, database string, passwords Passwords) error {
	if database == "" {
		return errors.New("db: bootstrap: no database")
	}
	return pgx.BeginFunc(ctx, admin, func(tx pgx.Tx) error {
		if err := CreateRoles(ctx, tx, passwords); err != nil {
			return fmt.Errorf("db: bootstrap: %w", err)
		}
		if err := PrepareDatabase(ctx, tx, database); err != nil {
			return fmt.Errorf("db: bootstrap: %w", err)
		}
		return nil
	})
}

// CreateRoles creates the three roles and PowerSync's, or restores an existing one's drifted
// attributes and sets its password. It holds a transaction-scoped advisory lock, since CREATE
// ROLE races with itself: two sessions that both find a role missing both try to create it. It
// refuses, naming what is missing, to make PowerSync's role, or restore its REPLICATION or
// BYPASSRLS, as an administrator that may not give them.
func CreateRoles(ctx context.Context, tx pgx.Tx, passwords Passwords) error {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", CatalogLock); err != nil {
		return fmt.Errorf("lock: %w", err)
	}
	for _, m := range managed {
		if err := setRole(ctx, tx, m.role, m.wants, passwords.Of(m.role)); err != nil {
			return err
		}
	}
	return nil
}

// setRole creates role with wants and password, or restores an existing role's drifted attributes
// to wants and sets its password, in tx, which holds CatalogLock. It refuses, naming what is
// missing, to give REPLICATION or BYPASSRLS as an administrator that may not (grantable).
func setRole(ctx context.Context, tx pgx.Tx, role string, wants roleAttributes, password string) error {
	if password == "" {
		return fmt.Errorf("no password for %s", role)
	}
	var a roleAttributes
	err := tx.QueryRow(ctx,
		"SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1", role,
	).Scan(&a.login, &a.super, &a.createDB, &a.createRole, &a.replication, &a.bypassRLS)
	create := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !create {
		return fmt.Errorf("look up %s: %w", role, err)
	}
	verb, clauses := "ALTER", roleClauses(wants, a, create)
	if create {
		verb = "CREATE"
	}
	if (wants.replication && (create || !a.replication)) || (wants.bypassRLS && (create || !a.bypassRLS)) {
		why, err := grantable(ctx, tx, role)
		if err != nil {
			return err
		}
		if why != "" {
			return errors.New(why)
		}
	}
	salt := make([]byte, scramSaltBytes)
	_, _ = rand.Read(salt) // It never fails: the process ends first.
	secret, err := scramSecret(password, salt, scramIterations)
	if err != nil {
		return fmt.Errorf("the SCRAM secret for %s: %w", role, err)
	}
	// format() quotes the role as an identifier and the secret as a literal.
	if err := execFormatted(ctx, tx, "%s ROLE %I WITH "+clauses+"PASSWORD %L", verb, role, secret); err != nil {
		return fmt.Errorf("%s ROLE %s: %w", verb, role, err)
	}
	return nil
}

// The parameters of the SCRAM secrets CreateRoles sets: PostgreSQL's own, which it uses for
// a password it hashes itself (scram_iterations, and its 16-byte salt).
const (
	scramIterations = 4096
	scramSaltBytes  = 16
)

// scramSecret returns password as pg_authid stores it, the SCRAM-SHA-256 secret of RFC 5802
// and RFC 7677, SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>, over salt.
//
// CreateRoles sets this secret, never the password itself. PostgreSQL stores a password
// given in this form as it is, and a role statement's text is not private: the server logs a
// statement that fails in full by default (log_min_error_statement is error), password
// literal and all, and statement logging records every one. The secret is what the server
// holds anyway; the password cannot be read back from it, only guessed.
//
// The password is prepared as pgx prepares it to log in, with precis.OpaqueString (the
// successor to SASLprep), and used as it is when that refuses it, as PostgreSQL does. An
// ASCII password, as the connection strings carry, is its own preparation either way.
func scramSecret(password string, salt []byte, iterations int) (string, error) {
	if prepared, err := precis.OpaqueString.String(password); err == nil {
		password = prepared
	}
	salted, err := pbkdf2.Key(sha256.New, password, salt, iterations, sha256.Size)
	if err != nil {
		return "", err
	}
	keyed := func(message string) []byte {
		mac := hmac.New(sha256.New, salted)
		mac.Write([]byte(message))
		return mac.Sum(nil)
	}
	storedKey := sha256.Sum256(keyed("Client Key"))
	encode := base64.StdEncoding.EncodeToString
	return "SCRAM-SHA-256$" + strconv.Itoa(iterations) + ":" + encode(salt) +
		"$" + encode(storedKey[:]) + ":" + encode(keyed("Server Key")), nil
}

// PrepareDatabase hands database to the migrate role and lets only the four roles and the
// caller connect to it. Bootstrap runs it; the tests run it on each database they
// clone, since CREATE DATABASE does not copy a template's privileges.
//
// It takes the lock CreateRoles takes. Granting to a role or giving it a database locks
// the role's catalog row, and an ALTER ROLE running beside that fails with "tuple
// concurrently updated" rather than waiting.
func PrepareDatabase(ctx context.Context, tx pgx.Tx, database string) error {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", CatalogLock); err != nil {
		return fmt.Errorf("lock: %w", err)
	}
	for _, stmt := range []string{
		"REVOKE ALL ON DATABASE %I FROM PUBLIC",
		// The caller keeps its own way in before it stops owning the database.
		"GRANT CONNECT ON DATABASE %I TO CURRENT_USER, " + RoleMigrate + ", " + RoleApp + ", " + RoleMeter + ", " + RolePowerSync,
		"ALTER DATABASE %I OWNER TO " + RoleMigrate,
	} {
		if err := execFormatted(ctx, tx, stmt, database); err != nil {
			return fmt.Errorf("prepare database %s: %w", database, err)
		}
	}
	return nil
}

// Storage is PowerSync's bucket storage (ADR 0001): a database of its own, owned by a role that
// holds nothing in the household's, whose credential only the service holds. The storage keeps
// every household's replicated rows outside row-level security (PRD 05 §6).
type Storage struct {
	Role, Password, Database string
}

// PrepareStorage makes storage's role, or brings it up to what it should be and sets its
// password, and its database, owned by it, unless the database exists; only the role and the
// caller may connect to it. It runs on the cluster admin connects to, as a role that may create
// roles and databases, and is safe to run again, and twice at once. A database cannot be created
// in a transaction, so it runs outside one, under the lock CreateRoles takes, which admin's session
// holds from the look-up to the database made. It refuses a role of the server's, PowerSync's
// replication role and the administrator's own, each of which it would bring down to the storage
// role's attributes and password; and, before it changes anything, a database that exists and is
// not the role's, the cluster's maintenance database or another application's, whose connections
// through PUBLIC it would revoke and in which PowerSync could keep no buckets.
func PrepareStorage(ctx context.Context, admin *pgx.Conn, storage Storage) error {
	switch {
	case storage.Role == "" || storage.Database == "":
		return errors.New("db: prepare storage: no role or no database")
	case storage.Password == "":
		return fmt.Errorf("db: prepare storage: no password for %s", storage.Role)
	}
	for _, m := range managed {
		if m.role == storage.Role {
			return fmt.Errorf("db: prepare storage: %s is a role CreateRoles makes; the bucket storage is owned by a role of its own", storage.Role)
		}
	}
	// The session holds CatalogLock until the database is made, which no transaction may hold: taken
	// by the transaction below alone, two preparations at once would both find the database missing,
	// and the second fail to make it. The transaction takes it again, as CreateRoles does, which a
	// session holding it is granted at once.
	if _, err := admin.Exec(ctx, "SELECT pg_advisory_lock($1)", CatalogLock); err != nil {
		return fmt.Errorf("db: prepare storage: lock: %w", err)
	}
	defer func() { _, _ = admin.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", CatalogLock) }()
	var owner *string
	err := pgx.BeginFunc(ctx, admin, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", CatalogLock); err != nil {
			return fmt.Errorf("lock: %w", err)
		}
		var administrator bool
		if err := tx.QueryRow(ctx, "SELECT $1 IN (current_user::text, session_user::text)", storage.Role).Scan(&administrator); err != nil {
			return fmt.Errorf("look up the administrator: %w", err)
		}
		if administrator {
			return fmt.Errorf("%s is the administrator's role; the bucket storage is owned by a role of its own", storage.Role)
		}
		// The database's owner, nil when there is no database of that name yet.
		if err := tx.QueryRow(ctx, "SELECT (SELECT pg_get_userbyid(datdba)::text FROM pg_database WHERE datname = $1)",
			storage.Database).Scan(&owner); err != nil {
			return fmt.Errorf("look up the database %s: %w", storage.Database, err)
		}
		if owner != nil && *owner != storage.Role {
			return fmt.Errorf("the database %s is %s's, not %s's; the bucket storage is a database of its own, owned by its role",
				storage.Database, *owner, storage.Role)
		}
		return setRole(ctx, tx, storage.Role, roleAttributes{login: true}, storage.Password)
	})
	if err != nil {
		return fmt.Errorf("db: prepare storage: %w", err)
	}
	statements := []string{
		"REVOKE ALL ON DATABASE %I FROM PUBLIC",
		"GRANT CONNECT ON DATABASE %I TO CURRENT_USER, %I",
	}
	if owner == nil {
		statements = append([]string{"CREATE DATABASE %I OWNER %I"}, statements...)
	}
	for _, s := range statements {
		if err := execFormatted(ctx, admin, s, storage.Database, storage.Role); err != nil {
			return fmt.Errorf("db: prepare storage %s: %w", storage.Database, err)
		}
	}
	return nil
}

// executor is what execFormatted runs a statement on: a transaction, or a connection outside one,
// for a statement no transaction may hold, CREATE DATABASE.
type executor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// execFormatted builds a statement with PostgreSQL's format(), which quotes %I as an
// identifier and %L as a literal, and executes it. DDL takes no bind parameters.
func execFormatted(ctx context.Context, tx executor, format string, args ...any) error {
	placeholders := ""
	params := []any{format}
	for i, arg := range args {
		placeholders += fmt.Sprintf(", $%d::text", i+2)
		params = append(params, arg)
	}
	var stmt string
	if err := tx.QueryRow(ctx, "SELECT format($1::text"+placeholders+")", params...).Scan(&stmt); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, stmt)
	return err
}
