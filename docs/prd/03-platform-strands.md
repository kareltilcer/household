# 03 — Platform strands

Capabilities owned by the platform, used by every module, imported by none of them. Each
is a package under `internal/platform/`.

## 1. The audit spine

Carried from `home` essentially unchanged. It is the oldest and best-earning decision in the
codebase and nothing about going commercial weakens it.

**FR-AU1 — Every mutation writes an event, in the same transaction as the change.** The write
takes a `*sql.Tx`; a failure to record the event fails the mutation. There is no outbox, no
queue and no eventual consistency between the data and its history.

**Event shape**

| Field | Notes |
|---|---|
| `id` | UUIDv7 |
| `household_id` | Tenant |
| `occurred_at` | `timestamptz` |
| `actor_type` | `user` · `system` · `service` |
| `actor_id`, `actor_label` | Denormalised label so the log renders after a member leaves |
| `module`, `action` | e.g. `garden`, `planting.create` — the qualified key is `garden.planting.create` |
| `entity_type`, `entity_id` | For the entity timeline |
| `level` | `info` · `notice` · `warn` |
| `summary_key` + `summary_args` | **Changed for Household**: a translation key and its arguments, not a rendered Czech sentence |
| `visibility`, `owner_id` | For redaction on read |
| `meta` | `jsonb` — `via` (`web`/`mobile`/`sync`/`system`), request id, and module-specific context |

**FR-AU2 — Field-level diffs** for entities where "who changed what to what" is the question the
log exists to answer: every money-bearing row, every tariff, every permission change, every
membership change, and the entities each module nominates.

**FR-AU3 — Summaries are keys, not sentences.** `home` stored a rendered Czech string. Household
stores `summary_key` and a JSON argument object and renders at read time in the *reader's*
language. Two members of the same household reading the same event in different languages both
read it correctly, and adding a language does not require re-rendering history. **D-21.**

**FR-AU4 — Redaction happens on read**, in one function, for private items whose owner is not
the reader: the summary becomes a fixed generic key, the entity id is dropped, and the diff
comes back empty. Full-text search over the log has a **second, stricter rule** — private events
are excluded from `q=` matching entirely for a non-owner, because a redacted hit still confirms
that the search term occurs in a private title. Two rules, deliberately, because one rule leaks.
Carried from `home` v9.

**FR-AU5 — Retention.** Audit events are retained for the life of the household. They are part
of the export and they are deleted by erasure. They are not prunable by the household, because
an audit log a member can quietly edit is not one.

## 2. The sync engine

**The largest single piece of new platform work in Household, and the one that must exist before
any module is built on top of it.** Retrofitting offline-first onto a data model that did not
plan for it is a rewrite; planning for it costs four columns and a discipline.

> **The mitigation plan for this risk is [10-sync-risk.md](10-sync-risk.md)** — schema before
> engine, buy before build, offline writes tiered by merge policy, a conformance suite written
> before the engine, production replica digests, and three gates with a named fallback. Read it
> alongside this section; this one is the design, that one is how not to get it wrong.

> **The engine is PowerSync, self-hosted, and the write path is ours (D-93,
> [ADR 0001](../adr/0001-sync-engine.md)).** What this section asks of sync stands: the promises
> (§2.1), the push and its per-mutation outcomes (§2.4), the merge policies (§2.5), what counts as
> access loss and that it deletes (§2.6), attachments (§2.7) and clocks (§2.8). What changes is how
> the read half is delivered. PowerSync replicates from the write-ahead log into buckets its
> streams define, so the pull, the snapshot, the horizon's `410` and the `retract` rows of
> §2.2–§2.3 and FR-SY7 are its checkpoints and buckets, and a retraction is a row leaving every
> bucket a member holds. §2.3's predicate is stream definitions generated from the entity registry:
> the floor is a reader set kept on each row rather than a term, and a redacted projection reaches
> its owner as well, in a table of its own. Where §2.2–§2.3 describe the feed's own mechanics, they
> describe the design D-93 replaced, which gate G-C's fallback would build: the spine writes no feed
> (**D-121**), and FR-SY7 states retraction as plan item 17 built it
> ([ADR 0018](../adr/0018-sync-engine-ii-versions-visibility-audiences-and-the-feed.md)).

### 2.1 What is promised

| Promise | Meaning |
|---|---|
| **Reads work offline** | Every module a member has been granted, fully readable with no network |
| **Writes work offline** | Creates, edits, deletes and completions are accepted locally and applied later |
| **Nothing is lost** | A queued mutation survives app kill, device restart and days offline |
| **Convergence** | Two devices that have both stopped changing converge on the same state |
| **Honesty** | The client always shows whether what you are looking at is synced, pending or rejected — it never pretends |

**Not promised:** real-time collaborative editing, operational transforms, or conflict-free
merge of rich text. Note bodies remain last-write-wins with the loser preserved, exactly as in
`home`.

### 2.2 The change feed

> **Under D-93 the spine writes no feed (D-121, plan item 17).** Every mutation still reports a
> change for each row it writes, which the spine checks against the row's entity, with the audit
> event beside it, in the mutation's transaction (FR-SY1); `sync_changes` is no longer written, nor
> its household lock taken, and the push's answer carries no `seq`. The table stays until gate G-C
> passes, when plan item 34 drops it; should G-C fail, its fallback writes it again. What follows
> describes the feed that fallback would build.

