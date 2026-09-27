# 0001 — Adopt PowerSync for replication; the write path stays Household's

- **Status:** Accepted
- **Date:** 2026-09-27
- **Plan item:** 5
- **Decides for:** PRD 10 §2 (D-83) and plan question Q2; PRD 03 §2.2–§2.3 and §2.6 (how the
  read half is delivered); D-93; plan decisions PL-5 and PL-6

## Context

PRD 10 §1 splits the sync risk in two. The schema half (UUIDv7 client ids, `version`, tombstones,
the access fields, a merge policy per entity) is catastrophic to change and is already enforced by
item 4. The engine half — the change feed, the replica, retraction, compaction — is contained and
replaceable. D-83 asks that two off-the-shelf engines be tried against the hardest cases before
one is built, and PRD 03 §2's design (PostgreSQL as the truth, a per-member partition of what
replicates, a SQLite replica, writes through the application's own API) is close enough to
existing systems that building it should be a decision rather than a default.

The spike ran PRD 10 §4's scenario 3 (two members check one shopping item offline) and scenario 7
(a grant is revoked while a member is offline with writes queued) against both candidates,
self-hosted in docker beside a PostgreSQL 17 carrying item 4's migrations. Its backend imported the
server's own packages, so every write a member made went through the tenant middleware,
`grant.Require` and `mutation.Apply`, and wrote its row, its audit event and its feed change in one
transaction. The harness made every other write directly as the administrator, standing in for the
API later items build: the grant, module and membership changes, the soft delete, and every row of
the visibility and audience cases, their readers included. The harness, the configurations and the
full results are in the commit that adds `spikes/sync-engine` (fbfdec0); the directory was deleted
before merge.

### The candidates, as they stood on 2026-09-27

Checked against each project's releases, licence files, image registry and documentation, not
against summaries.

| | PowerSync | Electric | Zero | Replicache |
|---|---|---|---|---|
| Version | Service 1.26.1 (2026-09-11); `@powersync/react-native` 2.3.0, `@powersync/web` 2.4.1, `@powersync/node` 1.1.0 | Server 1.8.1 (2026-09-07); `@electric-sql/client` 1.5.28 | 1.9.0 (2026-08-14) | 15.3.0 (2025-07-02) |
| Licence | Service FSL-1.1-ALv2: any use but a competing sync product, each release Apache-2.0 two years after it; SDKs Apache-2.0 | Apache-2.0 | Apache-2.0 | Maintenance mode; "migrate to Zero" |
| Self-hosted | `journeyapps/powersync-service`, amd64 and arm64; bucket storage in MongoDB or PostgreSQL | `electricsql/electric`, amd64 and arm64; a persistent disk | `rocicorp/zero`; two PostgreSQL databases and a replica file | No server: push and pull are ours |
| React Native | op-sqlite, in an Expo dev build; Expo Go only through an alpha adapter. Web on wa-sqlite (IndexedDB or OPFS) | `@electric-sql/react` holds shapes in memory; persistence through TanStack DB adapters at 0.2 | expo-sqlite or op-sqlite | Community bindings, last published 2024-07 |
| Writes | An upload queue in the replica's SQLite; a connector we write sends it to our API | None: the read path only | Custom mutators behind a TypeScript push protocol | Push to our endpoint; no per-mutation outcome |
| Telemetry | Anonymous usage sharing **on by default**; `telemetry.disable_telemetry_sharing` | Removed in 1.7.11 | On by default; `ZERO_ENABLE_TELEMETRY=false` | — |

**Zero** fails on paper: it has no offline writes ("Zero doesn't support offline writes"; writes
are refused while disconnected). **Replicache** is in maintenance mode and its React Native story is
an unmaintained community package. Neither was run. **CRDT libraries** stay rejected by D-24.

### What the spike measured

Times are to the first of the harness's looks that saw the state. It looks at once and then every
100 ms, so "within one poll" means the state was not there at the first look and was there at the
next, about 100 ms later.

