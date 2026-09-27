-- Tenant tables the tenant isolation test must fail, beside the fixture's. The test runs this
-- after the fixture, in a transaction it rolls back. The tables are the migrate role's, as a
-- migration's would be, and so readable by the request role; the rows are the administrator's.
SET LOCAL ROLE household_migrate;

-- No policy at all: household B reads household A's row.
CREATE TABLE isolation_open (id uuid PRIMARY KEY, household_id uuid NOT NULL);

-- A second permissive policy that lets every household read.
CREATE TABLE isolation_wide (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('isolation_wide');
CREATE POLICY everyone_reads ON isolation_wide FOR SELECT USING (true);

-- Isolated, but with no row of household A to read.
CREATE TABLE isolation_empty (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('isolation_empty');

-- Enabled and forced with no policy, so that household A cannot read its own row either, and
-- a read that finds nothing proves nothing.
CREATE TABLE isolation_blind (id uuid PRIMARY KEY, household_id uuid NOT NULL);
ALTER TABLE isolation_blind ENABLE ROW LEVEL SECURITY;
ALTER TABLE isolation_blind FORCE ROW LEVEL SECURITY;

-- No primary key to read a row by.
CREATE TABLE isolation_keyless (household_id uuid NOT NULL);
SELECT enable_tenant_isolation('isolation_keyless');

-- Keyed on the user as well as the household, in every context: household B's owner, a member
-- of household A too, reads the row of theirs that household A holds.
CREATE TABLE isolation_own_rows (id uuid PRIMARY KEY, household_id uuid NOT NULL, user_id uuid NOT NULL);
ALTER TABLE isolation_own_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE isolation_own_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON isolation_own_rows USING (household_id = app_household_id() OR user_id = app_user_id());

RESET ROLE;

INSERT INTO isolation_open VALUES ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-00000000000a');
INSERT INTO isolation_wide VALUES ('01900000-0000-7000-8000-000000000002', '01900000-0000-7000-8000-00000000000a');
INSERT INTO isolation_empty VALUES ('01900000-0000-7000-8000-000000000003', '01900000-0000-7000-8000-00000000000b');
INSERT INTO isolation_blind VALUES ('01900000-0000-7000-8000-000000000004', '01900000-0000-7000-8000-00000000000a');
INSERT INTO isolation_keyless VALUES ('01900000-0000-7000-8000-00000000000a');
INSERT INTO isolation_own_rows VALUES
  ('01900000-0000-7000-8000-000000000005', '01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1');
