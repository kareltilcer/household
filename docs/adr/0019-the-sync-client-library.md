# 0019 — The sync client library builds its replica from a registry generated with the server's, keeps what a mutation needs beside each write, and reports itself at rest

- **Status:** Accepted
- **Date:** 2026-10-02
- **Plan item:** 18
- **Decides for:** [PRD 03](../prd/03-platform-strands.md) §2.1, §2.4, §2.6–§2.7; [06](../prd/06-clients.md) §1, §5;
  [10](../prd/10-sync-risk.md) §4–§5; D-4, D-25, D-84, D-93, D-122, D-124, D-125, D-127, D-128, D-129;
  [ADR 0001](0001-sync-engine.md) and [ADR 0018](0018-sync-engine-ii-versions-visibility-audiences-and-the-feed.md)'s
  consequences for item 18

## Context

Item 17 left the engine complete on the server and its client in the conformance suite: a connector
of the suite's own, a hand-written schema of the conformance module's tables, and none of what an app
needs beside the queue. Item 18 is the library both clients ship (06-clients §1), and these questions
came with it:

1. **Where a replica's schema comes from.** PowerSync needs every client table with each column's type
   before it opens; the entity registry names tables and, for some entities, their columns, but no
   types, which only the migrated schema holds.
2. **What a mutation carries that a row write does not**, and how a client keeps it across restarts:
   its id, its client time, the version it was made against, any action; and which columns of a write
   the server sets itself.
3. **D-122 across batches**: a mutation made while an earlier one of its row was in flight is to be
   sent against the version that one's answer returned, though the replica's version moves only at a
   checkpoint, and PowerSync applies none while the queue holds anything.
4. **06-clients §5's "edits merge into the queued mutation"**, against ADR 0001's rule that a batch
   is sent again unchanged under its key, and FR-SY5's that a `mutation_id` sent again with anything
   else is refused.
5. **A 429 past the household's day (D-127)**, whose `Retry-After` is the end of the UTC day: the suite's
   connector slept inside PowerSync's upload loop, capped at a minute.
6. **Per-row state**, and the withdrawn state (design 03-patterns, *When access is withdrawn*), which
   PowerSync gives no signal for: a row leaving the replica is all it shows.
7. **Both halves of the replica's report (D-125)**: the hash, the replica's id, what an entity's rows
   are when its redacted projection is a second client table, what a report omits or adds, and how a
   replica downloads itself again without losing its queue or what it was answered.
8. **The attachment queue (D-25)**, which the platform's files pipeline receives per module route.
9. **Three builds**: Node for the suite, web on wa-sqlite over IndexedDB, React Native on op-sqlite.

## Decision

**The client registry is generated from the entity registry and the migrated schema**
(`internal/syncconfig.ClientRegistries`): every stream with its entity and client table, every entity
with its module, client tables, merge policy and offline-write flag, and every client table's columns
with the kind a client holds each as (text, uuid, integer, real, boolean, timestamp, date, json, uuid[],
text[]), read from `pg_attribute` in a database every module's block and the conformance module's have
migrated. It is committed as JSON, the server's in `packages/sync/src/generated/registry.json` and the
suite's beside its configuration, and a test in `internal/syncconfig` fails a committed one that is not
what the registry generates; `pnpm run gen` writes them with that test's `-write`, so `pnpm run gen` now
needs the database, as the Go tests already do. An entity's column list, and its redacted projection's,
carries `version` (architecture test 5), which the report hashes. The replica's schema is `schemaOf`
the registry, every full table tracking each write's metadata.

**A write records its mutation beside the row** (`_metadata`, `trackMetadata`): its id (a UUIDv7), its
client time, the version the replica held, any action, the fields it carries beyond the row's columns
(a state_set's key), and the columns it wrote for the replica alone (`local`), which the server sets and
the mutation never sends: a completion's `done_at`, a check's `checked_at`. A mutation's fields are the
write's changed columns, but the base columns and the local ones, each as its kind is sent (a boolean
as a boolean, an array and a JSON value as themselves). A write to an entity not written offline is
refused `NeedsConnection` before anything is queued (D-84).

**An edit merges into its row's queued write while that write has not been sent (D-129).** The
connector marks the highest queued write it is about to send in the replica's own table, and then reads
the batch it sends; an edit whose row's latest queued write is above the mark, and neither acts nor is a
delete, is folded into it in the edit's transaction (`ps_crud`): the earlier keeps its mutation id and
base version and takes the later's columns, fields and client time. A write at or below the mark may be
in flight, and a retry must send it unchanged, so a later edit is a mutation of its own; so is one that
names a row created between the two, which, sent in the earlier's place, would reach the push before it.

