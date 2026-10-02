-- Each replica's last report of itself (plan item 18, D-125, ADR 0019): a client's replica of a
-- household reports, at rest, what it holds as a hash and a count per entity type, and its health
-- (POST …/sync/digest). The server compares the hashes with what the replica's member may see, keeps
-- the report for the sync-health screen (GET …/sync/state), and keeps, per entity type that disagreed,
-- when it first did and the server's own hash then: a second disagreement a minute or more later,
-- against a server hash that held still, is divergence. A replica found divergent, or one its member
-- asked to download itself again (POST …/sync/reset), is told so at its next report.
--
-- It is the platform's own record of what replicas said, no entity's history, written through
-- tenant.InWriteTx. A replica is its member's: its id is the client's, and no other member's report
-- may name it. The expiry sweep deletes a replica that has not reported for 90 days (PRD 03 §5,
-- D-128): an app uninstalled, or a browser cleared, never reports again.
--
-- resnapshot is where the replica stands in downloading itself again: none; marked, to be told at
-- its next report; or told, until the report after, which it sends once it has downloaded itself.

-- +goose Up

CREATE TABLE sync_replicas (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  -- The device it reported from, or null for a web session's; and the device's label, or the
  -- browser's, as the replica was last reported from.
  device_id uuid,
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 256),
  checkpoint text CHECK (char_length(checkpoint) <= 64),
  reported_at timestamptz NOT NULL,
  pending_mutations integer NOT NULL CHECK (pending_mutations >= 0),
  unresolved integer NOT NULL CHECK (unresolved >= 0),
  checksum_failures integer NOT NULL CHECK (checksum_failures >= 0),
  -- The entity types that disagreed at the last report, and for each one still disagreeing since,
  -- {"<entity type>": {"since": <RFC 3339>, "server_hash": "<16 hex digits>"}}.
  mismatched text[] NOT NULL DEFAULT '{}',
  mismatches jsonb NOT NULL DEFAULT '{}',
  resnapshot text NOT NULL DEFAULT 'none' CHECK (resnapshot IN ('none', 'marked', 'told')),
  PRIMARY KEY (household_id, id)
);

CREATE INDEX sync_replicas_user ON sync_replicas (household_id, user_id);

SELECT enable_tenant_isolation('sync_replicas');

-- The expiry sweep finds the households with a replica past its time.
GRANT SELECT (reported_at) ON sync_replicas TO household_meter;
