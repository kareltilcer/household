# 0016 — One instance leads the scheduler through an advisory lock and takes each slot by a guarded update; notifications are queued in the transaction of their cause, filtered and rendered when they go out, and delivered by workers in every instance

- **Status:** Accepted
- **Date:** 2026-10-01
- **Plan item:** 15
- **Decides for:** [PRD 03](../prd/03-platform-strands.md) §4 (FR-NT1, FR-NT2, FR-NT5, FR-NT6) and §5;
  [PRD 06](../prd/06-clients.md) §6; [modules/17](../prd/modules/17-household-admin.md) FR-HA5, FR-HA12;
  D-78, D-110, D-111, D-112, D-113

## Context

Plan item 15 builds what makes the platform act without a request: a scheduler for the jobs PRD 03 §5
lists, and the transports every module will tell its members through. Before it, item 14's usage
sample and sweeps had nothing to run them, item 8's and item 9's tables grew without bound, and the
household surface sent its emails from an in-memory queue a restart loses (ADR 0009), told an inviter
of a decline by email for want of anything else (ADR 0011), and told nobody of a lowered grant (D-78)
or a locked child profile (A-18).

What had to be settled:

1. **How several instances fire a job once.** PRD 03 §5 asks for a leader lock. A lock alone does
   not stop a double fire while a leader whose connection the database dropped has not noticed, and a
   leader's memory of what it fired goes with it.
2. **What a notification is between its cause and its delivery**: queued where, durable how, and
   decided when. FR-NT5 says filtering happens at send time, per recipient; a notice held overnight by
   quiet hours must survive a restart.
3. **Where each transport's target lives.** `devices.push_token` exists (item 9); a browser's
   subscription has no table; an email address is the account's.
4. **Secrets in a durable queue.** An invitation's and a graduation's email carry a single-use token
   the database otherwise keeps only as its hash (ADR 0009 rejected a durable outbox for exactly this).
5. **What a member's preferences are** across households, and what quiet hours do.
6. **Who reads across households** for the delivery workers and the expiry sweep, since every
   household's queue and log are its own.

## Decision

**The scheduler** (`internal/platform/scheduler`) runs in every instance. Each tick, fifteen seconds,
it holds or takes a session-level advisory lock on a connection it takes from the pool and, leading,
takes out of it (`Hijack`), so that the pool makes another for the requests and the workers in its
place; a leader whose connection no longer answers a ping has lost the lock with its session, and
closes the connection. The leader starts each job due that is not running already. A job's next
slot is a row in `scheduler_jobs`, taken by `UPDATE … SET next_run_at = <next slot> WHERE name = $1
AND next_run_at <= $now`: PostgreSQL serialises two such updates on the row, and the second matches
nothing, so a slot fires once even when two instances both believe they lead. A slot missed while no
instance led fires once; the slots it missed are not made up. A failed or panicking job is tried
again after fifteen minutes, or at its next slot if sooner. Cadences are `Every(d)`, counted from
the zero time so every instance computes the same slots, and `Daily(hh:mm)` in UTC, the clock of the
jobs that belong to no household's day (D-109); a job about a household's own day, item 53's
digests, runs every minute and resolves each household's time with `internal/platform/localtime`,
which turns a wall-clock time into an instant DST included: a time the clocks skip moves forward by
the gap, and a time they repeat is its first occurrence, but for the end of quiet hours, which is the
reading of the pass the clock is in.

The jobs this item registers (`app.newScheduler`): `storage.nightly` at 01:00 UTC, the usage sample
and then the sweeps of objects no row records, a household's and the accounts' pictures (item 14);
`expiry.sweep` at 03:00 UTC; `expiry.tokens` hourly; `notify.receipts` every fifteen minutes.

**The expiry sweep** (`internal/platform/expiry`) holds PRD 03 §5's retention table as code, row for
row, with the account tables' retentions D-113 decides. Account tables are deleted from by the request
role outside any household. A household's rows, Idempotency-Keys, the push's answers, and what a
notification said and was rendered from, are found across households by the meter role, which is granted the columns that
say when they expire, and deleted in each household's context by the request role, as the usage
sampler writes. The throttle's retention lives in `ratelimit.Sweep`, beside the semantics it depends
on. Invitations that stopped working a month ago (D-110) are deleted by the household package
(`PurgeInvitations`), one mutation each, through the spine, recording `admin.invitation.purge` and the
invitation's deletion.