| Case | PowerSync | Electric |
|---|---|---|
| **Scenario 3.** Petr and Eva check Milk offline, one second apart, then reconnect | Both replicas equal the server 243 ms after reconnecting. The server holds one check (version 1 → 2), one audit event, one feed change; the outcomes were one `applied` and one `applied` no-op; no conflict | The same on the server. The outbox, the optimistic view and their persistence are ours: Electric replicates reads only |
| **Scenario 7.** Offline, Petr checks Bread and adds Butter; his grant is lowered to `none`; he reconnects | The replica is empty within one poll (104 ms), the optimistic Butter included. Both writes came back `rejected` / `not_found` once and were not retried; the server wrote nothing | With the grant checked in our proxy, the proxy answers `404` and nothing clears the replica unless our client treats the `404` as "delete what you hold". With the grant as subqueries in the shape, Electric sends a `move-out` event and **its own `Shape` class ignores it: all three rows stay**. A replica of ours that applies its positional tag protocol empties within one poll (102 ms) |
| **Access loss while connected** | Rows deleted within one poll for each cause the spike could make: grant to `none`, module disabled household-wide (for a member and the owner), removal from the household; rows back when the grant returns. The harness's same run soft-deleted an item, which is a deletion rather than access loss, and its row left the owner's replica within one poll too | As above: with the proxy gate, a grant lowered to `none` clears the replica only through our client's `404` convention, which drops the whole shape at once; with subqueries, its own `Shape` keeps the rows for a grant lowered to `none` and for a module disabled, and only our own tag-aware replica is correct |
| **Visibility and audience** (below), including scenario 18, and scenario 16 with the member removed while connected rather than offline | 7 of 7, through two workarounds | Not run. The probes found it expressible, with the caller's ids and floor as constants the proxy writes |

The totals are PowerSync 26 of 26; Electric 13 of 13 with the proxy gate, 12 of 15 with subqueries
and its own `Shape` (the one failure in scenario 7 above and two in access loss while connected),
and 15 of 15 with a tag-aware replica. The harness's own totals for Electric (15, 19 and 19) count
the notes it logs beside the checks, which pass or fail nothing. Both candidates took item 4's
tables without a column changed, but not without setup: the spike set `REPLICA IDENTITY FULL` on
every table either engine replicated (`memberships`, `module_enablement`, `module_grants` and its
own, `shopping_items` among them), which Electric needs for an update's old values and PowerSync was
never run without, and it added each engine's role and publication. Every scenario ran on a fresh
household in a database holding every earlier scenario's households, and no replica received
another household's row; each member belonged to one household, so this is not the isolation test
the decision below asks for.

### What each access language can say

PRD 03 §2.3's predicate has four axes: the module grant, visibility with its owner, the audience
with its floor, and the member a retraction is addressed to. Each candidate was asked to express
each one (`probes/` in the spike).

| Axis | PowerSync sync streams (edition 3) | Electric shape `where` |
|---|---|---|
| Grant above `none` on an enabled module | Yes, as two streams: an owner of an enabled module, and a member whose grant is above `none`. Inner joins only (a `LEFT JOIN` is refused), and no `OR` across the joined tables | Yes, as `IN (SELECT …)` subqueries joined by `AND`/`OR`; columns unqualified, enums cast to text |
| Private to the owner | Yes: `owner_id = auth.user_id()` | Yes, the owner's id as a constant |
| Redacted to everyone **but** the owner (D-88) | **No**: row data is compared with the caller only by equality, so `owner_id <> auth.user_id()` is refused. The redacted form goes to its own client table for everyone with the grant, the owner included, and the owner's client shows the full row it also holds | Yes |
| Audience membership | Yes: `conversation_id IN (SELECT … WHERE user_id = auth.user_id())` | Yes |
| The member's floor (D-90) | **No**, in every form tried: a join, a scalar subquery, a token parameter. It works as a **reader set on the row**: `auth.user_id() IN readers`, where the server keeps each row's readers | Only as a constant: one shape per member per conversation |
| Retraction to one member | No `NOT IN`; none needed: a row that leaves every bucket a member holds is deleted by their client | Only through move-outs |
| One replica per household (D-4) | Yes: the household as a subscription parameter, still `AND`ed with the grant | Yes, a constant |

### How the candidates fared against PRD 10 §2's questions

