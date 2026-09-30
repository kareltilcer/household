# 0014 — PowerSync replicates what migrations publish through streams the registry generates, a replica connects with a short EdDSA token the API hands out, and the push writes each mutation through its module's writer, answering it once

- **Status:** Accepted
- **Date:** 2026-09-30
- **Plan item:** 13
- **Decides for:** [PRD 03](../prd/03-platform-strands.md) §2.3–§2.5 and §2.8 under D-93;
  [07 FR-NF3](../prd/07-nonfunctional.md) for PowerSync (D-105); [modules/17 Sync](../prd/modules/17-household-admin.md);
  [ADR 0001](0001-sync-engine.md)'s deployment, credentials, streams and push; [ADR 0013](0013-conformance-suite-stand-ins-and-the-oracle.md)'s
  consequences for item 13

## Context

ADR 0001 adopted PowerSync for the read half of sync and kept the write half; ADR 0013 built the
conformance suite against stand-ins of its own. Plan item 13 deploys the service, generates its
streams from the entity registry, hands a client its credentials, and builds the push, and must pass
PRD 10 §4's scenarios 1, 3, 4, 5, 8, 9, 10, 13 (its `state_set` half), 15 and 17 on the engine.

What had to be settled:

1. **Who publishes a table**, so that a module's table cannot be left out of replication nor a
   table let into it by hand, while PowerSync's role reads past row-level security.
2. **The token PowerSync verifies**, signed with item 9's EdDSA keys, and where PowerSync gets them.
3. **What a stream is**, for each access an entity declares, and what it may send: an invitation's
   token, a household's code and a child's birth year must reach no replica.
4. **Where a mutation's write lives**: the push is the platform's, and what a mutation writes is its
   module's, through the service layer its REST routes use.
5. **Per-mutation idempotency** (FR-SY5): what is kept, under which key, and in which transaction.
6. **The batch ceiling**: the contract capped a batch with `maxItems: 500`, so the edge answered a
   larger one `422` before the `413` the operation declares.
7. **What a client does while PowerSync is down** and the API is not (FR-NF3).
8. **How the suite moves onto the engine** without a second API to keep beside it.

## Decision

**The migrations publish.** A platform migration creates the `powersync` publication, owned by the
migrate role, which owns every table it will name: only a table's owner may add it to a publication,
and a managed database's administrator may not be able to make one `FOR ALL TABLES`, which would
publish the credentials and the sessions besides. It adds `replicate(tbl)`, which a migration calls
on every table a generated stream reads, as it calls `enable_tenant_isolation` on every tenant table:
`REPLICA IDENTITY FULL` (kept as the spike ran every table; the suite has not been run without it),
the table added to the publication, and `SELECT` granted to `household_powersync`, whose
`BYPASSRLS` grants no privilege. `household-api bootstrap` makes that role with `REPLICATION` and
`BYPASSRLS`, and refuses, naming what is missing, under an administrator that cannot give them; it
also prepares PowerSync's bucket storage, a database of its own owned by a role of its own, when its
connection string is named (always in development; elsewhere it may live on a cluster of its own).
**Architecture test 10** holds it: every table a served stream reads is published, at full replica
identity, and readable by the role, which reads no table no stream reads and no entity is kept in;
every column an entity replicates exists; and the committed configurations are the generated ones.

**The streams are generated** (`internal/syncconfig`, `go generate ./cmd/sync-config`, which
`pnpm run gen` runs) from the registry, into `deploy/powersync/sync-config.yaml` for the server and
into the suite's stack for the suite, with a manifest of the suite's streams:

- `Grant` is two streams, an owner of the household while it enables the module and a member whose
  grant on it is above `none` while it does (the compiler takes inner joins only and no `OR` across
  them). A child's ceiling is never below `view`, so a stored grant above `none` is a grant held.
- **`Members`**, a new axis in `sync.Access`, is one stream: every member of the household, whatever
  their grant. Admin's settings, memberships and module enablement declare it; its invitations keep
  `Grant`, on admin (PRD modules/17 Sync).
