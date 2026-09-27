-- The spike's additions to item 4's schema, applied as the administrator after `bootstrap` and
-- `migrate`. Throwaway (plan item 5).

-- One entity table, made the way item 4 says a module makes one: the migrate role creates it,
-- so it gets the request role's default privileges, then calls the two helpers.
SET ROLE household_migrate;

CREATE TABLE shopping_items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  title text NOT NULL,
  -- state_set, keyed on the item, resolved by latest_client_time (PRD 03 §2.5): the intent
  -- and the client time it was expressed at travel together.
  checked boolean NOT NULL DEFAULT false,
  checked_at timestamptz
);

SELECT add_entity_columns('shopping_items');
SELECT enable_tenant_isolation('shopping_items');

RESET ROLE;

-- Both engines replicate the whole row (an update's old values included, which Electric needs
-- and PowerSync can use).
ALTER TABLE shopping_items REPLICA IDENTITY FULL;
ALTER TABLE memberships REPLICA IDENTITY FULL;
ALTER TABLE module_enablement REPLICA IDENTITY FULL;
ALTER TABLE module_grants REPLICA IDENTITY FULL;

-- The engines' own roles. Both need REPLICATION for the slot and, because every tenant table
-- forces row-level security and neither engine sets app.household_id, BYPASSRLS to read the
-- initial snapshot at all: an engine sees every household, and the tenant boundary moves from
-- PostgreSQL into the engine's own rules.
CREATE ROLE spike_powersync LOGIN PASSWORD 'spike_powersync' REPLICATION BYPASSRLS;
CREATE ROLE spike_electric LOGIN PASSWORD 'spike_electric' REPLICATION BYPASSRLS;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO spike_powersync, spike_electric;
GRANT CONNECT ON DATABASE household TO spike_powersync, spike_electric;
GRANT CREATE ON DATABASE household TO spike_electric;

-- PowerSync reads the publication named `powersync`.
CREATE PUBLICATION powersync FOR TABLE shopping_items, memberships, module_enablement, module_grants;

-- Electric manages its own publication when it owns the tables; here the migrate role owns
-- them, so Electric runs with manual publishing and is handed this one.
CREATE PUBLICATION electric_publication_default FOR TABLE shopping_items, memberships, module_enablement, module_grants;
ALTER PUBLICATION electric_publication_default OWNER TO spike_electric;

-- PowerSync's bucket storage, in a database of its own.
CREATE ROLE spike_powersync_storage LOGIN PASSWORD 'spike_powersync_storage';
CREATE DATABASE powersync_storage OWNER spike_powersync_storage;

-- The other two access axes, for probing what each engine can express (PRD 03 §2.3):
-- a note that may be private to its owner, whose redacted form (D-88) reaches the others;
-- and a conversation whose messages reach its members from their floor on (D-90).
INSERT INTO modules (id) VALUES ('spike') ON CONFLICT DO NOTHING;
SET ROLE household_migrate;
CREATE TABLE spike_notes (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('shared', 'private')),
  owner_id uuid REFERENCES users (id),
  title text NOT NULL,
  body text NOT NULL
);
SELECT add_entity_columns('spike_notes');
SELECT enable_tenant_isolation('spike_notes');

CREATE TABLE spike_conversation_members (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  floor_seq bigint NOT NULL,
  PRIMARY KEY (household_id, conversation_id, user_id)
);
SELECT enable_tenant_isolation('spike_conversation_members');

CREATE TABLE spike_messages (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  seq bigint NOT NULL,
  body text NOT NULL
);
SELECT add_entity_columns('spike_messages');
SELECT enable_tenant_isolation('spike_messages');
RESET ROLE;

ALTER TABLE spike_notes REPLICA IDENTITY FULL;
ALTER TABLE spike_conversation_members REPLICA IDENTITY FULL;
ALTER TABLE spike_messages REPLICA IDENTITY FULL;
GRANT SELECT ON spike_notes, spike_conversation_members, spike_messages TO spike_powersync, spike_electric;
ALTER PUBLICATION powersync ADD TABLE spike_notes, spike_conversation_members, spike_messages;
ALTER PUBLICATION electric_publication_default ADD TABLE spike_notes, spike_conversation_members, spike_messages;

-- PowerSync compares row data with the caller only by equality, so a member's floor in a
-- conversation (D-90) cannot be a term of its stream. The workaround: the server keeps each
-- message's readers on the row, the members whose floor it is at or above.
ALTER TABLE spike_messages ADD COLUMN readers uuid[] NOT NULL DEFAULT '{}';