| Question | PowerSync | Electric |
|---|---|---|
| Can it express all four access axes? | Yes, two of them through a workaround each | Yes, through a proxy writing constants, one shape per member per conversation |
| Does access loss propagate as deletion? | Yes, for every cause tried, with no client code | Only through client code of ours: a replica that implements its tag protocol, which its own client does not, or a proxy `404` that the client takes as the loss of the whole shape |
| Do writes go through our own API? | Yes, through a connector of about forty lines | Yes, because there is no write path: queue, persistence and optimistic state are ours |
| How good is the React Native story? | Maintained SDK on op-sqlite, dev build; web and Node SDKs from the same core | Pre-1.0 persistence adapters |
| Can it be self-hosted in the EU? | Yes, once telemetry sharing is turned off | Yes |

## Decision

**Adopt PowerSync, self-hosted, as the read half of the sync engine. The write half stays
Household's.** Recorded in the PRD as **D-93**.

The requirement that decided it is retraction: access loss must reach the device as deletion, which
PRD 10 §2 names as the thing most likely not to fit. PowerSync deleted the rows for every cause
with no client code; Electric's own client kept them, and Zero cannot write offline at all. The
requirement that came closest to forcing a build instead is keeping row-level security under the
read path, which adoption gives up; the generated streams and the isolation test below hold it.

- **What PowerSync does.** It replicates from PostgreSQL's write-ahead log into buckets, each keyed
  by its stream's parameters and shared by every member they admit, holds the client replica in
  SQLite (op-sqlite on React Native, wa-sqlite on the web, better-sqlite3 in Node tests), moves each
  client from checkpoint to checkpoint with per-bucket checksums, and deletes from the client any
  row that leaves every bucket it holds. The service is the Open Edition, its image pinned, its
  bucket storage a PostgreSQL database of its own, and its telemetry sharing off.
- **What stays ours.** The client's upload queue is PowerSync's, persisted in the replica, but the
  connector that drains it is ours. It posts the queue to `POST …/sync/mutations` in order, several
  queued transactions to a batch up to the contract's 500 mutations: PRD 02 §9 allows a device 60
  batches a minute, and a device back from days offline can hold more transactions than that while
  PowerSync applies no checkpoint. There every mutation goes through `mutation.Apply` and is
  answered with PRD 03 §2.4's outcome and a code. The connector completes every mutation the server
  answered, whatever the answer, and records any outcome but `applied` in a local-only table that
  the conflict inbox and the sync-health screen read, and that keeps an `entitlement` or `deferred`
  mutation to replay when its cause clears (FR-BI2, PRD 03 §2.4). A response that answers no
  mutation is not an answer: on a `401` the connector renews the API credential the push was sent
  with, which is never PowerSync's token, on a `429` it waits out the delay the response names, and
  on a `413` it sends the batch in smaller ones. A `422` locates the mutation the edge refused
  ([ADR 0003](0003-contract-enforcement-at-the-edge.md)), which is `rejected` with that code while
  the rest are sent again without it. A `402` or a `404` answers every mutation in the batch alike,
  `rejected` with `entitlement` or `not_found`, as the spike's harness was written to do for a
  `404`, though no scenario reached it: scenario 7's `not_found` came per mutation, in a `200`. A
  `409 idempotency_in_progress` means an earlier send of the same batch is still running or took
  effect without its response being kept (D-92): the connector sends it again, and once D-92's five
  minutes have passed it sends it under a fresh key, which per-mutation idempotency (FR-SY5)
  answers from each mutation's stored result. It throws, and so retries, only on a transport
  failure, a `5xx`, a `401`, a `409` or a `429`: PowerSync applies no checkpoint while the queue
  holds anything, so a connector that retried a refusal would freeze the replica. PowerSync's queue
  holds row writes, so what a mutation carries that a row write does not (its `mutation_id`, the
  `client_time` it was made at, its `base_version`, any `action`) is recorded with the write when
  it is made. The spike's harness minted the `mutation_id` at upload, took a check's `client_time`
  from the `checked_at` column the check itself wrote, and stamped every other write with the
  upload time. Merge policies, idempotency, clock clamping and the offline write flags are
  unchanged.
- **The access predicate becomes stream definitions generated from the entity registry**, never
  written by hand, so the check still lives in one place (the reasoning behind D-22):
  - the grant as its two arms, per household as a subscription parameter (D-4);
  - a private row by `owner_id = auth.user_id()`, and an entity's redacted projection as a column
    list into a client table of its own, which reaches the owner as well;
  - an audience's floor through a reader set the server keeps on each row: the members whose floor
    the row is at or above, written by the mutation that writes the row and rewritten by the one
    that changes the audience.