- The household is the subscription's parameter (D-4), and every table a subquery reads is looked up
  by the caller or by that household, which a test holds, since PowerSync refuses a connection past
  1000 parameter results (`PSYNC_S2305`).
- **`sync.Entity.Columns`** names the columns a stream sends, `id` first; nil is every column.
  Admin's name theirs: a household without its code, a membership without a child's birth year, an
  invitation without its token.
- The tenant root, `households`, is keyed by its own `id`: its `household_id` is a generated column,
  which PostgreSQL 17 leaves out of the changes it streams, so a stream filtering on it would lose
  each row at its first update.
- Soft-deleted rows stay in their streams, tombstones, so that a client tells a row another member
  deleted (it holds the tombstone) from one it lost access to (it leaves its buckets) — item 15's
  withdrawn state.
- An entity whose rows may be private (`Owner`) or an audience's (`Audience`) is not replicated yet:
  item 14 generates its visibility and audience streams, and until then it reaches no replica,
  which withholds it rather than leaking it.

A membership now carries its member's **grants** as the member list shows them (an owner's `manage`
everywhere, a member's or a child's stored level capped at their ceiling), written with the role by
the mutation that changes either, which moves its version: derived capability state on the row, as
PRD modules/17 Sync has it, never an entity of its own. A child profile's row carries whether its PIN
has locked it (`pin_locked`), written by the lock and by its end, beside whether its dashboard is.

**The credentials** are `POST /households/{household_id}/sync/credentials` (`postSyncCredentials`),
behind the authentication and the tenant middleware, for a device's access token and a web session
alike: PowerSync's URL and a token with `sub`, `aud` (`powersync`), `iat` and `exp`, header `typ`
`JWT`, signed EdDSA with `HOUSEHOLD_TOKEN_KEYS`' signing key and named by its thumbprint, lasting
**five minutes**, which bounds how long a revoked device or a removed member keeps syncing on the
connection it holds (FR-ID7). The API's authentication refuses any token with an audience, and
PowerSync any without one, so neither token opens the other's door. No `Idempotency-Key` is kept for
it: a credential is never kept to be answered with. **The keys** are `GET /sync/jwks`
(`getSyncJwks`), public, which PowerSync fetches (`client_auth.jwks_uri`), caches for minutes, and
fetches again at once for a token signed by a key it does not hold, so a key rotated in front of the
others verifies from its first token.

**The push** is `internal/platform/push`. A module whose entities a client writes offline implements
`push.Writer`; the push hands it each mutation inside `mutation.Apply`'s transaction, recording
`via: sync`, once it has checked, in order, the first failure answering it: that its entity syncs
(`validation_failed`); that the caller may contribute to its module (`not_found` without it,
`forbidden` at `view`, as the module's routes answer); that the entity takes offline writes (D-84;
`forbidden`); that no earlier mutation of the batch failed on the row it writes or on a row a field
names by its id (`deferred`, `dependency_failed`); that the entity's policy admits its op (an
`additive` row is only created, and a `state_set` write is never a delete; `validation_failed`); and
that its module writes the entity. An `additive` series' declared invariant is checked generically
before the write, from the entity's declaration, its series serialised by an advisory lock, and a
breach answers `monotonicity_violation` naming the neighbour, as `row` and in the message. The
client's clock is clamped to 24 hours and flagged, and handed to the writer, which keeps it where its
policy resolves by it. `lww_row` and `strict_version` writes, and `merged` and `conflict`, are item
14's.

**Each mutation that ends is answered once** (FR-SY5): its answer is kept in `sync_mutations` for 7
days under its household, **its sender** and its `mutation_id`, with a fingerprint of what it
carries. An answer that commits an effect is kept in the effect's own transaction, so a mutation that
took effect is never run twice however its answer was lost, and a delivery racing another is rolled
back and answered with the other's; an answer that commits none (a refusal, a state already in
place) is kept in its own. A deferred mutation keeps none, and its replay runs it. The same id
carrying another mutation is refused.

