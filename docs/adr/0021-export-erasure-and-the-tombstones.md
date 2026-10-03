# 0021 — An export is its requester's archive, built by a worker and streamed to the store; erasure deletes a household by its row, an account table by table, and leaves a tombstone

- **Status:** Accepted
- **Date:** 2026-10-03
- **Plan item:** 20
- **Decides for:** [PRD 05](../prd/05-privacy-and-compliance.md) §3–5, §9; [02](../prd/02-identity-and-access.md)
  FR-ID8, FR-PS1; [01](../prd/01-architecture.md) §2.4, §4; [03](../prd/03-platform-strands.md) §5; D-6, D-35,
  D-93, D-136–D-142; [ADR 0005](0005-tenancy-registry-and-row-level-security.md),
  [ADR 0006](0006-sync-ready-schema-and-the-mutation-spine.md) and
  [ADR 0015](0015-files-object-storage-the-meter-and-pictures.md)'s consequences for item 20

## Context

Every module has declared `ExportSource` and `EraseSource` since item 3 (D-6), and none did anything:
the interfaces took a household and a writer, and no caller existed. Item 20 is the caller, and these
questions came with it:

1. **What a module is handed.** A module may open no write transaction and make no scope of its own
   (architecture test 4), so it can neither read a household for an export nor delete in one unless
   the platform hands it the transaction. And an export is not one document: FR-PR2 wants structured
   JSON, the original files in the module's own folders, and readable derivatives.
2. **Whose an export is.** FR-HA15 makes a household's export an owner's, and D-19 keeps an adult's
   private items from every other member, owners included.
3. **How large an archive is.** A household at its storage ceiling keeps 205 GB (PRD 04 §4); the
   store's `PutOnce` takes a body whose length is known.
4. **How a household's rows are found to delete.** The request role may neither update nor delete
   the audit log (FR-AU5), and no module's list of its own tables is checked by anything.
5. **What erasure writes through.** Every write is a mutation the spine records, and the spine's
   record is an audit event in the household that is being deleted.
6. **The order of the rows and the objects**, which share no transaction.
7. **How a disabled account comes back**, when FR-PR4 revokes everything that would authenticate the
   contract's `DELETE /me/deletion`.

## Decision

**A module exports and erases in a transaction the platform opens.** `ExportSource.Export(ctx, tx, e,
a)` is called in a read-only transaction of the household, with no caller, and is told by `e` whose
export it is and how much of the household it takes: `household`, an owner's, everything its requester
may read; `personal`, a member's, what they made and what they keep privately; `departed`, a former
member's private items alone. It writes through `module.Archive`: its JSON once, any derivative by
name, and files by the entity they belong to, which the platform copies from the store after the
transaction has ended, so that no transaction is held for the hour a household's files may take.
`EraseSource.Erase(ctx, tx, e)` is called in a transaction that may write, the platform's own, for one
member's private data, or for a household, where a module deletes only what the cascade from the
household's row does not reach. The platform's own module, admin, names its two functions on
`module.PlatformModule`, and architecture test 3 holds it to them as it holds a module.

**An export is a row of its requester's, global, and a job (D-139).** `exports` is keyed by its user
and names a household or none; it is listed and linked to that user alone. A worker in every instance
claims the export that waited longest by moving it past a six-hour lease, builds it, and settles it
under the claim it took, so that a try whose lease another took writes nothing. A build that panics,
in a module's `Export` or anywhere else, is recovered and the export failed for good, as the files
workers answer a job that panics: left to pass it would end the process. The archive is a ZIP
written to a pipe and sent to the store as it is built, in 32 MiB parts (`objectstore.Store.Upload`),
at a key under the requester's own prefix that names the try, `u/{user_id}/exports/{id}/{claim}`: no
archive is ever on a disk, and one part of it is in memory. `manifest.json` is its last entry and names
every other with its length and its SHA-256. The platform writes the activity log, rendered in the
requester's language and redacted by the one rule every reader of the log applies
(`audit.Redacted`), a name or a summary that begins as a formula does written behind an apostrophe,
so that the spreadsheet that opens the log shows it and runs nothing. An archive's link is pre-signed
per read of the job, as every link is (D-9), and a household's only for a requester who is still an
owner when they read it, as the worker builds one only for a requester who still is; the email that
says it is ready links to the list.