- **Retraction** (FR-SY7) is a row leaving a member's buckets. There are no `retract` rows, so the
  client learns of a retraction only as the row leaving its replica, which is also how a row
  another member deleted leaves it when a stream drops tombstones, as the spike's did. The design's
  withdrawn state tells the two apart (design 03-patterns, *When access is withdrawn*), so items 13
  and 15 must give the client a way to tell them apart.
- **The tenant boundary on the read path is the generated streams.** PowerSync's replication role
  holds `REPLICATION` and `BYPASSRLS`. Every tenant table forces row-level security and the engine
  sets no tenant, so without `BYPASSRLS` it could read no table's initial snapshot (the spike never
  ran without it); the changes it streams from the write-ahead log pass no row-level security in
  any case. An isolation test, the read-path twin of FR-NF4, connects a member of two households to
  one of them and asserts that none of the other's rows arrive, nor any row of a household they
  are not in.
- **With its bucket storage's credential, it is the one exception to D-3.** D-3 says no database
  role bypasses row-level security for content, and this one does. It is the PowerSync service's
  own credential: no staff member, staff tool or support system connects with it, so the
  no-content-access test (PRD 05 §6) leaves it out and the isolation test above holds it instead.
  PowerSync's bucket storage holds the replicated rows outside row-level security, so it is
  household content under the same residency and encryption rules as the database, and the
  credential to its database is likewise the service's alone. PRD 01 §2.3, 02 §8 and 05 §6 record
  the exception.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Build PRD 03 §2's engine**: the feed pull, the snapshot, the `retract` rows, the digest, the realtime nudge, and a TypeScript client with two storage adapters (plan items 12–15 as first written: sizes L, XL, XL and L). Whether the digest and the nudge keep endpoints beside PowerSync is a separate question, left to item 14 | The spike's hardest cases, retraction for every cause and a queue that outlives going offline and whose refusals are surfaced once, came from PowerSync with no client code but the connector, on item 4's schema, with members' writes still through the spine. Building keeps two things adoption gives up: row-level security under the read path, and the floor as one term of the predicate. Each has a replacement that a test holds (above), and neither is worth building replication, retraction and the client replica ourselves, the riskiest work in the programme. Items 12–15 stay four items at the same sizes, but they build around PowerSync rather than that |
| **Electric** | It replicates reads only, so the outbox, its persistence and the optimistic state are ours to build, as the spike did. Its own client (1.5.28) ignores the `move-out` events that carry access loss, so a revoked grant leaves the rows on the device; a correct replica has to evaluate its positional tag protocol, which is the kind of client code the adoption was meant to avoid. Its React Native persistence is pre-1.0 |
| **Zero** | No offline writes |
| **Replicache** | In maintenance mode; no maintained React Native binding; no per-mutation outcomes on push |
| **PowerSync with its outcomes in a synced table** (the pattern its documentation suggests) | A rejection would then travel the read path to a member, as a row every replica of theirs holds. A local-only table on the device that queued the mutation keeps it with the only replica that can act on it |

## Consequences

- **Plan items 12–15 are rewritten** in the same PR: the conformance suite drives PowerSync
  clients against the real stack instead of an in-process engine; item 13 deploys the service and
  generates the streams; item 14 adds conflicts, the visibility and audience streams, retraction
  for all five causes and the observability; item 15 wraps the PowerSync SDKs. PL-5's replica is
  op-sqlite in a dev build rather than expo-sqlite, and PL-6 says PowerSync.
- **The contract changes later, not here.** `getSyncChanges` and `postSyncSnapshot` describe the
  replaced pull and bootstrap; item 13 removes them from `openapi.yaml` and `contract_pending` and
  adds the endpoint that hands a client PowerSync's URL and a token of its own. PowerSync checks a
  token's `aud` against the audience it is configured with, and item 9's access token carries no
  `aud` (only `sub`, `sid`, `iat`, `exp` and `client`), so the API's own token is never the one
  PowerSync reads. Item 14 decides the fate of `postSyncDigest`, `postSyncReset`, `getSyncState`
  and `…/stream`, whose frames carry entitlement and access changes as well as Chat's payloads.