One append-only table per deployment, keyed by household, ordered by a monotonic sequence.

**`sync_changes`**

| Column | Type | Notes |
|---|---|---|
| `seq` | `bigserial`, unique | Global monotonic. Monotonic per household as a consequence, and a household's rows commit in `seq` order, so a pull that has read `seq` N has missed nothing below it. The table is partitioned by month on `occurred_at`, so its primary key is `(household_id, seq, occurred_at)` ([ADR 0006](../adr/0006-sync-ready-schema-and-the-mutation-spine.md)) |
| `household_id` | `uuid` | Tenant |
| `entity_type` | `text` | e.g. `garden.planting` — the module-qualified entity name |
| `entity_id` | `uuid` | |
| `op` | enum | `upsert` · `delete` · `retract` |
| `row_version` | `bigint` | The `version` of the row after the change |
| `occurred_at` | `timestamptz` | |
| `actor_id` | `uuid` | Who caused it, so a client can suppress echo of its own writes |
| `module` | `text` | For grant filtering without a join |
| `visibility` | enum | `shared` · `private` · `redacted` — for privacy filtering without a join |
| `owner_id` | `uuid NULL` | For privacy filtering without a join |
| `audience_id` | `uuid NULL` | The enumerated member list this row belongs to, for membership filtering without a join. A **chat conversation** or a **`member_shared` calendar** in 1.0 — see [02](02-identity-and-access.md) §7 |
| `for_user_id` | `uuid NULL` | Non-null **only** on `retract` — a retraction is addressed to one member |
| `payload` | `jsonb NULL` | The row, as the API would serialise it. Null on `delete` and `retract` |

**D-88: a partly-visible entity emits two rows, never one row that is filtered on the way out.**
A calendar event marked private on a *shared* calendar is visible to its owner in full and to
everybody else as a busy block with no title
([modules/04-calendar.md](modules/04-calendar.md) FR-CA2, FR-CA5). One feed row cannot express
that, because the payload is written once and the feed has no per-recipient rendering step — and
adding one would put the redaction logic on the hot path of every pull, which is exactly the
mistake [D-8](09-decisions.md) avoided for the WebSocket.

So the mutation writes **two** rows in its transaction: a `private` row carrying the full payload
with `owner_id` set, and a `redacted` row carrying only the fields the redacted form is allowed to
have. `redacted` rows are delivered to everyone *except* the owner, who gets the full one; the two
carry the same `entity_id`, so a member whose access changes replaces one with the other rather
than holding both. Producing a redacted row is the entity's own responsibility, declared with its
sync entity, and an entity that declares one must provide the projection — there is no generic
field-stripper, because what is safe to reveal is a property of the entity and not of the platform.

**D-22: the feed row carries every field needed to authorise it.** `module`, `visibility`,
`owner_id` and `audience_id` are denormalised onto the change row so that pulling a feed is one
indexed scan with a `WHERE`, not seventeen module-specific joins whose correctness has to be
re-established every time a module is added. It is the same reasoning that put the tenant in the
URL: the check should be visible in one place.

Index: `(household_id, seq)` and a partial `(household_id, for_user_id, seq) WHERE for_user_id IS NOT NULL`.

**FR-SY1 — The change is recorded in the mutation's transaction**, beside the audit event. Same
rule, same enforcement, same architecture test. *Under D-93 it is reported and checked, and written
to no feed (D-121).*

### 2.3 Pull

> **Under D-93 there is no pull endpoint of ours** (plan item 13,
> [ADR 0014](../adr/0014-powersync-deployment-generated-streams-credentials-and-the-push.md)):
> `GET …/sync/changes` and `POST …/sync/snapshot` are gone from the contract. A client asks
> `POST /api/v1/households/{id}/sync/credentials` for PowerSync's URL and a token of PowerSync's own,
> which lasts five minutes and names only the caller, and its replica subscribes to the household's
> streams with the household as the subscription's parameter, one replica per household (D-4).
> PowerSync verifies the token with the keys the API publishes at `GET /api/v1/sync/jwks`. The
> streams are generated from the entity registry (D-22): an entity held to the grant reaches an owner
> of the household, and a member whose grant on its module is above `none`, while the household
> enables the module; admin's settings, memberships and module enablement reach every member of the
> household; each stream sends the columns its entity names, and a soft-deleted row stays in it, so
> that a client tells a row another member deleted from one it lost access to. The predicate below
> is what the streams express (plan item 17, ADR 0018): an entity whose rows may be private has its
> shared rows and its caller's own private rows in streams of their own, by the `visibility` and
> `owner_id` each row carries; its redacted projection, a column list the entity declares, reaches
> everyone with the grant, the owner included, from its private rows, in a client table of its own;
> and every stream of an entity an audience bounds holds its rows to the members their `readers`
> name. A row a private item or an audience bounds carries those columns itself, since a stream reads
> its entity's own table, and they are rewritten when the item moves or the audience changes, which
> is no edit of the row (**D-123**). The feed's `seq`, cursor and horizon describe the design D-93
> replaced; FR-SY2's pruning is PowerSync's compaction, run nightly, and FR-SY3's bootstrap is a
> replica's initial sync.

`GET /api/v1/households/{id}/sync/changes?since={cursor}&limit=` *(replaced, D-93)*

