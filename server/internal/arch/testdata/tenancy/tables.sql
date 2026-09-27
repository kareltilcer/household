-- Tables that break architecture test 2's rule, and some that keep it. The test runs this as
-- the migrate role, in a transaction it rolls back.

CREATE SCHEMA arch_testdata;

-- Keeps it: the template.
CREATE TABLE arch_testdata.compliant (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.compliant');

-- Keeps it: the template, narrowed by a restrictive policy.
CREATE TABLE arch_testdata.narrowed (id uuid PRIMARY KEY, household_id uuid NOT NULL, owner_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.narrowed');
CREATE POLICY own_items ON arch_testdata.narrowed AS RESTRICTIVE USING (owner_id = app_user_id());

-- No household_id at all.
CREATE TABLE arch_testdata.no_household (id uuid PRIMARY KEY);
ALTER TABLE arch_testdata.no_household ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.no_household FORCE ROW LEVEL SECURITY;

-- A household_id that may be NULL.
CREATE TABLE arch_testdata.nullable_household (id uuid PRIMARY KEY, household_id uuid);
SELECT enable_tenant_isolation('arch_testdata.nullable_household');

-- A household_id that is not a uuid, which the template cannot compare.
CREATE TABLE arch_testdata.text_household (id uuid PRIMARY KEY, household_id text NOT NULL);
ALTER TABLE arch_testdata.text_household ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.text_household FORCE ROW LEVEL SECURITY;

-- The template's policy on a table that does not enable row-level security.
CREATE TABLE arch_testdata.not_enabled (id uuid PRIMARY KEY, household_id uuid NOT NULL);
CREATE POLICY tenant_isolation ON arch_testdata.not_enabled
  USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());
ALTER TABLE arch_testdata.not_enabled FORCE ROW LEVEL SECURITY;

-- Enabled, but not forced, so its owner bypasses it.
CREATE TABLE arch_testdata.not_forced (id uuid PRIMARY KEY, household_id uuid NOT NULL);
ALTER TABLE arch_testdata.not_forced ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON arch_testdata.not_forced
  USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());

-- Enabled and forced, with no policy.
CREATE TABLE arch_testdata.no_policy (id uuid PRIMARY KEY, household_id uuid NOT NULL);
ALTER TABLE arch_testdata.no_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.no_policy FORCE ROW LEVEL SECURITY;

-- The template, widened by a second permissive policy.
CREATE TABLE arch_testdata.widened (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.widened');
CREATE POLICY everyone_reads ON arch_testdata.widened FOR SELECT USING (true);

-- The template's expression, for reading only.
CREATE TABLE arch_testdata.select_only (id uuid PRIMARY KEY, household_id uuid NOT NULL);
ALTER TABLE arch_testdata.select_only ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.select_only FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON arch_testdata.select_only FOR SELECT USING (household_id = app_household_id());

-- A policy that compares another column with the household.
CREATE TABLE arch_testdata.wrong_column (id uuid PRIMARY KEY, household_id uuid NOT NULL, other_id uuid NOT NULL);
ALTER TABLE arch_testdata.wrong_column ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.wrong_column FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON arch_testdata.wrong_column
  USING (other_id = app_household_id()) WITH CHECK (household_id = app_household_id());

-- A materialized view, which row-level security cannot hold.
CREATE MATERIALIZED VIEW arch_testdata.summary AS
  SELECT household_id, count(*) AS items FROM arch_testdata.compliant GROUP BY household_id;

-- Exempted as global: nothing is asked of it.
CREATE TABLE arch_testdata.catalog (id text PRIMARY KEY);

-- Exempted with a policy of its own, which it has, enabled and forced.
CREATE TABLE arch_testdata.roots (id uuid PRIMARY KEY);
ALTER TABLE arch_testdata.roots ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.roots FORCE ROW LEVEL SECURITY;
CREATE POLICY root_access ON arch_testdata.roots USING (id = app_household_id());

-- Exempted with a policy of its own, which it does not force.
CREATE TABLE arch_testdata.roots_unforced (id uuid PRIMARY KEY);
ALTER TABLE arch_testdata.roots_unforced ENABLE ROW LEVEL SECURITY;
CREATE POLICY root_access ON arch_testdata.roots_unforced USING (id = app_household_id());