**A household is erased by deleting its row (D-140).** `privacy.EraseRows` asks each module, then
deletes the household's row, as the request role in the household's context: every tenant table
references `households (id) ON DELETE CASCADE`, directly or through a table that does, and referential
actions run past row-level security and the request role's privileges, so the audit log, which that
role may not delete from, goes too. `internal/arch`'s erasure test runs it over the isolation fixture,
which holds a row of household A in every tenant table, and fails any table that still holds one, or
that lost one of household B's.

**A household erased is no longer charged, and an erased account's customers go with it.** Item 19
merged while this item was built, and left it both
([ADR 0020](0020-billing-the-processor-webhooks-the-payer-and-storage-lines.md)). `billing.Service.Close`
ends every subscription of the household's that is not over at the processor, inside the
transaction that erases it, once the row's lock is held and its being due is confirmed, and before
the rows that name the subscriptions go: a processor that cannot be asked leaves the household as it
was, for the next night, and one asked that then fails to commit has lapsed a household that was due
to go. They end at once, with no final invoice and nothing refunded for the days not used (D-140).
One the rows say is not paid for is ended only while the processor says so too, before any other
is: the rows are what the events said so far, and a payment the processor has taken whose event is
late or lost must not be undone, and a lapsed household erased, by a reading older than it. That is
one that waits and that the rows say charges nothing yet, ended only while it still waits
(`Processor.Abandon`), and the household's own that the rows say could not be collected, read from
the processor before it is ended. Where the processor says such a subscription charges, or is paid
for, nothing is ended, the erasure fails (`billing.ErrBehind`), what the processor says is recorded
as its event would have (`billing.Service.Refresh`), and the job's next run decides from that.
`billing.Service.Forget` deletes the account's customers at the processor before the
transaction that leaves the tombstone deletes their rows; the processor ends whatever subscription a
customer still has with it, and keeps the invoices it issued as its own record (PRD 05 §1). Whether a
payer must cancel first is read from billing's rows (`household.Standing.Paying`): a subscription of
the household's own that is live and not cancelled at its period's end, or one that waits on a first
payment the processor has on its way, which renews once that goes through. Whoever pays one that
waits so counts as the household's payer there (`household.Standing.Payer`), as an owner taking
billing over with a bank debit is before it clears. An owner who accepted the offer and has
confirmed no card is in no row, and is not blocked: billing's own reading of who is an owner
(`isOwner`) leaves out one whose account is scheduled for deletion, as the household surface's does
(D-137), so no offer names them and the card they confirm afterwards makes no subscription and
moves no payer, however late the processor's word of it arrives. The same wait keeps a
lapsed household from being erased by its clock (`billing.Awaited`, D-140): resuming restores a
household at any point of its retention, a bank debit takes days to clear, and the job reads the
household as not due, at its search and again under the row's lock, until the processor has said
how the payment went. So does a payment already recorded: billing records what the processor says
in one transaction and settles the household's row from the record in the next, so a household
whose own subscription the rows say is paid up is read as paid for, whatever its row still says,
until that settling, or the event delivered again after one that failed, has made it `active`. An
export carries `billing.json`, its requester's own subscriptions and invoices and nobody else's
(FR-BI5).