Returns changes with `seq > cursor` that the caller may see, in `seq` order, plus a
`next_cursor` and a `has_more` flag. The visibility predicate is:

```
module ∈ caller's granted modules (level > none)
AND (visibility = 'shared'
     OR (visibility = 'private'  AND owner_id  = caller)
     OR (visibility = 'redacted' AND owner_id <> caller))
AND (audience_id IS NULL
     OR (caller ∈ members(audience_id) AND seq >= floor_seq(caller, audience_id)))
AND (for_user_id IS NULL OR for_user_id = caller)
```

The `private`/`redacted` pair is mutually exclusive by construction: exactly one of the two rows
reaches any given caller, and which one is decided by the same indexed scan as everything else.

**D-90: the audience floor is a term in this predicate, not a filter applied afterwards.**
A member added to an existing chat conversation has a **floor** and must see nothing before it
([modules/15-chat.md](modules/15-chat.md) FR-CT2). Without the `seq >= floor_seq` term the REST path
would honour the floor and the feed would not, and a member added to a group today would replicate
every message in it still inside the 90-day horizon — the household's back catalogue, delivered by
the one path nobody was looking at.

So **the audience membership row stores `floor_seq`**: the household's `sync_changes.seq` at the
moment that member joined that audience, written in the same transaction as the join.
FR-CT2's message-id floor is unchanged and remains what the chat API and the unread counts use;
`floor_seq` is its equivalent in the feed's own ordering, and the two are set together from one
event so they cannot drift. An audience with no floor concept — a `member_shared` calendar, where
joining grants the whole calendar — stores `floor_seq = 0` and the term is satisfied trivially.

> **Under D-93 no `floor_seq` is stored.** A row an audience bounds keeps its **readers**, the
> members whose floor it is at or above, written by the mutation that writes it and rewritten by the
> one that changes the audience; a member added with a floor is a reader of nothing before it, which
> scenario 18 asserts on the count of messages a new member's replica receives. A `member_shared`
> calendar keeps readers on every row as well (**D-126**).

The rejected alternative was to keep chat out of the generic feed and give it a chat-specific pull
that already understands floors. It was rejected for the reason behind
[D-22](09-decisions.md): a second delivery path is a second place for the four access axes to be
re-implemented, and the axis this one gets wrong is the one nobody notices.

**FR-SY2 — Compaction and the horizon.** Changes older than **90 days** are pruned, and each
household carries a `compaction_horizon_seq`. A client whose cursor is below the horizon is told
`410 Gone` with `{ "action": "resnapshot" }` and re-bootstraps. This bounds the feed and makes
"the phone that was in a drawer for a year" a defined case rather than an unbounded replay.

**FR-SY3 — Bootstrap.** `POST …/sync/snapshot` with a module list returns a consistent snapshot
of everything the caller may see in those modules, taken at a stated `seq`, streamed as
newline-delimited JSON so a large household does not have to be buffered. The client applies it,
sets its cursor to that `seq`, and continues with incremental pulls.

### 2.4 Push

`POST /api/v1/households/{id}/sync/mutations` with an ordered batch:

```jsonc
{ "mutations": [ {
    "mutation_id":    "uuidv7",     // client-generated, the idempotency key
    "entity_type":    "shopping.item",
    "entity_id":      "uuidv7",     // client-generated on create
    "op":             "create" | "update" | "delete" | "action",
    "base_version":   12,           // null on create
    "action":         "complete",   // only when op = action
    "fields":         { },          // only the fields the client actually changed
    "client_time":    "2026-09-07T18:22:03+02:00"
} ] }
```

The response reports **per mutation**, in the same order:

| Result | Meaning | Client behaviour |
|---|---|---|
| `applied` | Committed. Carries the new `version` and the canonical row | Replace the local optimistic row |
| `merged` | Committed, but the server's row differs from what the client expected | Replace; if a field the user set was overridden, surface it |
| `conflict` | Refused on `base_version`. Carries the server's current row | Replace locally; re-present the user's change for confirmation |
| `rejected` | Invalid, unauthorised, or references something gone | Drop from the queue, surface a clear message |
| `deferred` | A dependency in this batch failed | Retry after the dependency is resolved |

**D-122: a write is held to its `base_version` against the row as the push finds it**, locked until
the write commits. A `strict_version` update, delete or action names its `base_version`, and one made
against another version than the row's is `conflict`, carrying the row as it stands. An `lww_field`
or `lww_row` write made against an older version is applied over the change it had not seen, and
answered `merged` with the code `concurrent_change` and the row: the server's row differs from what
the client expected, and the client surfaces it where a field the member set was overridden. A
create, and a write against the row's own version, is `applied`. A replica's own earlier write is
never a change it had not seen: a replica makes each write against the version it holds, which moves
only when a checkpoint reaches it, so a later mutation of a batch to a row an earlier one wrote,
made against the same version, is held to the version the earlier left; and a client sends a
mutation it made while an earlier one of the row was in flight against the version that one's answer
returned.

**FR-SY4 — Client-generated ids are mandatory.** A create performed offline must have a stable
identity immediately, because the user may then edit it, attach to it, or reference it in
another offline create before it ever reaches the server. UUIDv7 gives the client that identity
and keeps insertion order sane in the index. Server-assigned ids would require a local-to-real
id remapping pass across every table, which is where offline systems go to die. **D-23.**

