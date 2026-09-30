-- The daily usage sample (FR-ST2, PRD 04 §4; plan item 14): what each household stored on a day, by
-- module and by member, and how many objects and rows it held, which billing averages over its period
-- (item 19) and fair use watches (item 16). Nothing bills off a live scan: the sample is the figure.
-- The meter role measures every household at once and the request role writes each household's
-- sample in its own context (internal/platform/storage), so no role both reads across households
-- and writes.
--
-- sampled_on is the UTC day the sample was taken on, and a second sample that day replaces the first.

-- +goose Up

-- stored_bytes is every byte the household keeps in the object store, derived variants included
-- (FR-ST3); derived_bytes is the part of it that is derived.
CREATE TABLE usage_samples (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  sampled_on date NOT NULL,
  sampled_at timestamptz NOT NULL,
  stored_bytes bigint NOT NULL CHECK (stored_bytes >= 0),
  derived_bytes bigint NOT NULL CHECK (derived_bytes >= 0 AND derived_bytes <= stored_bytes),
  object_count bigint NOT NULL CHECK (object_count >= 0),
  PRIMARY KEY (household_id, sampled_on)
);

-- Each module the household holds objects or rows in: its bytes and objects, and the rows of the
-- tables it declares (module.StorageSource), which fair use counts (PRD 04 §5).
CREATE TABLE usage_sample_modules (
  household_id uuid NOT NULL,
  sampled_on date NOT NULL,
  module text NOT NULL REFERENCES modules (id),
  stored_bytes bigint NOT NULL CHECK (stored_bytes >= 0),
  derived_bytes bigint NOT NULL CHECK (derived_bytes >= 0 AND derived_bytes <= stored_bytes),
  object_count bigint NOT NULL CHECK (object_count >= 0),
  row_count bigint NOT NULL CHECK (row_count >= 0),
  PRIMARY KEY (household_id, sampled_on, module),
  FOREIGN KEY (household_id, sampled_on) REFERENCES usage_samples (household_id, sampled_on) ON DELETE CASCADE
);

-- Each member the household's objects are attributed to (FR-ST1), former members included: their
-- bytes stay until the objects go.
CREATE TABLE usage_sample_members (
  household_id uuid NOT NULL,
  sampled_on date NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  stored_bytes bigint NOT NULL CHECK (stored_bytes >= 0),
  object_count bigint NOT NULL CHECK (object_count >= 0),
  PRIMARY KEY (household_id, sampled_on, user_id),
  FOREIGN KEY (household_id, sampled_on) REFERENCES usage_samples (household_id, sampled_on) ON DELETE CASCADE
);

SELECT enable_tenant_isolation('usage_samples');
SELECT enable_tenant_isolation('usage_sample_modules');
SELECT enable_tenant_isolation('usage_sample_members');
