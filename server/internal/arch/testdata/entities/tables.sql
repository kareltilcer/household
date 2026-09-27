-- Tables for the entities of entities.Tabled: one that keeps architecture test 5's table rules
-- and some that break them. The test runs this as the migrate role, in a transaction it rolls
-- back.

CREATE SCHEMA arch_testdata;

-- Keeps it: the base columns, as the helper adds them.
CREATE TABLE arch_testdata.compliant_items (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT add_entity_columns('arch_testdata.compliant_items');

-- Only the two columns a module declares itself.
CREATE TABLE arch_testdata.bare_items (id uuid PRIMARY KEY, household_id uuid NOT NULL);

-- Its own spelling of the base columns: a narrower version, a creation instant with no zone
-- that may be NULL, a tombstone every row has, and no trigger.
CREATE TABLE arch_testdata.drifted_items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamp,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NOT NULL DEFAULT now()
);

-- The base columns and the trigger, keyed on the household and the id rather than on the id the
-- client generated.
CREATE TABLE arch_testdata.keyed_items (
  id uuid NOT NULL,
  household_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (household_id, id)
);
CREATE TRIGGER touch_entity BEFORE UPDATE ON arch_testdata.keyed_items FOR EACH ROW EXECUTE FUNCTION touch_entity();
