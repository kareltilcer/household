# 0015 — Files go through one pipeline into a write-once bucket, their variants are derived after the commit by workers the meter role dispatches, the meter reads every household's counting columns and nothing else, and pictures are the account's

- **Status:** Accepted
- **Date:** 2026-09-30
- **Plan item:** 14
- **Decides for:** [PRD 01](../prd/01-architecture.md) §2.3 (the meter role) and §8; [PRD 03](../prd/03-platform-strands.md)
  §3 (FR-ST1–ST4) and §8 (FR-FL1–FL4); [PRD 07](../prd/07-nonfunctional.md) FR-NF3 for object storage;
  [modules/17](../prd/modules/17-household-admin.md) FR-HA14; D-9, D-25, D-28, D-107, D-108, D-109; plan Q14

## Context

Plan item 14 builds what every module that keeps a household's files will go through (Documents,
Notes' images, Chat's attachments, Garden's photos, the asset modules' photographs), before any of
those modules exists, and the two uploads the platform needs itself: a member's picture and a child
profile's. It also builds the storage account billing reads: the daily usage sample (FR-ST2), the
storage picture a household is shown (FR-ST4), and the counters fair use watches.

What had to be settled:

1. **Where an upload's bytes go before its row commits**, so that a failed mutation leaves nothing
   billed and a retried one stores nothing twice, while bytes stay write-once (FR-FL1) against two
   requests racing for one entity.
2. **What a type is**, sniffed from the bytes, and which types are refused, which are shown and which
   are only ever downloaded (FR-FL2).
3. **How variants are derived after the commit** (FR-FL3), once, by any instance, surviving a restart,
   and what does the deriving: Go decodes the common raster images; nothing in Go renders a PDF or
   converts an office document, which Q14 left to "LibreOffice headless, assumed".
4. **Who reads across households.** The sampler measures every household, and the variant workers
   must find the households with work due. Every tenant table forces row-level security; PRD 01 §2.3
   gave the meter role "enforced; reads aggregate columns only", and architecture test 2 allowed no
   permissive policy but the tenant isolation.
5. **How bytes are attributed to a member** (FR-ST1) when only a module knows whose its entity is, and
   the sampler, reading as the meter, may read no module's content.
6. **What a link is** (D-9), and to whom it is issued.
7. **Where pictures live**: a user is in several households (D-4), and `Me.avatar_url` is one.

## Decision

**The pipeline** (`internal/platform/files`) is a library a module's handler calls, after it has
authorised the caller, in three steps:

- `Receive` reads the multipart body's `file` part to a temporary file under the 100 MB cap
  (`413 payload_too_large`, refused from `Content-Length` before a byte is read when that shows it),
  computes its SHA-256 and sniffs its type from its bytes (`Sniff`). The client's name never makes a
  type: it only says which kind of plain text text is, and a program's extension (`.exe`, `.msi`,
  `.jar`, `.bat`, `.ps1`, `.chm`, `.jnlp`, a disk image Windows mounts, …) blocks a file whatever its
  bytes are, since a script is text to any sniffer. A program (PE, ELF, Mach-O, a shebang script, a
  JAR or an Android or Windows package, an MSI by its compound file's class id) or a type the route's
  `Accept` does not take is `415`; a form with no file, two, an empty one, or a field over its length
  is `422`. A ZIP's directory is read to 4 MiB at most, since `zip.NewReader` holds every entry it
  lists; one larger is an archive. The upload's body may take `HOUSEHOLD_UPLOAD_TIMEOUT` (15 minutes)
  to arrive, extended past the server's body deadline through `http.ResponseController`; a spool the
  server cannot write is its own `500`, never the body's `422`. The Idempotency-Key's fingerprint of
  a multipart body leaves out its boundary, which a client draws afresh for every attempt, and its
  length, which carries the boundary once for each part and once more, and differs when a client
  draws boundaries of more than one length, as Firefox does: a form is known by its route, its
  precondition and its media type.
- `Put` checks the storage ceiling against the rows the household has now (`402
  storage_ceiling_reached`, with `over_by_bytes` and `blocks_at_ceiling`, remedy `free_storage`; below
  the ceiling an upload always succeeds, D-33) and writes the bytes to
  `h/{household}/{module}/{entity}/original` with `If-None-Match: *`, the digest in the object's
  metadata. **The store is what keeps bytes write-once**: a second write to a key is refused by the
  store itself (RustFS answers `412`, as S3 does, and S3 `409` to a write racing another still in
  flight, which is the same refusal), whoever races for it; a retry finds the same
  digest there and succeeds, and other bytes for the entity are `422` naming the field that named the
  entity. A store that cannot be reached is `502 storage_unavailable`, and nothing is recorded
  (FR-NF3).
- `Record`, in the transaction of the module's mutation, writes the `files` row with the attribution
  the module declares (`owner_id`, `private`) and, for a type with variants, the job that derives
  them, so both commit with the audit event and the change or neither does. `Remove` deletes an
  entity's rows in its mutation and queues the purge of its bytes; `Attribute` moves them to another
  member or between shared and private.

Bytes are therefore in the store before their row commits, never after: a row always names bytes
that are there. What a failed mutation, or a process that died between the store and the commit,
leaves is bytes no row names, which nothing bills (the sample sums rows), and `Sweep` removes them
once they are a day old. The ceiling is checked against the rows, not under a lock, so two uploads at
once may take a household past it by the smaller of them; the ceiling is a bound on exposure, not a
meter, and a lock per household on every upload was not worth it.

**Types** are classed: raster images Go decodes (JPEG, PNG, GIF, WebP, BMP, TIFF) get a thumbnail
(320 px) and, when larger than 1600 px, not upright or not shown by browsers, a preview; a PDF gets
its first page as a preview and a thumbnail; an office document (OOXML, ODF, the compound-file
formats, RTF) gets a PDF and that PDF's page; other images (HEIC, AVIF), text and media are shown in
place with no variants; HTML, SVG and XML are active, kept, and only ever a download; archives and
anything unrecognised are downloads.

**Variants are derived by workers in every instance**, from `file_jobs` rows the upload's own
transaction wrote. A commit wakes its instance's workers (`Nudge`); the others find due jobs every
30 seconds. A worker claims a household's next due job with `FOR UPDATE SKIP LOCKED`, moving its
`run_at` past a ten-minute lease, so a job whose worker died runs again once the lease passes, and a
job runs no longer than its lease, since the store's client gives up on nothing by itself; one
that fails for a reason a retry may mend waits 1, 5, 30 and 120 minutes, and after five tries, or at
once for a file that cannot be decoded or converted, the original's `variants` is `failed` and the
file stays download-only, its upload never lost. A panic in deriving, a decoder's on the bytes a
member sent, is such a failure and never the process's end; and a job claimed a sixth time, its
workers having each ended with their process before they could settle it, is given up without
running, rather than taking down one instance after another, a lease apart. A variant is put `If-None-Match` too; one a
previous attempt stored is kept as it is, since a conversion need not give the same bytes twice.
What is derived carries no metadata: an image is decoded, turned upright by its EXIF orientation,
scaled and written again. An image of more than 64 million pixels is not decoded, nor one that decodes to none (a GIF whose
first frame is none of its screen wide), and the images a
process decodes at once, its workers' and its requests' pictures alike, hold a gigabyte between them
at most (`imaging.Budget`): each waits for room, since a PNG of a few hundred kilobytes may decode to
half a gigabyte, and a handful sent at once would otherwise take the process's memory.

**The converter is a sidecar of our own**: `server/cmd/converter`, a small HTTP server in the server's
module, built into `deploy/converter`'s image over Debian's LibreOffice (`*-nogui`) and poppler. `POST
/pdf?ext=` converts an office document with `soffice --convert-to pdf`, `POST /page?side=` draws a
PDF's first page with `pdftoppm`; each conversion has a directory and a LibreOffice profile of its
own, so two run at once, and a timeout (two minutes, thirty seconds) past which its whole process
group is killed. What the commands print is discarded, since a damaged document's diagnostics quote
it (FR-NF5). What it cannot convert is `422`, which the pipeline takes for good; a timeout `504`
and a wait for a slot `503`, which it retries. It runs with no route out in a deployment, since a
document may name remote resources. CI builds the image and converts a real document through it.

**The meter role reads across households, and only counting columns.** `enable_tenant_isolation`
now also calls `enable_metering`, which creates `meter_read`, a permissive `FOR SELECT` policy `TO
household_meter` `USING (true)`, and grants the role `SELECT (household_id)`; migration 01015 adds
both to every table isolated before it and to the three tables with policies of their own
(`households.id`). The role holds `SELECT` on no other column but the few the sampler sums and the
workers schedule by (`files.module, variant, byte_size, owner_id`, `file_jobs.run_at`) and no other
privilege. **Architecture test 2** accepts that one policy beside the tenant isolation, exactly as
`enable_metering` makes it, and refuses a restrictive policy that reaches the meter role: a
restrictive policy is ANDed with every permissive one, so the narrower rule ADR 0005 prescribes, a
private item's `owner_id = app_user_id()` written for every role, would hide every such row from a
role that reads with no caller, and the sample would count none of them. A restrictive policy names
the roles it narrows, `TO household_app`. **Test 11** holds the role to its columns, against
deliberate violations of its own. The meter measures; it never writes: the sample of each household is written in that
household's context by the request role (`tenant.Assume` with no caller, `tenant.InWriteTx`), and a
worker, once the meter has named the household, claims and records its jobs the same way.

**The sample** (`storage.Sampler`) reads, as the meter, from one repeatable-read snapshot per batch of
500 households, each household's bytes by module (originals and derived apart) and by member, its
objects, and the rows of each table a module declares (`module.StorageSource.StorageTables`), and
replaces the household's sample of the UTC day (D-109; `usage_samples`, `usage_sample_modules`,
`usage_sample_members`). A household that keeps nothing is sampled at nothing, so a period's average
counts its empty days. Item 15's scheduler runs it nightly, with the sweeps.

