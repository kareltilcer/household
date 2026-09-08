# 07 — Notes (Poznámky)

## What it is

Markdown notes in an arbitrarily deep folder tree, each addressable by a slug path, with
two-scope pinning and a shared root plus a private root per member. Carried from `home` v3 (the
module) and v9 (private roots) with little change — the design generalises cleanly because a
note tree assumes nothing about a household.

**What changed:** language-aware full-text search, per-note language tagging, inline images count
toward the storage meter, and the private-root asymmetry for children.

## Functional requirements

**FR-NO1 — Notes CRUD.** `title`, optional `folder_id` (null ⇒ the root of the addressed tree),
`body_md`. Markdown is the single stored form; the editor is WYSIWYG by default with a raw
toggle. Soft delete; `?hard=true` purges and requires `manage`.

**FR-NO2 — Folders.** Single-parent tree, arbitrarily deep, per root. `name` → `slug`, unique
among siblings **within the root scope**. A non-empty folder requires `?cascade=true` to delete,
else `409` with the child count. A folder may not move into itself or a descendant (`422`).

**FR-NO3 — Two roots.** Every note and folder carries `visibility ∈ {shared, private}` and
`owner_id` (null when shared). A tree is addressed by its root scope — the pair
`(visibility, owner_id)` — of which a household with N members has `1 + N`.

**The sibling-uniqueness index carries the root scope.** This is the single line most likely to be
copied wrong, so it is written out:

```sql
CREATE UNIQUE INDEX ux_notes_sibling_slug ON notes (
  household_id,
  COALESCE(parent_id::text, 'root:' || visibility || ':' || COALESCE(owner_id::text, '')),
  slug
) WHERE deleted_at IS NULL;
```

Without the root scope in the sentinel, two members each keeping a private note called *Recipes*
at their own root collide, and the second one is refused against a note they cannot see. Four
indexes of this shape exist across Notes and Documents. Carried from `home` D178.

**FR-NO4 — Privacy refusals are `404`.** A private note is invisible to everyone but its owner —
including owners — on `GET` and `HEAD`. A `403` would confirm the id exists and turn the permalink
route into an existence oracle over the private tree. **The one exception:** a `child`'s private
root is readable by an `owner`, stated in the UI to the child at profile creation
([02](../02-identity-and-access.md) FR-CH3).

**FR-NO5 — Slug paths and the resolver.** The client route is the slug path; `GET …/notes/resolve
?path=&root=` maps it to `{ type, id }`. Renaming or moving changes the URL and the old one `404`s
— **no redirects**, carried from `home` D32. All mutating and detail endpoints address by stable id.

**FR-NO6 — Tree read model.** One query set returning the whole tree for a root scope, with
lightweight nodes. Archived excluded unless asked for.

**FR-NO7 — Search.** PostgreSQL full-text over title and body, with the text-search configuration
chosen per note from `language` (defaulted from the author's locale at write time) and `unaccent`
applied, so *pórek* matches *porek*. Ranked, paged. Private notes are excluded from a non-owner's
`q=` matching entirely.

**FR-NO8 — Pinning, two scopes.** `household` ("for everyone") is a shared, audited mutation
requiring `contribute`. `personal` ("just for me") is a per-member view preference requiring only
`view`, and is **not audited**. A note can be both; the widget de-duplicates with household
precedence. Re-pinning is idempotent.

**FR-NO9 — Inline images.** An image pasted or dropped into a note is uploaded to object storage,
keyed `h/{household}/notes/{note_id}/{image_id}`, and referenced from the Markdown. It inherits the
note's visibility, counts toward the storage meter, and is deleted when the note is hard-deleted.

**FR-NO10 — Last-write-wins bodies, with the loser preserved.** Note bodies are `lww_row`. The
overwritten version is kept for 30 days and offered on the conflict banner — `home` discarded it
and relied on the audit diff; keeping it is cheap and is the difference between "you lost your
paragraph" and "here it is".

## Data model

`note_folders`, `notes`, `note_pins`, `note_images`, `note_body_versions`. Columns per the house
conventions plus `visibility`, `owner_id`, `language`, `slug`, `position`, and a generated
`tsvector`.

`note_body_versions` is where FR-NO10's preserved loser lives: `(note_id, superseded_at)` with the
overwritten `body_md`, the losing author and the version it was written against. Rows are pruned
after 30 days by the nightly job, and they are the only place a note body exists twice.

## Sync

| Entity | Policy |
|---|---|
| `notes.folder` | `strict_version` |
| `notes.note` (metadata) | `lww_field` |
| `notes.note_body` | `lww_row`, loser preserved |
| `notes.pin` | `state_set` |

Private notes sync only to their owner. Lowering a member's grant, or a note moving from shared to
private, emits **retractions** ([03](../03-platform-strands.md) §2.6).

## Catalog contributions

Widget `notes.pinned` (household ∪ own personal pins, de-duplicated, opening in an overlay without
leaving the dashboard); metrics `notes.pinned_count` (per recipient) and `notes.total`; search scope
`notes.note`; storage declares its tables and the `notes/` blob prefix with per-note attribution.

## Permissions

Standard gate; personal pins at `view`; hard delete at `manage`.

## Non-goals

- No collaborative simultaneous editing, no operational transforms.
- No public sharing, no share links, no unauthenticated routes.
- No separate version-history UI — the activity log's field diffs plus the preserved loser are the
  history.
- No tags in 1.0; folders and search cover it.
- No note-level ACLs beyond the shared/private axis.