**A mutation of the queue is sent against the version its row's earlier mutation's answer returned
(D-122).** Each `applied` or `merged` answer of the queue records, per row, the version the mutation was
made against and the version returned (`rebase`, a local table); a later mutation of the row made
against the first version is sent against the second. The table is pruned once the replica holds the
row at that version or later, or no longer holds it with its queue empty, and is cleared by a
re-download. A held mutation replays as it was recorded.

**A 429 sets the time the push may next be sent to**, its `Retry-After`, in seconds or as a date, kept
in the replica's own table: every upload before then throws at once, without sending, PowerSync trying
again after its retry delay, and a restart keeps the wait. The rest of the connector is ADR 0001's,
moved from the suite: a 401 renews the credential, a 413 halves the batch, a 422 rejects what it locates,
a 402 or a 404 answers the batch alike, a 409 is sent again and rekeyed past D-92's five minutes. A
queued write no mutation can be made of (one made around the library, with no metadata, or one of a
table the registry no longer holds) is ended unsent and recorded as rejected, the writes before it sent
as a batch of their own: no answer would ever end it, and PowerSync would apply no checkpoint while it
waited. A `merged` answer asks for the member's attention only where the row it carries does not say what a field
they set says (a time compared as the instant it is), or where the entity keeps its loser (`lww_row`,
whose module offers it); a conflict and a rejection always do; an answer to a held mutation that ends
it marks the attention its earlier answers asked for as given.

**Per-row state is computed, and withdrawal is a row that leaves.** A row is `conflict`, `rejected` or
`merged` while an answer to a write of it asks for attention; else `syncing` while a write of it is at or
below the sent mark, `pending` while one is above it or held to replay; else `synced`, `deleted` when it
is a tombstone (item 13 keeps them); else absent. A watcher of a row that held it and finds it gone,
neither deleted by its member nor refused, reports it `withdrawn`, by `module` when the replica's
`module_enablement` row says its module is off, by `access` otherwise. The inbox lists each mutation's
last answer that asks for attention; retry writes the member's change again, every field carried, as a
new mutation against the row as the replica holds it, and gives up the old one's hold, which would
otherwise replay the change a second time; discard gives up the hold and the attention.

**The report is computed from what the replica holds, at rest, and sent with its health (D-125).**
Each pair hashes as the XXH3-64 of `<entity_id>:<version>`, the id lowercase, an entry as the sum
modulo 2^64; the library's XXH3 is its own, over BigInt, held to the server's `zeebo/xxh3` by
`vectors/replica-digest.json` for every length class XXH3 has. An entity's rows are counted once by
id, its own table's first and then those only its redacted projection's table holds; the server
counts the same, every row its streams reach the caller by: a shared row, an owned private one, every
private one where a projection reaches the rest, and where an audience bounds the entity only those
whose readers name the caller (`replica.Expected`). A replica is at rest when its upload queue is empty
and every row it holds has a version the server gave, and reports itself on its own only while PowerSync
is connected and nothing is downloading; it reads its tables in one transaction, which no checkpoint
lands inside, and its id is minted once, in the transaction that finds none, and kept. The server
compares only the entity types a report names, answers an entity type it does not sync as disagreeing
and never as divergence, and keeps each replica's last report (`sync_replicas`, D-128). A replica told
`resnapshot_required` waits for its queue to drain, clears its synced rows with its own tables kept
(PowerSync's clear, as `disconnectAndClear({ clearLocal: false })` runs it, in the transaction that finds
the queue empty), forgets its rebase and sent mark, and connects again unless it is being closed, a
disconnect waiting for it so that it cannot connect a replica the app has disconnected;
the server shows it as needing the download until its next report. Bucket checksum failures are counted
from PowerSync's log (`ChecksumWatch`), the only place it says so.

**A device whose sign-in has ended discards its replica (FR-ID7).** The app's credential throws
`Revoked` when it cannot be renewed; the replica then clears everything, its waiting files first and
then its tables, its own among them, and tells the app.

**Files wait in a pending queue (D-25)**: the bytes in the platform's storage (`LocalStorageAdapter`:
Node's file system, the browser's IndexedDB, the app's on React Native), a row in the replica's own table,
uploaded through the module's route once the replica holds the row at a version, after each checkpoint;
a refusal of the file itself is kept with its code, the bytes dropped, and the server marks the row; a
refusal for the household's state (`entitlement_*`) is not one, and the file waits. A refused create
the member discards takes its waiting file with it, its row being one the server will never hold.

