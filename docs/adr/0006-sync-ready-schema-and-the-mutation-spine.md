# 0006 — The sync-ready schema is enforced, and every write goes through one spine

- **Status:** Accepted
- **Date:** 2026-09-27
- **Plan item:** 4
- **Decides for:** PRD 01 §3 (data-model conventions, the two things every mutation does), §6
  (concurrency, idempotency), §10 tests 4, 5 and 9; PRD 03 §1 (FR-AU1–FR-AU5), §2.2 (the change
  feed, FR-SY1), §2.5 (merge policy); PRD 10 §1, §3; D-22–D-24, D-82, D-84, D-88, D-91, D-92;
  future/ai-assistant ("What 1.0 must not do")

## Context

PRD 01 §3 lists the base columns of every household row and says every mutation writes an audit
event and a sync change in its own transaction; PRD 03 describes the audit event, the change feed
and the merge policies; PRD 10 §1 makes the schema half the one that must be right before any
module exists (D-82), enforced by architecture tests. None of them says:

1. **How a module gets the base columns right**, and how a test knows it did.
2. **What an entity's registration holds**, beyond "a merge policy and an access predicate", or
   where it lives: PRD 01 §4 names a `platform/sync` catalog.
3. **How a change feed ordered by `seq` stays safe to pull.** `seq` is drawn when a row is
   inserted and becomes visible when its transaction commits, and the two orders differ between
   concurrent transactions: a pull that reads seq 101 before seq 100 commits steps past 100 for
   good.
4. **How "a mutating route that does not write an audit event or a sync change" fails the build.**
   Routes cannot be exercised generically: there is no valid body for an arbitrary operation.
5. **How the feed is partitioned** (the plan says monthly) given that a partitioned table's primary
   key must hold its partition key, and PRD 03 §2.2 makes `seq` the key.
6. **What `Idempotency-Key` answers** to a repeat that arrives while the first request runs, to a
   key reused for another request, and to a key whose first request was refused; and how a key and
   its effect stay consistent when a process dies between them.
7. **How architecture test 9 finds "a create schema for a registered sync entity"** in the contract.

## Decision