**FR-SY5 — Idempotency is per mutation, not per batch.** `mutation_id` is stored per household
for **7 days**; replaying it returns the stored result. Batches are retried wholesale by clients
on network failure, so per-mutation idempotency is what makes retry safe. The result is kept under
the member who sent the mutation as well as its household, so that a member sending another's
`mutation_id` is never answered with the other's result, and its row; a `mutation_id` sent again
carrying another mutation is `rejected`. A result that commits an effect is kept in the effect's
transaction, so a mutation that took effect is never applied twice however its answer was lost; a
`deferred` mutation keeps none, since its replay runs it (**D-106**, plan item 13).

**FR-SY6 — Batch ordering.** Mutations within a batch apply in order, each in its own
transaction. A failure does not abort the batch; later mutations that depend on a failed one
come back `deferred`. Whole-batch atomicity would mean one bad row blocks a week of a member's
work. A mutation depends on a failed one when it writes the row the failed one did, or names it by
its id in a field. Every outcome but `applied` carries a machine-readable `code` (PRD 10 §6). A batch
holds at most 500 mutations, a larger one refused whole (`413`, `batch_too_large`), and a device, or a
web session, sends at most 60 batches a minute (02 §9). A household's replicas push at most 100 000
mutations on a UTC day between them, a batch past that refused whole, `429` until the day ends
([04](04-billing-and-entitlements.md) §5, **D-127**).

### 2.5 Merge policy

**D-24: every sync entity declares a merge policy. There is no global default.** A module
registers its entities with one of five:

| Policy | Behaviour | Used by |
|---|---|---|
| **`lww_field`** | Field-level last-write-wins by server receipt time. Two members editing different fields of the same row both succeed | Most entities: tasks, notes metadata, plantings, contacts |
| **`additive`** | Append-only **in the merge**. Rows are created and never merged, so two replicas can never disagree about one. A correction is an ordinary **online** edit under `If-Match`; it is never queued offline | Chat messages, meter readings, harvest entries, fuel entries, service records, settlements, point-ledger entries |
| **`lww_row`** | Whole-row last-write-wins; the loser's version is preserved and surfaced: a write made against an older version keeps the row it replaced, in its module, with the version it stood at, the version the write was made against and who wrote each (**D-122**) | Note and message bodies — rich text cannot be field-merged honestly |
| **`strict_version`** | `base_version` must match exactly; otherwise `conflict` | Anything money-affecting or structurally load-bearing: allocation rules, transactions and expense shares, tariff versions, season close, permission changes |
| **`state_set`** | Idempotent **desired-state** writes. The entity declares its **key** and its **resolution rule**; applying the same write twice is applying it once | Shopping item checked state, chore completion, medication doses, reactions, read markers |

**`state_set` declares two things, and both are part of the entity's registration.** The policy is
not "a boolean toggle" — it is *the operation carries the state it wants, not a delta*, which is
what makes replay harmless. What varies between entities is who the state belongs to and how two of
them are ordered, so both are declared rather than assumed:

| | |
|---|---|
| **Key** | The tuple the state hangs off. `(item, user)` for a reaction or a personal completion; `(item)` alone where the fact is the household's and not a member's — a medication dose is given once for the animal, not once per person ([modules/14-pets.md](modules/14-pets.md) **D-73**) |
| **Resolution** | `latest_client_time` (the default — a check and an uncheck race, and the later intent wins, with §2.8's 24-hour clamp behind it) or `monotonic` (the value only ever moves forward, and the merge is a maximum — a chat read marker, [modules/15-chat.md](modules/15-chat.md) FR-CT5) |

An entity registering `state_set` without both is rejected by the same architecture test that
rejects a missing policy ([01-architecture.md](01-architecture.md) §10, check 5). **A value that is
neither a desired state nor idempotent is not `state_set`**, whatever its write volume — a lexorank
position is an ordinary field and is `lww_field`, which is where positions live.

**`additive` is a statement about merging one row, not about immutability and not about the set.**
Two things follow, and the second is the one that is easy to miss:

- A member who typed 41 500 km instead of 45 100 km must be able to fix it, and delete-plus-create
  loses the audit thread that makes the correction legible. What `additive` forbids is a
  *concurrent* edit: the row has no offline update path, so no two devices can ever hold different
  versions of it.
- **It does not promise the row will be accepted.** Some `additive` series carry a *cross-row*
  invariant that only the server can evaluate — a meter reading must not decrease against either
  neighbour ([modules/10-utilities.md](modules/10-utilities.md) FR-UT1), and the asset engine's
  usage log says the same ([modules/12-property.md](modules/12-property.md) FR-AS1). An offline
  create can satisfy every local check and still come back `rejected` with
  `monotonicity_violation`, because the replica did not hold the neighbour it broke.

So the guarantee `additive` makes is **convergence, not admission**: two replicas can never disagree
about a row, and that is what makes the cellar, the petrol station and the far end of the garden
safe. Whether the row is *valid* is still the server's answer, and an entity whose series carries a
cross-row invariant must say so in its registration, so that the client can pre-check against the
neighbours it *does* hold and warn at the meter rather than an hour later at the kitchen table.
Conformance scenario 17 ([10-sync-risk.md](10-sync-risk.md) §4) is this case.

`strict_version` is the important one. **A conflict is preferable to a silent merge whenever
money or a structural invariant is involved.** A shopping item that flickers is a nuisance; a
finance allocation rule that quietly took half of one member's edit and half of another's is a
wrong number nobody will ever find.

### 2.6 Retraction — the part that is usually got wrong

When a member loses access to data they already hold locally, the server must actively tell them
to delete it. Losing access happens on: a module grant lowered to `none`, removal from a
conversation or a `member_shared` calendar, an item moved from shared to private, removal from the
household, and a module disabled household-wide.

**A lapsed subscription is not on that list.** A household in `read_only` has lost the right to
*write*, not the right to *read*, so nothing is retracted and the replica stays exactly where it is —
see [04-billing-and-entitlements.md](04-billing-and-entitlements.md) FR-BI2, which is the
authoritative statement of what happens to a client when the money stops.

**Nor is a suspension**, which takes no member's access but the household's own: a `suspended`
household ([04](04-billing-and-entitlements.md) §3) refuses reads, and every stream holds it to
nothing, so each replica that connects is emptied of it and fills again when it is lifted
(**D-115**).

**FR-SY7 — Access loss is a row leaving every bucket the member holds** (D-93, plan item 17), which
their client deletes from its replica. No retraction is written: each cause changes what a stream
reads, in the transaction of the change, and PowerSync moves the rows out of the buckets that held
them, carrying no payload, so the act of retracting leaks nothing:

| Cause | What the change writes, which the streams read |
|---|---|
| A module grant lowered to `none` | The member's grant (`module_grants`), which the grant's stream looks up |
| Removal from a conversation or a `member_shared` calendar | The audience's membership, and the member taken out of the `readers` of every row it bounds, which is no edit of them (**D-123**) |
| An item moved from shared to private | The item's `visibility` and `owner_id`, and the same rewritten on every row it bounds, which is no edit of them |
| Removal from the household | The membership, which every stream looks up; and the member taken out of the readers of every audience they were in, by the household surface's hook (`household.Hooks.Lost`), since readers left behind would reach them again were they brought back with the grant |
| A module disabled household-wide | The module's enablement, which every stream of its entities looks up |

A row another member deleted stays in its streams, a tombstone, so that a client tells it from a row
it lost access to, which leaves its replica. The conformance suite proves each cause (PRD 10 §4,
the `loss-*` cases).

**FR-SY8 — Retraction is best-effort but auditable.** A device that never comes back online keeps
its local copy; nothing can prevent that. The security model therefore does not depend on
retraction — it depends on the server refusing the next request. Retraction is a correctness and
privacy *courtesy*, and the spec says so rather than implying a guarantee it cannot make.

### 2.7 Attachments offline

Files are not in the change feed. A photo taken offline is stored in the app's own sandbox with a
client-generated id, referenced by the mutation that created its parent row, and uploaded when
connectivity returns. Until the upload completes the row carries `attachment_status: pending` and
every client renders a placeholder. An upload that fails permanently (quota, size, type) marks the
row `attachment_status: failed` with a reason the member can act on. **D-25.**

### 2.8 Clocks

Client timestamps are **advisory data**, never authority. Ordering is by server receipt; `client_time`
is stored for display ("added at 18:22, synced at 19:40") and for `state_set` resolution, where a
skewed clock is a smaller problem than a wrong toggle. Any `client_time` more than 24 hours from
server time is clamped and flagged. **D-26.**

## 3. Storage and metering

**FR-ST1 — The storage catalog.** Each module declares the tables it owns and, if it holds bytes,
whom each of its objects is attributed to, `(owner_id, visibility)`: the member its bytes count
against and whether its entity is private to them. Only the module can do this: only `documents`
knows that `h/{hh}/documents/{id}/original` maps to that document's creator. The attribution travels
with each object, never computed from a prefix when the bytes are counted: the module declares its
member and whether its entity is private when it records the upload, and keeps both current as the
entity moves, so the sampler splits bytes by member, and counts objects and bytes, from the objects'
own rows without reading any module's table
([ADR 0015](../adr/0015-files-object-storage-the-meter-and-pictures.md)).

**FR-ST2 — Daily sampling.** A nightly job per household records a `usage_sample`:
`stored_bytes` broken down by module and by member, `object_count`, plus row counts per module for
fair-use monitoring. The sample is what billing reads; nothing bills off a live scan. It is the UTC
day's (**D-109**), a second one that day replacing the first, and a household that keeps nothing is sampled at
nothing, so a period's average counts its empty days. The meter role measures every household; each
household's sample is written in its own context.

**FR-ST3 — What is billed.** `stored_bytes` = object-storage bytes attributed to the household,
including all derived variants (previews, thumbnails): every object the household's files record.
The versions the store keeps of a deleted or replaced object, for the backups' 35 days
([07](07-nonfunctional.md) §3), are the platform's backup and not the household's storage, and are
not billed: counted, a file uploaded and deleted the same day would be billed for five weeks, which
**D-31** and FR-BI3's worked example rule out. Database rows are **not** billed; they are subject to
per-plan fair-use ceilings. See [04](04-billing-and-entitlements.md).

**FR-ST4 — The household can see it.** A storage screen shows total, the trend, the split by
module and by member, the largest items, and what deleting something would actually recover. A
metered charge the customer cannot verify is a complaint waiting to happen.

## 4. Notifications

Carried from `home` v5 in structure — the trigger/schedule/metric composition was good — and
extended for native push and for member-level control.

**FR-NT1 — Three transports.** Web Push (VAPID) for the web app; **APNs and FCM via Expo Push**
for the mobile apps; email for a defined, small set (security, billing, invitations, and a member's
removal from a household, **D-111**) that must arrive even when push is off. A device registers its
token on login and de-registers on logout. A browser's subscription is bound to the web session that
registered it and reaches its user while that session lives; a device's token reaches it while its
sign-in lives, so signing out, or being signed out everywhere, ends both. A web session holds one
subscription, which the next it registers replaces; a token registered from one installation of the
app is cleared from any other that held it, an earlier installation on the same phone, while the
profiles signed in on one shared tablet each keep it (D-104). A browser's endpoint must be at a push
service the server knows, so that no member can have the server send where they choose.
A notification is queued in the transaction of what caused it and delivered once that commits, by a
worker of any instance; an email's link token waits sealed under a key the database does not hold
([ADR 0016](../adr/0016-scheduler-and-notification-transports.md)). An email still waiting for the
mail server is dropped once what it says no longer holds: an invitation's when it is sent again,
withdrawn, declined or accepted, and a graduation's when a newer link is sent or its link is spent.

**FR-NT2 — Four categories**, each independently mutable per member per household:
`direct` (someone assigned you something, mentioned you, messaged you), `household` (something
changed that you asked to hear about), `reminders` (a due date you subscribed to), `digest`
(scheduled summaries). Plus a master switch and **quiet hours** in the member's own timezone, or
their household's when they set none. The account's defaults stand in for every household where the
member has set nothing; their first change in a household starts from them, and from then on the
household's are their own. Quiet hours **hold** a push until they end and never drop it; the email
set of FR-NT1 ignores the switch, the categories and quiet hours alike (**D-112**).

**FR-NT3 — Trigger rules.** An owner composes rules over the audit action catalog: match an action
key or prefix, filter by module/entity/level, choose an audience, template a title and body from
tokens, and coalesce repeats within a window. Inherited from `home`, with three changes: templates
are per-language, audiences respect module grants, and a member's own category mutes always win.

**FR-NT4 — Scheduled digests.** A named schedule (time, days, day-of-month with short-month
clamping) resolves metric tokens **per recipient** and sends. Inherited unchanged.

**FR-NT5 — Delivery is filtered by grant and by privacy, at send time, per recipient.** A rule
matching a Finance action does not notify a member with `none` on Finance, and the redacted form
of a private event is what renders — once, for the whole audience, never a second per-owner
rendering that could be misdelivered. A notification about a private item reaches its owner and
no one else, and a push reaches only someone who is still a member when it goes out. Repeats with
one coalescing key merge: into one still waiting, or, within fifteen minutes of one that went, into
one held until those fifteen minutes have passed.

**FR-NT6 — Delivery log.** Every attempt recorded with outcome, and every notification dropped,
or given up, before any attempt with its reason. `404`/`410` from a push service deletes the
subscription, and Expo's `DeviceNotRegistered`, in a ticket or in its receipt, clears the device's
token. Five failures in a row mark a subscription or a device stale and stop trying until it
registers again: a failure its push service lays on it, never one of the service's own (no answer,
`429`, a `5xx`, the project's credentials refused, an error of Expo's or of Apple's or Google's own),
which an outage would otherwise turn into every target going stale. A device's run of failures ends
when Expo's receipt, not its ticket, says Apple or Google took a push. A push a push service took is
not retried, since that service holds it for the device; one that no push service took, one failing
on its own side, is tried again as an email the mail server does not take is: with backoff, five
times in all (**D-112**). Support can read this log — it is metadata, not content. What a push said
is kept seven days for the household's owners (FR-HA12, §5) and is not what support reads; an email
keeps its subject, never its body, which may carry a link's token.

