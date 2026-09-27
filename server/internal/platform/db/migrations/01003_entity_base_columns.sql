-- The base columns of every household entity (PRD 01 §3, D-23, D-82): the sync-ready half of
-- the schema, which is catastrophic to change once households hold rows and cheap to get
-- right before any module has a table. A module's migration creates its table with the two
-- columns only it can declare, its client-generated UUIDv7 primary key and its tenant key,
-- then calls add_entity_columns and enable_tenant_isolation on it:
--
--   CREATE TABLE shopping_items (
--     id uuid PRIMARY KEY,
--     household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
--     …
--   );
--   SELECT add_entity_columns('shopping_items');
--   SELECT enable_tenant_isolation('shopping_items');
--
-- Architecture test 5 fails a registered sync entity whose table lacks any of them.

-- +goose Up

-- touch_entity keeps the base columns true on every update: the version is the sync engine's
-- optimistic-concurrency token and the row_version of its change, so a module that forgot to
-- increment it would publish a change that a replica holding the old version could not tell
-- from what it has. Who created the row, and when, never changes; who updated it is the caller
-- in the transaction's context, NULL for the system.
-- +goose StatementBegin
CREATE FUNCTION touch_entity() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  NEW.updated_by := public.app_user_id();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
-- +goose StatementEnd

-- add_entity_columns adds the base columns to tbl and the trigger that maintains them. It
-- refuses a table that does not already have the two a module declares itself: id uuid, its
-- primary key alone, and household_id uuid NOT NULL. created_by and updated_by default to the
-- caller in the transaction's context and reference the user, whose row is never deleted
-- (FR-PR4); a row soft-deleted has deleted_at set, and a hard delete is reserved for the
-- destructive-operation gate and erasure. Only the migrate role, which owns the tables, runs
-- it.
-- +goose StatementBegin
CREATE FUNCTION add_entity_columns(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = tbl AND i.indisprimary AND i.indnatts = 1
      AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype
  ) THEN
    RAISE EXCEPTION '% needs id uuid PRIMARY KEY before its base columns are added', tbl;
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = tbl AND a.attname = 'household_id' AND a.atttypid = 'uuid'::regtype
      AND a.attnotnull AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION '% needs household_id uuid NOT NULL before its base columns are added', tbl;
  END IF;
  EXECUTE format('ALTER TABLE %s'
    ' ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),'
    ' ADD COLUMN created_by uuid DEFAULT public.app_user_id() REFERENCES public.users (id),'
    ' ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),'
    ' ADD COLUMN updated_by uuid DEFAULT public.app_user_id() REFERENCES public.users (id),'
    ' ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),'
    ' ADD COLUMN deleted_at timestamptz', tbl);
  EXECUTE format('CREATE TRIGGER touch_entity BEFORE UPDATE ON %s'
    ' FOR EACH ROW EXECUTE FUNCTION public.touch_entity()', tbl);
END
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION add_entity_columns(regclass) FROM PUBLIC;
