# 0018 — The push compares a base version against the row it locks, the streams carry visibility and audiences on each row, a rewrite of a row's access is not an edit, and the change feed is written no longer

- **Status:** Accepted
- **Date:** 2026-10-02
- **Plan item:** 17
- **Decides for:** [PRD 03](../prd/03-platform-strands.md) §2.2–§2.6 and FR-SY7 under D-93;
  [01](../prd/01-architecture.md) §3, §7 and §10's test 4; [04](../prd/04-billing-and-entitlements.md) §5's
  sync mutations; [07](../prd/07-nonfunctional.md) §1; [10](../prd/10-sync-risk.md) §4 (scenario 2) and §5;
  D-8, D-85, D-88, D-90; D-121–D-127; [ADR 0001](0001-sync-engine.md), [ADR 0006](0006-sync-ready-schema-and-the-mutation-spine.md)
  and [ADR 0014](0014-powersync-deployment-generated-streams-credentials-and-the-push.md)'s consequences
  for item 17

## Context

Item 13 built the push for `lww_field`, `state_set` and `additive`, and generated streams for the
grant alone, withholding every entity whose rows may be private (`Owner`) or an audience's
(`Audience`). Gate G-B asks that all eighteen scenarios of PRD 10 §4, the access-loss cases beside
them and a fuzz run pass against the engine. Item 17 was left these questions:

1. **How `lww_row` and `strict_version` answer a `base_version`**, and what `merged` means, which no
   policy answered yet; and where `lww_row`'s loser is preserved.
2. **How a private row, a redacted projection and an audience reach a replica**, since a stream reads
   an entity's own table, compares a row with the caller by equality only, and cannot compare a row
   with a member's floor ([ADR 0001](0001-sync-engine.md)).
3. **What writes an audience's readers and a private item's visibility onto the rows they bound**,
   without `touch_entity` ([ADR 0006](0006-sync-ready-schema-and-the-mutation-spine.md)) turning the
   rewrite into an edit that conflicts with every queued or `If-Match` write to the row.
4. **What retraction is** for each of PRD 03 §2.6's five causes, with no `retract` rows.
5. **The fate of `sync_changes`**, which nothing reads under D-93, which the spine writes under a
   per-household lock, and whose monthly partitions run out three months after item 4's migration.
6. **Divergence**: whether `postSyncDigest` stays when PowerSync checks each bucket's checksum, the
   point it is computed at with no feed cursor, and what `postSyncReset` and `getSyncState` become.
7. **The socket**: whether `…/stream` stays for Chat's payloads, `entitlement_changed` and
   `access_changed`.
8. **Compaction, metrics, and the sync mutations' fair-use ceiling.**

## Decision

**The push compares a base version against the row it locks (D-122).** For an update, a delete or an
action of an `lww_field`, `lww_row` or `strict_version` entity, the push locks the row the mutation
names `FOR UPDATE` and hands its version to the writer (`push.Mutation.Prior`; the version alone is
read, which tells a caller nothing their module would not show them):

- **`strict_version`**: an update, a delete or an action names its `base_version`, and one made
  against another version than the row's is refused `conflict` (`version_conflict`) carrying the row
  as it stands. The writer calls `Mutation.Admit` once it has found the row and may show it to the
  caller, since only it knows the row's representation and its visibility; the push fails the batch
  at a `strict_version` write its writer let through over another version, a bug rather than a
  refusal.
- **`lww_field` and `lww_row`**: a write made against an older version than the row is at is applied
  over the change it had not seen and answered `merged` with the code `concurrent_change` and the row
  (`Mutation.Behind`): the server's row differs from what the client expected, which is PRD 03 §2.4's
  definition, and the client surfaces it where a field the member set was overridden. A write against
  the row's own version, a create, and a write that names no base version are `applied`. Scenario 2's
  reading (ADR 0013) is confirmed: the later write is answered `merged`, carrying the row, and the
  earlier value is not silently dropped, since the activity log keeps it as the value the later write
  replaced, which the conformance item's writer records as each field's diff.
