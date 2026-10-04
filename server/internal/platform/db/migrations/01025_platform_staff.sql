-- Platform staff, feature flags and fair-use overrides (PRD 02 §8, PRD 04 §5, PRD 05 §6, PRD 06 §7;
-- plan item 21, ADR 0022): who the platform's staff are, the log of what they did, the flags a
-- feature ships dark behind, the ceilings staff raised for one household, the notice a suspension
-- carries, and what the staff role may read.
--
-- Staff read no household's content, and there is no mechanism by which they could (D-3). What they
-- do read, across households, they read as a role of its own, household_staff, which holds SELECT on
-- the columns that are metadata, granted one at a time, and nothing else: an account's address and
-- its sign-ins, a household's name, members, plan and state, what it stores per module, how its
-- deliveries went, and its audit events' action keys (D-143). Architecture test 12 holds the role to
-- those columns, and the no-content-access test connects as it. What staff do, they do through the
-- request role, in the household's own context and through the mutation spine, so that each action
-- is in the household's own log (D-75).

-- +goose Up

-- The platform's own schema (FR-PS2: "separate schema"). The default privileges of 01001 are the
-- public schema's, so nothing made here is the request role's until it is granted: the audit log is
-- append-only because UPDATE and DELETE on it are granted to nobody.
CREATE SCHEMA platform;
GRANT USAGE ON SCHEMA platform TO household_app, household_staff;
GRANT USAGE ON SCHEMA public TO household_staff;

-- The two platform roles (PRD 02 §8). Neither is a household role, and neither appears in any
-- household's member list.
CREATE TYPE platform.staff_role AS ENUM ('support', 'platform_admin');

-- A staff member is an account with a row here, and with the second step turned on, which the staff
-- API checks on every request (D-144). granted_by is the platform_admin who made them one, NULL for
-- the operator, who makes the first through the command line (runbooks/platform-staff.md).
CREATE TABLE platform.staff (
  user_id uuid PRIMARY KEY REFERENCES public.users (id),
  role platform.staff_role NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.users (id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.staff TO household_app;
GRANT SELECT (user_id, role, granted_at, granted_by) ON platform.staff TO household_staff;

-- The platform audit log (FR-PS2): every staff action, once, in the transaction of its effect, kept
-- seven years. actor_label is the staff member's address as it was, so that the log reads after
-- their account is gone, and actor_id NULL with the label 'operator' for an action made through the
-- command line. household_id and target_user_id name what the action touched, as ids alone, with no
-- key to either: the log outlives a household that is erased. reason is why, which every action
-- carries, and meta what else the action says of itself, a limit's key and value, a flag's.
--
-- It is append-only: the request role inserts and reads, and nobody updates or deletes a row but
-- the purge below, of rows past their seven years.
CREATE TABLE platform.audit_log (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES public.users (id),
  actor_label text NOT NULL CHECK (actor_label <> '' AND char_length(actor_label) <= 254),
  actor_role platform.staff_role,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  household_id uuid,
  target_user_id uuid,
  reason text CHECK (reason <> '' AND char_length(reason) <= 500),
  meta jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(meta) = 'object'),
  CHECK ((actor_id IS NULL) = (actor_role IS NULL))
);

-- The log is read newest first, whole or by who acted or what was acted on (getPlatformAudit).
CREATE INDEX audit_log_occurred ON platform.audit_log (occurred_at DESC, id DESC);
CREATE INDEX audit_log_actor ON platform.audit_log (actor_id, occurred_at DESC, id DESC);
CREATE INDEX audit_log_household ON platform.audit_log (household_id, occurred_at DESC, id DESC);

GRANT SELECT, INSERT ON platform.audit_log TO household_app;
GRANT SELECT (id, occurred_at, actor_id, actor_label, actor_role, action, household_id, target_user_id, reason, meta)
  ON platform.audit_log TO household_staff;

-- purge_audit_log deletes the entries past their seven years (FR-PS2, PRD 03 §5), and returns how
-- many: the one way a row of the log is ever deleted. It runs as its owner, the migrate role, since
-- the request role, which the expiry sweep runs as, may not delete from the log, and it takes no
-- argument, so that a caller cannot ask for a shorter retention.
-- +goose StatementBegin
CREATE FUNCTION platform.purge_audit_log() RETURNS bigint
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH gone AS (
    DELETE FROM platform.audit_log WHERE occurred_at < now() - interval '7 years' RETURNING 1)
  SELECT count(*) FROM gone
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION platform.purge_audit_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.purge_audit_log() TO household_app;

-- A feature flag (PRD 06 §7): what a feature ships dark behind, on or off for the whole platform. A
-- household's own setting of it, below, comes first. The flag named module.<id> is its module's: a
-- household for which it is off holds no level on the module, whatever it enables and grants, and a
-- module with no such flag is served as it is enabled (D-146), but household settings, which no flag
-- turns off. A flag is never deleted, since a household's setting names it.
CREATE TABLE platform.feature_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AND char_length(key) <= 100),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users (id)
);

