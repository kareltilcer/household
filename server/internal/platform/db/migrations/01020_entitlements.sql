-- A household's entitlement (PRD 04 §3; plan item 16): the state of its subscription, the owner's
-- restriction of processing (FR-BI7, D-87) and the platform's suspension, from which one of the eight
-- states is resolved once per request (internal/platform/entitlement), by a precedence of its own
-- (D-114). They are columns of the household's row, the admin.household_settings entity, so that a
-- change of them is recorded through the mutation spine with its audit event, and so that the
-- generated streams can hold a suspended household to nothing (D-115).
--
-- billing_state is the subscription's own state, the six of the eight that money decides. The
-- columns beside it time it: trial_ends_at the trial's end, 30 days from creation (FR-HH1);
-- dunning_ends_at the end of the retries after a failed payment, set on entering past_due and kept
-- while a household it lapsed goes on, which is how a lapse is told from a trial that ended;
-- grace_ends_at grace's end, 14 days; lapsed_at when the household became read_only or canceled, and
-- retained_until the day its data is deleted: 12 months after the lapse, then 30 more days in which
-- its owners are warned three times (D-32, D-119), retention_warnings counting those sent. The hourly
-- job (household.Service.Transition) moves a household along them; Stripe's webhooks (item 19) move it
-- back.
--
-- restricted_at, restricted_by and restricted_by_label are the owner who restricted the household and
-- when (FR-BI7): the banner every member sees names them, by the label the owner had then, as an
-- ActorRef does. suspended_at is the platform's suspension (item 21), which refuses everything.

-- +goose Up

CREATE TYPE billing_state AS ENUM ('trialing', 'active', 'past_due', 'grace', 'read_only', 'canceled');

ALTER TABLE households
  ADD COLUMN billing_state billing_state NOT NULL DEFAULT 'trialing',
  ADD COLUMN trial_ends_at timestamptz,
  ADD COLUMN dunning_ends_at timestamptz,
  ADD COLUMN grace_ends_at timestamptz,
  ADD COLUMN lapsed_at timestamptz,
  ADD COLUMN retained_until timestamptz,
  ADD COLUMN retention_warnings smallint NOT NULL DEFAULT 0 CHECK (retention_warnings BETWEEN 0 AND 3),
  ADD COLUMN restricted_at timestamptz,
  ADD COLUMN restricted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN restricted_by_label text CHECK (char_length(restricted_by_label) <= 200),
  ADD COLUMN restriction_reason text CHECK (char_length(restriction_reason) <= 500),
  ADD COLUMN suspended_at timestamptz;

-- A household made before this migration started its trial when it was made. 720 hours, not 30 days:
-- an interval of days moves with the session's timezone across a change of the clocks. Every
-- household's in one statement, which row-level security would hide from the migrate role as from any
-- other: FORCE is lifted from the table for this statement alone and put back before the migration
-- commits, inside the transaction goose runs it in, whose ALTER TABLE lock keeps every other session
-- out of the table until then (as 01013 does). touch_entity is held off for it too: filling in a
-- column the household never had is no change of its settings, and would otherwise move every
-- household's version past the last change recorded of it.
ALTER TABLE households NO FORCE ROW LEVEL SECURITY, DISABLE TRIGGER touch_entity;
UPDATE households SET trial_ends_at = created_at + interval '720 hours';
ALTER TABLE households FORCE ROW LEVEL SECURITY, ENABLE TRIGGER touch_entity;

ALTER TABLE households
  ALTER COLUMN trial_ends_at SET DEFAULT now() + interval '720 hours',
  ALTER COLUMN trial_ends_at SET NOT NULL,
  ADD CONSTRAINT households_dunning CHECK (billing_state <> 'past_due' OR dunning_ends_at IS NOT NULL),
  ADD CONSTRAINT households_grace CHECK (billing_state <> 'grace' OR grace_ends_at IS NOT NULL),
  ADD CONSTRAINT households_lapse CHECK (
    (billing_state IN ('read_only', 'canceled')) = (lapsed_at IS NOT NULL AND retained_until IS NOT NULL)
    AND (retained_until IS NULL OR retained_until > lapsed_at)
    AND (lapsed_at IS NOT NULL OR retention_warnings = 0)),
  ADD CONSTRAINT households_restriction CHECK (
    (restricted_at IS NULL AND restricted_by IS NULL AND restricted_by_label IS NULL AND restriction_reason IS NULL)
    OR (restricted_at IS NOT NULL AND restricted_by_label IS NOT NULL));

-- The hourly job's search: every household with a clock running. An active household has none, and
-- most households are, in time.
CREATE INDEX households_entitlement_due ON households (billing_state) WHERE billing_state <> 'active';

-- The meter role finds the households the hourly job has work in, across households, as it finds the
-- files pipeline's: by the columns that schedule the work, never what a household wrote.
GRANT SELECT (billing_state, trial_ends_at, dunning_ends_at, grace_ends_at, retained_until, retention_warnings)
  ON households TO household_meter;
