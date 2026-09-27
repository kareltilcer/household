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
server's own packages, so every write went through the tenant middleware, `grant.Require` and
`mutation.Apply`, and wrote its row, its audit event and its feed change in one transaction. The
harness, the configurations and the full results are in the commit that adds `spikes/sync-engine`
(fbfdec0); the directory was deleted before merge.

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

Times are to the harness's first 100 ms poll that saw the state, so "about 100 ms" means "by the
first look".

| Case | PowerSync | Electric |
|---|---|---|
| **Scenario 3.** Petr and Eva check Milk offline, one second apart, then reconnect | Both replicas equal the server 243 ms after reconnecting. The server holds one check (version 1 → 2), one audit event, one feed change; the outcomes were one `applied` and one `applied` no-op; no conflict | The same on the server. The outbox, the optimistic view and their persistence are ours: Electric replicates reads only |
| **Scenario 7.** Offline, Petr checks Bread and adds Butter; his grant is lowered to `none`; he reconnects | The replica is empty by the first look (104 ms), the optimistic Butter included. Both writes came back `rejected` / `not_found` once and were not retried; the server wrote nothing | With the grant checked in our proxy, the proxy answers `404` and nothing clears the replica unless our client treats the `404` as "delete what you hold". With the grant as subqueries in the shape, Electric sends a `move-out` event and **its own `Shape` class ignores it: all three rows stay** (3 failures). A replica of ours that applies its positional tag protocol empties by the first look |
| **Access loss while connected** | Rows deleted by the first look for each cause the spike could make: grant to `none`, module disabled household-wide (for a member and the owner), removal from the household, soft delete; rows back when the grant returns | As above: correct only with our own tag-aware replica |
| **Visibility and audience** (below), including scenarios 16 and 18 | 7 of 7, through two workarounds | Expressible, with the caller's ids and floor as constants the proxy writes |

The totals are PowerSync 26 of 26; Electric 15 of 15 with the proxy gate, 16 of 19 with subqueries
and its own `Shape`, 19 of 19 with a tag-aware replica. Both candidates accepted item 4's schema as
it is. Every scenario ran on a fresh household in a database holding every earlier scenario's
households, and no replica received another household's row.

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
| Does access loss propagate as deletion? | Yes, for every cause tried, with no client code | Only with a client that implements its tag protocol, which its own client does not |
| Do writes go through our own API? | Yes, through a connector of about forty lines | Yes, because there is no write path: queue, persistence and optimistic state are ours |
| How good is the React Native story? | Maintained SDK on op-sqlite, dev build; web and Node SDKs from the same core | Pre-1.0 persistence adapters |
| Can it be self-hosted in the EU? | Yes, once telemetry sharing is turned off | Yes |

## Decision

**Adopt PowerSync, self-hosted, as the read half of the sync engine. The write half stays
Household's.** Recorded in the PRD as **D-93**.

- **What PowerSync does.** It replicates from PostgreSQL's write-ahead log into per-member buckets,
  holds the client replica in SQLite (op-sqlite on React Native, wa-sqlite on the web,
  better-sqlite3 in Node tests), moves each client from checkpoint to checkpoint with per-bucket
  checksums, and deletes from the client any row that leaves every bucket it holds. The service is
  the Open Edition, its image pinned, its bucket storage a PostgreSQL database of its own, and its
  telemetry sharing off.
- **What stays ours.** The client's upload queue is PowerSync's, persisted in the replica, but the
  connector that drains it is ours. It posts each queued transaction to `POST …/sync/mutations`,
  where every mutation goes through `mutation.Apply` and is answered with PRD 03 §2.4's outcome
  and a code. The connector completes every mutation the server answered, whatever the answer, and
  records any outcome but `applied` in a local-only table that the conflict inbox and the
  sync-health screen read. It throws, and so retries, only on a transport failure or a `5xx`:
  PowerSync applies no checkpoint while the queue holds anything, so a connector that retried a
  refusal would freeze the replica. Merge policies, idempotency, clock clamping and the offline
  write flags are unchanged.
- **The access predicate becomes stream definitions generated from the entity registry**, never
  written by hand, so the check still lives in one place (the reasoning behind D-22):
  - the grant as its two arms, per household as a subscription parameter (D-4);
  - a private row by `owner_id = auth.user_id()`, and an entity's redacted projection as a column
    list into a client table of its own, which reaches the owner as well;
  - an audience's floor through a reader set the server keeps on each row: the members whose floor
    the row is at or above, written by the mutation that writes the row and rewritten by the one
    that changes the audience.
- **Retraction** (FR-SY7) is a row leaving a member's buckets. There are no `retract` rows.
- **The tenant boundary on the read path is the generated streams.** PowerSync's replication role
  holds `REPLICATION` and `BYPASSRLS`: every tenant table forces row-level security, and the
  engine sets no tenant, so without `BYPASSRLS` it reads nothing. An isolation test, the read-path
  twin of FR-NF4, connects a replica for one household's member and asserts that none of another
  household's rows arrive.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Build PRD 03 §2's engine**: the feed pull, the snapshot, the digest, the realtime nudge, and a TypeScript client with two storage adapters (plan items 12–15 as first written: sizes L, XL, XL and L) | The spike's hardest cases, retraction for every cause and a replica that survives a restart with its queue, came from PowerSync with no client code but the connector, on item 4's schema, with writes still through the spine. Building keeps two things adoption gives up: row-level security under the read path, and the floor as one term of the predicate. Each has a replacement that a test holds (above), and neither is worth four items of the riskiest work in the programme |
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
  adds the endpoint that hands a client PowerSync's URL and token. Item 14 decides the fate of
  `postSyncDigest`, `postSyncReset`, `getSyncState` and `…/stream`.
- **`sync_changes` has no reader.** Item 4's spine still writes it, under a per-household lock that
  serialises a household's commits. Item 14 either names a consumer or stops the write and drops
  the table through an expand/contract migration, amending ADR 0006 and CLAUDE.md.
- **D-85's digest is partly the engine's now.** PowerSync verifies each bucket's checksum at every
  checkpoint and downloads it again on a mismatch. That catches divergence inside the engine, but
  not a local write our connector never uploaded; item 14 decides whether the digest endpoint
  stays for that.
- **Operations gain a service and a replication slot.** A slot retains write-ahead log while
  PowerSync is down, so its lag is monitored and `max_slot_wal_keep_size` bounds it (a runbook in
  item 13). A dev compose file gains `wal_level=logical`.
- **Removing a member from an audience rewrites every row of that audience**, to take the member
  out of each row's readers. A household's conversations are small enough that this is cheap;
  item 90's load tests measure it.
- **A private row's owner holds its redacted form as well**, in a separate table. The client never
  shows it where the full row exists; nothing leaks, since the owner may see the full row anyway.
- **The licence** permits this use, and each release becomes Apache-2.0 two years after it ships.
  A later release under different terms can be declined: the pinned version keeps working.
- **What would make this worth revisiting**: gate G-C failing on PowerSync, whose fallback is now to
  build PRD 03 §2's engine (the schema half and the write half carry over, which is D-82's point);
  a module whose access the stream language cannot express; a change in PowerSync's licence or
  maintenance.
- **Not verified by the spike**: the React Native SDK on a device (gate G-C does that on two
  phones), the web SDK, and bucket storage at a real household's volume (item 90).