**Attribution travels with each object.** A module declares, when it records an upload, the member the
bytes count against and whether the entity is private to them, and keeps it current with
`Attribute`; the row carries it, so the sampler splits by member without reading any module's table,
and a link to a private entity's object, or its variant, reaches its owner alone. A module labels its
entities for the storage picture through `StorageLabels`, read in the reader's household; without it,
the original's file name is the label.

**A link** (`Link`, the contract's `ContentLink`) is pre-signed for one object, signed as of the start
of the five minutes it is issued in and valid for fifteen from then, so it works for ten minutes at
least, and every link to an object issued in the same five minutes is the same URL, which a client's
cache keeps. It is issued only to a caller who can see the module, and for a private entity only to
its owner; each refusal is the `404` a missing object is. The response presents the stored type, and
an active type or a type a browser does not show as an attachment, whatever the object says.

**Pictures are the account's** (`internal/platform/avatar`, D-107): the upload (JPEG, PNG, GIF or WebP,
20 MB) is decoded, its centred square scaled to at most 512 pixels, turned upright and written again,
a PNG where it is transparent, and kept under `u/{user}/avatar/{id}/picture`, its row in `avatars`, a
global table. A new picture has a new id, so a new key; the one it replaces is purged once the
replacement commits, and the accounts' prefix is swept like a household's. A member sets their own
(`putMeAvatar`, clearing it through `PATCH /me`); an owner sets a child profile's
(`putChildrenByUserIdAvatar`, `deleteChildrenByUserIdAvatar`), in a mutation that touches the
membership and records `admin.child.avatar`. `avatar_url` is a link pre-signed as above, issued in the
response to whoever that response is for: the user, a member of a household the user is in, or the
holder of the household code that lists a child's profile.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Uploading straight to the store with a pre-signed PUT | FR-FL1 sniffs, caps and checks the quota on the way in; a pre-signed PUT lets the client write any bytes under any type, and D-9 issues URLs for reading one object only |
| Writing the row first, as pending, then the bytes | A row naming bytes that may never arrive, which every reader must allow for, and the write outside the mutation spine that a pending row needs |
| Streaming the part to the store without spooling it | The quota needs the size and the 402 its excess before the bytes are sent; a digest known before the write lets the retry tell its own bytes from another's; and a failed write to a multipart upload leaves parts behind |
| Enforcing write-once in the database, with a lock around the write | A row lock held across a 100 MB write to the store, or a check-then-write race that lets two requests overwrite each other's bytes; the store's conditional write settles the race where the bytes are |
| A third-party sniffing library | A dependency for what is a few signatures and two container formats, and an allowlist the platform does not own; the blocked and active lists are the security decision, and they are ours to read |
| Gotenberg, or another published LibreOffice image | Gotenberg converts to PDF only and cannot draw a page; poppler is not in it, and a second image beside it would be two services to secure for one job. A published unoserver image is a small maintainer's; Debian's packages are patched with the distribution |
| A queue of our own outside PostgreSQL | A job written in the upload's transaction exists exactly when its cause committed; anything else needs a transactional outbox to get there |
| A global job table without row-level security, for the workers to scan | It would hold every household's rows outside the isolation architecture test 2 exists to keep, for a scan the meter role can make over a column that names no content |
| A `SECURITY DEFINER` function to list households | The functions run as the migrate role, which every tenant table forces row-level security upon too, so it would read nothing without a context; and a function per question grows where one policy does not |
| Computing attribution at sampling time from each module's tables | The meter would need to read what modules keep, which the role exists not to; the module knows whose its entity is when it records it |
| Pictures under each household's prefix, metered there | A user in three households would have three pictures, or one billed to a household that did not choose it; a picture is a few kilobytes, and the account holds it as it holds the user's name |
| Serving pictures through an API route that redirects to the store | An authorised request per picture per member list, and a redirect whose `Authorization` header some mobile clients carry to the store, which refuses it |

