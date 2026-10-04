# 0022 — Platform staff read through a role held to metadata, act through the spine as a service, and are logged in the transaction of each action; flags and raised ceilings are read where they are enforced, and the loader keeps an administrator's edit

- **Status:** Accepted
- **Date:** 2026-10-04
- **Plan item:** 21
- **Decides for:** [PRD 02](../prd/02-identity-and-access.md) §8, FR-PS1, FR-PS2; [01](../prd/01-architecture.md)
  §2.3, §2.4, §10; [04](../prd/04-billing-and-entitlements.md) §3, §5; [05](../prd/05-privacy-and-compliance.md) §6;
  [06](../prd/06-clients.md) §7; D-3, D-75, D-93, D-143–D-148; [ADR 0004](0004-database-roles-migration-blocks-and-test-databases.md),
  [ADR 0006](0006-sync-ready-schema-and-the-mutation-spine.md) and [ADR 0008](0008-reference-data-pipeline.md)'s
  consequences for item 21

## Context

PRD 02 §8 gives the platform two roles, `support` and `platform_admin`, says what each sees and does,
and says that neither reads household content, by the absence of a mechanism rather than by policy
(D-3). Item 21 builds them, and these questions came with it:

1. **How staff read.** A search for a household by its name, or by a member's address, reads across
   households. The request role cannot: outside a household's context row-level security admits it to
   its caller's own households alone, and inside one it reads every row of that household, content
   among it. PRD 01 §2.3 said there is "no support role".
2. **How staff write.** Every write is a mutation the spine records, with an actor it takes from the
   tenant scope: a member, or the system. FR-AL7 wants a staff action in the household's own log as a
   service's, and several support actions change no entity's row at all (a credit at the payment
   processor, an invoice sent again), where the spine commits only a mutation that reports a change.
3. **Where the platform's own log is written.** FR-PS2 wants it append-only, in a schema of its own,
   kept seven years.
4. **Who the staff are**, and who makes the first.
5. **What a feature flag holds.** PRD 06 §7 wants one per household and per platform, "so a module can
   ship dark", and a module's rows replicate through streams PowerSync evaluates, not the server.
6. **Where a raised ceiling is read.** Item 16 kept the fair-use ceilings as constants, enforced in
   seven places, one of them in memory.
7. **What the reference loader does to a row an administrator edited**, which ADR 0008 left to this
   item.

## Decision

**Staff read through a role of their own (D-143).** `household-api bootstrap` makes a fourth server
role, `household_staff`, with no attribute but `LOGIN`; `serve` opens a pool as it
(`HOUSEHOLD_STAFF_DATABASE_URL`), and every read of the staff API runs there, in one read-only
transaction a response. Migration `01025` admits the role to the rows of the tenant tables it reads
(`enable_staff_read`: a `FOR SELECT` policy to that role alone) and grants it `SELECT` column by
column: an account's address, verification, language, sign-ins and devices, and whether its second
step is on or locked; a household's name, country, payer, subscription state and clocks, members and
their roles, enabled modules, bytes stored by module, notifications by their catalog key and their
outcome, plan and invoice totals, and its audit events' module, action and time. Not a summary, its
arguments, a diff, an entity's id, an actor, a file's name, an invoice's lines, a notification's
arguments or rendered text, an address a notification went to, or an account's name. Architecture test
12 holds the role to a list of those columns in the test's own source, as test 11 holds the meter; a
column added later is not the role's until the list names it. Test 2 accepts the staff's read policy
beside the meter's.

**Staff write as the request role, through the spine, as a service.** `mutation.AsService(ctx,
Service{Label, Witness})` names the actor of every mutation made in a scope that has no caller
(`tenant.Assume` with no user): the event is recorded with `actor_type` `service`, the label `support`,
and no actor id. The staff package builds that context for each action and calls what already exists:
`billing.Service.ExtendTrial`, whose event is the entitlement's own; `household.Service.Suspend` and
`Unsuspend`, which change the household's row. An action that changes no entity's row is recorded by
`mutation.Note`, an event with no sync change, in a transaction the staff package opens
(`tenant.InWriteTx`); it marks the request's Idempotency-Key committed there, as `Apply` does. Both
are the platform's alone: architecture test 4 fails a module that names either.