- **Base columns are a migration helper and a Go type.** A module's migration declares `id uuid
  PRIMARY KEY` and `household_id`, then calls `add_entity_columns(table)`, which refuses a table
  without those two and adds `version bigint NOT NULL DEFAULT 1`, `created_by`/`updated_by`
  (defaulting to `app_user_id()`, referencing `users`, whose rows are never deleted),
  `created_at`/`updated_at` and `deleted_at`, and a `touch_entity` trigger that grows the version
  by one on every update, sets `updated_by`/`updated_at`, and keeps `created_*` as they were. The
  version is the ETag and the change's `row_version`, so a module that forgot to bump it would
  publish a change no replica could order; the trigger makes forgetting impossible.
  `entity.Base` is the Go side, with `entity.Columns` for a SELECT list.
- **The entity registry is `sync.Entity`, declared through `module.SyncSource`.** Each entity
  names itself `<module>.<entity>` and its table, and declares its merge policy (one of five), its
  `state_set` key and resolution exactly when the policy is `state_set`, any `additive`
  cross-row invariant (a rule, the series, the order and the field, so a client can pre-check),
  its access as a set of axes of which the module grant is always one (a zero set is an entity that
  declared nothing), its redacted projection as a function, allowed only on an entity whose rows
  can be private (D-88), its offline-write flag (D-84), and the operationIds of its REST creates.
  `sync.Violations` is the check: the registry refuses a module whose entities fail it at startup,
  and architecture test 5 names every failure, then reads each entity's table from the catalog and
  fails a missing base column, a wrong type, a key that is not `id` alone, and a missing trigger.
  The registry also refuses an audit action that is not `<module>.<action>`, is declared twice or
  has no summary key.
- **The feed is `sync_changes`, partitioned by month on `occurred_at`**, with a default partition
  so that a month whose partition the maintenance has not made yet delays compaction instead of
  refusing every mutation. Its key is `(household_id, seq, occurred_at)`: `seq` is unique by
  construction, the key must hold the partition key, and the key is also the `(household_id,
  seq)` index a pull scans; the retraction index is the partial one PRD 03 §2.2 names. Checks hold
  the shape of a change: a retraction and only a retraction has a recipient and no version, an
  upsert and only an upsert has a payload, a private or redacted row has an owner, the entity is
  the module's. `sync_changes_add_partitions(months_ahead)` makes the partitions, each held to the
  tenant isolation and stripped of the request role's privileges, since PostgreSQL applies neither
  a parent's policies nor its privileges to a partition queried directly; architecture test 2 now
  fails a partition the request role can reach. The request role appends and reads, never updates
  or deletes.
- **A household's changes commit in `seq` order.** `sync.Emit` takes a transaction-scoped
  advisory lock on the household before inserting, so a household's transactions draw their seqs
  and commit one at a time, and a pull that has read seq N has missed nothing below it. The lock is
  taken after the mutation's own writes, the idempotency key's commit and the audit event, and
  held only for the feed inserts and the commit: a row lock taken under it could be one that
  another mutation of the household holds while it waits for the lock, as a member's removal
  holds their keys, and the two would deadlock. The feed is pulled per household, so a global
  order is not needed.
- **The audit spine** is `audit_events`, keyed `(household_id, id)`, and `audit_changes`, one row
  per field with its old and new JSON. `actor_type` is an enum, extensible with `ALTER TYPE`
  (future/ai-assistant). The summary is a key and arguments (FR-AU3). `meta` carries `via` and the
  request id, which only the platform writes. The request role cannot update or delete either
  table (FR-AU5); erasure deletes them with the household, through the cascade. `actor_label` is
  NULL until accounts have names (item 8).
- **`mutation.Apply` is the only write.** It opens a read-write transaction of the household
  (`tenant.InWriteTx`), runs the mutation, and records what the mutation reports — an
  `audit.Event` and one `sync.Change` per row — then commits. The actor is the caller in the tenant
  scope. It refuses an action the event's module does not declare, a change of an entity no module
  declares or another module's, a change the entity's access does not admit, and a private change
  in an event that is not private to the same owner, which the activity log would otherwise show
  everyone unredacted (FR-AU4). Apply commits only what it records: a mutation that reports
  nothing, a request for a change already in place, is rolled back whatever it did, and Apply
  answers it with a zero result. A write a mutation forgot to report is undone rather than
  committed without its history, and a mutation that found its state in place is never taken for
  one that wrote, however it looked: a read, a row lock, an upsert whose update did not apply or
  that lost a race for its key (two members checking one shopping item), an insert its savepoint
  undid. One that reports an event without a change, or the reverse, is refused. The module
  registry and how the change arrived (`via`) travel in the context: the router carries the
  registry into every household-scoped request, and the front door that lets a request in says
  how it arrived (`mutation.WithVia`).
- **Test 4 is held three times.** `tenant.InTx`, through which a handler reads, is now read-only,
  so PostgreSQL refuses a write there. `mutation.Apply` commits only what it records.
  And architecture test 4 parses every module's Go files, tests and testdata included, and fails
  one that names `tenant.InWriteTx`, which only the platform may call, or dot-imports the tenant
  package. The first two are proven by the probe and the spine's own tests.
- **ETag and If-Match** live in `platform/etag`: a version is the entity-tag `"42"`, and
  `IfMatch` compares strongly, as RFC 9110 requires of `If-Match`, so a weak tag, a tag this server
  could not have issued and a list match nothing and the write is refused as a conflict rather
  than applied; `*` matches any version, as RFC 9110 defines it. `problem.Conflict` is the `409
  version_conflict` with the current representation, its version, and the ETag, which a problem
  now carries in `Problem.Header`.
- **`Idempotency-Key` is claimed, committed and completed.** The middleware, behind the tenant
  middleware and the module's gate, claims the caller's key (`in_flight`) before the handler runs;
  `mutation.Apply` marks it `committed` in the transaction that commits the effect; the middleware
  then stores the 2xx response (`completed`). A repeat of a `completed` key gets the stored status,
  representation headers and body; of an `in_flight` or `committed` key, `409
  idempotency_in_progress`; of a key used for another request (method, path, query, `If-Match`,
  media type and a JSON body, or an upload's length), `422` naming `header:Idempotency-Key`. A
  claim past a five-minute lease is taken for one whose request ended without committing its
  effect, and a repeat takes it over; the request it was taken from, should it still be running,
  can no longer commit, and answers `409 idempotency_in_progress` itself (`ErrClaimLost`, which
  is that problem). The contract says so.
  Only a 2xx is stored: a refusal commits no effect, and a refusal stored for seven days would
  answer a retry after its reason had gone. A request answered otherwise after its effect
  committed, by a second mutation that failed or a handler that failed after its write, leaves
  its key `committed`, and a repeat is answered `409` as for a response that was never stored. A
  key is the caller's own, in their household. A JSON body read to fingerprint the request is
  held to the edge's cap on a body, since the middleware also serves requests no operation
  matches, whose bodies the edge does not read.
- **The contract gains `idempotency_in_progress`**, declared in `ProblemCode` and described with
  the other protocol-level answers: any operation that accepts `Idempotency-Key` may answer it,
  whatever `409` it declares for its own conflicts, and the response validation the tests run holds
  it to `Problem` alone.
- **Test 9 reads the operations an entity names among its creates.** Each must be in the contract,
  be a POST or PUT, require a body, and require in it, in every media type, `id` as a UUID (a
  string of format `uuid`) or `ids` as an array of them, directly, through `allOf`, or in every
  branch of a
  `oneOf`/`anyOf`. The schemas an `allOf` combines are read as one: the contract writes a create
  as `allOf` its update schema, which describes `id`, and a schema that only lists it required
  (`HarvestCreate`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A deferred constraint trigger on every entity table that fails a commit with no audit event and change in its transaction | A lookup per written row on the hottest path, and an exemption mechanism for erasure and data migrations, which is a bypass the tests would then have to police |
| Static call-graph analysis for test 4, from each mutating route to the spine | A new dependency (`x/tools`), and it misses writes reached dynamically; a read-only `InTx` makes the wrong path fail every time it runs instead |
| Refuse a mutation that reports nothing when it wrote, told by whether its transaction has an id (`pg_current_xact_id_if_assigned()`) or by PostgreSQL's per-transaction row counts (`pg_stat_get_xact_tuples_*`) | Both count what never commits: a row lock assigns a transaction id, and the counts include a row a rolled-back savepoint undid and the row an upsert withdraws when it loses a race for its key. A mutation that found its state in place, two members checking one shopping item among them, would be answered 500. Rolling back whatever a mutation that reports nothing did needs no such guess |
| Handlers keep a read-write `InTx` and the spine is one option among others | A write through `InTx` would commit with no history and no change, and nothing but review would catch it |
| No feed lock; a pull withholds rows whose transactions may still be in flight, by transaction-id snapshot | Every pull reasons about concurrent transactions, and `seq` order still differs from commit order; the lock costs a household's writers a serialised commit |
| Partitions by `seq` range, keeping `seq` alone as the key | The range a month fills depends on every household's write volume, so partitions would be sized by guesswork, and compaction by age would have to read each partition's newest row; a month's partition is dropped whole |
| No default partition | A lapse in partition maintenance would refuse every mutation of every household |
| Store the response after the handler with no `committed` marker, as common middleware does | A process that dies between the effect's commit and the store leaves an `in_flight` claim that a repeat takes over after the lease, and repeats the effect |
| Store every response, refusals included | A `402` replayed after the payment, a `404` after the grant came back, for seven days |
| One key namespace per household | A member could be answered with another member's response by reusing their key |
| A default `via` when the front door says nothing | It would hide the front door that forgot, and write a false answer to "was it my phone or the importer?" |
| Test 9 as a sweep of every household-scoped `201`, with an exemption list | Ten operations in today's contract do not conform, most of them uploads or actions that create no entity with a client id; the registry says which operations create which entity, and PRD 01 §10 reads the two together |

## Consequences

- A module's table calls `add_entity_columns` and `enable_tenant_isolation`; its entities are
  declared through `SyncSource`; its handlers read through `tenant.InTx`, write through
  `mutation.Apply`, answer with `etag.Set`, and compare `etag.IfMatch` before a conditional write,
  answering `problem.Conflict` on a mismatch.
- Items 8, 9 and 13 set `via` (`web`, `mobile`, `sync`) where they let a request in, and item 8
  fills `actor_label`; until then a mutation outside the tests fails with `ErrNoVia`, loudly.
- Item 17's partition maintenance moves any rows that reached the default partition into their
  month's partition before creating it, which PostgreSQL otherwise refuses, and adds D-88's
  redacted rows to the spine from each entity's `Redact`.
- Item 15's expiry sweep deletes `idempotency_keys` past seven days (PRD 03 §5).
- A key whose effect committed but whose response was never stored, because the process died
  between the two, the response was larger than the 1 MiB a key keeps, or the request was
  answered other than `2xx` after its effect committed, answers `409` until it expires: running it
  again would repeat the effect, the one thing the key exists to prevent. The contract says so. An
  upload that takes longer than the lease to arrive, which item 14 lets take fifteen minutes, keeps
  its claim until a repeat takes it over, and item 14 renews none: a client sends the repeat once it
  has given up on the first, which, if it is still arriving, can then no longer commit
  (`ErrClaimLost`), and the repeat's upload is the one that lands
  ([ADR 0015](0015-files-object-storage-the-meter-and-pictures.md)).
- The Idempotency-Key middleware is mounted on module routes. A household-scoped route outside a
  module (item 10's members, invitations and grants) mounts it as well. A route outside any
  household (`/auth`, `/me`, creating a household) has no household to hold its key in, since a
  key belongs to a membership; the first item that builds one (8) decides where its keys live.
- A household's mutations serialise at their commit. Revisit if a household's write rate ever
  makes that visible (item 90).
- Three creates in today's contract accept a client id without requiring it (plan Q11); test 9
  fails each once its entity names it.
