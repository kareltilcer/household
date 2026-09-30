-- The change feed (PRD 03 §2.2, FR-SY1, D-22): one append-only table for the deployment, keyed
-- by household and ordered by seq, which the mutation spine writes in each mutation's own
-- transaction and the sync engine (items 13 and 17) pulls from. Each row carries every field
-- the pull needs to authorise it (module, visibility, owner_id, audience_id, for_user_id), so a
-- pull is one indexed scan with one WHERE and no join into a module's tables.

-- +goose Up

CREATE TYPE sync_op AS ENUM ('upsert', 'delete', 'retract');

-- shared rows reach every member granted the module; a private row reaches its owner alone,
-- and its redacted projection everyone else (D-88).
CREATE TYPE sync_visibility AS ENUM ('shared', 'private', 'redacted');

-- Partitioned by month on occurred_at, so that compaction past the 90-day horizon (FR-SY2,
-- item 17) drops a partition rather than deleting rows. A partitioned table's primary key must
-- hold the partition key, so seq alone cannot be it; (household_id, seq, occurred_at) is the
-- key and is also the (household_id, seq) index a pull scans. seq comes from one sequence, so
-- it is unique on its own, and the spine takes the household's feed lock before drawing one,
-- so that a household's rows commit in seq order and a pull that has read seq N has missed no
-- row below it (internal/platform/sync). occurred_at is the start of the row's transaction and
-- seq is drawn near its end, so at a month's turn a household's row in the earlier month's
-- partition can have a greater seq than one in the later month's: the seqs of neighbouring
-- partitions overlap, and compaction's horizon is the greatest seq it dropped, never the least
-- one it kept.
CREATE TABLE sync_changes (
  seq bigserial NOT NULL,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  op sync_op NOT NULL,
  row_version bigint,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  module text NOT NULL REFERENCES modules (id),
  visibility sync_visibility NOT NULL DEFAULT 'shared',
  owner_id uuid,
  audience_id uuid,
  for_user_id uuid,
  payload jsonb,
  PRIMARY KEY (household_id, seq, occurred_at),
  CHECK (starts_with(entity_type, module || '.')),
  -- A retraction is addressed to one member and carries nothing, so the act of retracting
  -- leaks nothing (FR-SY7); an upsert carries the row, a delete only its id and version.
  CHECK ((op = 'retract') = (for_user_id IS NOT NULL)),
  CHECK ((op = 'upsert') = (payload IS NOT NULL)),
  CHECK ((op = 'retract') = (row_version IS NULL)),
  CHECK (row_version > 0),
  CHECK (visibility = 'shared' OR owner_id IS NOT NULL)
) PARTITION BY RANGE (occurred_at);

-- Retractions are pulled by the member they are addressed to.
CREATE INDEX sync_changes_retractions ON sync_changes (household_id, for_user_id, seq) WHERE for_user_id IS NOT NULL;

SELECT enable_tenant_isolation('sync_changes');

-- The feed is append-only for the request role: a change, once written, is what some replica
-- has already applied. Compaction drops whole partitions as the migrate role.
REVOKE UPDATE, DELETE ON sync_changes FROM household_app;

-- sync_changes_isolate_partition holds a partition to the rules its parent is held to. The
-- request role reaches the feed only through sync_changes, where the parent's policy and
-- privileges apply to every partition: PostgreSQL checks neither on a partition reached through
-- its parent, and checks only the partition's own on one reached directly. So a partition takes
-- no privilege of the request role's, which the migrate role's default privileges would
-- otherwise give it, and carries the tenant isolation as well, which holds the migrate role,
-- its owner.
-- +goose StatementBegin
CREATE FUNCTION sync_changes_isolate_partition(partition regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.enable_tenant_isolation(partition);
  EXECUTE format('REVOKE ALL ON %s FROM household_app', partition);
END
$$;
-- +goose StatementEnd

-- sync_changes_add_partitions makes sure a monthly partition exists for the month holding now()
-- and for each of the months_ahead after it. A partition's bounds are UTC midnights on the
-- first of the month, named sync_changes_yYYYYmMM. Item 17's maintenance calls it ahead of the
-- calendar; the default partition below catches a row whose month has none, so that a lapse
-- delays compaction rather than refusing every mutation, and the maintenance moves such rows
-- into their month's partition before creating it, which PostgreSQL otherwise refuses.
-- +goose StatementBegin
CREATE FUNCTION sync_changes_add_partitions(months_ahead integer) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  first timestamp := date_trunc('month', now() AT TIME ZONE 'UTC');
  lower timestamp;
  name text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    lower := first + make_interval(months => i);
    name := format('sync_changes_y%sm%s', to_char(lower, 'YYYY'), to_char(lower, 'MM'));
    IF to_regclass(format('public.%I', name)) IS NULL THEN
      EXECUTE format('CREATE TABLE public.%I PARTITION OF public.sync_changes FOR VALUES FROM (%L) TO (%L)',
        name, lower::text || '+00', (lower + interval '1 month')::text || '+00');
      PERFORM public.sync_changes_isolate_partition(format('public.%I', name)::regclass);
    END IF;
  END LOOP;
END
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION sync_changes_isolate_partition(regclass) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_changes_add_partitions(integer) FROM PUBLIC;

CREATE TABLE sync_changes_default PARTITION OF sync_changes DEFAULT;
SELECT sync_changes_isolate_partition('sync_changes_default');

SELECT sync_changes_add_partitions(3);
