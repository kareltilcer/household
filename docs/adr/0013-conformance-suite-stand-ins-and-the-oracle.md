# 0013 — The conformance suite drives PowerSync clients against stand-ins of its own, judges every replica against its own statement of the access predicate, and waits for each engine item to switch its scenarios on

- **Status:** Accepted
- **Date:** 2026-09-29
- **Plan item:** 12
- **Decides for:** [10-sync-risk](../prd/10-sync-risk.md) §4 (the scenarios, the invariants and the
  fuzzer, under D-93); plan items 13, 14, 15 and 18's use of the suite; [ADR 0001](0001-sync-engine.md)'s
  harness, stand-ins and connector

## Context

PRD 10 §4 asks for an executable falsifier before the engine: eighteen scenarios with six invariants
checked after each, and a fuzzer over the same invariants. D-93 turned it from an in-process simulator
into a suite that drives PowerSync clients against the real stack, and plan item 12 builds it before
items 13 and 14 build the engine it tests: until they land, it runs against stand-ins of its own, as
the spike's harness did, and its scenarios start skipped. Item 12 must also show the suite can fail,
with a connector and a stream broken on purpose.

Seven questions were left:

1. **Where the suite and its stack live.** The repository's compose PostgreSQL runs without
   `wal_level=logical` and serves the Go tests; PowerSync's deployment is item 13's.
2. **What the scenarios write.** No feature module exists before item 30's `proof` and item 31's
   Shopping, and items 13 and 14 must pass scenarios before either.
3. **What the stand-ins are, and how the engine replaces them** without the scenarios being rewritten.
4. **What a replica is judged against.** Two replicas that agree with each other, or with the
   server's whole table, pass a stream that leaks.
5. **How a mutation carries what a row write does not**: its id, its client time, its base version
   and any action (ADR 0001).
6. **How the invariants read under D-93**, where a client holds no feed cursor and a replica is one
   member's view of one household.
7. **How a scenario waits for the engine**, and who switches it on.

## Decision

**The suite is `packages/sync/conformance`, beside the client library item 15 builds, with a stack of
its own.** `conformance/stack/docker-compose.yml` runs the repository's PostgreSQL image with
`wal_level=logical` and PowerSync, pinned, on ports of their own; `conformance:up` prepares the
database as a deploy does (`household-api bootstrap` and `migrate`), then the suite's part
(`conformance-standin setup`), then starts PowerSync once its role, publication and storage exist. The
workspace guard holds the stack's PostgreSQL image to the development one and PowerSync to a release.
`pnpm test` runs the harness's unit tests, which need no stack; `conformance` runs the suite; CI runs
both on every change, and a nightly workflow runs a long fuzz run.

**The scenarios write a test module of the suite's own, `conformance`** (`server/internal/conformance`,
migration block 98, never among the modules the server serves): one entity for each shape a scenario
needs, across all five merge policies, a `state_set` keyed on one field and one keyed on two, an
`additive` series with a `non_decreasing` invariant, a private entity with a redacted projection, an
audience whose messages keep their readers on the row, and an attachment's row. Its id is in the
suite's database's `modules` alone.

**The stand-ins are a Go command, `conformance-standin`, and a hand-written sync configuration**, each
behind the `Target` a scenario runs against (`harness/target.ts`):

- a sign-in that names the caller and signs the stand-in's own HS256 token, whose lifetime a test sets
  to see its connector renew a refused credential;
- credentials that hand a household's member PowerSync's URL and an HS256 token PowerSync verifies with
  a test key, carrying the audience PowerSync checks, which the stand-in's own API refuses;
- a push at the contract's path, validated at the edge against the committed contract, behind the real
  tenant middleware and the household's Idempotency-Key, writing through `mutation.Apply`: the
  conformance module's items (`lww_field`, a soft delete a field like the others) and their checks
  (`state_set` on the item, the latest client time winning, clamped to a day and flagged), each
  mutation in its own transaction and answered in order, one after a failure to write what it depends
  on `deferred`;
- PowerSync's replication role (`REPLICATION`, `BYPASSRLS`, reading the published tables and no other),
  the `powersync` publication at `REPLICA IDENTITY FULL`, and a database of its own for its buckets;
- streams over the items and their checks with the household as the subscription's parameter (D-4),
  and one stream broken on purpose that only the negative control subscribes to.

The access changes a scenario makes (a grant, a module switch, a removal, an audience, a note made
private) are the administrator's, written as the spike wrote them: the conformance module is not among
the contract's `ModuleKeyValue`, so item 10's routes cannot grant it, and a stream reads the tables
they write whichever path wrote them.

**Every replica is judged against the suite's own statement of the access predicate**
(`Admin.visible`): the rows of its household that its member may see, computed from PostgreSQL as the
administrator, never read from a stream. A row a replica holds and may not is `retraction`, or
`isolation` when it is another household's; a row it lacks or holds otherwise is `convergence`. So a
stream that disagrees with the entities' declared access is caught, which two replicas compared with
each other would not show.

**A write records its mutation as PowerSync's row metadata**: each table a client writes tracks
metadata (`trackMetadata`), and every write sets `_metadata` to its mutation id, its client time, its
base version and any action or key field, which the queued write carries to the connector, a delete
included (`_deleted`). The suite's connector (`harness/connector.ts`) follows ADR 0001's rules and
keeps its answers other than `applied`, and its held mutations, in local-only tables.

