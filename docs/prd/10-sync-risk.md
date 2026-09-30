# 10 — De-risking the sync engine

The offline-first sync engine ([03-platform-strands.md](03-platform-strands.md) §2) is the largest
single commitment in the product and the one place where being wrong is expensive to undo. It is
also, in [08-roadmap.md](08-roadmap.md), built in a phase with no user-visible output — which means
no natural feedback loop and constant pressure to move on.

This chapter is the plan for not getting it wrong. It is ordered by leverage: the first two items
remove most of the risk, and the rest catch what remains.

## 1. Separate what is unfixable from what is replaceable

**This is the reframing that makes the rest of the plan cheap, and it should be done before any
sync code is written.**

The risk is usually described as "the sync engine might be wrong". That is imprecise, and the
imprecision is what makes it feel unmanageable. There are two distinct things:

| | Cost to change later | What it is |
|---|---|---|
| **The sync-ready schema** | **Catastrophic** — every table, every module, a data migration across live households | `household_id` on every row · `version` on every row · **client-generated UUIDv7 primary keys** · soft-delete tombstones · the denormalised access fields on the change row (`module`, `visibility`, `owner_id`, `audience_id`) · a declared merge policy per entity |
| **The sync engine** | **Contained** — one package, one protocol version, no data migration | The change feed, the mutation queue, conflict resolution, retraction, compaction, the client replica |

> **Under D-93** the replicated path reads no change row: PowerSync's streams read the access fields
> on each entity's own row, and plan item 14 decides how a row that a private item or an audience
> bounds carries them ([ADR 0001](../adr/0001-sync-engine.md)).

The schema half is **cheap to get right and must be right on day one**. It is four columns, an id
strategy and a registry. None of it requires the engine to exist. All of it is enforceable by the
architecture tests already specified ([01-architecture.md](01-architecture.md) §10, checks 2 and 5)
from the very first migration.

The engine half is expensive to get right but **replaceable if the schema is correct** — including
replaceable by somebody else's engine (§2).

**D-82: mandate the sync-ready schema in Phase 0 before choosing an engine, and gate every module's
first migration on it.** The practical effect is that a wrong engine costs a rewrite of one package;
a wrong schema costs the product. Spending Phase 0's first week on the cheap half is the highest
return available.

## 2. Buy before you build — and timebox the decision

**D-83: spike two off-the-shelf sync engines against the hardest case in week one, before
committing to build one.**

The design in §2 of [03](03-platform-strands.md) — Postgres as the source of truth, a per-user
partition of the change feed, a client-side SQLite replica, and writes that go through the
application's own API rather than straight to the database — is not unusual. It is close enough to
several existing systems that building it from scratch should be a decision, not a default.

| Candidate | Shape of fit | What to check in the spike |
|---|---|---|
| **PowerSync** | Closest fit. Postgres → client SQLite, per-user sync rules that map onto the access predicate, and an upload queue whose writes go through **your own backend**, which is exactly the server-authoritative model specified. First-class React Native support; self-hostable | Whether sync rules can express **all four** access axes (module grant, visibility, ownership, membership) and whether **access loss propagates as deletion** on the client — that is the retraction requirement and it is the thing most likely not to fit |
| **ElectricSQL** | Postgres → partial replication over HTTP. Read-path sync, writes left to you. Smaller surface, self-hostable | Whether the partition model handles a grant being revoked mid-session, and how much of the write path you end up building anyway |
| **Replicache / Zero** | Mutation-based client/server sync — conceptually identical to the push/pull design here | Licensing and maturity; React Native story |
| **CRDT libraries (Yjs, Automerge)** | **Rejected.** [D-24](09-decisions.md) chose declared server-authoritative merge policies precisely because money and structural rows must conflict rather than merge | — |

All of these move quickly; **verify their current state rather than trusting any summary**,
including this one. Both leading candidates are self-hostable, which matters — a managed sync
service in the request path is a sub-processor and an EU-residency question
([05-privacy-and-compliance.md](05-privacy-and-compliance.md) §1).

**The spike is timeboxed to one week and has a written verdict.** It runs the retraction scenario
and the shopping-list scenario (§4, scenarios 7 and 3) against each candidate. If neither fits, the
build proceeds — but it proceeds having learnt from two designs and knowing exactly which
requirement forced the decision.

**The verdict (D-93, [ADR 0001](../adr/0001-sync-engine.md)): adopt PowerSync, self-hosted, for
replication, and keep the write path.** Both scenarios passed on PowerSync with every member's
write going through the mutation spine. Electric passed only with client code its own client lacks;
Zero has no offline writes; Replicache is in maintenance mode. Two axes of the predicate needed a
workaround each: the floor became a reader set on the row, and a redacted projection reaches its
owner as well. The requirement that decided it was retraction, which PowerSync met for every cause
with no client code. The requirement that came closest to forcing a build was keeping row-level
security under the read path, which stream definitions generated from the entity registry and an
isolation test now hold instead.

