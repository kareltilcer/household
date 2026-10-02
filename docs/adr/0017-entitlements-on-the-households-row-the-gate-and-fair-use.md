# 0017 — A household's entitlement lives on its own row and is resolved once per request, the gate names its exemptions by operationId, the streams hold a suspension, and fair use is counted where it is near

- **Status:** Accepted
- **Date:** 2026-10-02
- **Plan item:** 16
- **Decides for:** [PRD 04](../prd/04-billing-and-entitlements.md) §1, §3, §5 (FR-BI1, FR-BI2, FR-BI7);
  [PRD 03](../prd/03-platform-strands.md) §2.6 and §5; [PRD 10](../prd/10-sync-risk.md) §4 (scenario 14);
  D-30–D-32, D-87, D-93, D-114–D-119

## Context

Plan item 16 builds what a household may do as its subscription, its owners and the platform leave
it: eight states, a gate that refuses what a state does not permit, an owner's restriction of
processing, the clock that moves a trial and a lapse along, and the fair-use ceilings. Item 3 left the
tenant middleware a hook for the gate, item 10 left `Household.entitlement` out, item 13's
credentials and streams knew nothing of a suspension, and item 14's storage `402` said `trialing`
whatever the household was.

What had to be settled:

1. **Where the state lives.** PRD 04 §3 resolves it once per request, the restriction needs its own
   audit event (FR-BI7), and the streams must be able to read whether a household is suspended.
2. **How the gate knows an exempt operation.** FR-BI1's list is closed and names paths and methods;
   the tenant middleware runs before the household router has matched a route.
3. **How grace blocks uploads alone**, when the gate sees only a method.
4. **How a suspension reaches the replicated path.** PowerSync's reads pass no middleware, and the
   credential it connects with names a user, not a household (ADR 0014).
5. **Where the fair-use ceilings are counted**, when a live count of a module's rows on every create
   would cost a scan per write, and every module writes through one spine.

## Decision

