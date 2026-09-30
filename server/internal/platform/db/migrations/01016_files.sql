-- Files (PRD 01 §8, PRD 03 §3, §8; plan item 14, ADR 0015): the metadata of every object a household
-- keeps in the object store, the work its files leave for after their commit, and the account
-- pictures, which are no household's.
--
-- An object's key is h/{household_id}/{module}/{entity_id}/{variant}, derived from its row, and its
-- bytes are write-once: an original is one entity's file for as long as the entity lives, and a
-- changed file is a new entity (FR-FL1). The row is written in the transaction of the mutation that
-- records the upload, with its audit event and its change, after the bytes are in the store; a row
-- therefore always names bytes that are there, and bytes no row names are what a failed or abandoned
-- upload left, which the sweep removes (internal/platform/files).

-- +goose Up

-- One object. module and entity_id are the entity the module keeps the file for, a document or a
-- note's image; variant says which of its objects: the original as uploaded, or a variant derived
-- from it after commit (FR-FL3). The derived bytes are the household's as the original's are, and
-- are billed with them (FR-ST3).
--
-- owner_id and private are the attribution the module declares for the object (FR-ST1): the member
-- its bytes count against in the storage picture, and whether the entity is private to them, which
-- keeps its link and its label from anyone else. variants, on an original only, is the state of the
-- variants derived from it: pending until the job that derives them ends, then ready, failed (the
-- file stays download-only, FR-FL3), or none for a type that has none.
CREATE TABLE files (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  module text NOT NULL REFERENCES modules (id),
  entity_id uuid NOT NULL,
  variant text NOT NULL CHECK (variant ~ '^[a-z][a-z0-9_]*$'),
  content_type text NOT NULL CHECK (content_type <> ''),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  filename text CHECK (filename <> '' AND char_length(filename) <= 255),
  owner_id uuid REFERENCES users (id),
  private boolean NOT NULL DEFAULT false,
  variants text CHECK (variants IN ('pending', 'ready', 'failed', 'none')),
  created_by uuid DEFAULT app_user_id() REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, module, entity_id, variant),
  CHECK ((variant = 'original') = (variants IS NOT NULL)),
  CHECK (NOT private OR owner_id IS NOT NULL)
);

SELECT enable_tenant_isolation('files');

-- The sampler sums what each household stores, by module and by member (FR-ST2).
GRANT SELECT (module, variant, byte_size, owner_id) ON files TO household_meter;

-- The work a file leaves for after its commit (FR-FL3): deriving an original's variants, and
-- purging an entity's objects once its rows are gone. The mutation that records the upload or the
-- deletion writes the job in its own transaction, so a job exists exactly when its cause committed.
-- run_at is when it may next run: a worker that takes a job moves it past its lease, so that a job
-- whose worker died runs again once the lease has passed, and one that failed moves it past its
-- backoff.
CREATE TABLE file_jobs (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('variants', 'purge')),
  module text NOT NULL REFERENCES modules (id),
  entity_id uuid NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim uuid,
  PRIMARY KEY (household_id, kind, module, entity_id)
);

CREATE INDEX file_jobs_run_at ON file_jobs (run_at);

SELECT enable_tenant_isolation('file_jobs');

-- The workers look across households for those with work due.
GRANT SELECT (run_at) ON file_jobs TO household_meter;

-- A user's picture (Me.avatar_url, and a child profile's): the account's and no household's, as the
-- user is (PRD 01 §2.4), so it is kept under u/{user_id}/avatar/{id}/picture and metered to no
-- household (D-107). id is the picture's, in its key, so a new one never overwrites the old, whose
-- object the replacement purges.
CREATE TABLE avatars (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  id uuid NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type <> ''),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