## Consequences

- Every module that keeps files calls `Receive`, `Put`, `Record`, `Link`, `Remove` and `Attribute`,
  and implements `module.StorageSource`; none touches the store. A module whose entity carries a
  preview state reads the original's `variants` (a hook to change its own row when the workers finish
  is the first such module's to add, item 46).
- An attachment made offline (D-25) keeps its state on the module's own row, never in `files`: the
  row a client created offline replicates with the module's `attachment_status: pending` before its
  bytes have moved; when connectivity returns, the upload is `Receive`, `Put` and `Record` for that
  entity's id, in a mutation that sets its `attachment_status` to `ready` with the file it records;
  and a refusal no retry will mend, `402 storage_ceiling_reached`, `413` or `415`, is recorded on the
  row as `failed`, with the reason its `code` names, in a mutation of the module's own (PRD 10 §4,
  scenario 12, which item 17 switches on). The pending `files` row rejected above is not D-25's
  pending row: `files` names bytes once they are in the store, whatever the module's row says of
  them.
- A file's attribution names one member and whether the entity is private to them, and no audience
  between that and the whole module: `Link` refuses a private file to everyone but its owner, and the
  storage picture lists a shared one to every reader who can see its module. A module whose entities
  some of its members may not open, though they are no one member's, Chat's conversations (item 85),
  extends the attribution with that audience before it records a file; recorded as shared, its
  attachments would be named in the picture to members who are not in the conversation (D-108).
- `nosniff` cannot be set on what the store serves: S3 lets a pre-signed URL override the type and
  the disposition, not other headers. The edge in front of the bucket adds it in a deployment
  (`docs/runbooks/object-storage.md`); in development RustFS serves without it, from an origin other
  than the app's.
- The meter role's grants widen with each column a later item needs to count by, and test 11 names
  every one; a column that says what a household wrote is the line the role never crosses.
- Office previews need the sidecar: without `pnpm run up:convert` in development, an office document
  or a PDF is kept and linked, and its variants fail. A deployment runs the sidecar beside the API
  (items 30 and 88), with no egress.
- The storage picture's totals are live; its trend and billing are the samples', which exist once item
  15's scheduler runs the sampler. `included_bytes` is the base allowance until item 19 adds the blocks
  in effect.
