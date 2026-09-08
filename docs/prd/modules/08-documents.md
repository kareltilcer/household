# 08 — Documents (Dokumenty)

## What it is

Files in a folder tree — contracts, invoices, manuals, insurance, certificates — with in-browser
preview, permanent household-only links, immutable bytes, and shared plus private roots. Carried
from `home` v4 and v9.

**What changed for the commercial product, and all of it matters:**

1. **Expiry dates and document types** — the feature that turns a filing cabinet into something
   that tells you your passport runs out in six months.
2. **It is the household's file store.** Property, Vehicles, Pets, Finance, Utilities and Garden
   all reference documents rather than holding their own files, so there is one meter, one
   privacy model and one place to look.
3. **It is the largest contributor to the storage bill**, so its screens make that visible.

## Functional requirements

**FR-DO1 — Upload.** `multipart/form-data`: the file, optional `folder_id`, `title`, `description`,
`document_type`, `expires_on`. The server enforces the size cap and the household storage ceiling,
**sniffs the content type from the leading bytes** (never the client's header), streams to object
storage at `h/{household}/documents/{id}/original`, computes a SHA-256, and writes the row in one
transaction with the audit event and the sync change. Bytes are **write-once**: a changed file is a
new document, optionally linked as a successor.

Errors: `402` over storage ceiling; `413` over size cap; `415` a blocked type; `422` empty file;
`502` object storage unreachable, with nothing committed.

**FR-DO2 — Metadata is mutable, bytes are not.** `PATCH` changes title (re-deriving the slug),
description, type, expiry, folder and archive state. It never changes the file.

**FR-DO3 — Folders, roots, slug paths, resolver, tree, search.** Identical in behaviour to Notes
(FR-NO2 to FR-NO7), over the documents tables, including the root-scoped sibling-uniqueness index
and the `404`-not-`403` privacy refusal. Search covers title, original filename and description —
**not file contents**; there is no OCR and no in-file indexing in 1.0.

**FR-DO4 — The permanent link.** A document's content URL is id-based and stable for its life,
because the id never changes and the bytes never change. The slug path is a convenience and is not
permanent. Every content route is session-authorised; there is no public path and no share token.

**FR-DO5 — Serving content.** Four read endpoints, each authorising the caller then issuing a
short-lived pre-signed URL or streaming through:

| Endpoint | Behaviour |
|---|---|
| `…/raw` | Original bytes, correct sniffed type, `ETag` = checksum, `Cache-Control: private, immutable`, HTTP Range supported |
| `…/download` | Same bytes, always `Content-Disposition: attachment` |
| `…/preview` | The best previewable representation — the original for natively previewable types, else a derived PDF. `409` while pending, `404` when the type has none |
| `…/thumbnail` | A small image, or `404` |

**Isolation:** `X-Content-Type-Options: nosniff` on everything; PDFs render through a sandboxed
viewer; images through `<img>`; text escaped. **Active types — HTML, SVG, anything scriptable — are
download-only and are never rendered in the app's origin.** Carried from `home` D48.

**FR-DO6 — Derived variants**, generated asynchronously after commit, once, cached forever:
image thumbnails; PDF first-page thumbnails; office formats converted to a preview PDF with a
bounded timeout plus a thumbnail. Failure leaves the document download-only and never loses the
upload. Derived bytes **count toward the storage meter** and the storage screen shows them
separately, because "why is my 2 MB file using 3 MB" is otherwise a support ticket.

**FR-DO7 — Document types and expiry.** New in Household. A document may carry a **type** from a
translated, country-aware catalog (passport, ID card, driving licence, insurance policy, lease,
warranty, certificate, invoice, contract, medical, other) and an **`expires_on`**.

A document with an expiry registers with the reminder strand as kind `documents.expiry`, whose
default lead time is **per type** — six months for a passport, one month for an insurance policy —
because a sensible default is what makes the feature work without configuration. Completion is
**personal** where the document belongs to a member and **shared** where it belongs to the
household; the type carries which. **D-53.**

**FR-DO8 — Pinning, two scopes.** Identical to Notes FR-NO8.

**FR-DO9 — References from other modules.** A vehicle, an appliance, a pet, an expense or a
utility bill links to a document by id. The link is a **platform-resolved reference**: the
referring module stores the id, the platform resolves it, applies the caller's Documents grant and
the document's privacy, and returns what the caller may see — or a placeholder saying a document
exists but is not visible to them. A module never reads the documents tables. **D-40.**

**FR-DO10 — Storage visibility.** A screen showing total document storage, the split by folder, by
member and by type, the largest files, derived-variant overhead, and what deleting a selection
would actually recover. A metered charge must be verifiable by the person paying it.

**FR-DO11 — Bulk operations.** Multi-select move, archive, download-as-zip and delete, because a
household migrating from a folder on a laptop will upload two hundred files and immediately need
to organise them.

## Data model

`document_folders`, `documents`, `document_pins`, `document_types` (reference data, translated),
`document_references` (the reverse index of which module rows point at a document — used to warn
before deletion). Columns per house conventions plus `visibility`, `owner_id`, `original_filename`
(kept as uploaded, searched by FR-DO3, and never used as the storage key), `content_type`,
`byte_size`, `checksum`, `storage_key`, `attachment_status` (`pending` · `ready` · `failed`, per
[03](../03-platform-strands.md) §2.7 — the row exists and syncs before the bytes arrive),
`preview_kind`, `preview_status`, `preview_key`, `thumbnail_key`, `document_type_id`, `expires_on`,
`slug`, and a generated `tsvector` over title, `original_filename` and description.

**FR-DO12 — Deleting a referenced document warns first**, naming what references it ("this is the
service invoice on your Škoda"), and requires confirmation. It does not block — the household's
files are theirs — but a silent broken reference is not acceptable either.

## Sync

| Entity | Policy | Notes |
|---|---|---|
| `documents.folder` | `strict_version` | |
| `documents.document` (metadata) | `lww_field` | |
| `documents.pin` | `state_set` | |
| File bytes | **not synced** | The replica holds metadata and thumbnails; originals are fetched on demand and cached with an LRU budget the member controls |

**Offline upload** follows [03](../03-platform-strands.md) §2.7: the file is held in the app
sandbox, the metadata row syncs immediately with `attachment_status: pending`, and the bytes upload
on reconnect. A member who photographs a receipt in a car park sees the row on every device before
the bytes have moved.

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `documents.pinned` — household ∪ own personal pins, opening a preview overlay |
| Widget | `documents.expiring` — documents expiring within the member's lead windows |
| Metric | `documents.pinned_count` (per recipient), `documents.expiring_90d`, `documents.total`, `documents.storage_bytes` |
| List | `documents.expiring`, `documents.largest` |
| Reminder kind | `documents.expiry` — scope per type |
| Search scope | `documents.document` |
| Storage | Tables plus the `documents/` prefix, attributed per document creator and visibility |

## Permissions

Standard gate. Upload, rename, move, soft-delete at `contribute`; hard delete (which purges object
storage) at `manage`; personal pins at `view`.

## Non-goals

- No in-file text search, no OCR, no content extraction in 1.0.
- No in-browser editing, annotation or e-signing.
- No third-party storage integrations (Drive, Dropbox, OneDrive).
- No version history on bytes — a new file is a new document, optionally linked as a successor.
- No public sharing or share links of any kind.
- No per-document ACLs beyond shared/private.