## 3. Tier the promise by merge policy

**D-84: offline *writes* ship per merge policy, behind a per-entity flag, not all at once.**

The five merge policies are not equally risky. Two of them cannot conflict by construction:

| Policy | Offline write ships | Why |
|---|---|---|
| **`additive`** | **Phase 1** | A meter reading, a harvest, a fuel entry, a chat message, a settlement — each is an observation of a moment that nobody else recorded. There is no **merge** to get wrong. Correcting one is an online-only edit, so it is not part of this tier |
| **`state_set`** | **Phase 1** | A checked shopping item, a completed chore, a recorded dose, a reaction. Idempotent by construction: applying twice is applying once. Lexorank positions are **not** in this tier — they are `lww_field`, because a position is a value and not a desired state ([D-24](09-decisions.md)) |
| **`lww_field`** | **Shopping in Phase 1**; every other entity Phase 2, one at a time | Real merge semantics. Shopping is pulled forward because gate G-C proves the engine on it, and the acceptance criterion opens with an offline *create* of a `shopping.item` — a list you cannot add to offline tests nothing. Elsewhere, enable one entity at a time as the conformance suite goes green |
| **`lww_row`** | Phase 2 | Note and message bodies. Needs the preserved-loser path working |
| **`strict_version`** | Phase 3 | Money and structure. The conflict UI must exist and be good before this is allowed offline |

Until an entity's policy is enabled for offline writes, the client **queues nothing and says so** —
the row is read-only offline with a plain "needs a connection to change this" state.

**The point of this is the failure mode.** A bug in a policy that has not shipped is invisible. A
**merge** bug in `additive` or `state_set` is close to impossible. So the worst realistic outcome in
Phase 1 is *"I couldn't edit that on the tram"* rather than *"my household's finances are wrong"*.

**One honest qualification, because the sentence above is about merging and not about admission.**
`additive` guarantees that two replicas never disagree about a row. It does not guarantee the server
will take it. Some `additive` series carry a **cross-row** invariant — a meter reading must not
decrease against either neighbour (FR-UT1), and the asset engine's usage log says the same (FR-AS1)
— which a replica missing that neighbour cannot evaluate. So the genuine Phase-1 failure mode is
narrower than "no bugs" and wider than "none possible": it is *"the reading you typed in the cellar
came back rejected an hour later"*. That is a real irritation, it is not data loss, and it has three
answers, all specified: the entity declares the invariant so the client can pre-check
([03-platform-strands.md](03-platform-strands.md) §2.5), the client questions a suspicious value at
the meter rather than at the kitchen table
([modules/10-utilities.md](modules/10-utilities.md) Sync), and **scenario 17** below is the
conformance test.

**And the phasing caveat, stated because the roadmap makes it easy to misread.** The three offline
scenarios that actually sell the product — a meter reading in a cellar, a harvest at the end of a
garden, a shopping list in a shop — are all `additive` or `state_set`, so the tier that ships first
is the tier that matters most. But **only the third exists in Phase 1**: Utilities and Garden are
Phase 3 modules ([08-roadmap.md](08-roadmap.md)), so in Phase 1 the `additive` flag is exercised by
the throwaway module and by Shopping's trip rows and by nothing else. What Phase 1 buys is not the
cellar working — it is **the mechanism proven before the modules that depend on it are written**, so
that Utilities arrives on an engine whose `additive` path has been in production for two phases.
That is the actual claim, and it is a better one than the shorter version.

## 4. Write the falsifier before the engine

Phase 0 has no UI and therefore no feedback. Replace the missing feedback loop with an executable
one: **a deterministic multi-client simulator, written before the engine, that the engine must
satisfy.**

It models N clients, a server, scripted network partitions, message reordering, duplicate delivery
and clock skew — in process, with no devices and no network. It is days of work, not weeks, and it
is the single most valuable artefact produced in Phase 0.