A credit is the one action whose effect is outside the database. The processor is asked last, inside
the transaction that records the credit, so that a refusal records nothing; and the credit is named
to it by the request's Idempotency-Key (`NewCredit.IdempotencyID`), so that a request sent again
after an answer that never arrived, or a commit that failed, is the one credit there. What it says on
the processor's record is a catalog message in the household's language, as a storage line is.

**The platform's log is written by the spine's witness (D-145).** `Service.Witness` runs in the
mutation's transaction once its event is written, and the staff package's witness inserts the entry:
who, by the address they had, their role, the action, the household, the reason, and the event's id.
So the effect, the household's event and the platform's entry commit together, and an action that
changes nothing writes none of the three. An account's action takes the same shape without a
household: each of identity's support methods takes a `Witness` it runs in its own transaction. The
log is `platform.audit_log`, in a schema the public schema's default privileges do not reach: the
request role is granted `SELECT` and `INSERT`, and nothing is granted `UPDATE` or `DELETE`. Entries
past seven years are deleted by `platform.purge_audit_log()`, `SECURITY DEFINER`, which takes no
argument, so that no caller can ask for a shorter retention; the nightly expiry sweep calls it. The
log names a household by its id alone and outlives its erasure.

**A staff member is an account (D-144).** `platform.staff` holds an account's role. The staff
middleware reads the row and the account's second step on every request, as the request role, and
admits by the role the route asks for. A route reads its Idempotency-Key only behind that admission,
as a module's does behind its gate: a key answers a repeat with what the first request was answered,
and one who is staff no longer is answered `404`, not that. `household-api staff grant <email>
<role>` and `staff revoke <email>` change the staff as the operator, recorded as the operator's; they
are how the first `platform_admin` is made. Granting, revoking and demoting take a lock on the table,
so that two at once cannot both find the other still an admin, refuse the last one, and read the
caller's own role again under the lock, so that an admin taken out while their request was on its way
does not finish it as one.

**A flag is data, and a module's flag gates its level (D-146).** `platform.feature_flags` holds a
flag's setting for the platform and `household_flags`, a tenant table, a household's own. The tenant
middleware reads both with the ceilings in one statement and carries them in the scope
(`Scope.Flag`, `Scope.Flags`). `tenant.Levels` joins the flag `module.<id>`: where it is off, the
module's enablement reads as off, so its routes answer `404`, the push refuses it and a notification
about it goes to nobody, as for a module the household does not enable. Household settings (`admin`)
is the one module whose flag gates nothing: it is never disabled (FR-HA8, `patchModulesByModule`),
and a flag would leave a household's owners with no level on it and nobody among them who could turn
it on again. The generated
streams do not read the flags, so a replica still holds the rows of a module whose flag was turned
off: the scope carries, beside each level, the level the streams read, by enablement and grant alone
(`Scope.Replicated`), and a replica's report is compared with that (`replica.Expected`, D-125).
Compared with the flag's level it would disagree for as long as the flag stayed off, and the replica
would be told to download itself again after every report.

**A raised ceiling is read where it is enforced (D-147).** `household_limits`, a tenant table, holds
a household's own value for a ceiling. `fairuse.Ceiling(ctx, tx, household, key, fallback)` reads it
in the transaction that enforces the ceiling: the members', a module's rows, the objects, and the
day's sync mutations, each of which had the household's context open already. The two with no
transaction read it from the scope (`Scope.Limit`): a file's size, and the API's rate, for which the
in-memory buckets now fill at a rate of their own (`ratelimit.Buckets.TakeAt`). `chat_messages` is
kept and read by item 85. A value is at most 2^53 − 1, the contract's maximum: what every client
reads exactly, and far enough below the largest `int64` that nothing computed from a ceiling where it
is enforced, four fifths of it or a form's length past it, overflows.