## 5. Scheduler

A single in-process scheduler with a leader lock so that multiple API instances do not double-fire.
Modules register jobs; the platform owns the timing. Every instance runs it; the one holding a
PostgreSQL advisory lock leads, and each job's next slot is kept in the database and taken by a
statement that matches only while it is due, so that a slot fires once even while a leader whose
connection died has not yet noticed ([ADR 0016](../adr/0016-scheduler-and-notification-transports.md)).
A failed job, or one whose instance ended while it ran, is tried again after fifteen minutes or at
its next slot, whichever comes first, four tries a slot at most: a job that fails every time, a
nightly one that one household fails, then waits for its next slot rather than running every fifteen
minutes until it.

| Job | Cadence | Owner |
|---|---|---|
| Digest evaluation | Every minute | Notifications |
| Reminder materialisation | Hourly | Reminders |
| Weather poll | Twice daily | Garden |
| Storage sampling | Nightly | Storage |
| Usage rollup and billing sync | Nightly | Billing |
| PowerSync's compaction, after the erasure and the expiry sweep (`deploy/powersync/compact.sh`) | Nightly, 04:00 UTC | Sync |
| PowerSync's replication lag, sampled for alerting | Every minute | Sync |
| Trial and dunning transitions | Hourly | Billing |
| Invitation and token expiry | Hourly | Identity |
| Erasure execution: the deletions scheduled 30 days ago, the lapsed households whose retention ran out, and the private data of members who left 30 days ago | Nightly, 02:30 UTC | Privacy |
| Expiry sweep | Nightly | Platform — see below |
| Expo receipts | Every 15 minutes | Notifications |

