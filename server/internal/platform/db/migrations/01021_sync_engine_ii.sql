-- Sync engine II (plan item 17, ADR 0018): a rewrite of the access a row carries, which is not an
-- edit of it, and the count of the mutations a household's replicas push in a day.
--
-- A stream reads an entity's own table (D-93), so a row an audience bounds keeps its readers on the
-- row (D-90), and a row a private item bounds keeps the item's visibility and owner (D-88), each
-- rewritten when the audience or the item changes: by sync.RewriteAccess, which names the columns it
-- rewrites in the transaction's household.access_rewrite. touch_entity then leaves the row's version,
-- updated_by and updated_at as they were, since who a row reaches is not what it says, and an edit a
-- member queued against it, or sent under If-Match, must still apply against the version they saw
-- rather than conflict, or be preserved as a loser. It refuses such an update that changes any other
-- column, which would be an edit nobody versioned. Every other update moves the version as before
-- (ADR 0006): the setting is cleared after each rewrite.
--
-- sync_usage counts the mutations the push received for each household on each day, the UTC day
-- (D-109's metering bucket), against PRD 04 §5's fair-use ceiling of 100 000 a day, a rate, which past
-- it answers 429 until the day ends (D-116, D-127). It is the platform's own record, no entity's
-- history, written through tenant.InWriteTx; the expiry sweep deletes a day a week after it.

-- +goose Up

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION touch_entity() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  rewrite text[] := string_to_array(nullif(current_setting('household.access_rewrite', true), ''), ',');
BEGIN
  IF rewrite IS NOT NULL THEN
    IF to_jsonb(NEW) - rewrite IS DISTINCT FROM to_jsonb(OLD) - rewrite THEN
      -- P0001, which no refusal of a client's mutation reads as its own (push.FromDatabase): a module's
      -- bug, which fails its request.
      RAISE EXCEPTION 'a rewrite of the access a row of % carries changed more than %', TG_TABLE_NAME, array_to_string(rewrite, ', ');
    END IF;
    RETURN NEW;
  END IF;
  NEW.version := OLD.version + 1;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  NEW.updated_by := public.app_user_id();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TABLE sync_usage (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  day date NOT NULL,
  mutations integer NOT NULL CHECK (mutations >= 0),
  PRIMARY KEY (household_id, day)
);

SELECT enable_tenant_isolation('sync_usage');

-- The expiry sweep finds the households with a day past its week.
GRANT SELECT (day) ON sync_usage TO household_meter;
