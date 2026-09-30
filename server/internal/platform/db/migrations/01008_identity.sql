-- Identity (PRD 02 §1–2, §9; plan item 8): what a user is beyond their id, the credentials they
-- sign in with, their web sessions, the single-use tokens an email carries, the throttles on the
-- surfaces that take a password or an address, and the Idempotency-Key storage of a signed-in
-- user's own requests. Every table here is global (PRD 01 §2.4): a user exists without any
-- household, and none of these rows is a household's, so none has row-level security; the
-- request role reads and writes them for the caller the server authenticated.

-- +goose Up

-- A user's profile (FR-ID1, PRD 03 §9). email is as the person typed it, and unique however it
-- is cased: two accounts that differ only in the case of an address would be one mailbox. A
-- managed child profile (item 11) has none. locale is a BCP 47 tag, the UI language and the
-- formatting; timezone and first_day_of_week are the member's overrides, NULL to follow each
-- household's timezone and the locale's first day. A row made before its owner has a profile, as
-- a test's is, reads as an unnamed English-speaking account with no address.
ALTER TABLE users
  ADD COLUMN email text CHECK (email <> '' AND char_length(email) <= 254),
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 80),
  ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'),
  ADD COLUMN timezone text CHECK (timezone <> ''),
  ADD COLUMN first_day_of_week smallint CHECK (first_day_of_week BETWEEN 0 AND 6),
  ADD CHECK (email_verified_at IS NULL OR email IS NOT NULL);

CREATE UNIQUE INDEX users_email ON users (lower(email));

-- The ways a user signs in (PRD 02 §1): at most one of each type. secret is the PHC string of a
-- password's or a PIN's Argon2id hash (internal/platform/password), never the secret itself; an
-- identity provider's credential (item 9) holds none. updated_at is when the secret was last set,
-- which hashing the same one again with new parameters does not move: a sign-in or a change
-- compares it to find a password replaced since it was checked (internal/platform/identity).
CREATE TYPE credential_type AS ENUM ('password', 'google', 'apple', 'child_pin');

CREATE TABLE credentials (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type credential_type NOT NULL,
  secret text CHECK (secret LIKE '$argon2id$%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type),
  CHECK ((type IN ('password', 'child_pin')) = (secret IS NOT NULL))
);

-- A web session (FR-ID3, FR-ID7): the cookie's token and the CSRF token bound to it, each kept as
-- its SHA-256, so the tokens themselves are only ever in the browser. A session lasts until
-- expires_at, which each use pushes 30 days on (D-95), or until it is revoked; a revoked or expired
-- row is kept for the expiry sweep (item 15) to delete.
CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
  user_agent text NOT NULL DEFAULT '' CHECK (char_length(user_agent) <= 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- A single-use token an email carries (FR-ID1, FR-ID6): an address's verification, valid 24
-- hours, or a password reset, valid one hour. Kept as its SHA-256. email is the address it was
-- sent to, which is the one a verification confirms.
CREATE TYPE email_token_purpose AS ENUM ('verify_email', 'reset_password');

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose email_token_purpose NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX email_tokens_user ON email_tokens (user_id, purpose);
CREATE INDEX email_tokens_expires_at ON email_tokens (expires_at);

-- The count of attempts on a throttled surface (PRD 02 §9, internal/platform/ratelimit), one row
-- per surface and what it counts: an address, an account or a client's network. The key is the
-- SHA-256 of the two, so that no address is kept in the clear; the hash is not keyed, so anyone
-- who guesses an address finds its row, and the rows are still personal data, which the expiry
-- sweep deletes. A row counts attempts until window_ends_at; a surface that backs off also blocks
-- until blocked_until.
CREATE TABLE auth_throttles (
  key bytea PRIMARY KEY CHECK (octet_length(key) = 32),
  count integer NOT NULL CHECK (count >= 0),
  window_ends_at timestamptz NOT NULL,
  blocked_until timestamptz
);

-- The expiry sweep (item 15) deletes rows whose window and block have both ended.
CREATE INDEX auth_throttles_window_ends_at ON auth_throttles (window_ends_at);

-- Idempotency-Key storage for a signed-in user's own requests, the /auth and /me routes that act
-- on their account (internal/platform/idempotency, ADR 0009): the same states and the same
-- answers as a member's keys in their household (01006), held by the user rather than by a
-- membership, since these requests have no household.
CREATE TABLE account_idempotency_keys (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 128),
  fingerprint bytea NOT NULL,
  state idempotency_state NOT NULL,
  claim uuid NOT NULL,
  claimed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status smallint CHECK (status BETWEEN 200 AND 299),
  header jsonb,
  body bytea,
  PRIMARY KEY (user_id, key),
  CHECK ((state = 'completed') = (status IS NOT NULL))
);

-- The expiry sweep (item 15) deletes keys past their 7 days.
CREATE INDEX account_idempotency_keys_created_at ON account_idempotency_keys (created_at);