GRANT SELECT, INSERT, UPDATE ON platform.feature_flags TO household_app;
GRANT SELECT (key, enabled, updated_at, updated_by) ON platform.feature_flags TO household_staff;

-- enable_staff_read admits the staff role to tbl's rows, for reading. It grants no column: each one
-- the role reads is granted below, by name, and architecture test 12 fails one that is not metadata.
-- Only the migrate role, which owns the tables, runs it.
-- +goose StatementBegin
CREATE FUNCTION enable_staff_read(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE POLICY staff_read ON %s FOR SELECT TO household_staff USING (true)', tbl);
END
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION enable_staff_read(regclass) FROM PUBLIC;

-- A household's own setting of a flag, which comes before the platform's: a feature turned on for
-- the households that try it first, or off for one it troubles.
CREATE TABLE household_flags (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  key text NOT NULL REFERENCES platform.feature_flags (key),
  enabled boolean NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, key)
);

SELECT enable_tenant_isolation('household_flags');
SELECT enable_staff_read('household_flags');
GRANT SELECT (household_id, key, enabled, set_at) ON household_flags TO household_staff;

-- A fair-use ceiling raised for one household (PRD 04 §5): exceeding one is a support conversation,
-- and platform_admin raises it there. key is the ceiling, as the contract's PlatformLimitOverride
-- names it, and value what the household is held to in place of the constant. set_by_label is the
-- staff member's address as it was.
CREATE TABLE household_limits (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key IN ('members', 'rows_per_module', 'chat_messages', 'sync_mutations_per_day', 'api_rate',
    'object_count', 'file_size_bytes')),
  value bigint NOT NULL CHECK (value > 0),
  reason text NOT NULL CHECK (reason <> '' AND char_length(reason) <= 500),
  set_by uuid REFERENCES users (id),
  set_by_label text NOT NULL CHECK (set_by_label <> '' AND char_length(set_by_label) <= 254),
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, key)
);

SELECT enable_tenant_isolation('household_limits');
SELECT enable_staff_read('household_limits');
GRANT SELECT (household_id, key, value, reason, set_by, set_by_label, set_at) ON household_limits TO household_staff;

-- The notice a suspension carries (PRD 04 §3: "always with notice"): what the platform tells the
-- household of why, which the lockout shows and the owners are emailed. It is kept with the
-- suspension and goes with it.
ALTER TABLE households
  ADD COLUMN suspension_notice text CHECK (suspension_notice <> '' AND char_length(suspension_notice) <= 500),
  ADD CONSTRAINT households_suspension CHECK (suspended_at IS NOT NULL OR suspension_notice IS NULL);

-- Whether a notification's email carried a secret in its link, which is gone once the notification
-- settled: support cannot send such a one again (re-drive), since its link would open nothing.
--
-- The notifications made before this migration say so here. One still waiting holds its secret, and
-- is told by it; one that settled has none left to tell by, so every settled one whose email carried
-- a link reads as having carried a secret, an invoice's among them, which support sends again as the
-- invoice (re-issue) rather than as the notification. Every household's in one statement, which
-- row-level security would hide from the migrate role as from any other: FORCE is lifted from the
-- table for that statement alone and put back before the migration commits, under the lock its ALTER
-- TABLE holds (as 01020 does). What is left is a row an instance of the release before this one queues
-- while the two serve side by side, which does not say and reads as carrying none: re-driven, should it
-- fail, its email would go with a link that opens nothing.
ALTER TABLE notifications ADD COLUMN sealed boolean NOT NULL DEFAULT false;
ALTER TABLE notifications NO FORCE ROW LEVEL SECURITY;
UPDATE notifications SET sealed = true WHERE secret IS NOT NULL OR (status <> 'queued' AND route IS NOT NULL);
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

-- What the staff role reads of the tables that exist already. On a tenant table it is admitted to
-- every row, for reading, and granted the columns below; a global table has no policy to pass.

