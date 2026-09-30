-- Per-mutation idempotency (PRD 03 §2.4, FR-SY5; plan item 13): the answer the push gave each
-- mutation that ended, kept for 7 days under the mutation's id, so that a mutation delivered again,
-- in a batch retried whole under a fresh Idempotency-Key, is answered as it was the first time and
-- takes no second effect (internal/platform/push).
--
-- A mutation is its sender's: the key is the household, the member who pushed it and its id, so a
-- member who sends another's mutation id is answered as the mutation was new to them, never with the
-- other's answer, whose row they may not see. An answer that commits an effect is written in the
-- effect's transaction; one that commits none (a refusal, a conflict, a state already in place) in
-- a transaction of its own once the mutation has been answered. A deferred mutation keeps none:
-- its replay runs it. fingerprint is what makes a delivery the same mutation, its entity, its op
-- and what it carries: a mutation id sent again with anything else is refused.

-- +goose Up

CREATE TABLE sync_mutations (
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  mutation_id uuid NOT NULL,
  fingerprint bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
  outcome text NOT NULL CHECK (outcome IN ('applied', 'merged', 'conflict', 'rejected')),
  version bigint CHECK (version > 0),
  code text,
  message text,
  row jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id, mutation_id),
  FOREIGN KEY (household_id, user_id) REFERENCES memberships (household_id, user_id) ON DELETE CASCADE,
  CHECK ((outcome = 'applied') = (code IS NULL))
);

-- The expiry sweep (item 17) deletes answers past their 7 days.
CREATE INDEX sync_mutations_created_at ON sync_mutations (created_at);

SELECT enable_tenant_isolation('sync_mutations');