**A notification is a row in `notifications`**, a tenant table, one per recipient, written by
`notify.Service.Queue` in the transaction of what caused it: the access change's mutation, the
child's lock, the invitation's, the graduation's link. It exists exactly when its cause committed.
It names its recipient, its category, a catalog key and arguments, never rendered text; the module
whose view the recipient must hold, the owner a private item's notice may reach, the in-app path a
push opens, and a coalescing key. Once it is settled, its arguments, which may hold names and an
invitation's personal message, are kept as long as the delivery log keeps what it said, seven days
(`args_expires_at`), and the expiry sweep empties them.

**Workers in every instance deliver**, as item 14's files workers derive: the meter role finds the
households with something due (`status`, `run_at`), a commit of the same instance wakes them, and
each notification is claimed under a five-minute lease with `FOR UPDATE SKIP LOCKED`, chosen by a
subquery in `WHERE`, which PostgreSQL runs once (one in `FROM` may be run again for each row the
`UPDATE` reads, claiming them all). At claim time the worker reads, in the household's context, the
recipient's membership, their effective level on the notification's module (`tenant.Effective`), the
item's owner, their preferences and their quiet hours, and drops, holds or sends accordingly
(FR-NT5): every drop is logged with its reason. Then it renders the message in the recipient's own
language, with the household's name, and the count of repeats merged into it, and sends to every live
target at once, so that a push service slow to answer holds up none of the others. A notification is
settled in one transaction with its log rows and what the attempts say of their targets, each under a
savepoint, so that failing to record a target's health never leaves what went claimed, to go again;
a worker whose lease another took settles nothing. What a worker decided is written
past its context's end, for ten seconds at most, so that a shutdown leaves nothing it sent claimed to
go again once the lease has passed; one the shutdown stopped before it went is put back, its attempt
not counted. A repeat queued while one with its key is going out waits the fifteen minutes, as it
would after one sent. Two transactions queueing one recipient's repeats under one key take turns
under a transaction-scoped advisory lock, so that the second finds what the first committed rather
than each queueing a notification of its own.

**Targets** are the account's: `push_subscriptions` (global), one row per browser endpoint, bound to
the web session that registered it, which takes it along when it is deleted; and `devices.push_token`,
used while the device's sign-in lives. An endpoint must be https at a known push service
(`notify.DefaultPushHosts`, extended by `HOUSEHOLD_PUSH_HOSTS`), since it decides where the server
sends. Web Push is RFC 8030 over `webpush-go` (PL-2): encrypted to the browser's keys, signed with
`HOUSEHOLD_VAPID_KEY`, a day to live, the urgency of who it is for, the hash of its household and its
coalescing key as its topic, following no redirect. Expo is its HTTP API with the project's access token when one is set;
its ticket waits in `push_receipts` (global) until `notify.receipts` reads its receipt. A 404 or 410,
or Expo's `DeviceNotRegistered`, deletes a subscription or clears a token; five failures in a row mark
a target stale until it registers again (FR-NT6). A failure is one the push service lays on the
target, another 4xx or another of Expo's errors; no answer, a 429, a 5xx, a redirect, or an error of
the project's credentials, of the message, or of Expo's or Apple's or Google's own (`Unavailable`,
logged `push_unavailable`) counts against none, or an outage would leave every target it reached
stale. A device's run of failures ends with a receipt saying Apple or Google took a push, not with
Expo's ticket, which says only that Expo did. A push a push service took is not retried, since that
service holds it for the device; one that none took, a service among its targets' unavailable, is
tried again (D-112), its targets' health recorded with each attempt; so is an email, after a minute,
five, thirty and two hours, each given up after the fifth.

**An email's link token waits sealed**, under `HOUSEHOLD_NOTIFY_KEYS`, keys of its own built as
item 9's MFA keys are (`mfa.Keys`: AES-256-GCM, the first seals, each opens), bound to the
notification's id; the email's address and the sealed token are erased when the notification is
settled. A backup holds a sealed token only for the minutes an email waits, and never one that opens
without the key the database does not hold. An email waits under a key of what it says
(`Notification.Replaces`): another queued under the key drops it, and its cause's end withdraws it
(`Withdraw`), so that an invitation sent again, withdrawn, declined or accepted, or a graduation link
sent again or spent, its profile's removal among what spends it, is not emailed late by a mail server
that was down. One a worker is handing to the mail server as it is withdrawn keeps its claim, and the
worker settles it as what became of it: sent, logged after its drop, or left dropped and never tried
again. The graduation's link, an
account row, is written in the household's `tenant.InWriteTx` with its email rather than in
`tenant.AccountTx`, which refuses the tenant table the email waits in: the two commit together, and
the account table admits the request role in either. The delivery log keeps an email's subject, never its
body; a push's title and body for seven days (`body_expires_at`), which the expiry sweep clears.