- **`sync_changes` has no reader**, and neither has the `seq` the push's response carries. Item 4's
  spine still writes it, under a per-household lock that serialises a household's commits, so its
  monthly partitions still have to be made while it does. Item 14 either names a consumer or stops
  the write and drops the table through an expand/contract migration, recording the choice in a new
  ADR (ADR 0006 is accepted, so it is not rewritten) and amending PRD 03 §2.2, 07 §1, CLAUDE.md
  and the push's response, and PRD 01 §3 and §10's check 4 if the write stops.
- **The tenant middleware is not on the read path.** It resolves the entitlement state on every
  request, and PRD 04 §3 gives a `suspended` household no sync at all. The credentials and the
  streams hold that instead, which item 18 adds.
- **D-85's digest is partly the engine's now.** PowerSync verifies each bucket's checksum at every
  checkpoint and downloads it again on a mismatch. That holds a replica to PowerSync's buckets, not
  the buckets to PostgreSQL: a replication fault, or a generated stream that disagrees with an
  entity's declared access, passes every checksum. A digest computed from PostgreSQL still sees
  that, and item 14 decides whether its endpoint stays for it. A local write the server never took
  is not such a case: PowerSync drops it at the next checkpoint, as it dropped the spike's rejected
  Butter.
- **Operations gain a service and a replication slot.** A slot retains write-ahead log while
  PowerSync is down, so its lag is monitored and `max_slot_wal_keep_size` bounds it (a runbook in
  item 13), and it has to survive a failover of the database. A dev compose file gains
  `wal_level=logical`, and each replicated table is set to `REPLICA IDENTITY FULL`, as the spike ran
  them. PostgreSQL lets only a role that holds `REPLICATION` and `BYPASSRLS` grant them (ADR 0004),
  so the production provider chosen in item 88 must allow it; items 30 and 88 deploy the service.
  PowerSync's deployment guidance caps one API process at 200 concurrent client connections and
  recommends 100, so the service scales out with connected devices. PRD 07 §1's Year-3 connection
  target names only the socket (40 000), so item 14 restates it for PowerSync when it decides the
  socket's fate, and item 90 measures the service against it. It is also a dependency that can fail
  on its own, so item 13 defines its failure behaviour (PRD 07 FR-NF3) and item 89 tests it.
- **Removing a member from an audience rewrites every row of that audience**, to take the member
  out of each row's readers, and removal from the household does so for every audience they were
  in. The rewrite is not an edit of the row: item 4's `touch_entity` bumps `version` on every
  update, which would turn each queued or `If-Match` edit to a row of the audience into a conflict
  or a preserved loser, so item 14 keeps the readers out of the version, a change to ADR 0006's
  trigger that a new ADR records and PRD 01 §3 already notes, or in a table of their own, which the
  probes accepted only alone: never beside the grant's subquery, and against a table the spike
  never created. A household's conversations are small enough that this is cheap. A
  `member_shared` calendar's audience is every event of the calendar, which can be many more rows;
  it has no floor, so item 14 may resolve it through the calendar's member list in the stream
  instead, which the probes accepted though never beside the grant's subquery. Item 90's load tests
  measure whichever remains.
- **A private row's owner holds its redacted form as well**, in a separate table. The client never
  shows it where the full row exists; nothing leaks, since the owner may see the full row anyway.
  Item 14 declares each projection as the column list its stream selects, in place of the `Redact`
  function ADR 0006 gave `sync.Entity` and the redacted feed rows it left to item 14.
- **The licence** permits this use, and each release becomes Apache-2.0 two years after it ships.
  A later release under different terms can be declined: the pinned version keeps working.
- **What would make this worth revisiting**: gate G-C failing on PowerSync, whose fallback is now to
  build PRD 03 §2's engine (the schema half and the write half carry over, which is D-82's point);
  a module whose access the stream language cannot express; a change in PowerSync's licence or
  maintenance.
- **Not verified by the spike**: a restart, since offline was `disconnect()` on a database left
  open, so a queue that survives the app being killed rests on the SDK's persistence until item 15
  tests it; tokens signed EdDSA and read from a JWKS (the spike signed HS256); the per-household
  subscription parameter, which the probes compiled and no scenario ran; scenario 16 as PRD 10 §4
  states it, with the member offline when removed; the replicated tables without `REPLICA IDENTITY
  FULL`; the React Native SDK on a device (gate G-C does that on two phones), the web SDK, and
  bucket storage at a real household's volume (item 90).
