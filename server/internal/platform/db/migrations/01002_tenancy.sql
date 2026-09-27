-- The minimal tenancy schema (PRD 01 §2, 02 §1, §5): users, households, their memberships,
-- and which modules each household enables and grants each member. Their flows come in items
-- 8–10. This block holds what the tenant middleware reads to resolve a request, and the
-- row-level security every tenant table is held to (D-1, D-2).

-- +goose Up

-- The tenant context. The server sets app.household_id and app.user_id with SET LOCAL at the
-- start of every transaction of a household-scoped request (internal/platform/tenant); these
-- read them back, as NULL when they are unset. A custom setting reads as NULL in a session that
-- never set it and as '' in one whose last transaction set it locally, so a pooled connection's
-- next transaction sees no tenant rather than an error, and a policy that compares a column
-- with NULL is never true: a query with no tenant context reads nothing and writes nothing.
CREATE FUNCTION app_household_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.household_id', true), '')::uuid $$;

CREATE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- The tenant-isolation template (PRD 01 §2.2). The migration that creates a tenant table calls
-- it on the table, and architecture test 2 fails a tenant table whose only permissive policy
-- is not the one it creates: a table that needs a narrower rule adds a restrictive policy on
-- top. FORCE matters, because the migrate role owns every table and an owner bypasses a policy
-- that is not forced. Only the migrate role, which owns the tables, runs it.
-- +goose StatementBegin
CREATE FUNCTION enable_tenant_isolation(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s'
    ' USING (household_id = public.app_household_id())'
    ' WITH CHECK (household_id = public.app_household_id())', tbl);
END
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION enable_tenant_isolation(regclass) FROM PUBLIC;

-- The modules a household can enable and grant (PRD modules/00 §6): the contract's
-- ModuleKeyValue, which a test holds this list to. Reference data, the same for every
-- household, and written only by migrations.
CREATE TABLE modules (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*$')
);

INSERT INTO modules (id) VALUES
  ('dashboard'), ('tasks'), ('reminders'), ('calendar'), ('shopping'), ('chores'), ('notes'),
  ('documents'), ('finance'), ('utilities'), ('garden'), ('property'), ('vehicles'), ('pets'),
  ('chat'), ('activity'), ('admin');

REVOKE INSERT, UPDATE, DELETE ON modules FROM household_app;

CREATE TYPE household_role AS ENUM ('owner', 'member', 'child');

CREATE TYPE access_level AS ENUM ('none', 'view', 'contribute', 'manage');

-- A person (PRD 02 §1). Global (PRD 01 §2.4): a user exists without any household and may be
-- in several. Item 8 gives them credentials and a profile.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A deleted account's row is replaced by a tombstone, never deleted (FR-PR4), so the request
-- role deletes no user. A delete would reach past row-level security: a user's memberships,
-- and through them their grants, cascade from their row, so a delete in one household's
-- context would remove them from every other household too. Architecture test 2 fails a
-- global table the request role deletes from whose deletion acts on households' rows.
REVOKE DELETE ON users FROM household_app;

-- The tenant root. Item 10 gives it its name, country, timezone, currency, locale and code.
CREATE TABLE households (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A user's place in a household, and their role there. A user may hold several (D-4). A
-- membership that exists is live: removing a member deletes it (FR-HH5).
CREATE TABLE memberships (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role household_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE INDEX memberships_user_id ON memberships (user_id);

-- Whether a household enables a module (PRD 01 §5). A module with no row is disabled: item 10
-- writes a row for every module when it creates a household.
CREATE TABLE module_enablement (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  module text NOT NULL REFERENCES modules (id),
  enabled boolean NOT NULL,
  PRIMARY KEY (household_id, module)
);

-- A member's level on a module (FR-AC1). A module with no row is none. The tenant key reaches
-- households through the membership, whose deletion takes the member's grants with it.
CREATE TABLE module_grants (
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  module text NOT NULL REFERENCES modules (id),
  level access_level NOT NULL,
  PRIMARY KEY (household_id, user_id, module),
  FOREIGN KEY (household_id, user_id) REFERENCES memberships (household_id, user_id) ON DELETE CASCADE
);

SELECT enable_tenant_isolation('module_enablement');
SELECT enable_tenant_isolation('module_grants');

-- The two tables tenancy is resolved through have policies of their own (PRD 01 §2.4). Both are
-- read before a household context exists, to list a user's households and to check that the
-- caller is a member of the one a request addresses, so outside any household's context a user
-- reads their own memberships and the households they hold them in. Inside a household's
-- context both read as a tenant table does, that household's rows only: a query that forgets
-- its WHERE household_id does not reach the caller's rows in another household, where the
-- caller may hold another role. The wider read is a FOR SELECT policy, and both tables are
-- written only through a second policy held to the household's context. A DELETE is checked
-- against a policy's USING alone, so a USING that admitted the caller's rows everywhere would
-- let a transaction in one household delete them in another. Architecture test 2 holds both
-- tables to this.
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE households FORCE ROW LEVEL SECURITY;
CREATE POLICY household_read ON households FOR SELECT
  USING (
    id = app_household_id()
    OR (app_household_id() IS NULL
      AND EXISTS (SELECT FROM memberships m WHERE m.household_id = households.id AND m.user_id = app_user_id()))
  );
CREATE POLICY household_write ON households
  USING (id = app_household_id())
  WITH CHECK (id = app_household_id());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON memberships FOR SELECT
  USING (household_id = app_household_id() OR (app_household_id() IS NULL AND user_id = app_user_id()));
CREATE POLICY membership_write ON memberships
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
