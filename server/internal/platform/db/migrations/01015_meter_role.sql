-- What the meter role reads (PRD 01 §2.3, plan item 14, ADR 0015): the nightly storage and usage
-- sampler, and the files pipeline's search for households with work due, each of which reads across
-- households and so cannot run in any one household's context. Row-level security stays enforced
-- on the role: a policy of its own admits every row to it, FOR SELECT only, and it holds no
-- privilege on a table but SELECT on the columns granted it one at a time, which name a household
-- and count, size or schedule its rows, never what they say. So the sampler learns how many rows,
-- objects and bytes each household holds, and whose, and nothing a household wrote. Architecture
-- test 2 holds every tenant table to the one policy, and test 11 the role to its columns.
--
-- Every tenant table gets it: enable_tenant_isolation now meters the table it isolates, which is
-- how the rows each module holds are counted for fair use (FR-ST2, PRD 04 §5) and how PRD 04 §8
-- estimates a household's share of the database. The tables it has isolated already get it here, as
-- do the three with policies of their own.

-- +goose Up

-- enable_metering admits the meter role to tbl's rows and grants it the column that names their
-- household, key: household_id on a tenant table, id on the tenant root. A partition gets the
-- policy but no grant: the role reads a partitioned table through its parent, whose privileges then
-- hold, and a partition read directly is held to its own policies (architecture test 2). Only the
-- migrate role, which owns the tables, runs it.
-- +goose StatementBegin
CREATE FUNCTION enable_metering(tbl regclass, key name DEFAULT 'household_id') RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE POLICY meter_read ON %s FOR SELECT TO household_meter USING (true)', tbl);
  IF NOT (SELECT c.relispartition FROM pg_class c WHERE c.oid = tbl) THEN
    EXECUTE format('GRANT SELECT (%I) ON %s TO household_meter', key, tbl);
  END IF;
END
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION enable_metering(regclass, name) FROM PUBLIC;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION enable_tenant_isolation(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s'
    ' USING (household_id = public.app_household_id())'
    ' WITH CHECK (household_id = public.app_household_id())', tbl);
  PERFORM public.enable_metering(tbl);
END
$$;
-- +goose StatementEnd

-- The tables isolated before this migration, and the partitions of sync_changes among them. In a
-- database where a module's block ran before this one, its tables are among them too.
-- +goose StatementBegin
DO $$
DECLARE
  tbl regclass;
BEGIN
  FOR tbl IN
    SELECT p.polrelid::regclass FROM pg_policy p
    WHERE p.polname = 'tenant_isolation'
      AND NOT EXISTS (SELECT FROM pg_policy m WHERE m.polrelid = p.polrelid AND m.polname = 'meter_read')
  LOOP
    PERFORM enable_metering(tbl);
  END LOOP;
END
$$;
-- +goose StatementEnd

SELECT enable_metering('households', 'id');
SELECT enable_metering('memberships');
SELECT enable_metering('invitations');
