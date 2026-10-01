-- Notifications (PRD 03 §4; plan item 15, ADR 0016): where a member's devices are reached, what each
-- member wants to be told and when, the notifications waiting to go out, and the record of every
-- attempt at one.
--
-- The three transports of FR-NT1 each keep their target where it belongs: a browser's Web Push
-- subscription with the web session that registered it, a mobile installation's Expo push token on
-- its device (item 9's devices.push_token), and an email address on its account. All three are the
-- account's, and global. What a member wants is theirs per household, over account-wide defaults.
-- What waits to go out, and what happened to it, is the household's: a notification is queued in the
-- transaction of what caused it, and a worker of any instance delivers it once that commits, filtered
-- at send time by the recipient's grant, the item's privacy and their own preferences (FR-NT5).

-- +goose Up

-- A browser's Web Push subscription (FR-NT1), bound to the web session that registered it: it
-- reaches its user while that session lives, and goes with it, so that a browser whose user signed
-- out, or was signed out everywhere, is told nothing more of theirs. One row per endpoint: a browser
-- whose next user subscribes it moves it to them. p256dh and auth are the browser's keys as it gives
-- them, base64url. failures counts the deliveries that failed since the last that did not; at five in
-- a row the subscription is stale (stale_at) and nothing more is tried on it until it is registered
-- again (FR-NT6). A 404 or a 410 from the push service deletes it.
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%' AND char_length(endpoint) <= 2048),
  p256dh text NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),
  auth text NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]{22,24}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  failures smallint NOT NULL DEFAULT 0 CHECK (failures >= 0),
  stale_at timestamptz
);

CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
CREATE INDEX push_subscriptions_session ON push_subscriptions (session_id);

-- A device's Expo push token (FR-NT1), which reaches it while its sign-in lives: push_registered_at
-- is when it was last registered, and push_failures and push_stale_at are its health, as a
-- subscription's are (FR-NT6). An Expo receipt of DeviceNotRegistered clears the token.
ALTER TABLE devices
  ADD COLUMN push_registered_at timestamptz,
  ADD COLUMN push_failures smallint NOT NULL DEFAULT 0 CHECK (push_failures >= 0),
  ADD COLUMN push_stale_at timestamptz,
  ADD CHECK ((push_token IS NULL) = (push_registered_at IS NULL));

-- Expo answers a message it accepts with a ticket, and says only later, in the ticket's receipt,
-- whether Apple or Google delivered it (FR-NT6): a receipt of DeviceNotRegistered is a 410's
-- equivalent. Each ticket waits here for its receipt, with the token it was sent to, which a receipt
-- clears only while the device still holds it. A ticket a day old is dropped unread: Expo keeps a
-- receipt for a day.
CREATE TABLE push_receipts (
  ticket text PRIMARY KEY CHECK (ticket <> '' AND char_length(ticket) <= 128),
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  token text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, device_id) REFERENCES devices (user_id, id) ON DELETE CASCADE
);

CREATE INDEX push_receipts_sent_at ON push_receipts (sent_at);

-- What a member wants to be told (FR-NT2): the master switch, the four categories, and quiet hours,
-- from and to, read in the member's own timezone; a window that wraps midnight runs from one evening
-- to the next morning. A household's own row (notification_preferences) is its member's for that
-- household; the account's defaults stand in for every household without one, and the built-in
-- defaults, everything on and no quiet hours, for an account without them.
CREATE TABLE notification_defaults (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  direct boolean NOT NULL,
  household boolean NOT NULL,
  reminders boolean NOT NULL,
  digest boolean NOT NULL,
  quiet_from time(0),
  quiet_to time(0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_from IS NULL) = (quiet_to IS NULL)),
  CHECK (quiet_from <> quiet_to)
);

CREATE TABLE notification_preferences (
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  enabled boolean NOT NULL,
  direct boolean NOT NULL,
  household boolean NOT NULL,
  reminders boolean NOT NULL,
  digest boolean NOT NULL,
  quiet_from time(0),
  quiet_to time(0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id),
  FOREIGN KEY (household_id, user_id) REFERENCES memberships (household_id, user_id) ON DELETE CASCADE,
  CHECK ((quiet_from IS NULL) = (quiet_to IS NULL)),
  CHECK (quiet_from <> quiet_to)
);

SELECT enable_tenant_isolation('notification_preferences');

CREATE TYPE notification_category AS ENUM ('direct', 'household', 'reminders', 'digest');
CREATE TYPE notification_transport AS ENUM ('web_push', 'expo', 'email');
CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed', 'dropped');