**An account is erased table by table, last.** In each household the account is in, each module
first deletes what the member kept privately, the notifications sent to them go, and `forget_actor`
takes their name off the events they caused, a `SECURITY DEFINER` function that makes that one change
of a log the request role otherwise only appends to (D-141). Then the household surface says what
becomes of the household (`household.Service.Depart`, D-137): it goes with the account and is erased
as above, or it goes on, the membership ended by a mutation of the system's through the spine, with
the owner who succeeds, where one must, made by a mutation before it. A household that goes is erased
under its row's lock only with the members it was resolved with: one who joined since leaves the
account scheduled, and the household is resolved again on the job's next run. One whose deletion
follows the account's goes with it whoever owns it by then, as it would the night after were it kept.
The account's own tables go in one transaction at the end, which empties the `users` row and sets
`deleted_at`: a failure before it leaves the deletion scheduled, and the next night goes over the
households again, each step a no-op where it was done. The job ends the deletion's cancel link before
it reads the deletion it is to execute, the link first and the row after, as a cancellation takes
them: one under way is waited for and has taken the row by then, and one that comes later finds its
link spent, so that nothing cancels a deletion whose execution has begun, and no account is answered
as kept and erased all the same. It finds the households by the account's memberships and
its departures, so in each household whichever of the two it is goes last: a membership ended before
what the household keeps of the member was deleted would leave a failed night's remainder there for
good.

**Erasure records no audit event, and leaves a tombstone.** It writes through `tenant.InWriteTx` and
`tenant.AccountTx`, the platform's own paths, as the expiry sweep's deletions do. `erasures` keeps the
id of what was erased, the day and the cause, and whether its objects are gone. The rows commit first
and the objects under `h/{household_id}/` or `u/{user_id}/` are removed after, by the tombstone, as
the run that erased them ends: one pass removes every erasure's objects and counts them. The nightly
job removes them again for three days, since an upload in flight when its household was erased put
its bytes after the first pass, and the files sweep lists only households that exist. The prefix is
the household's id, which a client chooses when it makes one, so an erased household's id is refused
to a new one, as an id another household has is (`postHouseholds`, `422` naming `/id`): a household
made under it would keep its files where the job goes on removing them.