**The loader keeps an edit (D-148).** Every reference table carries `edited_at`. The loader's upsert
writes a row that exists when `(edited_at IS NULL) = (its values differ from the files')`: an
unedited row that differs takes the files' values and a new version, and an edited row that agrees is
released, its mark cleared and its version left. An edited row that differs is left alone and counted
(`Report.Held`), and `migrate` logs the dataset at warning level. Nothing in this item sets the
mark: the operations that edit reference data come with their tables (items 56 and 68), and inherit
the rule.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| The request role assuming each household's context to read its metadata | In that context it reads every row of the household, so what keeps content out of an answer is each handler's choice of columns, which is policy. And it cannot search: outside a context it sees its caller's households alone |
| Widening the meter role's columns | Test 11 holds the meter to what names, counts, sizes or schedules rows. A name or an address is none of those, and a role held to two rules is held to neither |
| A `SECURITY DEFINER` function per staff read | The reads are a dozen ad hoc queries; each function would be a bypass to audit on its own, where a role's privileges are one list a test reads |
| Passing the actor to `mutation.Apply` as an argument | Every caller of Apply would name an actor, and a module could name any. The scope's caller stays the actor; the service is named only where there is none |
| Writing the platform's entry from the handler, after the action | A process that dies between the two leaves an action with no entry; written before, an entry for an action that failed |
| Making limits and flags entities, changed through `mutation.Apply` | They are the platform's record about a household, replicated to no device; as entities they would need streams, a merge policy and a client table for rows no client reads |
| A `DELETE` grant on the log for the expiry sweep | The request role could then delete any entry. The function deletes only what is past seven years, and takes no argument |
| Holding the generated streams to the flags | PowerSync would replicate both flag tables and every stream would join them, for the one case, a flag turned off after use, that disabling the module answers and retracts. A module that ships dark has nothing to replicate |
| Loading ceilings into the scope alone | A scope the middleware did not resolve (`tenant.Assume`), as an invitation's acceptance runs in, has none, and would hold the household to the constant |
| The files overwriting an edit on the next deploy | An edit not copied into `reference-data/` before the next deploy would be lost without a word (D-148) |
| Porting `home`'s `platform/statusreport` | It reports crashes to a status service Household does not have. Crash reports reach support through the error aggregation item 89 sets up (plan Q14) |

## Consequences

- A deployment has a fifth connection string, `HOUSEHOLD_STAFF_DATABASE_URL`, and `bootstrap` must
  run before `migrate`, as it already must for the meter: `01025` grants to a role that has to exist
  ([runbook](../runbooks/platform-staff.md)).
- A migration that adds a column staff should read grants it to `household_staff` and names it in
  test 12's list, in the same PR. A new tenant table staff read calls `enable_staff_read`.
- A support action on a household is a function that takes the caller's context and, where it is no
  mutation, a transaction: the staff package supplies both. `billing.Service.ResendInvoice` changed
  shape for it, and `Credit` takes the name of its request and renders its own note.
- The household's log now holds events with no sync change beside them (`admin.support.credit`,
  `…invoice`, `…redrive`, `…limit`, `…flag`). Item 52 renders a `service` actor's label through the
  catalog (`activity.actor.support`).
- A flag turned off for a household that has used its module stops the module's routes and its push;
  the rows already on its replicas stay until the module is disabled, and their reports still match.
- Every household-scoped request reads the household's ceilings and flags, one indexed statement
  more in the tenant middleware's transaction. Item 90 measures it.
- Items 56 and 68 add `edited_at` to their reference tables and build their upserts from
  `reference`'s `theirs`, `bumped` and `released`; their admin operations set the mark.

**Revisit this when** staff need to read something that is not a column of one table (an aggregate
across households is a view the role is granted, not a wider grant), when the platform's log needs a
reader other than `platform_admin`, or when a flag must retract.