-- A household: its name, where it is, when it was made, its payer, and its entitlement, the state
-- of its subscription and the clocks that time it, whether an owner restricted it, never why, and
-- its suspension with its notice, which is the platform's own.
SELECT enable_staff_read('households');
GRANT SELECT (id, name, country, created_at, billing_payer_id, billing_state, trial_ends_at, dunning_ends_at, grace_ends_at,
  lapsed_at, retained_until, restricted_at, suspended_at, suspension_notice, deletion_scheduled_at)
  ON households TO household_staff;

-- Its members and their roles, and the modules it enables.
SELECT enable_staff_read('memberships');
GRANT SELECT (household_id, user_id, role, created_at) ON memberships TO household_staff;
SELECT enable_staff_read('module_enablement');
GRANT SELECT (household_id, module, enabled) ON module_enablement TO household_staff;

-- What it stores, by module: how many bytes, never whose file or what it is called.
SELECT enable_staff_read('files');
GRANT SELECT (household_id, module, variant, byte_size) ON files TO household_staff;

-- Its audit events' action keys and when each happened: never a summary, its arguments, a diff, an
-- entity's id or who acted (PRD 05 §6).
SELECT enable_staff_read('audit_events');
GRANT SELECT (household_id, module, action, occurred_at) ON audit_events TO household_staff;

-- How its notifications went: which message, by its catalog key, to whom, over what, and with what
-- outcome. Never the arguments a message was rendered from, its rendered title or body, or an
-- address.
SELECT enable_staff_read('notifications');
GRANT SELECT (household_id, id, user_id, category, message, email, sealed, status, reason, attempts, created_at, settled_at,
  args_expires_at)
  ON notifications TO household_staff;
SELECT enable_staff_read('notification_deliveries');
GRANT SELECT (household_id, id, notification_id, user_id, category, transport, status, reason, sent_at)
  ON notification_deliveries TO household_staff;

-- Its plan and its invoices: the subscription's state and period, and each invoice's number, state
-- and total. Never the processor's ids, a payment method or an invoice's lines.
SELECT enable_staff_read('billing_subscriptions');
GRANT SELECT (household_id, payer_id, standing, status, billing_interval, currency, current_period_end, cancel_at_period_end,
  started_at, ended_at)
  ON billing_subscriptions TO household_staff;
SELECT enable_staff_read('billing_invoices');
GRANT SELECT (household_id, id, payer_id, number, status, currency, total_minor, tax_minor, issued_at, period_start, period_end)
  ON billing_invoices TO household_staff;

-- An account: its address and whether it is verified, its language, when it was made and whether it
-- is gone or about to be; its sign-ins, a browser's and a device's, by when, and a device's platform
-- and version; and whether its second step is on, or locked. Never its name, a credential, a token
-- or a secret.
GRANT SELECT (id, email, email_verified_at, locale, created_at, deleted_at) ON users TO household_staff;
GRANT SELECT (user_id, executes_at) ON account_deletions TO household_staff;
GRANT SELECT (id, user_id, created_at, last_seen_at, expires_at, revoked_at) ON sessions TO household_staff;
GRANT SELECT (user_id, id, platform, app_version, created_at, last_seen_at) ON devices TO household_staff;
GRANT SELECT (user_id, device_id, created_at, refreshed_at, revoked_at) ON device_sessions TO household_staff;
GRANT SELECT (user_id, activated_at, locked_at) ON mfa_totp TO household_staff;

-- A diagnostic bundle, whole (FR-PS1): what its member assembled, saw in full and chose to send,
-- which is the only thing of a household that reaches staff.
GRANT SELECT (id, user_id, household_id, screen, ticket_reference, payload, redacted_fields, created_at, expires_at)
  ON diagnostic_bundles TO household_staff;

-- A reference row an administrator edited (D-148, ADR 0022): edited_at is when, NULL for a row as
-- the files in reference-data/ have it. The loader, which writes these tables on every deploy (ADR
-- 0008), leaves an edited row as its administrator left it, and reports it, until the files hold the
-- same values: then the row is the files' again. Every reference table carries the column, and the
-- items that add one, the crop catalog and the tariff presets, add it with theirs.
ALTER TABLE country_profiles ADD COLUMN edited_at timestamptz;
ALTER TABLE unit_dimensions ADD COLUMN edited_at timestamptz;
ALTER TABLE units ADD COLUMN edited_at timestamptz;
