package conformance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// Replicated are the tables in the stand-in's publication, which PowerSync replicates and its
// streams read: the tenancy tables the grant is resolved from, and the conformance module's. Item
// 13 replaces the list with one generated from the entity registry.
var Replicated = []string{
	"memberships", "module_enablement", "module_grants",
	"conformance_items", "conformance_item_checks", "conformance_readings", "conformance_budgets",
	"conformance_notes", "conformance_chores", "conformance_completions", "conformance_attachments",
	"conformance_conversations", "conformance_conversation_members", "conformance_messages",
}

// Publication is the publication PowerSync replicates from, by the name it reads by default.
const Publication = "powersync"

// Roles are the credentials Setup gives PowerSync: the role it replicates as, and the one that owns
// its bucket storage's database, each with its password, as powersync.yaml names them.
type Roles struct {
	Replication, ReplicationPassword string
	Storage, StoragePassword         string
	// StorageDatabase is the database PowerSync keeps its buckets in, beside the household's.
	StorageDatabase string
}

// Migrate applies the conformance module's block to the database migrate connects to as the
// migrate role, whose platform block `household-api migrate` has already applied.
func Migrate(ctx context.Context, migrate *sql.DB) error {
	block, err := Block()
	if err != nil {
		return err
	}
	_, err = db.Migrate(ctx, migrate, db.Platform(), block)
	return err
}

// Setup prepares, as the administrator admin connects as, what PowerSync needs of the database
// named database (ADR 0001): a role that holds REPLICATION and BYPASSRLS, since every tenant table
// forces row-level security and PowerSync sets no tenant, and reads the Replicated tables and no
// other; those tables at REPLICA IDENTITY FULL, as the spike ran them; the publication over
// exactly them; and a database of its own for its buckets, owned by a role that holds nothing in
// the household's. It can be run again: a role is brought up to date, the publication set to the
// list, and a database that exists is kept.
func Setup(ctx context.Context, admin *pgx.Conn, database string, roles Roles) error {
	for _, name := range []string{roles.Replication, roles.Storage, roles.StorageDatabase} {
		if !identifier(name) {
			return fmt.Errorf("conformance: %q is not a lowercase identifier", name)
		}
	}
	if roles.ReplicationPassword == "" || roles.StoragePassword == "" {
		return errors.New("conformance: each PowerSync role needs a password")
	}
	tables := make([]string, len(Replicated))
	for i, t := range Replicated {
		tables[i] = pgx.Identifier{t}.Sanitize()
	}
	replication := pgx.Identifier{roles.Replication}.Sanitize()
	storage := pgx.Identifier{roles.Storage}.Sanitize()
	statements := []string{
		role(roles.Replication, "LOGIN REPLICATION BYPASSRLS", roles.ReplicationPassword),
		"GRANT CONNECT ON DATABASE " + pgx.Identifier{database}.Sanitize() + " TO " + replication,
		"GRANT USAGE ON SCHEMA public TO " + replication,
		// Whatever it was granted before, it reads the replicated tables and no other.
		"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM " + replication,
		"GRANT SELECT ON " + strings.Join(tables, ", ") + " TO " + replication,
		role(roles.Storage, "LOGIN NOREPLICATION NOBYPASSRLS", roles.StoragePassword),
	}
	for _, t := range tables {
		statements = append(statements, "ALTER TABLE "+t+" REPLICA IDENTITY FULL")
	}
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT FROM pg_publication WHERE pubname = $1)", Publication).Scan(&exists); err != nil {
		return fmt.Errorf("conformance: read the publication: %w", err)
	}
	verb := "CREATE PUBLICATION " + Publication + " FOR TABLE "
	if exists {
		verb = "ALTER PUBLICATION " + Publication + " SET TABLE "
	}
	statements = append(statements, verb+strings.Join(tables, ", "))
	for _, s := range statements {
		if _, err := admin.Exec(ctx, s); err != nil {
			return fmt.Errorf("conformance: %s: %w", redact(s), err)
		}
	}
	// A database cannot be created in a transaction, nor in a DO block, so it is looked for first.
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT FROM pg_database WHERE datname = $1)", roles.StorageDatabase).Scan(&exists); err != nil {
		return fmt.Errorf("conformance: read the databases: %w", err)
	}
	if !exists {
		if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{roles.StorageDatabase}.Sanitize()+" OWNER "+storage); err != nil {
			return fmt.Errorf("conformance: create the bucket storage's database: %w", err)
		}
	}
	return nil
}

// role returns the statement that makes the role name with attributes and password, or brings a
// role of that name up to them.
func role(name, attributes, password string) string {
	quoted := strings.ReplaceAll(pgx.Identifier{name}.Sanitize(), "'", "''")
	return fmt.Sprintf(`DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = %[1]s) THEN
    EXECUTE 'ALTER ROLE %[2]s %[3]s PASSWORD ' || %[4]s;
  ELSE
    EXECUTE 'CREATE ROLE %[2]s %[3]s PASSWORD ' || %[4]s;
  END IF;
END $$`, literal(name), quoted, attributes, "quote_literal("+literal(password)+")")
}

// literal returns s as an SQL string literal.
func literal(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// redact returns statement with any password it sets cut off, for an error message.
func redact(statement string) string {
	if i := strings.Index(statement, "PASSWORD"); i >= 0 {
		return statement[:i] + "PASSWORD …"
	}
	return statement
}

func identifier(s string) bool {
	if s == "" || len(s) > 63 {
		return false
	}
	for i, r := range s {
		if r != '_' && (r < 'a' || r > 'z') && (i == 0 || r < '0' || r > '9') {
			return false
		}
	}
	return true
}