-- A notification to one recipient, queued in the transaction of what caused it, so that it exists
-- exactly when its cause committed, and settled by a worker once it is sent, failed or dropped.
--
-- It is for a member (user_id), or, for an email to someone who has no account yet, an invitation's,
-- for an address, kept only until it is settled, and written in locale; a member reads their own
-- language when it goes out. message is the catalog key its title and body, or
-- its email's subject and body, are rendered from, in the recipient's language when it goes out, with
-- args; count is how many notifications it stands for once later ones with its coalesce_key merged
-- into it. secret is what its email's link carries in its fragment, an invitation's or a graduation's
-- token, sealed under the notification keys (HOUSEHOLD_NOTIFY_KEYS) and bound to the row's id, and
-- erased when it is settled: the database keeps such a token only as its hash, and a backup holds
-- nothing that opens a household.
--
-- module, when set, is the module whose view the recipient must hold when it goes out, and owner_id
-- the member a private item's notification may reach and no one else (FR-NT5). email marks the fixed
-- set that goes by email (FR-NT1), which no mute or quiet hours hold. replace_key names what it is the
-- latest word on: one queued under the same key drops it while it waits (reason replaced), as does
-- its cause ending (reason withdrawn), so that an invitation's email whose link was sent again, or
-- whose invitation was withdrawn, is never sent late. run_at is when it may next be tried: past quiet
-- hours (reason quiet_hours), past a failed email's backoff, or past the lease of the worker that
-- claimed it.
CREATE TABLE notifications (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  user_id uuid REFERENCES users (id),
  address text CHECK (address <> '' AND char_length(address) <= 254),
  locale text CHECK (locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'),
  category notification_category NOT NULL,
  message text NOT NULL CHECK (message ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  args jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(args) = 'object'),
  count integer NOT NULL DEFAULT 1 CHECK (count >= 1),
  route text CHECK (route ~ '^[a-z][a-z0-9/_-]*$'),
  secret bytea,
  module text REFERENCES modules (id),
  owner_id uuid REFERENCES users (id),
  link text CHECK (link LIKE '/%' AND char_length(link) <= 512),
  coalesce_key text CHECK (coalesce_key <> '' AND char_length(coalesce_key) <= 200),
  email boolean NOT NULL DEFAULT false,
  replace_key text CHECK (replace_key <> '' AND char_length(replace_key) <= 200),
  status notification_status NOT NULL DEFAULT 'queued',
  reason text CHECK (reason ~ '^[a-z][a-z_]*$'),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  PRIMARY KEY (household_id, id),
  CHECK ((status = 'queued') = (settled_at IS NULL)),
  CHECK (status = 'queued' OR (address IS NULL AND secret IS NULL)),
  CHECK (status <> 'queued' OR user_id IS NOT NULL OR address IS NOT NULL),
  CHECK (email OR (address IS NULL AND secret IS NULL AND route IS NULL)),
  CHECK ((secret IS NULL) OR (route IS NOT NULL))
);

SELECT enable_tenant_isolation('notifications');

CREATE INDEX notifications_due ON notifications (household_id, run_at) WHERE status = 'queued';
CREATE INDEX notifications_coalesce ON notifications (household_id, user_id, coalesce_key, created_at DESC)
  WHERE coalesce_key IS NOT NULL;
CREATE INDEX notifications_replace ON notifications (household_id, replace_key)
  WHERE status = 'queued' AND replace_key IS NOT NULL;
CREATE INDEX notifications_created ON notifications (household_id, created_at DESC);

-- The workers find the households with a notification due, across households, as the meter role.
GRANT SELECT (status, run_at) ON notifications TO household_meter;

-- The delivery log (FR-NT6, FR-HA12): every attempt at a notification on one target, and every
-- notification dropped, or a push given up, before any target, with no transport, with its outcome
-- and, for one that did not arrive, the reason. It is the household's operational record, not its audit log, and holds what was sent only
-- for seven days (PRD 03 §5): a push's rendered title and body until body_expires_at, which the
-- expiry sweep clears with them. An email keeps its subject for as long and never its body, which
-- may carry a link's token. The outcome is kept for as long as the household is.
CREATE TABLE notification_deliveries (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  notification_id uuid NOT NULL,
  user_id uuid REFERENCES users (id),
  category notification_category NOT NULL,
  transport notification_transport,
  status notification_status NOT NULL CHECK (status <> 'queued'),
  reason text CHECK (reason ~ '^[a-z][a-z_]*$'),
  title text,
  body text,
  body_expires_at timestamptz,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, notification_id) REFERENCES notifications (household_id, id) ON DELETE CASCADE,
  CHECK ((title IS NULL AND body IS NULL) = (body_expires_at IS NULL)),
  CHECK ((status = 'sent') = (reason IS NULL)),
  CHECK (status <> 'sent' OR transport IS NOT NULL)
);

SELECT enable_tenant_isolation('notification_deliveries');

CREATE INDEX notification_deliveries_sent ON notification_deliveries (household_id, sent_at DESC);
CREATE INDEX notification_deliveries_notification ON notification_deliveries (household_id, notification_id);
CREATE INDEX notification_deliveries_body ON notification_deliveries (body_expires_at) WHERE body_expires_at IS NOT NULL;

-- The expiry sweep finds the households with rendered bodies past their seven days.
GRANT SELECT (body_expires_at) ON notification_deliveries TO household_meter;

-- And the households with the rest of what it deletes (PRD 03 §5): Idempotency-Keys and the push's
-- answers past their seven days, and invitations past the month after they stopped working (D-110),
-- found by when they were made, expired or last changed, and whether they are still pending.
GRANT SELECT (created_at) ON idempotency_keys TO household_meter;
GRANT SELECT (created_at) ON sync_mutations TO household_meter;
GRANT SELECT (status, expires_at, updated_at) ON invitations TO household_meter;
