# 0012 — A child profile is an account with a PIN and a child's membership, its lockout counts on the credential, and the household surface serves its sign-in

- **Status:** Accepted
- **Date:** 2026-09-29
- **Plan item:** 11
- **Decides for:** [02-identity-and-access](../prd/02-identity-and-access.md) §4, §6 (FR-CH1–FR-CH5), §9;
  [05-privacy-and-compliance](../prd/05-privacy-and-compliance.md) §7;
  [modules/17-household-admin](../prd/modules/17-household-admin.md) (FR-HA7, Data model, Sync); D-17–D-19,
  D-97, D-99, D-104; [ADR 0009](0009-accounts-sessions-throttles-and-the-breach-corpus.md),
  [ADR 0010](0010-mobile-tokens-second-step-providers-and-client-versions.md) and
  [ADR 0011](0011-households-as-the-platforms-own-module.md)'s notes on item 11

## Context

Plan item 11 builds the child profile: an owner makes it, it signs in with the household's code, a
profile and a PIN, ten wrong PINs lock it, an owner resets its PIN and unlocks it, and it graduates
into a member. D-104 settles what the PRD left open about its behaviour. Five technical questions
remain:

1. **Where the profile lives.** A user's tables are global and written through `tenant.AccountTx`;
   a membership is admin's entity, written through `mutation.Apply` (ADR 0011).
2. **Where the lockout counts.** The sign-in throttles of ADR 0009 count per address and per network
   and back off; FR-CH5 locks until an owner acts, which owners must see in the member list.
3. **How a sign-in reads a household before its context exists.** A profile is found by its
   household's code, which no policy let a caller read outside a household's context.
4. **Which package serves the routes.** The sign-in is the account's (a device's token pair, `Me`),
   the profile the household's (its code, its membership, the lock the members read); `identity` is
   built before `household`.
5. **Two request bodies carry a PIN**: making a profile and setting its PIN. A key's fingerprint is a
   fast hash of the body (D-97).

## Decision

**A profile is two rows and a credential.** Its account is a `users` row with no address, whose one
credential is a `child_pin`, the PIN's Argon2id hash, and which speaks its household's language; its
membership is a `memberships` row whose role is `child`, carrying its birth year and whether its
dashboard is locked. The client's `id` is both rows' (D-23), the `user_id` every later operation
names, so the create is architecture test 9's to check. All three are written in one `mutation.Apply`
in the household's context: the global tables have no row-level security, and the household's
history records the profile's making.

**The lockout counts on the credential**: `credentials.failures`, the wrong PINs since the last right
one, which only a `child_pin` may count. A sign-in counts its attempt before the PIN is checked,
under the credential's row lock, and refuses one at ten unchecked; a right PIN clears the count.
The attempt that counts the tenth, unless it signs the child in, records the lock as the system's
change of the membership (`admin.child.lock`), whose row carries `pin_locked` to every member's
replica: a wrong PIN, and a check or a sign-in cut short, a client gone among them, alike, since each
leaves the count at ten, with a context that outlives the request's. A right PIN whose sign-in finds
another attempt's tenth counted since its own is refused `423`, so that no lock the replicas have
read is cleared unrecorded. An owner's unlock and new PIN clear the count, each writing
`updated_at = clock_timestamp()` under the row's lock, and a new PIN also ends the profile's device
sign-ins; a sign-in that checked the PIN before either finds `updated_at` moved and signs nobody in,
as a password's does (`unchanged`, ADR 0009). A count of ten is the same number before an unlock and
after it, and `updated_at` is what tells them apart: the attempt that counted the tenth records its
lock only while `updated_at` is still the one it read, so an unlock between its count and its record
leaves nothing recorded, and neither its record nor its right PIN takes a tenth counted after the
unlock, which its own attempt records, for its own. A profile's removal moves `updated_at` the same
way before it signs the profile out: a sign-in reads the membership without waiting for the removal
that deletes it, and holds the PIN alone, so one that held it first is signed out with the rest, and
one that reaches it after waits for the removal and signs nobody in.

**A household is read by its code outside any context**: `households`' read policy admits the row
whose `join_code` the transaction presents in `app.join_code`, as `invitations`' admits one by
`app.invitation_token` (ADR 0011). The profile list then reads the household's child profiles in its
context through `tenant.Assume`, the code having proved the household. The sign-in reads nothing of
the household beyond the profile: its transactions carry the profile as their caller, whose own
membership, and the household it is in, the existing policies admit, joined to the code.

