-- The conformance module's tables for plan item 17's engine (ADR 0018): a note's comments, which a
-- private note bounds, and the note versions its whole-row last-write-wins preserves.
--
-- conformance.note_comment, lww_field (PRD 03 §2.6, D-88): a comment on a note, which reaches whom
-- its note reaches. A stream reads the comment's own table, so the comment carries its note's
-- visibility and owner, written when it is made and rewritten when the note moves between shared and
-- private (sync.RewriteAccess), which is not an edit of the comment: its version stays.
--
-- conformance_note_versions keeps the loser of conformance.note's lww_row (PRD 03 §2.5, as notes keep
-- theirs, PRD modules/07 FR-NO10): the note as it stood when a write made against an older version
-- replaced it whole, with the version it stood at, the version the write was made against and who
-- wrote each. It is no entity: nothing replicates it, and the suite reads it as the administrator.

-- +goose Up
ALTER TABLE conformance_notes ADD UNIQUE (household_id, id);

-- conformance.completion's rotated: whether the occurrence advanced its chore's rotation, which the
-- server does once, as the occurrence first comes to be done, never again when it is undone and done
-- again (scenario 13, D-52).
ALTER TABLE conformance_completions ADD COLUMN rotated boolean NOT NULL DEFAULT false;

CREATE TABLE conformance_note_comments (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  note_id uuid NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('shared', 'private')),
  owner_id uuid REFERENCES users (id),
  body text NOT NULL CHECK (body <> '' AND char_length(body) <= 2000),
  CHECK ((visibility = 'private') = (owner_id IS NOT NULL)),
  FOREIGN KEY (household_id, note_id) REFERENCES conformance_notes (household_id, id)
);
SELECT add_entity_columns('conformance_note_comments');
SELECT enable_tenant_isolation('conformance_note_comments');
SELECT replicate('conformance_note_comments');

CREATE TABLE conformance_note_versions (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  note_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  base_version bigint NOT NULL CHECK (base_version > 0 AND base_version < version),
  row jsonb NOT NULL,
  written_by uuid REFERENCES users (id),
  superseded_by uuid REFERENCES users (id),
  superseded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (household_id, note_id) REFERENCES conformance_notes (household_id, id)
);
SELECT enable_tenant_isolation('conformance_note_versions');
