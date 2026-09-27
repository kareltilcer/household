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

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/secure/precis"
)

// The three roles of PRD 01 §2.3. None is a superuser or may bypass row-level security;
// there is deliberately no support role and no bypass role (D-3).
const (
	// RoleMigrate owns the database and every table in it, and is used only to migrate,
	// at deploy time. As owner it would bypass row-level security, which is why every
	// tenant table forces it (PRD 01 §2.2).
	RoleMigrate = "household_migrate"
	// RoleApp serves every request. It owns nothing and creates nothing; it reads and
	// writes rows through the privileges the platform migration block grants it.
	RoleApp = "household_app"
	// RoleMeter is the nightly storage and usage sampler, which reads aggregate columns
	// only (item 16 grants them).
	RoleMeter = "household_meter"
)

// Roles lists the three roles.
var Roles = []string{RoleMigrate, RoleApp, RoleMeter}

// Passwords are the login passwords Bootstrap sets, one per role.
type Passwords struct {
	Migrate, App, Meter string
}

// Of returns role's password, or "" for a role that is not one of the three.
func (p Passwords) Of(role string) string {
	switch role {
	case RoleMigrate:
		return p.Migrate
	case RoleApp:
		return p.App
	case RoleMeter:
		return p.Meter
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

// attributes are what each role is, whatever it was before: Bootstrap creates a role with
// them and restores any that drifted on a role that already exists, so a BYPASSRLS granted
// by hand does not survive a deploy.
const attributes = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"

// roleAttributes are an existing role's attributes, as pg_roles reports them.
type roleAttributes struct {
	login, super, createDB, createRole, replication, bypassRLS bool
}

// restore returns the clauses that put the role back to attributes, naming only those that
// differ. PostgreSQL 16 and later refuse a SUPERUSER, REPLICATION or BYPASSRLS clause, the
// NO form included, from an administrator without that attribute, which a managed
// database's administrator is: restating every clause would fail each run after the first.
// A clause that did drift is still named, and fails loudly when the administrator cannot
// undo it.
func (a roleAttributes) restore() string {
	var clauses string
	for _, c := range []struct {
		drifted bool
		clause  string
	}{
		{!a.login, "LOGIN"},
		{a.super, "NOSUPERUSER"},
		{a.createDB, "NOCREATEDB"},
		{a.createRole, "NOCREATEROLE"},
		{a.replication, "NOREPLICATION"},
		{a.bypassRLS, "NOBYPASSRLS"},
	} {
		if c.drifted {
			clauses += c.clause + " "
		}
	}
	return clauses
}

// Bootstrap creates the three roles, or restores an existing one's attributes and sets its
// password, and then prepares database: the migrate role owns it, and only the three
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

// CreateRoles creates the three roles, or restores an existing one's drifted attributes and
// sets its password. It holds a transaction-scoped advisory lock, since CREATE ROLE races
// with itself: two sessions that both find a role missing both try to create it.
func CreateRoles(ctx context.Context, tx pgx.Tx, passwords Passwords) error {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", CatalogLock); err != nil {
		return fmt.Errorf("lock: %w", err)
	}
	for _, role := range Roles {
		password := passwords.Of(role)
		if password == "" {
			return fmt.Errorf("no password for %s", role)
		}
		var a roleAttributes
		err := tx.QueryRow(ctx,
			"SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1", role,
		).Scan(&a.login, &a.super, &a.createDB, &a.createRole, &a.replication, &a.bypassRLS)
		verb, clauses := "ALTER", a.restore()
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			verb, clauses = "CREATE", attributes+" "
		case err != nil:
			return fmt.Errorf("look up %s: %w", role, err)
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

// PrepareDatabase hands database to the migrate role and lets only the three roles and
// the caller connect to it. Bootstrap runs it; the tests run it on each database they
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
		"GRANT CONNECT ON DATABASE %I TO CURRENT_USER, " + RoleMigrate + ", " + RoleApp + ", " + RoleMeter,
		"ALTER DATABASE %I OWNER TO " + RoleMigrate,
	} {
		if err := execFormatted(ctx, tx, stmt, database); err != nil {
			return fmt.Errorf("prepare database %s: %w", database, err)
		}
	}
	return nil
}

// execFormatted builds a statement with PostgreSQL's format(), which quotes %I as an
// identifier and %L as a literal, and executes it. DDL takes no bind parameters.
func execFormatted(ctx context.Context, tx pgx.Tx, format string, args ...any) error {
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