> **Under D-93 the suite runs against the adopted engine** rather than an in-process one: N
> PowerSync clients, the real service and the real API in containers, partitions scripted by
> disconnecting clients and by a network that refuses requests and loses responses, duplicate
> delivery by replaying an upload, skew through `client_time`. Reordering becomes the order in
> which clients reconnect and upload, scripted per scenario. One client's connector drains
> PowerSync's queue in order, one batch at a time, so its uploads reorder only where it replays a
> held `deferred` or `entitlement` mutation after writes queued later; the suite scripts that too,
> with a later write to the same row. It is slower and less deterministic than an in-process
> simulator, so the fuzz run on each change is short and the long one nightly. The scenarios and
> the invariants below stand. Where one names a mechanism of the replaced feed, its D-93 form is
> given beside it (scenarios 6 and 18, and invariant 5). The suite (plan item 12,
> [ADR 0013](../adr/0013-conformance-suite-stand-ins-and-the-oracle.md)) holds each replica to the
> rows its member may see, computed from PostgreSQL apart from the streams, so that a stream that
> disagrees with an entity's declared access fails convergence or retraction; and it reads invariant
> 5 bucket by bucket, a bucket made again, when access returns or a checksum fails, starting from
> nothing.

### The scenarios it must cover

| # | Scenario | Expected |
|---|---|---|
| 1 | Two clients offline edit **different fields** of one row (`lww_field`) | Both changes survive; no conflict shown |
| 2 | Two clients offline edit **the same field** | One wins by server receipt; the loser is surfaced, not silently dropped |
| 3 | Two clients offline check the **same** shopping item | One check; idempotent; no conflict dialog |
| 4 | Client A creates X offline and edits it twice before syncing | One entity, final state, no id remapping |
| 5 | Client A creates X, edits X, deletes X — all offline | Server sees three mutations for an id it never had; net effect is a tombstone and **no error storm** |
| 6 | Client offline past the compaction horizon | `410` → resnapshot → converges. Under D-93: the client catches up from PowerSync's compacted buckets, downloading again any bucket whose checksum no longer matches, and converges with its queue intact |
| 7 | **Grant revoked while the client is offline** | On reconnect, retractions delete the local rows; queued mutations against them are `rejected`, surfaced once, and not retried forever |
| 8 | Batch where mutation 3 fails | 1–2 apply, 3 rejected, 4+ `deferred`; retry resolves |
| 9 | Whole batch delivered twice (network retry) | Identical result; no duplicates |
| 10 | Client clock skewed +48 h | Clamped and flagged; ordering unaffected |
| 11 | `strict_version` mismatch | `conflict` carrying the server's current row |
| 12 | Attachment row syncs, bytes fail permanently | Row marked `failed` with a reason a member can act on; the row is never lost |
| 13 | Two rotating-chore completions offline | Rotation advances **once** |
| 14 | Entitlement lapses with a queue outstanding | `rejected` with `entitlement`, held locally, replayed if the subscription resumes |
| 15 | Two devices of the **same** member, both offline | Converge; no self-echo loops |
| 16 | Member removed from a conversation while offline | Messages retracted; the floor still holds for everyone else |
| 17 | **Offline `additive` create that violates a cross-row invariant on arrival** — a meter reading back-filled below a neighbour the replica did not hold | `rejected` with `monotonicity_violation`, surfaced once with the offending neighbour named, never retried in a loop, and the member's typed value preserved so they can correct it rather than re-read the meter |
| 18 | **Member added to an existing conversation, then pulls** | Nothing before their `floor_seq` is delivered, on the feed as well as the API (**D-90**). Under D-93: nothing before their floor reaches their replica, because they are not among the readers of any earlier message. The assertion is on the *count* of message rows received, not on their content, because a leak here is a row that should not have been sent at all |

### The invariants it asserts after every scenario

1. **Convergence** — every replica and the server are byte-identical at quiescence.
2. **No acknowledged write is lost.**
3. **Idempotency** — replaying any batch produces identical state.
4. **Retraction completeness** — no client retains a row it was retracted from.
5. **Monotonicity** — sequence numbers and read markers never move backwards. Under D-93 a client
   sees no feed sequence number: what never moves backwards is its replica's checkpoint.
6. **Terminality** — every mutation reaches exactly one of `applied`/`merged`/`conflict`/`rejected`.

Then **fuzz it**: randomised operation schedules and partition timing over the same invariants.
Scenario tests find the bugs you thought of; the fuzzer finds the ones you did not, and it is the
same harness.

## 5. Verify convergence in production, not just in tests

**D-85: clients periodically send a rolling digest of their local state; the server compares it to
its own and forces a resnapshot on mismatch.**

Per entity type, the client computes a cheap rolling hash of `(entity_id, version)` pairs and posts
them — with the cursor they were taken at — to **`POST …/sync/digest`**. The server computes the
same over what that client *should* hold **at that cursor**: the visibility predicate of the pull,
applied at a point in the past rather than at now, which is what makes the comparison meaningful on
a household that is still being written to. It answers per entity type. A mismatch means
divergence — the exact bug class that unit tests miss and users never report clearly, because the
symptom is "something looked wrong for a while".