**The expiry sweep is one job, not six**, because every one of them is the same operation: delete
rows past a retention the specification has already fixed. Listing them separately would be six
schedulers to forget one of.

| What it drops | Retention | Stated in |
|---|---|---|
| Mutation idempotency records | 7 days | FR-SY5 |
| The count of a household's pushed mutations on a day | 7 days past the day | **D-127** |
| A replica's last report of itself (`POST …/sync/digest`) | 90 days after it last reported, and no longer than its member's membership | **D-128** |
| `Idempotency-Key` records of REST requests | 7 days | [01-architecture.md](01-architecture.md) §6 |
| Preserved note-body losers | 30 days | [modules/07-notes.md](modules/07-notes.md) FR-NO10 |
| Generated export archives | 7 days after generation | [05-privacy-and-compliance.md](05-privacy-and-compliance.md) §3 |
| An export's row, once its archive is gone or it failed | 30 days after it ended | **D-139** |
| Diagnostic bundles | 30 days | [02-identity-and-access.md](02-identity-and-access.md) FR-PS1 |
| Rendered notification bodies in the delivery log, and the arguments a settled notification was rendered from | 7 days — the outcome is kept, the body is not | [modules/17-household-admin.md](modules/17-household-admin.md) FR-HA12 |
| Soft-deleted rows past their module's undo window | Per module | Module pages |
| Web sessions | Once ended, revoked or expired, with the browser subscriptions they registered | **D-113** |
| `Idempotency-Key` records of account requests | 7 days | [01-architecture.md](01-architecture.md) §6 |
| Used refresh tokens | 30 days after use | **D-113** |
| Revoked device sign-ins, with their refresh tokens | 30 days after they were revoked | **D-113** |
| Trusts to skip the second step | Once expired | **D-113** |
| Sign-in throttle counts | A day after their window and their block end | **D-113** |

The hourly invitation and token expiry is the same operation on what expires within the hour:

| What it drops | Retention | Stated in |
|---|---|---|
| Email links (verification, reset, graduation) | 7 days past their expiry, spent or not | **D-113** |
| Second steps and provider sign-ins waiting | A day past their end or their expiry | **D-113** |
| Invitations that stopped working | 30 days after they did, through the mutation spine | **D-110** |

A retention this table does not name is a retention nobody decided, which is the reason it is a
table rather than a sentence.

Timezone-sensitive jobs resolve against the **household's** timezone, not the server's. A digest
"at 08:00" means 08:00 where the household is, DST included.

## 6. Reminders as a strand

**D-27: the reminder mechanism is a platform strand; the Reminders module is its user interface
plus its own standalone reminders.**

`home`'s Okno do budoucnosti owned its own events and its own reminder logic. In Household, **ten
modules** register a combined **twenty-one reminder kinds** — Tasks, Calendar, Chores, Documents,
Finance, Utilities, Garden, Property, Vehicles and Pets — covering a vehicle inspection, a document
expiry, an appliance service interval, a contract notice period, a chore, a planting task, a
medication dose and a dozen more. Duplicating lead-time logic ten times is how ten subtly different
behaviours ship.

**FR-RM1 — A module registers reminder *kinds*.** A kind declares its key, its label, the entity it
attaches to, and a resolver returning `(entity_id, due_on, title_key, title_args, module)` for a
date window. The strand owns lead times, snoozing, completion, recurrence expansion and delivery.

**FR-RM2 — A member subscribes per kind**, with their own lead time — `0d`, `1d`, `3d`, `1w`, `2w`,
`1m`, `3m`, or a custom number of days. Subscriptions are personal; two members can want different
notice for the same thing. The offered set is defined here and nowhere else; the Reminders module
presents it ([modules/03-reminders.md](modules/03-reminders.md) FR-RE6) rather than defining its own.

**FR-RM3 — Completion is shared where the obligation is shared** (the boiler service is done, for
everyone) and personal where it is not (your own reminder to renew your passport). The kind
declares which.

## 7. Search

**FR-SE1 — One search endpoint across every module the caller may see.**
`GET /api/v1/households/{id}/search?q=&modules=&limit=`

Each module registers a search scope: the table, the `tsvector` column, the fields, and a renderer
producing a uniform hit `{ module, entity_type, entity_id, title, snippet, path, updated_at }`.

**FR-SE2 — Language-aware.** The `tsvector` is generated with the PostgreSQL text-search
configuration matching the content's language, with `unaccent` so that *pórek* matches *porek* and
*Grünkohl* matches *Grunkohl*. Where a household is multilingual the configuration is per-row,
chosen at write time from the household locale, with `simple` as the fallback.

**FR-SE3 — Privacy and grants apply before ranking**, not after — filtering after ranking changes
the number of results a caller sees and is itself a leak.

## 8. Files

