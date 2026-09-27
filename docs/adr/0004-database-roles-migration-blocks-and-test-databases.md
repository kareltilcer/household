# 0004 — Database roles, migration blocks, and one database per test package

- **Status:** Accepted
- **Date:** 2026-09-27
- **Plan item:** 2
- **Decides for:** PRD 01 §2.3 (the three roles), §9 (goose, one numbered block per module,
  forward-only), D-3, D-11; PL-3 (tests hit real PostgreSQL)

## Context

PRD 01 §2.3 names three roles and says none may bypass row-level security, but not who creates
them, who owns what, or how the request role gets privileges on tables it does not own. §9 says
migrations are goose, one numbered block per module, run by the migrate role, forward-only; it
does not say how the blocks share one goose sequence. PL-3 puts every Go test on a real
PostgreSQL, and `go test ./...` runs packages in parallel against one cluster.

## Decision

**Roles.** `household-api bootstrap`, run as an administrator, creates `household_migrate`,
`household_app` and `household_meter` as `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS`, and on every later run restores those attributes and resets each
password to the one its connection string carries (`HOUSEHOLD_DATABASE_URL`,
`HOUSEHOLD_MIGRATE_DATABASE_URL`, `HOUSEHOLD_METER_DATABASE_URL`). It then makes
`household_migrate` the owner of the database, revokes the database from `PUBLIC`, and grants
`CONNECT` to the three roles and to itself. `serve` refuses a `HOUSEHOLD_DATABASE_URL` that does
not log in as `household_app`, and `migrate` one that does not log in as `household_migrate`.

**Privileges.** The migrate role owns the database and, through `pg_database_owner`, its public
schema. The platform block's first migration grants the request role `USAGE` on the schema and,
by default privileges, `SELECT, INSERT, UPDATE, DELETE` on every table the migrate role creates.
The request role creates, alters, drops and truncates nothing; the meter role is granted its
columns one at a time (item 16).

**Migration blocks.** A block has a two-digit number and its files are named
`NNSSS_description.sql`: block 01 (the platform) runs `01001`, `01002`, …. All blocks share one
goose sequence, applied out of order where a lower block gains a migration after a higher one
has run, since blocks own disjoint tables. Assembly refuses a file numbered for another block, a
number used twice, and any migration with a `-- +goose Down` section. A session advisory lock
keeps two deploys from applying a migration twice.

**Test databases.** `testsupport` builds a template database by migrating an empty one as the
migrate role, names it after a hash of the migrations, and clones it per test package
(`CREATE DATABASE … TEMPLATE`) in `TestMain`, dropping the clone afterwards. A template for other
migrations, and clones left by a killed run, are swept on the next run. Every change to the roles
and to databases, in the bootstrap and in the tests, holds one advisory lock (`db.CatalogLock`)
taken from a connection to one database: PostgreSQL fails an `ALTER ROLE` that runs beside
another, or beside a `CREATE` or `DROP DATABASE` of objects the role owns, with "tuple
concurrently updated", and an advisory lock only excludes sessions in the same database.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| `household_app` as a group role, with a separate login role that `SET ROLE`s into it | A second role for no gain in item 2; item 3 may still add one when the tenant middleware's `SET LOCAL ROLE household_app` needs it |
| Default privileges set by the bootstrap (`ALTER DEFAULT PRIVILEGES FOR ROLE household_migrate`) | Needs the administrator to be a member of the migrate role, which a managed database's admin is not by default; set by the migrate role itself, in a migration, the privileges are versioned with the schema |
| Passwords in their own variables (`HOUSEHOLD_APP_PASSWORD`, …) | The same secret twice, once in the variable and once in the connection string the server uses, free to disagree |
| A separate goose version table per module | goose runs one sequence per table; seventeen tables make "is this database up to date" seventeen questions |
| Down migrations | D-11: a release is undone by a later release; a down migration that drops what an older app still reads is the outage it was meant to undo |
| One shared test database, truncated between packages | Packages run in parallel; truncation would race, and a test that forgot a `WHERE` would pass on data another package left behind |
| A fresh database migrated per package | Correct, but pays the whole migration run per package, which grows with every module |

## Consequences

- Staging and production (item 30) must run `bootstrap` with an administrator who may create
  roles and hand a database to one; on PostgreSQL 16 and later that may need `GRANT
  household_migrate TO <admin> WITH SET TRUE` once. Statement logging must be off for DDL while it
  runs, since the passwords travel in `ALTER ROLE`.
- A package whose tests use the database has a one-line `TestMain`; a test that calls
  `testsupport.Open` without it fails and says so.
- Tests set the three roles' passwords on the cluster they run against to the development
  defaults, so `HOUSEHOLD_TEST_DATABASE_URL` must never name a shared cluster.
