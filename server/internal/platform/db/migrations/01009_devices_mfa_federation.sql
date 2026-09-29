-- Identity II (PRD 02 §1–2; plan item 9): the mobile devices a user signs in on and the refresh-
-- token families they hold, the second factor, the browsers and devices trusted to skip it, and
-- sign-in with Google and Apple. Every table here is global, as item 8's are (PRD 01 §2.4): a
-- user's, never a household's, with no row-level security; the request role reads and writes them
-- for the caller the server authenticated.

-- +goose Up

-- An identity provider's credential names the account there by its subject, the OIDC `sub`, which
-- is its stable identifier (FR-ID2): never the address, which a provider lets its user change and
-- which Apple's private relay hides. One subject is one account's.
ALTER TABLE credentials
  ADD COLUMN subject text CHECK (subject <> '' AND char_length(subject) <= 255),
  ADD CHECK ((type IN ('google', 'apple')) = (subject IS NOT NULL));

CREATE UNIQUE INDEX credentials_subject ON credentials (type, subject) WHERE subject IS NOT NULL;

-- A mobile installation a user has signed in on (FR-ID3, FR-ID7): the client names it with an id it
-- keeps for the installation, which is unique per user, not globally, since a shared tablet is
-- signed in on by several profiles, and one client's id says nothing about another's. push_token is
-- the slot plan item 17 fills with the installation's Expo push token.
CREATE TABLE devices (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  platform text CHECK (platform IN ('ios', 'android')),
  app_version text CHECK (char_length(app_version) <= 64),
  push_token text CHECK (char_length(push_token) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

-- A device's sign-in, which holds a refresh-token family (FR-ID4, D-14): an access token names it as
-- its sid. It lasts until it is revoked (D-99): by signing out on the device, revoking the device,
-- signing out everywhere, a password reset, the device signing in again, or a refresh token of the
-- family presented after it was used. A device holds at most one live sign-in.
CREATE TABLE device_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (user_id, device_id) REFERENCES devices (user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX device_sessions_live ON device_sessions (user_id, device_id) WHERE revoked_at IS NULL;
CREATE INDEX device_sessions_user ON device_sessions (user_id);

-- A refresh token, single use and kept as its SHA-256 (FR-ID4). Each use marks it used and names the
-- token it was exchanged for, so that a token presented again is known for a reuse, and one
-- presented again moments after its use, while the token it was exchanged for is still unused, for
-- a retry whose answer was lost (D-98). Kept while its family lives; the expiry sweep (item 17)
-- deletes used tokens a month old, which no longer tell a theft from a stale token.
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES device_sessions (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  replaced_by uuid,
  CHECK ((used_at IS NULL) = (replaced_by IS NULL))
);

CREATE INDEX refresh_tokens_session ON refresh_tokens (session_id);

-- A user's TOTP authenticator (FR-ID5). Each secret is sealed under the server's MFA key and bound
-- to its owner (internal/platform/mfa); a pending one is an enrolment waiting for its first code.
-- last_step is the last time step whose code was accepted, which no code may be again. failures
-- counts wrong codes since the last right one; the tenth locks the factor, until a recovery code
-- or support unlocks it (D-100).
CREATE TABLE mfa_totp (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret bytea,
  activated_at timestamptz,
  pending_secret bytea,
  pending_at timestamptz,
  last_step bigint,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_at timestamptz,
  CHECK ((secret IS NULL) = (activated_at IS NULL)),
  CHECK ((pending_secret IS NULL) = (pending_at IS NULL)),
  CHECK (secret IS NOT NULL OR pending_secret IS NOT NULL)
);

-- A user's recovery codes, each an HMAC under the server's MFA key, spent once. A new set replaces
-- the old one whole.
CREATE TABLE mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  PRIMARY KEY (user_id, code_hash)
);

-- A sign-in waiting for its second step (FR-ID5): the password, or the identity provider, has
-- vouched for user, and the challenge's token, kept as its SHA-256, is what /auth/mfa/verify takes
-- with the code. It remembers what the sign-in is for: a web session, or a device's sign-in. It
-- lasts ten minutes, and ends when it is answered or when the factor locks.
CREATE TABLE mfa_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  client_type text NOT NULL CHECK (client_type IN ('web', 'mobile')),
  device_id uuid,
  device_label text NOT NULL DEFAULT '' CHECK (char_length(device_label) <= 80),
  device_platform text CHECK (device_platform IN ('ios', 'android')),
  device_app_version text CHECK (char_length(device_app_version) <= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  CHECK ((client_type = 'mobile') = (device_id IS NOT NULL)),
  CHECK (expires_at > created_at)
);

CREATE INDEX mfa_challenges_user ON mfa_challenges (user_id);
CREATE INDEX mfa_challenges_expires_at ON mfa_challenges (expires_at);

-- A browser or a device a user chose to trust for thirty days (A-7), which signs in without the
-- second step until then: its token, kept as its SHA-256, is in the browser's __Host-hh_trust
-- cookie or in the device's keeping. Ended by turning the second step off or on again, a password
-- reset, and signing out everywhere.
CREATE TABLE mfa_trusts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX mfa_trusts_user ON mfa_trusts (user_id);
CREATE INDEX mfa_trusts_expires_at ON mfa_trusts (expires_at);

-- An OIDC authorization begun with a provider (FR-ID2), for ten minutes: the state it carries, kept
-- as its SHA-256; the redirect URI, the client's PKCE challenge and the nonce the provider's ID
-- token must carry; and the user who began it, when a signed-in user did, which only that user may
-- complete as a link. Used once.
CREATE TABLE oauth_states (
  id uuid PRIMARY KEY,
  state_hash bytea NOT NULL UNIQUE CHECK (octet_length(state_hash) = 32),
  provider credential_type NOT NULL CHECK (provider IN ('google', 'apple')),
  user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  client_type text NOT NULL CHECK (client_type IN ('web', 'mobile')),
  redirect_uri text NOT NULL CHECK (char_length(redirect_uri) <= 2048),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  nonce text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX oauth_states_expires_at ON oauth_states (expires_at);
