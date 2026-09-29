-- Households, memberships, invitations and grants (PRD 02 §3–5, §7; PRD modules/17; plan item 10):
-- what item 3's minimal tenancy schema left for this item. A household gains its settings and its
-- code; a membership, a module's enablement and a household's settings become entities of admin, the
-- module the platform serves itself (ADR 0011), so that every change to them is written through the
-- mutation spine with its audit event and its sync change; and an invitation, the third table PRD 01
-- §2.4 gives a policy of its own, is added.
--
-- No household existed before this item, since nothing could create one: the columns added NOT NULL
-- here have no default to fill an older row with.

-- +goose Up

-- The memberships become the admin.membership entity, keyed on an id of their own as every entity is
-- (add_entity_columns). A member is still one row per household and user, which the tables naming a
-- member reference: their grants, and their Idempotency-Keys. The join date is the row's created_at,
-- which add_entity_columns makes.
ALTER TABLE module_grants DROP CONSTRAINT module_grants_household_id_user_id_fkey;
ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_keys_household_id_user_id_fkey;
ALTER TABLE memberships DROP CONSTRAINT memberships_pkey;
ALTER TABLE memberships DROP COLUMN created_at;
ALTER TABLE memberships ADD COLUMN id uuid NOT NULL;
ALTER TABLE memberships ADD PRIMARY KEY (id);
ALTER TABLE memberships ADD CONSTRAINT memberships_household_id_user_id_key UNIQUE (household_id, user_id);
ALTER TABLE module_grants
  ADD FOREIGN KEY (household_id, user_id) REFERENCES memberships (household_id, user_id) ON DELETE CASCADE;
ALTER TABLE idempotency_keys
  ADD FOREIGN KEY (household_id, user_id) REFERENCES memberships (household_id, user_id) ON DELETE CASCADE;
SELECT add_entity_columns('memberships');

-- A module's enablement becomes the admin.module_enablement entity, one row per household and module.
ALTER TABLE module_enablement DROP CONSTRAINT module_enablement_pkey;
ALTER TABLE module_enablement ADD COLUMN id uuid NOT NULL;
ALTER TABLE module_enablement ADD PRIMARY KEY (id);
ALTER TABLE module_enablement ADD CONSTRAINT module_enablement_household_id_module_key UNIQUE (household_id, module);
SELECT add_entity_columns('module_enablement');

-- A household's settings are its own row's (PRD modules/17 §1), the admin.household_settings entity:
-- on the tenant root, whose policy lets a member read it before a household context exists, so that
-- the list of a user's households carries their names. household_id is the row's own id, the column
-- every entity names its household by. country is a country Household has a profile of (FR-HA1),
-- whose units and first day of the week a new household starts with; locale is a BCP 47 tag, the
-- default language of the household's messages. join_code is the household code (FR-CH1): eight
-- characters of an alphabet without 0, O, 1 and I, which a child's sign-in names the household by and
-- which an owner may regenerate. billing_payer_id is the payer of record (FR-HH1), a member, whom
-- leaving and removal refuse (FR-HH4); the key is checked at commit, so that a household and its first
-- member are written in either order. created_at is when the household was made, which
-- add_entity_columns makes.
ALTER TABLE households DROP COLUMN created_at;
ALTER TABLE households
  ADD COLUMN household_id uuid GENERATED ALWAYS AS (id) STORED NOT NULL,
  ADD COLUMN name text NOT NULL CHECK (name <> '' AND char_length(name) <= 80),
  ADD COLUMN country text NOT NULL REFERENCES country_profiles (code),
  ADD COLUMN timezone text NOT NULL CHECK (timezone <> ''),
  ADD COLUMN base_currency char(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN locale text NOT NULL CHECK (locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'),
  ADD COLUMN units unit_system NOT NULL,
  ADD COLUMN first_day_of_week smallint NOT NULL CHECK (first_day_of_week BETWEEN 0 AND 6),
  ADD COLUMN join_code text NOT NULL UNIQUE CHECK (join_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  ADD COLUMN billing_payer_id uuid,
  ADD FOREIGN KEY (id, billing_payer_id) REFERENCES memberships (household_id, user_id) DEFERRABLE INITIALLY DEFERRED;
SELECT add_entity_columns('households');

-- An invitation (FR-HH2, FR-HH3), the admin.invitation entity: a membership proposed to an address, or
-- to whoever holds a link, with the role and the grants accepting it gives, never a child's (D-17: a
-- child profile is created by an owner, not invited). grants are the proposed levels by module id, and
-- dashboard_layout the starting layout item 36 applies. The token its email or link carries is kept
-- as its SHA-256. A link is accepted by up to max_uses accounts, twelve at most, the members' fair-use
-- ceiling (PRD 04 §5); an email by the one account with its address. It is accepted once it is used
-- up; an expired invitation is one past expires_at, whatever its status says.
CREATE TYPE invitation_kind AS ENUM ('email', 'link');

CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined', 'revoked');

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  kind invitation_kind NOT NULL,
  email text CHECK (email <> '' AND char_length(email) <= 254),
  role household_role NOT NULL CHECK (role <> 'child'),
  grants jsonb NOT NULL CHECK (jsonb_typeof(grants) = 'object'),
  dashboard_layout jsonb CHECK (jsonb_typeof(dashboard_layout) = 'object'),
  message text CHECK (char_length(message) <= 500),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  invited_by uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 12),
  uses integer NOT NULL DEFAULT 0 CHECK (uses BETWEEN 0 AND max_uses),
  status invitation_status NOT NULL DEFAULT 'pending',
  CHECK ((kind = 'email') = (email IS NOT NULL)),
  CHECK (kind = 'link' OR max_uses = 1),
  CHECK ((status = 'accepted') = (uses = max_uses))
);
SELECT add_entity_columns('invitations');

CREATE INDEX invitations_household_id ON invitations (household_id, created_at DESC);
CREATE INDEX invitations_email ON invitations (lower(email)) WHERE status = 'pending';

-- The token an invitation's holder presents, which the server sets with SET LOCAL as the hex of its
-- SHA-256 to read that one invitation before any household's context exists; NULL when unset, as the
-- tenant settings read.
CREATE FUNCTION app_invitation_token() RETURNS bytea
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT decode(NULLIF(current_setting('app.invitation_token', true), ''), 'hex') $$;

-- Invitations are read before a household context exists (PRD 01 §2.4), by the one who holds one:
-- outside any household's context, the invitation whose token the transaction presents, and every
-- email invitation to the caller's verified address; inside a household's context, that household's
-- rows only, as a tenant table's. They are written only in their household's context, as households
-- and memberships are (ADR 0005).
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_read ON invitations FOR SELECT
  USING (
    household_id = app_household_id()
    OR (app_household_id() IS NULL AND (
      token_hash = app_invitation_token()
      OR (kind = 'email' AND lower(email) = (
        SELECT lower(u.email) FROM users u WHERE u.id = app_user_id() AND u.email_verified_at IS NOT NULL)))));
CREATE POLICY invitation_write ON invitations
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- A member's last activity in a household (FR-HA3) is their newest event in its log.
CREATE INDEX audit_events_actor ON audit_events (household_id, actor_id, occurred_at DESC);