**FR-FL1 — Upload** goes through the API: enforce the size cap, sniff the content type from the
leading bytes (never trust the client's header), check the household's storage quota, stream to
object storage, compute a SHA-256, and write the metadata row in the same transaction as the audit
event and the sync change. Bytes are **write-once**. The cap is 100 MB (`413`); a program is refused
`415` by its bytes or by its name, and so is a type the route does not take; an upload past the
storage ceiling is `402 storage_ceiling_reached`, naming by how much. The bytes are in the store
before their row commits, never after: bytes a failed mutation left, which no row names, are billed to
nobody and swept once a day old. The same bytes sent again for an entity succeed; other bytes for it
are refused `422`.

**FR-FL2 — Delivery** is a short-lived pre-signed URL issued only after the caller is authorised
for the owning entity. Originals of untrusted active types (HTML, SVG) are download-only and are
never rendered in the app's origin. `X-Content-Type-Options: nosniff` on everything.

**FR-FL3 — Derived variants** — thumbnails, image scaling, PDF first-page previews, and office
document conversion — are generated asynchronously after commit, once, and cached forever, because
the bytes never change. A failure leaves the file download-only and never loses the upload. A raster
image gets a 320-pixel thumbnail and, when larger than 1600 pixels, not upright, or of a type browsers
do not show (BMP, TIFF), a preview, both without the original's metadata; a PDF its first page as a
preview and a thumbnail; an office document a PDF and that PDF's page, through a LibreOffice sidecar
with a timeout. A failure a retry may mend is retried for about two and a half hours; a file that
cannot be decoded or converted is left at once.

**FR-FL4 — Quota enforcement is on upload, never on read and never by deletion.** Over quota, an
upload returns `402` with the amount over; existing files remain readable and downloadable forever.
**D-28.**

## 9. Internationalisation and localisation

**D-29: English is the source language of the product and the only language in the codebase.**
`home` hardcoded Czech in a single `cs.ts`. Household has no user-visible string in any client
source file — the architecture test enforces it.

### Languages

| Phase | Languages |
|---|---|
| **1.0** | English (source), Czech, German, Slovak, Polish |
| **1.x** | Dutch, Spanish, French, Italian, Portuguese, Hungarian, Romanian |
| **2.0** | The remaining EU official languages |

### What "localised" means beyond translation

| Dimension | Set per | Notes |
|---|---|---|
| **UI language** | Member | Two members of one household read the same data in different languages |
| **Timezone** | Household, overridable per member | Digests, quiet hours and "today" all resolve against it |
| **Base currency** | Household | Formatting follows the *member's* locale; the currency follows the household |
| **Date, time, number format** | Member locale (ICU) | Never hand-rolled |
| **First day of week** | Member locale, overridable | |
| **Measurement units** | Household | Metric default; imperial available for length, area, mass, temperature and volume |
| **Country profile** | Household | Drives utility tariff presets, public holidays, vehicle-inspection naming (STK/MOT/TÜV/HU), document types, and default VAT |
| **Climate profile** | Household location | Drives Garden frost dates, hardiness zone, and crop timing resolution |

### Mechanics

- **ICU MessageFormat** for every string, so plurals and gender are the translator's problem, not
  a `if (n === 1)` in a component. Czech, Slovak and Polish all have three-plus plural forms and
  four-form Slavic plurals are the single most common bug in naively translated apps.
- **One catalog per language, shared by both clients**, generated into typed accessors so a missing
  key is a compile error. The server renders the same files, and both renderers implement one
  subset of ICU MessageFormat: plurals, ordinals, selects and plain numbers, with no date, time or
  styled number formats yet ([ADR 0007](../adr/0007-shared-packages-client-catalogs-and-vectors.md)).
- **Server-side strings** — push bodies, emails, audit summaries, exported documents — are rendered
  from keys against the *recipient's* language, which is why the audit spine stores keys (FR-AU3).
- **Reference data is translated as data, not as strings**: the crop catalog, tariff presets,
  document types and unit names carry per-language fields in the database.
- **Pseudolocalisation** is a build target, and the E2E suite runs one pass in it, because a layout
  that only works in English is a layout that breaks in German.

## 10. The asset engine

**A strand, not a module, and it is listed here because it was previously visible only from a module
page.** Property, Vehicles and Pets are the same shape — *a thing the household owns or cares for,
which has documents, costs, recurring service dates and a history* — and **D-67** keeps them as three
modules with their own vocabulary over one engine, because people look for their car under "car".

The engine is specified in full in [modules/12-property.md](modules/12-property.md) §"The shared
asset engine"; what belongs here is the part that is platform behaviour rather than Property's:

| | |
|---|---|
| **Owns** | `asset_service_schedules`, `asset_service_records`, `asset_usage_readings`, keyed by `(entity_type, entity_id)`. They live in the **platform's** migration block, not in any module's |
| **Routes** | `…/assets/{entity_type}/{entity_id}/…` — the one place in the API where a household-scoped path is not under a module id, because the alternative is five endpoints written three times over one implementation |
| **Grant resolution** | From `entity_type`, never from the path. `property_item` → Property, `vehicle` → Vehicles, `pet` → Pets, and the answer is identical to what the caller would get under that module's own routes, including `404`-not-`403` (**D-16**) and the household-enablement switch |
| **Consumers** | Property, Vehicles, Pets. A fourth module wanting service schedules registers an `entity_type`; it does not fork the engine |
| **Invariant it carries** | The usage log is a non-decreasing `additive` series with the same validation Utilities applies to meter readings (FR-AS1, **D-68**) — including §2.5's admission caveat |

**It is built in Phase 4**, immediately before the three modules that need it
([08-roadmap.md](08-roadmap.md)), not in Phase 0 with the other strands. That is deliberate and it is
the one strand where it is safe: nothing outside those three modules depends on it, so building it
late costs a rewrite of nothing. The reason it is named here anyway is that a platform capability
discoverable only from inside one module's page is a platform capability the next module will
duplicate.