The digest carries **hashes and counts only**; no row data crosses in either direction. That is
what lets the same figures ride in the diagnostic bundle (§6.2) without exposing content, and it is
a periodic check alongside the pull rather than a per-pull cost.

The response is a forced resnapshot for that device plus a telemetry event. **Divergence rate is an
alerting metric** ([07-nonfunctional.md](07-nonfunctional.md) §5), not a support ticket.

> **Under D-93** PowerSync verifies a checksum per bucket at every checkpoint and downloads a
> bucket again when it does not match, which holds a replica to PowerSync's buckets. It does not
> hold the buckets to PostgreSQL: a replication fault, or a generated stream that disagrees with an
> entity's declared access, passes every checksum. The digest, computed from PostgreSQL, remains
> the check on that, but it is evaluated above at the client's cursor, and a PowerSync client holds
> no feed cursor. Plan item 14 decides whether it keeps an endpoint of its own and, if it does, the
> point it is computed at.

## 6. The interaction with the no-content-access guarantee

**Worth stating explicitly because it is a genuine collision between two decisions.**

[D-3](09-decisions.md) means platform staff cannot read household content — which includes being
unable to inspect a member's pending mutation queue or local replica to debug a divergence report.
The usual debugging path for a sync bug is therefore closed.

Three consequences, all requirements rather than observations:

1. **The sync-health screen ships in Phase 0, not Phase 4.**
   [17-household-admin.md](modules/17-household-admin.md) FR-HA19 places it in the admin module;
   for the purposes of building the engine it must exist as soon as the engine does. It is the only
   view anyone gets of what went wrong.
2. **The diagnostic bundle carries sync state** — cursor, queue depth, per-entity digest mismatch,
   the last N mutation outcomes and their reasons, with **no field values**. Under D-93 the cursor
   is the replica's last checkpoint, and the mismatches are its bucket-checksum failures and any
   digest item 14 keeps. That makes it metadata, which means it can be sent without the member
   having to expose content.
3. **Every mutation outcome but `applied` carries a machine-readable `code`, always.** "Rejected"
   with no reason is undebuggable by anyone, and here there is no second route to the answer. An
   `applied` mutation took the effect it asked for, has no reason to give, and carries none
   ([03](03-platform-strands.md) FR-SY6, plan item 13).

## 7. Gates

Three points where the plan stops rather than continues on optimism.

| Gate | When | Condition | If it fails |
|---|---|---|---|
| **G-A** | End of Phase 0, week 1 | The sync-ready schema is enforced by architecture tests, and the buy-vs-build verdict is written down | Do not start any module |
| **G-B** | End of Phase 0 | The conformance suite is green, including all 18 scenarios, plus a fuzz run | Do not start Phase 1 |
| **G-C** | End of Phase 1 | The Shopping acceptance criterion passes **on two physical phones in aeroplane mode**, and the sync-health screen shows what happened | **Stop and build [03](03-platform-strands.md) §2's engine** on the schema and the write path, which are already ours. Do not proceed to Phase 2 on an engine that is not trusted. (The fallback was *adopt a vendor* until D-93 adopted one at G-A) |

**G-C is the one that matters and it is named in the roadmap already.** Writing the fallback down
now — *build the engine*, since D-93 adopted the vendor — is what makes it a gate rather than a
wish, because the decision at that point will be made under schedule pressure by people who have
just spent a quarter on the thing they would be abandoning.

## 8. Two smaller things that pay for themselves

- **Do not let one person own it alone.** Sync is the classic place where an individual's mental
  model quietly diverges from what the code does, and the divergence is invisible until it is
  expensive. Design review by a second engineer on the protocol, the policy registry and the
  retraction path specifically.
- **Dogfood the throwaway module for a month.** [08-roadmap.md](08-roadmap.md) already specifies a
  three-entity module exercising every merge policy. Use it as the team's own shopping list, on
  real phones, on real networks — then delete it. A month of genuine irritation surfaces things no
  conformance suite will.

## 9. What this changes in the plan

| Was | Now |
|---|---|
| Phase 0 builds the engine, then modules follow | Phase 0 **week 1**: schema mandate + buy-vs-build spike (G-A). Then the conformance suite. Then the engine, which since D-93 is PowerSync plus Household's push, streams and client library |
| Offline writes ship complete | Offline writes ship **per merge policy**: `additive` and `state_set` in Phase 1, the rest gated on the suite |
| Sync-health screen in Phase 4 with the admin module | Sync-health screen in **Phase 0** |
| "If sync is not solid, everything stops" | A named gate (G-C) with a named fallback: adopt a vendor, and since D-93 adopted one at G-A, build the engine |
| Divergence found by users | Divergence found by **replica digests**, alerted on, resnapshot automatically; since D-93, by PowerSync's bucket checksums first (§5) |
