-- Export, erasure, diagnostics and consent (PRD 05 §3–5, §9; PRD 02 FR-PS1; plan item 20, ADR 0020):
-- the exports a member asks for, the deletions an account and a household schedule, the members who
-- left a household and whose private data waits there for its window to end, the tombstones erasure
-- leaves, the diagnostic bundles a member chose to send, and what each account consented to.
--
-- Erasure is the platform's own deletion, no entity's history: a household's rows go with its row,
-- through the cascade every tenant table hangs from it by, its audit log among them (FR-AU5), and an
-- account's go table by table, its users row staying as the tombstone its authorship still points at
-- (FR-PR4). Neither is a mutation the spine records, since what would record it is what goes.

-- +goose Up

-- A deleted account's tombstone (FR-PR4): its users row, which is never deleted (01002), with every
-- column of its profile cleared and deleted_at set, carrying its id and that time and nothing else.
-- Who made or changed a row, and who an event's actor was, still name it, and read as a former member.
ALTER TABLE users
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT users_tombstone CHECK (
    deleted_at IS NULL
    OR (email IS NULL AND email_verified_at IS NULL AND display_name = '' AND timezone IS NULL AND first_day_of_week IS NULL));

-- An account's scheduled deletion (FR-PR3, FR-PR4): from the moment its row exists the account is
-- disabled, no sign-in admits it and every session and device's sign-in it had is revoked, and at
-- executes_at, 30 days on, the nightly job erases it. Its user asked for it, or it is a child profile
-- an owner removed from its household, which is nothing outside it and which nobody can sign in to
-- (ADR 0012). The households its user chose to have deleted with it, each of which they were the only
-- owner of, name it on their own rows (households.deletion_account); a household they are the only
-- member of goes with the account without being named. Cancelling deletes the row.
CREATE TABLE account_deletions (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  id uuid NOT NULL UNIQUE,
  cause text NOT NULL CHECK (cause IN ('requested', 'child_removed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  executes_at timestamptz NOT NULL,
  CHECK (executes_at > requested_at)
);

-- The nightly job's search.
CREATE INDEX account_deletions_executes_at ON account_deletions (executes_at);

-- The link the email of a scheduled deletion carries, which cancels it: the one way back into an
-- account that no longer signs in. It lasts as long as the window. The value is compared as text,
-- since a value added to an enum cannot be used in the transaction that adds it (01011).
ALTER TYPE email_token_purpose ADD VALUE 'cancel_deletion';

-- A household's scheduled deletion (FR-PR6), columns of its own row, the admin.household_settings
-- entity, so that scheduling and cancelling one are recorded through the mutation spine with their
-- audit events, and every member's replica learns of it with the row. deletion_scheduled_at is when
-- the nightly job erases it, 30 days after deletion_requested_at. deletion_account is the account
-- whose own deletion it follows, when its only owner chose to delete it with their account: it is
-- cancelled with that deletion, or by an owner as any household's deletion is.
ALTER TABLE households
  ADD COLUMN deletion_id uuid,
  ADD COLUMN deletion_requested_at timestamptz,
  ADD COLUMN deletion_scheduled_at timestamptz,
  ADD COLUMN deletion_account uuid REFERENCES users (id),
  ADD CONSTRAINT households_deletion CHECK (
    (deletion_id IS NULL AND deletion_requested_at IS NULL AND deletion_scheduled_at IS NULL AND deletion_account IS NULL)
    OR (deletion_id IS NOT NULL AND deletion_requested_at IS NOT NULL AND deletion_scheduled_at > deletion_requested_at));

CREATE INDEX households_deletion_due ON households (deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;

-- The meter role finds the households the nightly job erases, across households, by the column that
-- schedules it, as it finds the hourly transitions' (01020), whose columns also tell it the lapsed
-- households whose retention ran out with their three warnings sent (D-119).
GRANT SELECT (deletion_scheduled_at) ON households TO household_meter;

-- A member who left a household or was removed from it (FR-PR7): their private data there, the
-- private root of each module that has one, is deleted at erase_after, 30 days on, a window in which
-- they may still export it. erased_at is when it was. The row stays for as long as the household
-- does, as the record that the user was once its member: when their account is erased, it is how the
-- job finds the households whose logs still name them. A member who comes back before erase_after
-- keeps what they had, and the row goes.
CREATE TABLE departures (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  cause text NOT NULL CHECK (cause IN ('left', 'removed')),
  departed_at timestamptz NOT NULL DEFAULT now(),
  erase_after timestamptz NOT NULL,
  erased_at timestamptz,
  PRIMARY KEY (household_id, user_id),
  CHECK (erase_after > departed_at)
);

CREATE INDEX departures_user ON departures (user_id);

SELECT enable_tenant_isolation('departures');

-- The nightly job finds the departures whose window ended, and the households an erased account
-- was once a member of; the export worker finds the households a user left whose window is open.
GRANT SELECT (user_id, erase_after, erased_at) ON departures TO household_meter;

-- An export job (FR-PR2): the archive a user asked for, of everything about them (household_id
-- null) or of a household they own. It is its requester's, whichever it is, since what it holds is
-- what they may read: nobody else lists it or is handed its link. A worker claims it by moving
-- run_at past its lease, builds the archive and stores it under object, the account's own prefix,
-- u/{user_id}/exports/{id}/{claim}; it is downloadable until expires_at, 7 days after it was ready,
-- when the expiry sweep removes the archive and marks the row expired. ended_at is when it became
-- ready, failed or expired, from which the row itself is kept 30 days. contents are the archive's
-- top-level entries.
CREATE TABLE exports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  household_id uuid REFERENCES households (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim uuid,
  ready_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  size_bytes bigint CHECK (size_bytes >= 0),
  object text,
  contents jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(contents) = 'array'),
  CHECK ((status = 'ready') = (object IS NOT NULL)),
  CHECK (status <> 'ready' OR (ready_at IS NOT NULL AND expires_at IS NOT NULL AND size_bytes IS NOT NULL)),
  CHECK ((status IN ('queued', 'running')) = (ended_at IS NULL))
);

CREATE INDEX exports_user ON exports (user_id, requested_at DESC);
-- The workers' search, and the expiry sweep's.
CREATE INDEX exports_due ON exports (run_at) WHERE status IN ('queued', 'running');
CREATE INDEX exports_ended ON exports (ended_at) WHERE ended_at IS NOT NULL;
-- One export of a kind waits or runs at a time for a user: asking again answers the one under way.
CREATE UNIQUE INDEX exports_active ON exports (user_id, coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('queued', 'running');

-- A diagnostic bundle (FR-PS1, D-20): what a member assembled, saw in full and chose to send, the
-- only route by which anything of a household reaches platform staff (item 21 reads it). It expires
-- 30 days after it was sent, and goes with its account, and with the household it was about.
CREATE TABLE diagnostic_bundles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  household_id uuid REFERENCES households (id) ON DELETE CASCADE,
  screen text NOT NULL CHECK (screen <> '' AND char_length(screen) <= 200),
  ticket_reference text CHECK (ticket_reference <> '' AND char_length(ticket_reference) <= 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  redacted_fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX diagnostic_bundles_expires_at ON diagnostic_bundles (expires_at);
CREATE INDEX diagnostic_bundles_user ON diagnostic_bundles (user_id);

-- What an account consented to (FR-PR9): product analytics and marketing email, each off until its
-- user turns it on, and withdrawable. An account with no row consented to neither. A child profile
-- has none, ever (PRD 05 §7).
CREATE TABLE consents (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  analytics boolean NOT NULL DEFAULT false,
  marketing_email boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- What erasure leaves of a household or an account: its id, when it was erased and why, and whether
-- its objects are gone yet. The rows are deleted in one transaction and the objects under its prefix,
-- h/{household_id}/ or u/{user_id}/, after it commits, so a process that died between the two left
-- objects no row names, which the nightly job finds here and removes; and it removes them once more
-- on the nights after, for the bytes an upload in flight put after the first pass.
CREATE TABLE erasures (
  kind text NOT NULL CHECK (kind IN ('household', 'account')),
  id uuid NOT NULL,
  cause text NOT NULL CHECK (cause IN ('requested', 'account', 'lapsed', 'child_removed', 'ownerless')),
  erased_at timestamptz NOT NULL DEFAULT now(),
  purged_at timestamptz,
  PRIMARY KEY (kind, id)
);

CREATE INDEX erasures_erased_at ON erasures (erased_at);

-- forget_actor takes an erased account's name off the events it caused in the household of the
-- transaction's context (FR-PR4): who did a thing becomes an opaque id, which the log renders as a
-- former member. The log is otherwise append-only to the request role (01004, FR-AU5), so this is the
-- one change of it that role can make, through a function that makes only it: it runs as the tables'
-- owner, whom the forced policy still holds to the household in context.
-- +goose StatementBegin
CREATE FUNCTION forget_actor(actor uuid) RETURNS bigint
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
  AS $$
    WITH relabelled AS (
      UPDATE public.audit_events SET actor_label = NULL
      WHERE household_id = public.app_household_id() AND actor_id = actor AND actor_label IS NOT NULL
      RETURNING 1)
    SELECT count(*) FROM relabelled
  $$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION forget_actor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION forget_actor(uuid) TO household_app;