**The household surface serves every child route**, the two before sign-in (`/auth/child/profiles`,
`/auth/child/login`) and the graduation's link (`/auth/graduation/confirm`) among them, and takes the
identity service as its `Accounts`. What is the account's stays identity's, exported for it:
`SignInChild` signs a device in as `admit` does with no second step and answers `LoginResult`;
`NewPassword` screens and hashes a graduation's password; `Graduate` turns the profile into an
account of its own in the graduation's transaction (the address verified, the password in place of
the PIN, every session, device and trust ended). The public routes carry the module registry, and set
their own `via`: mobile for a lock, web for a graduation's link.

**A graduation's link is an email token**, purpose `graduate`, whose row keeps the address until the
link sets the password with it: the account has no address before then, so no reset, resend or
provider sign-in treats a half-graduated profile as an adult's. Sending another spends the ones
before, holding the profile's account, which the confirmation locks before the link, so that two
sent at once leave one that works. It counts among the household's twenty emails a day
(`ratelimit.InvitationHousehold`), and so does an address refused as taken, whose refusal would
otherwise let an owner test addresses for an account (D-13). The row names the owner who sent it, `email_tokens.sent_by`: a link lapses with its
sender's ownership, as an invitation does (D-103). When the ownership ends, `withdraw` spends the
links they sent for the household's profiles with their invitations, so that none works again once
they are an owner again; and the confirmation checks under the household's lock that they are still
an owner, for a link whose sending read the role just before a removal committed, which the
withdrawal did not find.

**A PIN keeps no Idempotency-Key**, as a password does not (D-97): the two routes whose body carries
one are mounted behind the tenant middleware but not the member's key (`household.PINRoutes`). A
repeat of a profile's making answers `422` for its id; a repeat of a new PIN sets it again.

**A child profile is told from an adult by its credential**, `identity.IsChild`, which the account's
`Me.is_child` already reads: creating a household and linking a provider refuse it `403`, and leaving
refuses a child's membership (D-104). It is also the flag analytics (plan item 92) and a private
root's owner-readable case (items 43 and 46) read.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| The lockout on `ratelimit.Throttles` | A throttle counts in windows and backs off; FR-CH5's lock lasts until an owner acts, and owners read it in the member list and on their replicas |
| The lock as a column of its own, `locked_at`, beside the count | Two states to keep in step for one fact; a count at ten is the lock, whether or not its record committed |
| A count at ten taken as the lock of whichever attempt reads it | An owner's unlock between an attempt's count and its sign-in would let that attempt clear, or record a second time, a lock another attempt counted after the unlock; `updated_at`, which the unlock moves, tells the two counts apart |
| A policy on `memberships` naming the household by its code | `memberships`' policy would read `households`, whose policy reads `memberships`: PostgreSQL refuses the recursion |
| The child's sign-in in `identity`, calling into the household surface | `identity` is built first, and the lock and the profile list are the household's; a hook each way for one route |
| The graduation's address on the account from the start, unverified | A password reset, a resend or a provider sign-in would then act on a profile that is still a child |
| A sender's graduation links only spent when their ownership ends, as `withdraw` spends their invitations | The link is written in a transaction of the account's, after the role was read: one written as the removal committed would outlive it. Checked at confirmation too, under the household's lock, it cannot |
| A sender's ownership only checked at confirmation | A sender made an owner again would bring back every link they sent before, which D-103's withdrawal never does for an invitation |
| A key kept for a PIN's routes, with the PIN left out of the fingerprint | A second fingerprint for two routes, and a body with its PIN taken out is not the request it stands for |

## Consequences

- Plan item 29 builds the child's screens on `postAuthChildProfiles` and `postAuthChildLogin`, and
  the tablet's switcher over the sign-ins it holds; item 25 builds the web page a graduation's link
  opens, which posts `postAuthGraduationConfirm`.
- Plan item 16 lets a child profile's `avatar_url` be set, which its making refuses until uploads
  exist, as `PATCH /me` does.
- Plan item 17 may tell the owners that a profile locked (A-18's *ask Jana*), from its
  `admin.child.lock` event; item 17's sweep deletes spent and expired `graduate` tokens with the rest.
- Plan item 20 erases the account of a child profile removed from its household: it is nothing
  outside it, and signs nobody in. Its removal already signs it out of every device.
- Plan item 13's membership stream carries a child's `pin_locked` and `dashboard_locked`, never its
  birth year, which only the owners and the child read.