**Under D-93 the invariants read as follows** (`harness/invariants.ts`), each returning what it finds
rather than throwing, so that a negative control can assert which one failed:

1. Convergence: each replica equals the rows its member may see, field for field, compared in one
   canonical form (a replica's `0`/`1` a boolean, its timestamps instants, a date its text).
2. No acknowledged write is lost: the row an `applied` or `merged` answer names is on the server at the
   version it answered, or later.
3. Idempotency: a batch delivered again, under its own key or, where the target has per-mutation
   idempotency (FR-SY5), under a fresh one, is answered alike and changes nothing.
4. Retraction completeness: no replica holds a row its member may not see.
5. Monotonicity: no bucket's applied op moves backwards. A bucket at op 0 has applied no checkpoint
   since it was made, as one a member's access brought back, or one downloaded again after its
   checksum failed, starts again from nothing; the long fuzz run found the first case.
6. Terminality: every mutation a client wrote ends in exactly one of applied, merged, conflict and
   rejected, once; none is left queued, held without cause or retried without end; every outcome but
   `applied` carries a code; every answer is the contract's.

**A scenario waits for the engine it tests.** Each names the item that switches it on (13, 14 or 18),
the entities its target's push must write, the tables its streams must replicate, and any capability
beyond them (`compact`, `setEntitlement`, `uploadAttachment`). It is skipped until its key is in
`scenarios/index.ts`'s `enabled`; one switched on that its target cannot run fails rather than
skipping. Scenario 13 is two keys, `13` (the completion, item 13's half) and `13-rotation` (item
14's), and the five causes of access loss item 14 proves, with the lapse that is not one (item 18),
are keys of their own. `CONFORMANCE_SCENARIOS=all` runs every scenario the target can, for the item
building its engine.

**The harness proves itself against the stand-ins now**: clients through partitions both ways, a lost
answer retried under its key, duplicate delivery, a clock two days out, a grant revoked offline, each
access loss the stand-in streams express, a member of two households, a refused credential and a
refusal the edge locates; and it fails a connector that retries a rejection forever (`terminality`)
and a stream that leaks another household's rows (`isolation`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Scenarios green against the stand-ins now**, the stand-in push building every merge policy | It would be item 13 and 14's push written twice, once to throw away; a scenario green against a stand-in says nothing of the engine. The stand-in writes what the harness's own proof needs, and the scenarios wait. Forced on, the thirteen the stand-in can run pass but scenario 2, whose `merged` answer is item 14's, which shows they are runnable |
| **Judging replicas against each other, or against the server's whole table** | Two replicas fed by the same leaking stream agree with each other, and a replica holding another household's rows still holds every row of its own. Only the predicate, stated apart from the streams, catches a stream that disagrees with it |
| **The suite's stack in the repository's compose file** | Its PostgreSQL would run with logical replication under every developer's Go tests, and PowerSync's deployment, credentials and configuration there are item 13's. Item 13 may move the suite onto what it deploys |
| **Access changes through item 10's routes** | The routes grant only the contract's modules, and the suite's module is not one; adding it to `ModuleKeyValue` would put a test module in the contract |
| **Mutation metadata in a side table keyed by the queue's row id** | The id is known only after the write, and the queue and the side table would have to be kept in step; PowerSync's `_metadata` rides on the queued write itself |
| **A second PowerSync for the broken stream** | It would double the stack and hold a second replication slot; a stream no client subscribes to unless told to is as broken and costs nothing |

## Consequences

- **Item 13 moves the suite onto the engine**: the conformance module registered in the API the suite
  runs against, its streams generated with every other entity's, the stand-in's push, token and
  configuration replaced, an engine `Target` beside `standIn` (its tombstones kept, its replay by fresh
  key), and scenarios 1, 3, 4, 5, 8, 9, 10, 13, 15 and 17 switched on. The contract caps a batch at 500
  mutations with `maxItems`, so the edge answers a larger one `422` before the `413` the operation
  declares: item 13 settles which, and the connector handles both.
- **Item 14** switches on 2, 6, 7, 11, 12, `13-rotation`, 16, 18 and the five `loss-*` cases, with the
  target's `compact` and `uploadAttachment` (item 16's upload). Scenario 2 reads *the loser is surfaced*
  as the later write answered `merged`, carrying the row, since the earlier write was answered before
  the later one existed; item 14 confirms that or rewrites the scenario. Its readers and visibility
  rewrites replace the administrator's in `Admin`.
- **Item 18** switches on 14 and `no-loss-lapse`, with the target's `setEntitlement`. A mutation's
  entitlement code is spelled `entitlement` in PRD 10 §4 and `entitlement_read_only` among the problem
  codes; the connector holds either, and item 18 settles which the push sends.
- **Item 15's connector replaces the suite's**, and may take its `_metadata` convention; the suite's
  unit tests are the connector's behaviour as ADR 0001 states it.
- **The fuzzer's schedule is the seed's, not PowerSync's timing**: a failing seed replays what the
  clients did and when, and may interleave differently with replication.
- **The stand-in serves a route at the contract's path outside the server's router**, which
  architecture test 6 does not see: it is never deployed, and item 13's route replaces it.