**Preferences** (D-112) are a member's per household in `notification_preferences` (tenant, keyed on
the membership, which takes them along), over account-wide defaults in `notification_defaults`
(global), over built-in defaults. The first change in a household copies what was in force there.
They are the member's own settings and no household's history: written by the platform through
`tenant.InWriteTx` in the household's context after the membership is checked, neither audited nor
synced, read by the client through `/me/notification-preferences`. Quiet hours are read on the
member's own clock, their timezone or their household's, and hold a push until they end, a minute at
least by the database's clock, which decides what is due; the email set ignores them.

**What the household surface tells** (D-111): the invitation's and the graduation's emails, queued in
their mutation's or their link's transaction; a decline, pushed to the inviter; a lock, pushed to
every owner; a change of a member's role or grants, pushed to them unless the change is their own,
coalescing for fifteen minutes; a removal, emailed to the removed member. The access notice is queued in the change's own transaction
rather than from `household.Hooks.Changed` after the commit, which the plan named: the hook still runs
after it, for any other consumer, and the commit and the notice can no longer part.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| The leader lock alone | A leader whose connection died keeps firing until it notices, and another has taken the lock meanwhile: the slot fires twice. The guarded update costs one row lock per job per slot |
| No leader, the guarded update alone | Every instance would evaluate every job every tick, and PRD 03 §5 asks for a leader; the lock keeps one instance doing the work and the update keeps it right |
| A job's last run in the leader's memory, as `home` kept it | A new leader would fire what the last one just fired, or miss what it never did |
| Rendering when queued, as `home` did | A notice held by quiet hours, or queued before a member changed their language, would arrive in the wrong one; FR-NT5 filters at send time, and rendering there is the same read |
| One table for queue and log | The log keeps an attempt per target and a drop per recipient, and outlives the queue's purpose; the queue keeps what is needed to send, the address and the sealed token among them, only until it is settled |
| The email token in the clear until sent (ADR 0009's objection) | A backup taken in between holds a token that opens a household for 14 days, against a hash kept precisely so that the database alone opens nothing |
| The invitation and graduation emails left on the in-memory runner | A restart would lose an invitation silently while the owners see it pending; the token sealed costs one key |
| Each preference field inherited from the account's unless set in the household | A second preference system to explain on one screen (F-20); a change in a household would mean different things depending on which fields had been touched |
| Preferences through the mutation spine, audited and synced | A member muting a category is no household's history, and the activity log would fill with it; nothing offline needs them before the client is online to change them |
| Quiet hours dropping what falls in them | An access change or a lock the member never learns of; the prototype holds them ("it waits") |
| The access notice from `household.Hooks.Changed` after commit, as planned | A crash between the commit and the hook loses the notice D-78 promises; queueing in the change's transaction costs nothing |

## Consequences

**What gets easier:**
- Item 16 registers its hourly transitions and trial notices as jobs, and tells owners through
  `Queue`; item 53's rules and digests queue through it too, and add `rule_id` to the log beside
  `getNotificationsDeliveries`, which reads `notification_deliveries` and the queued rows.
- A module tells its members of an assignment or a mention by queueing a `direct` notification in its
  mutation with its module and, for a private item, its owner: the grant and privacy filters are the
  platform's.
- Items 17 and 20 schedule compaction and erasure as jobs.

**What gets harder:**
- A deployment carries two more secrets (`docs/runbooks/notifications.md`). The VAPID key cannot be
  rotated without every browser subscribing again.
- The meter role reads nine more columns, each saying when something is due or expires
  (architecture test 11).
- A push to a recipient with several targets is settled as sent when one took it: the log shows
  each target's outcome, the queue only the notification's.
- An Expo receipt's error reaches the device's health, not the household's log, which records what
  Expo accepted.

**Revisit this when** an instance's clock may drift from the database's by more than a minute (the
quiet-hours floor), when a household's notifications outgrow one worker's turn, or when item 53's
rules need rendering once for an audience (FR-NT5's redacted form) rather than once per recipient.