**The state is columns of the household's row** (`01020_entitlements.sql`): the subscription's own
state (`billing_state`, an enum of the six money decides) and the clocks that time it (`trial_ends_at`,
`dunning_ends_at`, `grace_ends_at`, `lapsed_at`, `retained_until`, `retention_warnings`), the owner's
restriction (`restricted_at`, `restricted_by`, the label they had then, the reason), and the platform's
`suspended_at`. Check constraints tie each state to the clocks it needs. `internal/platform/entitlement`
reads them (`Columns`, `Row`) into a `Status`, whose `State` is D-114's precedence, and holds every rule
that is not SQL: what each state permits, the gate, the `402` and its remedy, the clock (`Advance`,
`RetainedUntil`, `WarningsDue`) and the banner (`Summary`, DD-9's notice). It imports neither the tenant
package nor the database. A change of the state is a change of `admin.household_settings`, through the
mutation spine with its audit event: an owner's restriction and its lifting
(`admin.household.restrict`, `.unrestrict`), and the hourly job's moves and warnings
(`admin.household.entitlement`, `.retention_warning`), the system's. The trial begins with the row: its
default, `now() + 720 hours`, in the insert that creates the household, so the change the creation
records is the household's first version. Item 10's `Hooks.Created`, which an `UPDATE` would have used
a version later, is gone.

**The tenant middleware reads the state with the membership** (`tenant.resolve`, one more row of the
same transaction) into the scope (`Scope.Entitlement`), and asks the gate. **The contract's edge carries
the operation it validated into the request** (`contract.OperationOf`), and the gate (`app.Gate`,
`entitlement.Gate`) decides by its `operationId`: a suspended household answers `404`; a safe method goes
on; an unsafe one goes on in a state that writes or when its `operationId` is on the closed list; every
other is `402`, with `entitlement_read_only` or `entitlement_restricted`, the state, and the remedy for
the caller. A request no route matches is refused like any unsafe one. `NewRouter` installs the gate
unless a test replaces it. A test holds the list to the contract both ways: the household-scoped unsafe
operations that declare no `402` are exactly the list, and every operation in every state answers as
the list says.

**Grace's refusal is the files pipeline's** (`files.Put`): an upload in a state that does not upload is
refused with the same `402`, and the storage ceiling's `402` names the state the request found.

**The streams hold a suspension.** Every lookup the generator writes (`sync.Streams`) joins the
subscribed household, `h.id = subscription.parameter('household_id') AND h.suspended_at IS NULL`, and
reads `households` among its tables. PowerSync drops a suspended household's buckets from every replica
that connects, and adds them again when it is lifted; the conformance suite's `suspension` scenario
runs it against PowerSync, its oracle holding a suspended household to nothing. The credentials route
answers a suspended household `404` as every other route does.

**The push's batch is the gate's** (D-118): the gate answers `402` before the push runs, so no answer is
kept and the batch the client holds is applied whole once the household writes again. The suite's
connector records each mutation with the `402`'s code and holds it.

**Fair use is counted where it is near** (`internal/platform/fairuse`, D-116). The mutation spine asks a
`mutation.Ceiling`, carried into each member's request by middleware, of every mutation that creates
rows (an upsert at its first version): `storage.RowCeiling` reads the module's row count in the
household's last daily sample, one indexed read in the mutation's transaction, and only at 80 % of the
ceiling counts the module's tables live, as the meter role reads them. A refusal is a `403`, which the
push answers `rejected`. The files pipeline counts objects beside the bytes it already sums; a household
creation counts the caller's owned households under an advisory lock of the user's (`db.OwnerLock`),
reading them outside the new household's context in its own transaction (`tenant.Outside`); joining
counts the members under the household's lock. The nightly sample warns the owners of a crossing of
80 %, compared with the sample before it, and so does the tenth member's arrival.

**The hourly job** (`household.Service.Transition`, `entitlement.transitions`) finds the households with
a clock run out as the meter role, which reads the schedule columns and nothing else (architecture test
11), and moves each along in a mutation of the system's, then sends the warning due: the latest of those that fell due, alone, and when it goes late it moves `retained_until` out to its lead from now (`Status.Warn`), so that no household is deleted sooner than a warning said.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A table of its own for the entitlement | A restriction must record an audit event through the spine, which records only a change of a declared entity: a table of its own would be a new entity, a new stream and a new replicated table, for a state every member reads with the household anyway. The cost of the row is that a change of the state moves the household's version, so an owner's `If-Match` on the settings made across a transition answers `409` with the current settings; transitions are a handful in a household's life |
| The gate deciding by path patterns of its own | A second spelling of the contract's paths, beside the router's and the edge's, which drifts from them silently. The edge has matched the operation already; its `operationId` is what the contract and the test both name |
| Exemptions read from the contract (an unsafe operation that declares no `402` is exempt) | FR-BI1's list is closed in the PRD; a contract edit that forgot a `402` would open a write path. The list is code and the test holds the two to each other |
| Refusing the credentials of a suspended household, and nothing else | The credential names its user: a member of two households subscribes to a suspended one with the token the other's route hands out, until it expires and after |
| A live count of a module's rows on every create | A scan of up to 250 000 rows per write, every write, for a ceiling that exists to catch automation. The sample bounds the count to households already near it, and a household below 80 % cannot reach the ceiling within a day |
| Counting only from the sample | A household at the ceiling would stay refused until the next night after it deleted rows |

## Consequences

- A module holds no billing logic and no fair-use logic: the gate, the spine and the files pipeline
  hold both.
- Item 19 moves the subscription through the same columns from Stripe's webhooks, entering `past_due`
  with its `dunning_ends_at` and `active` with every clock cleared; the hourly job is its backstop.
- Item 20 deletes a household whose `retained_until` has passed with its three warnings sent.
- Item 21 sets `suspended_at`, and raises a ceiling per household, which `fairuse` names as constants
  until then.
- Item 17 decides whether the state reaches a client by the realtime frame `entitlement_changed`; until
  then a client reads it from the household and learns of a lapse from a `402`.
- Two creates at once near a ceiling may pass it by one each, and a suspended household's replica on a
  device that never connects again keeps what it held (FR-SY8). Revisit if either matters.