**Three builds over one core**: `@household/sync/node`, `@household/sync/web` (wa-sqlite over IndexedDB,
each tab connecting on its own by default, every tab on the household's one database) and
`@household/sync/native` (op-sqlite) each open a replica on their SDK, and are typechecked against
their own platform's types. React Native's showed two gaps: its
Response has no body stream, and its FormData takes no Blob made from bytes, so the multipart upload is
the Node and web builds', and React Native's app sends its file by its URI.

**The conformance suite drives the library.** Its clients are the library's replicas on its own
network and clock; its connector and mutation encoding moved into the library with their tests; its
hand-written tables stay the oracle's, held by a test to the generated registry. It proves a restart
before the queue drains, every replica's report matching on every access axis at rest, and a reset's
download losing nothing queued; the web build passes the same in Playwright's Chromium.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Column types declared in the Go registry** | Every module would write each column twice, once in its migration and once in Go, and a test would hold the two together; the schema is the one source of what a column is |
| **Generating the client registry in `go generate`**, keeping `pnpm run gen` free of the database | `go generate` has no migrated database to read types from; making one there would duplicate testsupport's template, and the Go tests need the database already |
| **The suite's per-table `writes` list in the registry**, filtering a mutation's fields | The server has no declaration of which columns a client writes, only writers' code; a write's `local` columns say it where the app writes them |
| **Merging edits at upload time**, coalescing a row's queued writes into one mutation | A batch whose answer was lost is sent again, and would carry another mutation under the same id, which FR-SY5 refuses; merging in the edit's transaction, above a mark the connector sets before sending, never changes a sent mutation |
| **Clearing the rebase when the queue drains** | A write made after the queue drains and before the checkpoint lands is still made against the old version; pruning by the version the replica holds keeps it right |
| **Sleeping out a 429 inside the upload** | PowerSync's upload loop waits on it, a `disconnect` with it; a day's wait cannot be slept, and a restart forgot it |
| **A synced table telling the client why a row left** | No retraction is written (FR-SY7), and a row in a stream to a member who lost access is the leak retraction prevents; the module's enablement row, which every member holds, says which of the two sentences to show |
| **An npm XXH3**, or WebAssembly | Hermes runs no WebAssembly, and the pure-JavaScript ports were unmaintained or XXH64; the shared vectors hold ours to the server's on every length class |
| **Counting an entity's redacted projection as an entity type of its own** | The contract's entity types are module-qualified entities; counting each id once over both tables is what the server can compute from the entity's rows alone |
| **Comparing every entity type the server syncs, reported or not** | An app older than the server subscribes to fewer streams, and would be told to download itself again for ever |
| **PowerSync's attachment queue** (`AttachmentQueue`, alpha) | It manages downloads and an archive the platform does not want, behind a remote storage interface that does not fit a module's upload route and the server marking the row; its storage adapters are used |
| **One TypeScript program for every build** | The DOM's, Node's and React Native's globals cannot be one program's, and merged they hide exactly the React Native gaps a separate check found |

## Consequences

- **Items 27 and 28** open a replica per household with `@household/sync/web` and `/native`: the
  mobile app installs a `crypto.getRandomValues` polyfill before it (as `@household/api` already asks),
  supplies an attachment storage and transport, and gives the replica a credential that throws
  `Revoked` when its refresh is refused. They render RowState, the inbox and `NeedsConnection` with the
  design's words, and the withdrawn sentence by its reason. A replica reports itself on its own only
  while PowerSync has caught up (`caughtUp`), and an app that calls `report()` itself, a sync-health
  screen's "check now", waits for the same.
- **Item 27** keeps one tab's replica of a household open at a time (a Web Lock on its database, say):
  every tab opens the household's one database, and each tab's replica runs a connector of its own, so
  two tabs uploading at once send the same queued writes twice under keys of their own, and one tab's
  download or discard clears the database under the other. PowerSync's shared worker (`multiTab`)
  shares the connection, not the connector.
- **Each module** writes the columns its server sets as `local` and carries a state_set's key; an
  entity it adds reaches a client only through `pnpm run gen`, which needs PostgreSQL. A stream added
  to an entity an app in the field already syncs, a redacted projection above all, is one that app
  never subscribes to: it reports fewer of the entity's rows than the server counts, every second report
  is divergence, and it downloads itself again for as long as it is not updated. Such a change ships
  as an entity type of its own, or with the report first naming the streams a replica holds.
- **Item 20's diagnostic bundle** reads the replica's health from the library and a verdict by sending
  a report (`report()`): the library keeps no verdict of its own.
- **Item 89** alerts on `sync.Metrics`' divergence and queue as replicas report them.
- **What would make this worth revisiting**: a PowerSync release that signals checksum failures or a
  row's removal by cause; one that changes `ps_crud`'s layout, which the merge writes; or a client whose
  reports, at its households' volume, take long enough at rest to matter (item 90 measures it).
