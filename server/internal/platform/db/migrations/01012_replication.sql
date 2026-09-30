-- What PowerSync replicates (ADR 0001, D-93; plan item 13): the powersync publication, which the
-- replication role PowerSync connects as streams from the write-ahead log, and replicate, which a
-- migration calls on every table a generated stream reads, as it calls enable_tenant_isolation on
-- every tenant table. Architecture test 10 fails a table a stream reads that is not published as
-- replicate leaves it, and one the replication role may read that no stream needs.

-- +goose Up

-- The replication role reads nothing it is not given: it may look into the schema, and reads a
-- table once replicate grants it one.
GRANT USAGE ON SCHEMA public TO household_powersync;

-- Owned by the migrate role, which owns every table it will name: only a table's owner may add it
-- to a publication, and only the publication's owner may change what it names. Empty until
-- replicate names a table. It publishes every change, and none of the partitions' own names, since
-- no partitioned table is replicated.
CREATE PUBLICATION powersync;

-- replicate publishes tbl for PowerSync: at REPLICA IDENTITY FULL, so that an update and a delete
-- carry every column's old value, as the spike ran every table (ADR 0001) and as a stream that
-- filters on a column needs to tell a row leaving its bucket from one staying; in the powersync
-- publication; and readable by the replication role, whose BYPASSRLS grants no privilege. Only the
-- migrate role, which owns the tables, runs it.
-- +goose StatementBegin
CREATE FUNCTION replicate(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s REPLICA IDENTITY FULL', tbl);
  IF NOT EXISTS (SELECT FROM pg_publication_rel r JOIN pg_publication p ON p.oid = r.prpubid
                 WHERE p.pubname = 'powersync' AND r.prrelid = tbl) THEN
    EXECUTE format('ALTER PUBLICATION powersync ADD TABLE %s', tbl);
  END IF;
  EXECUTE format('GRANT SELECT ON %s TO household_powersync', tbl);
END
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION replicate(regclass) FROM PUBLIC;

-- The platform's own: admin's entities, which reach every member of their household (the
-- settings, the memberships and the modules' enablement) or those granted admin (the invitations),
-- and the grants every stream's arm for a member reads (PRD modules/17 Sync, ADR 0011).
SELECT replicate('households');
SELECT replicate('memberships');
SELECT replicate('module_enablement');
SELECT replicate('module_grants');
SELECT replicate('invitations');
