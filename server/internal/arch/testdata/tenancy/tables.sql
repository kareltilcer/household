-- Tables that break architecture test 2's rule, and some that keep it. The test runs this as
-- the migrate role, in a transaction it rolls back.

CREATE SCHEMA arch_testdata;

-- Keeps it: the template, and a key with the household for another tenant table to reference.
CREATE TABLE arch_testdata.compliant (id uuid PRIMARY KEY, household_id uuid NOT NULL, UNIQUE (household_id, id));
SELECT enable_tenant_isolation('arch_testdata.compliant');

-- Keeps it: a reference to another tenant table's row that pairs the two households, so the
-- row it names is in its own household.
CREATE TABLE arch_testdata.compliant_child (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  FOREIGN KEY (household_id, parent_id) REFERENCES arch_testdata.compliant (household_id, id) ON DELETE CASCADE
);
SELECT enable_tenant_isolation('arch_testdata.compliant_child');

-- A reference to another tenant table's row by its id alone. The key is checked past row-level
-- security, so a row of one household can name another household's row, whose delete there is
-- then refused.
CREATE TABLE arch_testdata.loose_child (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  parent_id uuid NOT NULL REFERENCES arch_testdata.compliant (id)
);
SELECT enable_tenant_isolation('arch_testdata.loose_child');

-- Keeps it: the template, narrowed for the request role by a restrictive policy.
CREATE TABLE arch_testdata.narrowed (id uuid PRIMARY KEY, household_id uuid NOT NULL, owner_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.narrowed');
CREATE POLICY own_items ON arch_testdata.narrowed AS RESTRICTIVE TO household_app USING (owner_id = app_user_id());

-- The same rule for every role, the meter's among them, which reads with no caller: it would count
-- none of the table's rows.
CREATE TABLE arch_testdata.narrowed_everyone (id uuid PRIMARY KEY, household_id uuid NOT NULL, owner_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.narrowed_everyone');
CREATE POLICY own_items ON arch_testdata.narrowed_everyone AS RESTRICTIVE USING (owner_id = app_user_id());

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

-- The meter role's read, widened to writing: the role reads across households, and writes none.
CREATE TABLE arch_testdata.meter_writes (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.meter_writes');
CREATE POLICY meter_all ON arch_testdata.meter_writes TO household_meter USING (true) WITH CHECK (true);

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

-- A partitioned tenant table. Each partition is held to the rule on its own, since a query that
-- reaches one directly is held to its policies alone. One keeps it: the template, and no
-- privilege of the request role's, which reaches it through its parent. One has no policy at
-- all; one grants the request role a delete its parent may not allow.
CREATE TABLE arch_testdata.feed (seq bigint NOT NULL, household_id uuid NOT NULL, at date NOT NULL, PRIMARY KEY (household_id, seq, at))
  PARTITION BY RANGE (at);
SELECT enable_tenant_isolation('arch_testdata.feed');
CREATE TABLE arch_testdata.feed_sealed PARTITION OF arch_testdata.feed FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
SELECT enable_tenant_isolation('arch_testdata.feed_sealed');
CREATE TABLE arch_testdata.feed_bare PARTITION OF arch_testdata.feed FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE arch_testdata.feed_open PARTITION OF arch_testdata.feed FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
SELECT enable_tenant_isolation('arch_testdata.feed_open');
GRANT SELECT, DELETE ON arch_testdata.feed_open TO household_app;

-- A materialized view, which row-level security cannot hold.
CREATE MATERIALIZED VIEW arch_testdata.summary AS
  SELECT household_id, count(*) AS items FROM arch_testdata.compliant GROUP BY household_id;

-- Exempted as global: nothing is asked of it.
CREATE TABLE arch_testdata.catalog (id text PRIMARY KEY);

-- Exempted as global, and the request role deletes and updates its rows: a tenant table whose
-- rows go with a person's is changed in every household from any one.
CREATE TABLE arch_testdata.people (id uuid PRIMARY KEY);
GRANT SELECT, INSERT, UPDATE, DELETE ON arch_testdata.people TO household_app;
CREATE TABLE arch_testdata.assigned (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES arch_testdata.people (id) ON DELETE CASCADE ON UPDATE CASCADE
);
SELECT enable_tenant_isolation('arch_testdata.assigned');

-- Keeps it: exempted as global, and the request role updates its rows but deletes none, so a
-- tenant table may cascade a delete from it, and takes no action on an update.
CREATE TABLE arch_testdata.tombstoned (id uuid PRIMARY KEY);
GRANT SELECT, INSERT, UPDATE ON arch_testdata.tombstoned TO household_app;
CREATE TABLE arch_testdata.authored (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES arch_testdata.tombstoned (id) ON DELETE CASCADE
);
SELECT enable_tenant_isolation('arch_testdata.authored');

-- Keeps it: exempted as global, and the request role updates a column of its rows but not the
-- key a tenant table references, so the tenant table's action on an update of the key never
-- runs.
CREATE TABLE arch_testdata.labelled (id uuid PRIMARY KEY, label text NOT NULL);
GRANT SELECT, UPDATE (label) ON arch_testdata.labelled TO household_app;
CREATE TABLE arch_testdata.tagged (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  label_id uuid NOT NULL REFERENCES arch_testdata.labelled (id) ON UPDATE CASCADE
);
SELECT enable_tenant_isolation('arch_testdata.tagged');

-- Exempted with a policy of its own, which it has, enabled and forced.
CREATE TABLE arch_testdata.roots (id uuid PRIMARY KEY);
ALTER TABLE arch_testdata.roots ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.roots FORCE ROW LEVEL SECURITY;
CREATE POLICY root_access ON arch_testdata.roots USING (id = app_household_id());

-- Its household is a tenant root's row, which keeps it; its partner is another root's row,
-- named by an id that no household pairs.
CREATE TABLE arch_testdata.linked (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES arch_testdata.roots (id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES arch_testdata.roots (id)
);
SELECT enable_tenant_isolation('arch_testdata.linked');

-- Exempted with a policy of its own, which it does not force.
CREATE TABLE arch_testdata.roots_unforced (id uuid PRIMARY KEY);
ALTER TABLE arch_testdata.roots_unforced ENABLE ROW LEVEL SECURITY;
CREATE POLICY root_access ON arch_testdata.roots_unforced USING (id = app_household_id());

-- Exempted with policies of its own: read by the user it names as well, and written only in its
-- household's context.
CREATE TABLE arch_testdata.members (household_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (household_id, user_id));
ALTER TABLE arch_testdata.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.members FORCE ROW LEVEL SECURITY;
CREATE POLICY member_read ON arch_testdata.members FOR SELECT
  USING (household_id = app_household_id() OR user_id = app_user_id());
CREATE POLICY member_write ON arch_testdata.members
  USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());

-- Exempted with a policy of its own whose wider rule reaches writes too: a DELETE, checked
-- against its USING alone, removes the user's rows in every household from any one.
CREATE TABLE arch_testdata.members_writable (household_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (household_id, user_id));
ALTER TABLE arch_testdata.members_writable ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_testdata.members_writable FORCE ROW LEVEL SECURITY;
CREATE POLICY member_access ON arch_testdata.members_writable
  USING (household_id = app_household_id() OR user_id = app_user_id())
  WITH CHECK (household_id = app_household_id());
