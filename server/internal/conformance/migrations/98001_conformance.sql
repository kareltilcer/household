-- The conformance module's tables (plan item 12): the entities the sync conformance suite
-- (packages/sync/conformance) drives, one for each shape PRD 10 §4's scenarios need, made as a
-- module makes its own (add_entity_columns, enable_tenant_isolation). No feature module exists
-- before item 30's proof and item 31's Shopping, and items 13 and 14 must pass the scenarios
-- before either, so the suite brings its own. Block 98 is the suite's: no module the server serves
-- numbers its block 98, and the server's own registry never holds this one.

-- +goose Up
INSERT INTO modules (id) VALUES ('conformance');

-- conformance.item, lww_field (scenarios 1, 2, 4, 5, 7, 8, 9, 10, 15): a shopping item's text, its
-- note and its quantity, each merged on its own, and its soft delete a field like the others
-- (PRD modules/05 Sync, B). The quantity's range is what scenario 8's third mutation breaks.
CREATE TABLE conformance_items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title <> '' AND char_length(title) <= 200),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
  UNIQUE (household_id, id)
);
SELECT add_entity_columns('conformance_items');
SELECT enable_tenant_isolation('conformance_items');

-- conformance.item_checked, state_set keyed on (item_id) and resolved by latest_client_time
-- (scenario 3, PRD modules/05 Sync): one row per item whatever id each client gave the check it
-- made offline. checked_at is the client time of the intent in place, clamped to 24 hours of the
-- server's (PRD 03 §2.8), and clock_flagged says it was.
CREATE TABLE conformance_item_checks (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  checked boolean NOT NULL,
  checked_at timestamptz NOT NULL,
  clock_flagged boolean NOT NULL DEFAULT false,
  UNIQUE (household_id, item_id),
  FOREIGN KEY (household_id, item_id) REFERENCES conformance_items (household_id, id)
);
SELECT add_entity_columns('conformance_item_checks');
SELECT enable_tenant_isolation('conformance_item_checks');

-- conformance.reading, additive with a non_decreasing invariant over (meter_id) ordered by read_at
-- (scenario 17, FR-UT1): a meter reading, which must not fall below the reading before it nor rise
-- above the one after it.
CREATE TABLE conformance_readings (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  meter_id uuid NOT NULL,
  read_at timestamptz NOT NULL,
  value bigint NOT NULL CHECK (value >= 0)
);
SELECT add_entity_columns('conformance_readings');
SELECT enable_tenant_isolation('conformance_readings');

-- conformance.budget, strict_version (scenario 11): an amount of money, which conflicts rather than
-- merges.
CREATE TABLE conformance_budgets (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> '' AND char_length(name) <= 200),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$')
);
SELECT add_entity_columns('conformance_budgets');
SELECT enable_tenant_isolation('conformance_budgets');

-- conformance.note, lww_row, which may be private to its owner and then reaches everyone else as its
-- redacted projection (D-88): the access loss of an item moved from shared to private (PRD 03 §2.6).
CREATE TABLE conformance_notes (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('shared', 'private')),
  owner_id uuid REFERENCES users (id),
  title text NOT NULL CHECK (char_length(title) <= 200),
  body text NOT NULL CHECK (char_length(body) <= 20000),
  CHECK ((visibility = 'private') = (owner_id IS NOT NULL))
);
SELECT add_entity_columns('conformance_notes');
SELECT enable_tenant_isolation('conformance_notes');

-- conformance.chore, strict_version, and conformance.completion, state_set keyed on (chore_id,
-- occurrence) and resolved by latest_client_time (scenario 13, D-52): a rotating chore, whose
-- rotation the server advances once per occurrence completed, however many completions of it
-- arrive.
CREATE TABLE conformance_chores (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> '' AND char_length(name) <= 200),
  rotation uuid[] NOT NULL,
  rotation_index integer NOT NULL DEFAULT 0 CHECK (rotation_index >= 0),
  UNIQUE (household_id, id)
);
SELECT add_entity_columns('conformance_chores');
SELECT enable_tenant_isolation('conformance_chores');

CREATE TABLE conformance_completions (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  chore_id uuid NOT NULL,
  occurrence date NOT NULL,
  done boolean NOT NULL,
  done_at timestamptz NOT NULL,
  UNIQUE (household_id, chore_id, occurrence),
  FOREIGN KEY (household_id, chore_id) REFERENCES conformance_chores (household_id, id)
);
SELECT add_entity_columns('conformance_completions');
SELECT enable_tenant_isolation('conformance_completions');

-- conformance.attachment (scenario 12, D-25): a file's row, which syncs whatever becomes of its
-- bytes, pending until they arrive and failed, with a reason a member can act on, when they never
-- can.
CREATE TABLE conformance_attachments (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  file_name text NOT NULL CHECK (file_name <> '' AND char_length(file_name) <= 255),
  attachment_status text NOT NULL CHECK (attachment_status IN ('pending', 'ready', 'failed')),
  failure_reason text,
  CHECK ((attachment_status = 'failed') = (failure_reason IS NOT NULL)),
  FOREIGN KEY (household_id, item_id) REFERENCES conformance_items (household_id, id)
);
SELECT add_entity_columns('conformance_attachments');
SELECT enable_tenant_isolation('conformance_attachments');

-- conformance.conversation and its members, and conformance.message, additive with an audience
-- (scenarios 16 and 18, D-90): a member joins a conversation with a floor, the household's feed
-- sequence when they joined, and a message keeps its readers on the row, the members whose floor it
-- is at or above, which the stream tests the caller against (ADR 0001).
CREATE TABLE conformance_conversations (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) <= 200),
  UNIQUE (household_id, id)
);
SELECT add_entity_columns('conformance_conversations');
SELECT enable_tenant_isolation('conformance_conversations');

CREATE TABLE conformance_conversation_members (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  floor_seq bigint NOT NULL CHECK (floor_seq >= 0),
  UNIQUE (household_id, conversation_id, user_id),
  FOREIGN KEY (household_id, conversation_id) REFERENCES conformance_conversations (household_id, id)
);
SELECT add_entity_columns('conformance_conversation_members');
SELECT enable_tenant_isolation('conformance_conversation_members');

CREATE TABLE conformance_messages (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  body text NOT NULL CHECK (char_length(body) <= 4000),
  readers uuid[] NOT NULL DEFAULT '{}',
  FOREIGN KEY (household_id, conversation_id) REFERENCES conformance_conversations (household_id, id)
);
SELECT add_entity_columns('conformance_messages');
SELECT enable_tenant_isolation('conformance_messages');