- **A replica's own earlier write is never a change it had not seen.** A replica makes each write
  against the version of the row it holds, which moves only when a checkpoint reaches it, so its
  second write of a row carries the base version its first did. Within a batch the push holds a later
  mutation of a row an earlier one wrote, made against the same version, to the version the earlier
  left (`landing.rebase`): applied rather than merged over its own replica's write, no loser kept of
  it, no conflict with it, and an edit of a row created in the same batch, which could name no
  version, held to the create's. Across batches the client does the same, sending a mutation it made
  while an earlier one of the row was in flight against the version that one's answer returned.
- **`lww_row` preserves its loser in its module**: a write behind its row keeps the row it replaces,
  with the version it stood at, the version the write was made against and who wrote each, where the
  module keeps it for the member to be offered (notes' `note_body_versions`, PRD modules/07 FR-NO10;
  the conformance module's `conformance_note_versions`). The module owns it because it is household
  content, held to the row's own visibility, exported and erased with the module's data.

**A row carries the access its streams read (D-88, D-90, D-93).** `sync.Entity` names the columns:
a row that may be private carries `visibility` and `owner_id`, a row an audience bounds carries
`readers`, the members whose floor it is at or above (`sync.Entity.AccessColumns`). Every row a
private item or an audience bounds carries them itself (a private note's comments, a message's body,
reactions and attachments' metadata), since a stream reads its entity's own table; architecture test
10 fails an entity whose table lacks them, or lets its `visibility` or its `readers` be NULL, which
no stream matches. The generated streams (`sync.Streams`):

- `Owner` doubles the grant's two arms: the shared rows (`visibility = 'shared'`), and the private
  rows of the caller's own (`visibility = 'private' AND owner_id = auth.user_id()`).
- A redacted projection is a column list on the entity (`sync.Entity.Redacted`, replacing ADR 0006's
  `Redact` function), streamed by the grant's two arms from the private rows, whoever owns them, into
  a client table of its own named for the entity's table, without its schema, with `_redacted` after
  it (`SELECT … FROM t AS t_redacted`), which reaches the owner as well, whose client shows the full
  row over it. It names only columns the entity's own column list does, when it has one: a column
  withheld from every replica is withheld from the projection too (architecture test 5).
- `Audience` holds every stream of the entity, its projection's included, to the rows whose readers
  name the caller (`auth.user_id() IN readers`).

**A rewrite of the access a row carries is not an edit of it (D-123).** `sync.RewriteAccess` sets the
transaction-local `household.access_rewrite` to the access columns an update rewrites, runs it, and
clears it; `touch_entity` (migration 01021, replacing ADR 0006's) then leaves the row's `version`,
`updated_by` and `updated_at` as they were, and raises when the update changed any other column. The
mutation that changed the audience or moved the item records its own change and audit event; the
rewritten rows record none, since what they say did not change, only who they reach. So an edit
queued against one of them, or sent under `If-Match`, still applies against the version its member
saw. Only the platform sets the setting: architecture test 4 fails a module naming it.

**Retraction is a row leaving every bucket a member holds (FR-SY7).** No cause writes a retraction:
a grant lowered to `none`, a module disabled and a member removed change the tables every stream's
lookup reads; a member removed from an audience is taken out of the readers of its rows, and an item
made private has its own visibility and its bounded rows' rewritten, by the module's mutation. The one
write a cause needs of the platform is item 10's `household.Hooks.Lost`: a member removed from the
household, or gone from it, is taken out of the readers of every row of every audience entity
(`app.Retract`, `sync.RemoveReader`), in the removal's transaction, since readers left behind would
reach them again were they brought back with the grant. A lapsed entitlement retracts nothing; a
suspension empties every replica of the household (D-115).

**The change feed is written no longer (D-121).** `mutation.Apply` checks each change a mutation
reports against its entity (`sync.Change.Check`, which now also refuses a row that does not
serialise) and records the audit event, and writes no `sync_changes` row and takes no household lock.
`sync.Change` keeps its `Row`, so that the record stays what a feed would carry. The push's response
loses `seq`, which had no reader. The table, its partitions function and its policies stay until gate
G-C (item 34): if G-C passes, item 34 drops them, the contract step of an expand/contract change that
this item's release is the expand step of; if it fails, its fallback, building PRD 03 §2's engine,
restores the write against a table still there, from the change every mutation still reports.

**The replica reports itself, and the digest stays (D-125).** `postSyncDigest` becomes a replica's
report: per entity type, the count and an order-independent hash of the `(entity_id, version)` pairs
it holds (the sum modulo 2^64 of each pair's xxh3-64), and its health, which the sync-health screen
shows: the checkpoint it applied, its queued mutations, its unresolved conflicts and rejections, and
its bucket checksum failures. It is sent at rest, its queue empty. The server computes the same over
what the caller may see as the report arrives: no point in PostgreSQL's history is held to compare at,
and a PowerSync client holds no cursor. A mismatch is divergence only when the replica's next report,
at least a minute later, mismatches the same entity type while the server's own hash of it has not
moved between the two. Divergence, or an owner's `postSyncReset`, marks the replica to download
itself again once its queue has drained, so that nothing queued is lost. `getSyncState` reports each
of the caller's replicas as it last reported itself. The three operations stay in `contract_pending`:
item 18 builds both halves, which agree on the hash and the replica's id only when built together.

**The socket goes (D-124).** PowerSync's connection carries every synced row, a chat message's
included, so the nudge has no reader and Chat's payload exception no reason (D-8's latency argument
was about a pull round-trip PowerSync does not make). A grant reaches a client on the membership row
(PRD modules/17 Sync), and the household's entitlement on the household's row, whose stream now sends
its state, its clocks and its restriction as the banner shows them. `getStream` and `StreamFrame` are
removed from the contract and from `contract_pending`; PRD 07 §1's connection target is PowerSync's.

**Compaction is PowerSync's own command, nightly.** `deploy/powersync/compact.sh` runs
`powersync-service compact` at 04:00 UTC in the service's image, after the expiry sweep at 03:00 and
the erasure job item 20 schedules before it, so that a row erased leaves bucket storage the night it
leaves the database. The development compose file runs it as `powersync-compact`; items 30 and 88
schedule it beside their PowerSync. The conformance target runs it on demand (scenario 6).

**Metrics are hooks (`sync.Metrics`)**: each batch's size, each mutation's outcome and code (the
conflict rate), a replica's queue and divergence as its report states them (item 18), and each
replication slot's lag in bytes and whether PowerSync holds it, which a scheduler job samples every
minute. `sync.LogMetrics` logs them until item 89 alerts on them.

**The sync mutations' fair-use ceiling is a rate per UTC day (D-127).** The push counts each
household's mutations per UTC day (`sync_usage`, the platform's own record, kept a week), D-109's
metering bucket, each once, as it first answers it: a mutation answered from what was kept for it, or
deferred to its replay, is not counted again, so that a batch sent again after a lost answer, or
after the server failed it, counts once. A batch received once the day's count has reached 100 000 is
refused whole, `429` `rate_limited` with `Retry-After` the day's end, and is not counted; the batch
that crosses 80 % tells the owners once (`notification.fair_use_sync`).

**A `member_shared` calendar's audience is readers on every row (D-126)**, as a conversation's: the
member list in the stream was never tried beside the grant's subquery, and the suite proves one
mechanism.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **`merged` only when a field the client set was overwritten since its base version** | The server cannot tell which fields changed between two versions without a history of versions per field; the audit log is not one (diffs are kept only for the entities that nominate them). The client holds its own change and the returned row, which is all it needs to decide what to surface |
| **The push reading the row generically for a `strict_version` conflict** | A private row's content would reach a member its module hides it from; the writer knows the row's representation and its visibility, so it answers the conflict and the push checks it did |
| **A platform table of preserved losers** | Household content the platform would have to export, erase, meter and hold to each row's visibility; notes' PRD already keeps its loser in the module |
| **A reader table, resolved by a subquery** | The probes accepted it only alone, never beside the grant's subquery (ADR 0001), and a stream's parameter results are capped at 1000 (`PSYNC_S2305`); readers on the row pass the suite |
| **The readers and the visibility kept out of the version by leaving `touch_entity` off for their tables** | Every other update of those rows would go unversioned too; the setting is held to the access columns, and checked |
| **Keeping `sync_changes` with partition maintenance and a retention** | No reader: PRD 07 §1 sized it at ~4 B rows a year at Year 3, and its lock serialises every household's commits, for nothing. Restoring the write in G-C's fallback is restoring a function against a table that stays until then |
| **Dropping `sync_changes` now** | An instance still running the code that writes it would fail every mutation between the migration and its restart; expand/contract keeps the drop for a release after this one, and G-C's fallback weighs keeping it until the gate |
| **Retiring the digest** | PowerSync's checksums hold a replica to its buckets, never the buckets to PostgreSQL: a replication fault, or a stream that disagrees with its entity's declared access, passes every checksum, and the digest is the only check on it in production (D-85) |
| **Computing the digest at the replica's checkpoint** | PostgreSQL keeps no history of a row's versions to compute it at; comparing at the report's arrival and confirming a mismatch against a server hash that held still for a minute tells real divergence from a household being written to |
| **Building the digest's server half here** | Its hash, the replica's id and the report are agreed between two halves; built alone it would be tested against a hand-made client only. Item 18 builds both, and the contract states them now |
| **Keeping the socket for `entitlement_changed` and `access_changed`** | Both are state on rows a replica already holds; a second channel would carry them a second way |
| **A fixed 24-hour window counted from each mutation, or per device** | A rolling window needs per-mutation timestamps to count; the ceiling is the household's (PRD 04 §5), and D-109 already makes the UTC day the metering bucket every household shares |
| **Counting each batch whole as it arrives** | A batch is sent again after a lost answer or a server's fault: one mutation that fails its batch, retried every few seconds by its device, would spend the household's day in minutes and hold every one of its devices until midnight |

## Consequences

- **Item 18** builds the replica's report: both halves of `postSyncDigest`, `postSyncReset` and
  `getSyncState`, their table of each replica's last report, and the confirmation of a mismatch; its
  client surfaces a `merged` answer where a field the member set was overridden, shows an `lww_row`
  loser, and holds a `429` past the day's mutations until its `Retry-After`; it sends a mutation made
  while an earlier one of its row was in flight against the version that one's answer returned. It
  reports a replica's queue and divergence through `sync.Metrics`.
- **Item 34** drops `sync_changes` and `sync_changes_add_partitions` once G-C passes, with the tests
  and the isolation fixture's rows that hold them; if G-C fails, its fallback writes the feed again
  from the change every mutation reports.
- **Item 20** schedules the nightly erasure before compaction's 04:00 UTC; **items 30 and 88** run
  `deploy/powersync/compact.sh` beside their PowerSync; **item 89** alerts on `sync.Metrics`.
- **Modules** with an `Owner` or `Audience` entity carry the access columns on every row the item or
  the audience bounds, rewrite them through `sync.RewriteAccess` in the mutation that moves the item or
  changes the audience, and keep an `lww_row` entity's losers themselves (items 43, 75, 85). A removal
  from the household leaves a module's own audience memberships as they were, so a module that writes
  a row's readers from them holds them to the household's members, locking those memberships until
  the write commits, as the conformance module's messages do.
- A household that pushes its day's 100 000 mutations waits for the next UTC day: at Europe's offsets
  that is midnight or one or two in the morning, local time.
- **What would make this worth revisiting**: a module whose bounded rows are too many to rewrite in
  the mutation that moves their parent (a `member_shared` calendar with years of events; item 90
  measures it); a PowerSync release that compares a row with a parameter other than by equality,
  which would let the redacted projection leave the owner out; or G-C failing.
