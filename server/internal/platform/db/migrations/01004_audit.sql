-- The audit spine (PRD 03 §1, FR-AU1–FR-AU5): an event for every mutation, written in the
-- mutation's own transaction by the mutation spine (internal/platform/mutation), with the
-- field diffs of the entities whose history is the question the log exists to answer.

-- +goose Up

-- Who caused an event. An enum, not a CHECK, so that a later actor such as an AI assistant's
-- is an ALTER TYPE … ADD VALUE and not a rebuild of a table with dependants (future/ai-assistant
-- §"What 1.0 must not do").
CREATE TYPE audit_actor_type AS ENUM ('user', 'system', 'service');

CREATE TYPE audit_level AS ENUM ('info', 'notice', 'warn');

-- Whether an event is about a private item, which FR-AU4 redacts on read for everyone but its
-- owner.
CREATE TYPE audit_visibility AS ENUM ('shared', 'private');

-- One event. The summary is a translation key and its arguments, rendered in the reader's
-- language when read (FR-AU3, D-21), never a stored sentence. actor_label is the actor's name
-- when the event was written, so the log still reads after they leave. meta carries how the
-- change arrived (via: web, mobile, dashboard, sync, import, system, and values added later),
-- the request id, and anything module-specific.
CREATE TABLE audit_events (
  id uuid NOT NULL,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type audit_actor_type NOT NULL,
  actor_id uuid,
  actor_label text,
  module text NOT NULL REFERENCES modules (id),
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  entity_type text,
  entity_id uuid,
  level audit_level NOT NULL DEFAULT 'info',
  summary_key text NOT NULL CHECK (summary_key <> ''),
  summary_args jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(summary_args) = 'object'),
  visibility audit_visibility NOT NULL DEFAULT 'shared',
  owner_id uuid,
  meta jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(meta) = 'object'),
  PRIMARY KEY (household_id, id),
  CHECK (actor_type <> 'user' OR actor_id IS NOT NULL),
  CHECK ((entity_type IS NULL) = (entity_id IS NULL)),
  CHECK (entity_type IS NULL OR starts_with(entity_type, module || '.')),
  CHECK (visibility = 'shared' OR owner_id IS NOT NULL)
);

-- The activity log, newest first, and one entity's timeline.
CREATE INDEX audit_events_household_occurred ON audit_events (household_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_entity ON audit_events (household_id, entity_type, entity_id, occurred_at DESC);

-- One field's change in an event (FR-AU2): its value before and after, as JSON, NULL where it
-- had none.
CREATE TABLE audit_changes (
  household_id uuid NOT NULL,
  event_id uuid NOT NULL,
  field text NOT NULL CHECK (field <> ''),
  old_value jsonb,
  new_value jsonb,
  PRIMARY KEY (household_id, event_id, field),
  FOREIGN KEY (household_id, event_id) REFERENCES audit_events (household_id, id) ON DELETE CASCADE
);

SELECT enable_tenant_isolation('audit_events');
SELECT enable_tenant_isolation('audit_changes');

-- The log is not the household's to edit or prune (FR-AU5): the request role appends to it and
-- reads it. Erasure deletes it with the household, through the cascade from households.
REVOKE UPDATE, DELETE ON audit_events, audit_changes FROM household_app;