**The deletions are columns and rows a job finds.** A household's is four columns of its own row,
written through the spine as its settings are, so that its members' replicas learn of it and its log
records who scheduled it; the meter role reads `deletion_scheduled_at` to find the households due, as
it reads the entitlement's clocks. Scheduling one counts among the household's five a day (D-138) in
the mutation's own transaction (`ratelimit.Throttles.TakeIn`), so that a request that schedules
nothing, refused or answered with the deletion already pending, counts for nothing and leaves no
refund to make. An account's is a row of `account_deletions`, whose existence
disables the account: identity's admission reads it under a lock on the user's row, which scheduling
takes first, so that no sign-in commits beside it. Admission never waits for that row: one a
scheduling holds reads as the account disabled, since a sign-in that waited for it while holding the
challenge its second step answers would deadlock with the scheduling that ends the challenges.
`departures` records each member who left, with the day their private data goes, and stays while the
household does, as the way an account's erasure finds the households it was once in. An invitee who
declined is recorded there too, as erased already (the household surface's `Named` hook): the
decline's event names them in the log of a household they never joined, which nothing else would
find.

**The job runs nightly at 02:30 UTC**, between the sweeps at 02:00 and the expiry sweep at 03:00,
ninety minutes before PowerSync's compaction, which then drops the erased rows from bucket storage
(D-93).

**The account comes back by its link (D-136).** `POST /auth/deletion/cancel` is public and takes the
token the email carried; `DELETE /me/deletion` is removed from the contract. The email is sent once,
after the response, and is not always delivered, so a password reset asked for at the account's
address sends the link again in place of a reset link, which would set a password that signs nobody
in. The link sent again is the same row of `email_tokens` with a new token, not a second row: the
job that begins a deletion's execution ends the links it finds, and a row inserted beside them at
that moment would be one it had not seen.

## Alternatives rejected

- **A module's own transaction for export and erase**, the interfaces as item 3 left them. A module
  would need `tenant.Assume` and `tenant.InWriteTx`, which test 4 keeps from it for the reason it
  exists: a scope a module made itself reads and writes whichever household it names.
- **One list of deletes per module for a household's erasure.** A table left out of a list is rows of a
  household that no longer exists, readable by nobody and deletable by nothing. The cascade is the
  schema's own statement of what belongs to a household, and it was already there.
- **Erasure through the mutation spine.** The spine commits only what it records, and what it records
  is an event in the log being deleted. A final event in a platform log is item 21's, whose schema is
  not built; the tombstone says as much as that event would.
- **Spooling an archive to a file before storing it**, as an upload is spooled. An upload is capped at
  100 MB; an archive is as large as the household.
- **Exports as tenant rows under the household's prefix.** A member's own export has no household, and
  the files sweep removes whatever under a household's prefix no `files` row records.
- **A column grant on `audit_events.actor_label`** in place of `forget_actor`. It would let any
  statement of the request role rewrite any actor's label to anything; the function clears one actor's,
  in the household of the transaction's context.
- **Deleting the objects before the rows.** A failure between the two would leave a household whose
  files' rows name bytes that are gone, for its members to meet until the next night.

## Consequences

- A module's server PR implements both interfaces for real: `Export` for the three scopes, and
  `Erase` for a member's private data. A module with no private root erases nothing of a member's.
- A new tenant table references its household with `ON DELETE CASCADE`, or its module erases it; the
  erasure test fails the PR otherwise. The isolation fixture's row for the table is what proves it.
- `billing.Processor` gains `DeleteCustomer`, and billing `Close`, `Forget` and `Export`: what
  [ADR 0020](0020-billing-the-processor-webhooks-the-payer-and-storage-lines.md) left to this item;
  and `Awaited`, which the erasure of a lapsed household waits on, with `Refresh`, which records
  what the processor says of a subscription the rows said was not paid for, one that waits or the
  household's own, when `Close` refused to end it. What the
  processor says later of a subscription whose household is gone is about nothing, as billing
  already takes it (`errGone`).
- The erasure of a lapsed household knows its own subscription to be paid for by the status the
  processor gives it, which is `active` only once a payment has succeeded: a bank debit begun for
  an invoice it could not collect leaves it past due while the debit clears, and nothing the
  server reads tells that from a subscription nobody pays. So `Close` ends a lapsed household's own
  subscription only once the processor has given it up, and refuses one it still collects
  (`ErrCollecting`): the household is kept and the job reports it each night. Stripe is set to
  cancel a subscription, or mark it unpaid, once its retries end
  ([the billing runbook](../runbooks/billing.md)), so that a lapsed household has no subscription
  of its own left to pay into, its payer subscribes again, and that payment is waited for; set to
  leave one past due, a household that lapsed on a failed payment is not erased until someone ends
  its subscription there. That errs towards keeping data past its retention, which an operator sees and can put
  right, over erasing a household somebody is paying to keep, which nobody can.
- Item 21 reads `diagnostic_bundles` (`getPlatformDiagnosticsByBundleId`), and may record erasures in
  the platform audit log.
- Items 25 and 29 build A-20 over `postMeDeletion`, and item 25 the page the email's link opens,
  `account/deletion/cancel`; item 27 builds A-34, A-35 and C-56 over the exports, the consents and the
  household's deletion, and reads `deletion_scheduled_at` from the household's replicated row.
- Item 43 adds the owner's hard-delete of a departed member's private items before their window ends
  (FR-PR7), with the first private root it applies to.
- A multipart upload a process died in the middle of leaves parts the store keeps until its own
  lifecycle rule aborts them; items 30 and 88 set that rule on the bucket, and give the API's key
  `AbortMultipartUpload`, as [the object-storage runbook](../runbooks/object-storage.md) says.
- The erasure's deletes replicate to PowerSync row by row; a large household's erasure is a large
  transaction in the replication slot, which item 90 measures.