**A batch holds at most 500 mutations**: a larger one is refused whole, `413` with the contract's
`batch_too_large`, and `maxItems` is gone from `SyncMutationBatch`, so that the edge no longer answers
it `422`. A device, or a web session, sends at most 60 batches a minute (PRD 02 §9), counted in
memory per instance as the API's other buckets are.

**The suite runs against the engine.** `cmd/conformance-api` serves the server's own API
(`app.Run`, which `household-api serve` now calls too) with the conformance module registered and a
sign-in of the suite's own that signs a new device of a member in, for as long as the test asks up to
an access token's lifetime; the stand-in's push, token and hand-written configuration are gone, and
so is its target, which had nothing left to stand in for. The suite's PowerSync runs the deployed
configuration with the suite's streams, fetching its keys from that API on the host
(`host.docker.internal`, which CI's API listens for on every interface). Its clients subscribe to
every generated stream, admin's included, whose tables the client schema and `Admin.visible` now
declare, so that the read-path isolation test holds admin's rows too.

**While PowerSync is down and the API is not** (D-105): a replica stays readable as it last was and
keeps every local write; queued writes still reach the push, which answers them, so a rejection is
still surfaced; the client says it is not receiving changes, and other members' changes arrive from
the checkpoint it last applied when PowerSync returns. A replication slot that is lost, after a
restore or past `max_slot_wal_keep_size`, makes PowerSync replicate the publication again from a
snapshot; a client whose buckets then disagree downloads them again, and no queued mutation is lost,
since the queue is the device's and the push the API's. The runbook
[replication-slot.md](../runbooks/replication-slot.md) covers the slot.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Bootstrap, as the administrator, keeps the publication's table list** | It would be a list beside the migrations, which a module's migration could forget; and `FOR ALL TABLES` needs a superuser and publishes the account tables too. The migrate role owning the publication lets a module publish a table in the migration that makes it |
| **The JWKS inline in PowerSync's configuration** | A rotated key would need PowerSync's configuration redeployed in step with the API's; fetched, the new key verifies from its first token |
| **The API's own access token for PowerSync** | It carries no audience (D-15), and a token PowerSync accepts must never open the API; web sessions have no access token at all |
| **A generic push that writes rows from the declarations alone** | A module's writes validate, derive and record their own audit events; one service layer serves REST and sync (PRD 01 §3), so the module writes and the platform checks |
| **Answers kept per household, as FR-SY5 words it** | A member sending another's mutation id would be answered with the other's answer, and its row; keyed on the sender too, a member's retry is still answered as it was |
| **`422` from `maxItems`** | The contract already names the refusal, `413` `batch_too_large`; a generated client reads the ceiling from the description |
| **The grants as a stream of `module_grants`** | It is no entity, and PRD modules/17 has the grants travel on the membership, whose version a grant's change moves |
| **The stand-in kept beside the engine** | Its push, token and configuration are replaced; a second API would be kept in step for nothing |
| **Dropping `REPLICA IDENTITY FULL`** | The suite has never run without it, and a stream that filters on a column needs an update's old values to see a row leave its bucket |

## Consequences

- **Item 14** generates the visibility and audience streams for `Owner` and `Audience` entities
  (withheld until then), declares redacted projections as column lists beside `Columns`, answers
  `merged` and `conflict`, and decides the fate of the push's `seq`.
- **Item 15**'s client library needs the served streams' names: it generates them from the registry,
  as the suite's manifest is, or reads them from `deploy/powersync/sync-config.yaml`.
- **Item 18** gates the push and the credentials on the entitlement (PRD 04 §3).
- **Items 30 and 88** deploy PowerSync with credentials of their own, reach the API's JWKS over the
  network they share, and keep the bucket storage under the database's residency and encryption.
  Development on Linux has the API listen where the container reaches it (`.env.example`).
- **Item 89** tests D-105's failure behaviour and the slot's recovery; **item 90** measures the
  service and the per-series lock.
- A member's display name is not replicated: `users` is global, no household's. Items 15 and 25
  decide whether the client needs it offline, and how it reaches the replica if so.
- The push's per-device budget is per instance, as every API bucket is (ADR 0009).
