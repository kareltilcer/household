-- Idempotency-Key storage for the household's unsafe REST requests (PRD 01 §6; the contract's
-- IdempotencyKey parameter): a key is retained for 7 days, and a request that repeats one gets
-- the stored response instead of repeating the effect (internal/platform/idempotency).

-- +goose Up

-- in_flight: a request holds the key and its effect has not committed. committed: the effect
-- committed, in the same transaction that set this, and the response is not stored yet.
-- completed: the response is stored and is what a repeat gets.
CREATE TYPE idempotency_state AS ENUM ('in_flight', 'committed', 'completed');

-- A key is the caller's own: two members who happen to send one key hold two rows, and neither
-- is answered with the other's response. claim identifies the request holding the key, so that
-- a request whose hold lapsed and was taken over cannot then commit its effect.
CREATE TABLE idempotency_keys (
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 128),
  fingerprint bytea NOT NULL,
  state idempotency_state NOT NULL,
  claim uuid NOT NULL,
  claimed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status smallint CHECK (status BETWEEN 200 AND 299),
  header jsonb,
  body bytea,
  PRIMARY KEY (household_id, user_id, key),
  FOREIGN KEY (household_id, user_id) REFERENCES memberships (household_id, user_id) ON DELETE CASCADE,
  CHECK ((state = 'completed') = (status IS NOT NULL))
);

-- The expiry sweep (item 15) deletes keys past their 7 days.
CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);

SELECT enable_tenant_isolation('idempotency_keys');
