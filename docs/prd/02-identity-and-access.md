# 02 — Identity & Access

`home` delegated identity to an external `auth` service and used its three-role template.
Household owns identity outright. This chapter is the specification of that ownership.

## 1. The object model

```
User ──┬─< Credential        (password | google | apple | child_pin)
       ├─< Session           (web cookie)
       ├─< Device            (mobile, holds a refresh-token family)
       └─< Membership >──── Household ──< Invitation
                │
                └── ModuleGrant × N        (one per enabled module)
```

| Object | Scope | Notes |
|---|---|---|
| **User** | Global | A person. Exists without any household. Identified by `id`; addressed by email where one exists |
| **Credential** | Per user | A user may hold several: a password *and* Google *and* Apple. A child holds exactly one, of type `child_pin` |
| **Session** | Per user | A web session. Sliding expiry, revocable individually or all-at-once |
| **Device** | Per user | A mobile installation. Holds a refresh-token family, a push token and the sync cursor (under D-93, the right to a sync token) |
| **Household** | Tenant root | Has a name, a timezone, a base currency, a country profile, a locale and an owner-set module enablement |
| **Membership** | (user, household) | Carries the role and the module grants. **A user may hold several memberships with different roles** |
| **Invitation** | Per household | A pending membership. Email or link. Expires |

## 2. Authentication

### 2.1 Sign-up

**FR-ID1 — Register with email and password.**
`POST /api/v1/auth/register` with `email`, `password`, `display_name`, `locale`.

- Password minimum **12 characters**, checked against a breached-password list (offline
  k-anonymity check against a local dataset — no third-party call, **D-12**). No composition
  rules: length and non-breached, per NIST SP 800-63B, because forced symbol classes produce
  worse passwords and more resets.
- Stored with **Argon2id**.
- The account exists immediately but is **unverified**: it can create a household and use it,
  but cannot invite anyone, receive an invitation, or be made the billing payer until the
  email is verified. Blocking everything until verification loses users at the exact moment
  they are most motivated; blocking *outbound trust* is the part that matters.
- Verification email carries a single-use token valid **24 hours**.
- The response is the same shape whether or not the email is already registered
  (`202 Accepted`), and the email sent differs — an enumeration-resistant sign-up. **D-13.**

**FR-ID2 — Sign in with Google, sign in with Apple.**
OIDC authorization-code flow with PKCE. **Sign in with Apple is mandatory** if any other
third-party sign-in is offered, per App Store Review Guideline 4.8; it is therefore not
optional in the specification either. Apple's private-relay addresses are accepted and never
used as a stable identifier — the `sub` claim is.

Linking rule: if the verified email of an OIDC identity matches an existing verified account,
the credential is **linked** to it after an explicit confirmation step. It is never linked
silently, because a silent link on an unverified email is an account-takeover primitive. The
sign-in answers `409 link_required` for an identity whose address any account has, verified or
not; the account's owner signs in as they always have and links the provider from their account,
which the account's address is told of by email. An identity whose address no account has makes a
new account, its address verified only when the provider verified it. A password reset that proves
an address nobody had proven unlinks every identity the account held before it, which whoever
linked it had not shown the address was theirs. **D-102.**

**FR-ID3 — Sign in.**
`POST /api/v1/auth/login`, branching on `client_type`:

| `client_type` | Returns |
|---|---|
| `web` | `Set-Cookie: __Host-hh_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`) + the readable CSRF cookie `__Host-hh_csrf` |
| `mobile` | `{ access_token, expires_in, refresh_token }` and registers/updates a `Device` |

Failures are generic (`invalid_credentials`) whatever the cause. Rate limited per IP and per
account with exponential backoff; after 10 failures in 15 minutes the account requires a
CAPTCHA-free cooldown rather than a lockout, because lockout is a denial-of-service against
the real user.

A web session lasts **30 days from its last use**, with no limit on how long it may be kept in use,
until it is signed out, revoked from the session list, ended by signing out everywhere, or ended by
a password reset. Signing in again from a browser ends the session it held. **D-95.**

A mobile sign-in names its `device`: the installation's own id, which the client keeps, a label, a
platform and an app version. A device holds one sign-in at a time, so signing in again on it ends
the one it held; the id is unique per user, so a shared tablet signs several profiles in, each with
a sign-in of its own. The sign-in lasts **until it is revoked**, with no idle expiry: by signing
out on the device, revoking it from the device list, signing out everywhere, a password reset, a
password change made on another client, or a reused refresh token (FR-ID4). **D-99.** A child
profile's sign-ins end too when an owner sets it a new PIN, removes it from the household, or when
it graduates (FR-CH4, FR-CH5, **D-104**).

**FR-ID4 — Token refresh with reuse detection.**
`POST /api/v1/auth/token` with a refresh token. Refresh tokens are **single-use and rotating**;
each belongs to a family. Presenting a token that has already been used invalidates the entire
family and every session it produced, and notifies the user by email. This is the standard
detection for a stolen refresh token and it is cheap. **D-14.** One exception: a token presented
again within a minute of its use, while the token it was exchanged for is still unused, is a retry
whose answer was lost, and is answered with a new pair; the unused one is retired, so presenting
it later is a reuse. **D-98.** The email is the account-takeover notice (A-11), calm, naming the
device and linking to a password reset, which signs every device out.

An access token authenticates a request only while its device's sign-in is live, which the server
reads on each request as it reads a web session: a revoked device, a password reset or signing out
everywhere ends its requests at once, not when its token expires.

Access tokens are JWTs, **15 minutes**, signed EdDSA, carrying only `sub`, `sid`, `iat`, `exp`
and `client`. **They carry no roles and no household grants** — those are resolved server-side
per request from the membership, so revoking a grant takes effect on the next request rather
than in fifteen minutes. **D-15.**

**FR-ID5 — Multi-factor authentication.** Optional TOTP with recovery codes, per user. When
enabled it is required on every login on a new device. Not required for children.

A device, or a browser, is new unless it is trusted: trust is opt-in, chosen when the second step
is answered, and lasts 30 days (A-7). It is required of a sign-in with Google or Apple as of one
with a password. Turning it on takes a verified address, the current password and a first code,
and gives ten recovery
codes, each used once in place of a code; a new set, with the password, retires the old one (A-6),
and every recovery code spent is emailed (A-8). Ten wrong codes since the last right one lock the
authenticator and end the account's pending sign-ins; a locked one takes only a recovery code,
which unlocks it, or support's unlock. A password reset keeps the second step on; it, turning the
second step off or on again, signing out everywhere, signing a device or a session out from its
list, and a reused refresh token end every trust, since what was signed out may be lost with its
trust in it. **D-100.**

**FR-ID6 — Password reset.** `POST /api/v1/auth/password-reset` always returns `202`.
Single-use token, **1 hour**, invalidates every session and every refresh-token family on use,
and every trust of FR-ID5, and sends a confirmation email to the old address. The link proves the
address: an unverified one is verified, and the Google or Apple identities linked to the account
before it was are unlinked (D-102).

**FR-ID7 — Session and device management.** `GET /api/v1/me/sessions` lists active sessions and
`GET /api/v1/me/devices` the devices signed in, with last-seen, approximate location from IP and
user agent. Any can be revoked individually; "sign out everywhere" revokes all. The approximate
location stays null until an IP-to-place source is chosen (plan item 30). Revoking a device also invalidates its offline
sync cursor, so its local replica is discarded on next contact rather than being resumed. Under
D-93 the device is refused any further sync token, and its client discards the replica when it is
refused. A sync token already issued keeps the device replicating until it expires, so that
token's lifetime is how long a revoked device can still receive new rows; plan item 13 sets it.

**FR-ID8 — Account deletion.** Self-service, from the app. See
[05-privacy-and-compliance.md](05-privacy-and-compliance.md) §4 for what happens to households
the user owns.

## 3. Households and membership

**FR-HH1 — Create a household.** Any user, **verified or not** — FR-ID1 blocks outbound trust, not
the first useful thing a new account does. Supplies `name`, `country`, `timezone`, `locale`,
`base_currency`. Creator becomes an `owner` and the **billing payer of record**. A 30-day trial
starts. A user may create several.

**Verification gates what leaves the household, not what happens inside it.** An unverified creator
has a fully working household and a running trial; what they cannot do until they verify is invite
anybody (FR-HH2) or attach a payment method and subscribe. Being payer of record costs nothing while
no card is required, which is the whole of the trial, so the two rules do not collide in practice —
and if the trial ends unverified the household enters `grace` like any other
([04-billing-and-entitlements.md](04-billing-and-entitlements.md) §3) rather than being blocked
earlier for a reason the member cannot see.

**FR-HH2 — Invite a member.**
`POST /api/v1/households/{id}/invitations` — `owner` only. Two forms:

| Form | Use |
|---|---|
| **Email invitation** | Named, single-recipient, expires in 14 days, binds to that email on acceptance |
| **Link invitation** | A single-use code an owner can send over any channel, expires in 72 hours, `max_uses` of 1 by default and at most 12, the members' fair-use ceiling ([04](04-billing-and-entitlements.md) §5) |

The invitation carries the **proposed role and the proposed module grants**, so what the
invitee accepts is what they get, and the owner does not have to configure access afterwards.
An owner may set up the grants before the person exists. The role is `owner` or `member`: a child
profile is created by an owner (FR-CH1), never invited (**D-17**, **D-103**). An address has one
email invitation waiting at a time. An email invitation is sent again with a new link, which
replaces the old one and runs another 14 days, and one that was declined, withdrawn or expired is
open again. A household sends 20 invitations a day, resends included (§9); one refused sends
nothing, and is not counted. An invitation is its inviter's grant, and lapses with their ownership:
what an owner sent that is still waiting is withdrawn when they are removed, leave or are made a
member, and another owner may send an email invitation again, as theirs (**D-103**).

**FR-HH3 — Accept an invitation.** The invitee signs in or registers, sees exactly what they
are being given (household name, inviter, role, the list of modules and levels), and accepts or
declines. Accepting needs a verified address, and an email invitation's is the one it was sent to:
joining a household is trust extended beyond the account (FR-ID1). Declining is recorded, closes
the invitation, and the inviter is told.

**FR-HH4 — Leave a household.** Any member may leave at any time. Content they created stays
with the household (it is household data, not personal data they own), except items in their
**private root**, which are handled per [05](05-privacy-and-compliance.md) §5. Two members cannot
leave without doing something first, and both refusals name the action that unblocks them:

| Who | Refusal | What unblocks it |
|---|---|---|
| The **last owner** | `409`, `last_owner` | Promote another member to `owner`, or delete the household |
| The **billing payer** | `409`, `billing_payer` | Hand billing to another owner (FR-HH6), or cancel the subscription |

The payer rule is the same one account deletion applies
([05](05-privacy-and-compliance.md) §4) and it exists for the same reason: a household whose payer
has walked out is a household that lapses for a reason nobody in it can fix. A payer who is *also*
the last owner hits both, and the flow says so at once rather than one at a time.

**FR-HH5 — Remove a member.** `owner` only. Immediate: sessions scoped to that household stop
resolving, the offline replica receives retractions for everything they can no longer see, and
their device deletes it on next sync.

**FR-HH6 — Transfer ownership and transfer billing.** Two separate actions, deliberately. An
owner may promote another member to `owner` (there may be several), and the billing payer may
hand billing to another owner. Neither implies the other. Billing moves only between owners, so the
payer stays an owner until it has moved: making them a member is refused `409`, `billing_payer`, as
their leaving is (**D-103**).

## 4. Roles

Three household roles. They are coarse on purpose; the fine-grained control is the module
grant, not the role.

| Role | What it *is* | Powers that are not expressible as a module grant |
|---|---|---|
| **`owner`** | An adult who is responsible for the household | Invite, remove and re-grant members; enable and disable modules; edit household settings; billing (if payer); household deletion; hard-delete anything; read the activity log; reset a child's PIN and read a child's private root (see §6) |
| **`member`** | An adult participant | None. A member's abilities are exactly the union of their module grants |
| **`child`** | A managed profile created by an owner | None, and additionally *restricted*: cannot be granted `manage` on any module, cannot see Finance or Chat unless explicitly granted, cannot invite, cannot change household settings, cannot delete anything but their own items; and, since an owner manages the profile, cannot create a household, leave its own, or link Google or Apple (**D-104**) |

**There may be several owners.** A household with one owner shows a nudge to promote a second,
because an account recovery problem for a sole owner is a household nobody can administer.

## 5. Module grants

**FR-AC1 — The four levels.** For every module enabled in the household, each membership holds
exactly one level:

| Level | Read | Create / edit own | Edit others' | Structural | Example in Garden |
|---|---|---|---|---|---|
| **`none`** | — | — | — | — | The module does not exist for this member. Not hidden — **absent** |
| **`view`** | ✓ | — | — | — | Sees the plan and the task list, changes nothing |
| **`contribute`** | ✓ | ✓ | ✓ | — | Logs harvests, completes tasks, adds plantings |
| **`manage`** | ✓ | ✓ | ✓ | ✓ | Creates and closes seasons, edits beds, reopens a closed season |

`manage` is the level that maps onto `home`'s `admin` gate for destructive and structural
operations. `contribute` maps onto `editor`, `view` onto `reader`. The fourth level, `none`, is
the one `home` had no concept of and the one commercial households ask for first.

**FR-AC2 — `none` means absent.** This is a requirement, not an implementation note, and it is
checked at nine surfaces:

| Surface | Behaviour when the module is `none` |
|---|---|
| REST routes | `404`, not `403` — a `403` confirms the household uses the module |
| Sync feed | The module's entities are never sent, and are **retracted** if the grant is lowered |
| Dashboard catalog | The module's widgets are not listed and not resolvable |
| Global search | The module's scope is not searched |
| Notifications | No trigger rule fires to this member for this module's actions; no metric resolves |
| Reminders | The module's reminder kinds do not appear in this member's list |
| Activity log | Events from this module are filtered out for this member |
| Export | Not included in this member's personal export |
| Deep links | A link into the module resolves to a neutral "not available" screen, never to a leak |

**D-16: refusals are `404`, everywhere, for both grants and privacy.** `home` established this
for private items and conversations; Household extends it to module grants. A `403` is an
existence oracle, and here it would leak which modules a household uses to a member they
deliberately excluded.

**FR-AC3 — Defaults.** All seventeen modules are listed, because a module missing from this
table is a module whose default nobody decided.

| Level | Modules |
|---|---|
| `contribute` | Dashboard, Tasks, Reminders, Calendar, Shopping, Chores, Notes, Chat, Pets |
| `view` | Documents, Activity log, Household settings |
| `none` | Finance, Utilities, Garden, Property, Vehicles |

An owner changes any of it at invite time. **The line the defaults draw is money and possessions**,
not participation: what a household does together is open, what a household owns and spends is
closed until somebody opens it.

Three of these need their reasoning stated, because they are the ones that look inconsistent:

- **Chores is `contribute`** because the module *is* the household's shared work. It is chore
  *administration* that is closed, and that is the standard `manage` gate, not a grant default.
- **Pets is `contribute`** ([modules/14-pets.md](modules/14-pets.md) FR-PE10). Feeding the cat is
  not a possession question, and a module a member cannot touch is a module they will not open.
  Editing the health record and the medication schedule is still `manage`.
- **Activity log is `view`** ([modules/16-activity.md](modules/16-activity.md)). It is already
  filtered by every other grant — a member sees history only for modules they can see — so `view`
  here reveals nothing they could not read directly, and the log is the transparency surface on
  which FR-PS2 and D-75 depend. `view` on Household settings works the same way: it unlocks the
  household's invitations and the storage picture, and every *write* in that module is
  `owner`-gated regardless of the grant. The member list and the household profile every member
  reads, whatever their grant, since every member's app works from them
  ([modules/17-household-admin.md](modules/17-household-admin.md) Permissions, **D-103**).

**FR-AC4 — Child defaults.** A new `child` gets `contribute` on Chores, Shopping, Calendar, Tasks
and **Pets**; `view` on Reminders and Dashboard; `none` on everything else — including Finance,
Chat and the Activity log. An owner can raise any of these except to `manage`, which is unavailable
to children by construction, and except Finance, which is capped at `view` for a child
([modules/09-finance.md](modules/09-finance.md)).

## 6. Child profiles

**D-17: a child is a managed sub-profile created by an owner, not a self-registering user.**

The alternative — a real account for the minor, with a verifiable-parental-consent flow — was
specified and rejected. The age of digital consent is set per member state between 13 and 16 across
the EU, and is 13 in the UK; verifiable parental consent is a per-country compliance problem with no good
technical answer; and none of that machinery buys the product anything, because in a household
app the parent is present, is the customer, and is already administering the account.

By making the child profile a *managed* object under an adult's account, Household is not
offering an information-society service directly to a child. The owner is the account holder;
the child is a profile within it. This is the same posture a family streaming account or a
console family group takes.

**FR-CH1 — Create a child profile.** An owner supplies `display_name`, an optional
`year_of_birth`, an avatar, and sets a **4–6 digit PIN**. No email address is required and none
is collected. If the child has a phone, they sign in on it with **household code + profile + PIN**;
on a shared family tablet, each profile signs in once with its PIN in the same way, and profiles are
then switched without re-authentication (**D-104**, which rejected a sign-in an owner issues for the
tablet in the profile's place).

**The household code** is a short, human-typeable identifier (8 characters, unambiguous alphabet —
no `0`/`O`, no `1`/`I`) generated per household at creation and shown to owners in household
settings. It exists because a child profile has no email address and therefore no other way to say
*which household* they are signing in to. It is **not a credential**: it identifies a household, it
does not authenticate anybody, and knowing it grants nothing without a profile and that profile's
PIN. An owner may **regenerate** it, which invalidates the old one for future sign-ins and leaves
existing sessions alone. It is never used by an adult member, who signs in by email, and it is never
an invitation — an invitation is FR-HH2 and carries a role and grants, which a code cannot.

**The profile list.** A code opens its household's name and its child profiles, in the order they
were made, for the child to pick their own (A-15); no adult is listed, since an adult signs in by
email. Guessing codes is what is limited: thirty that open no household, in an hour from one network
(§9). The sign-in that follows is a device's, as a mobile sign-in is (FR-ID3), with no second step
(FR-ID5). **A shared tablet** is one an owner signs in on, which reads the code for the profiles that
use it; each of them signs in on it once with their PIN, the tablet holding one sign-in per profile
(FR-ID3's device id is per user), and switching between them asks for nothing more. **D-104.**

**FR-CH2 — What is collected about a child is minimised.** Display name, optional birth year
(used only for age-appropriate defaults and birthday reminders — never a full date unless an
owner adds one as a calendar event), avatar, and the content they create. No email, no phone,
no location, no analytics identifier, no behavioural profiling. Child profiles are **excluded
from product analytics entirely**. **D-18.**

**FR-CH3 — The one asymmetry.** A child's items in their private root are readable by an owner.
This is stated plainly in the UI to the child at profile creation — *"a parent can see
everything here"* — because a private space a parent can silently read is worse than no private
space at all. Adults' private roots are readable by nobody, owners included (**D-19**, carried
from `home`).

**FR-CH4 — Graduation.** An owner can convert a child profile into a full `member` by attaching
an email address, which the (now young adult) verifies. Their content stays with them. There is
no automatic graduation on a birthday, because Household does not know the birth date reliably
and should not act on a guess.

The owner, once their own address is verified, sends the address a link valid 14 days, with which
the young adult chooses a password. Opening it verifies the address and makes the profile a
`member` in one step, keeping its levels and everything it made; its PIN, and every device it was
signed in on, end with it. Until then the profile is a child, signing in with its PIN, and an owner
may send the link again, to the same address or a corrected one, which retires the one before. The
link is its sender's, and lapses with their ownership, as an invitation does (D-103): its holder
would come into the household with the profile's account and everything it made. An address an
account already has is refused, and the refusal counts among the household's emails a day as a link
does, since it says that an account has the address (D-13). **D-104.**

**FR-CH5 — PIN reset and lockout.** An owner resets the PIN from their own authenticated
session. Ten wrong PINs lock the profile until an owner unlocks it.

The ten are counted since the last right PIN, which clears them, and each is counted before it is
checked, so that PINs sent at once meet the lock one by one: at most ten are checked between an
owner's unlocks. Every attempt at a locked profile, the tenth wrong one included, is told it is
locked, and so is a right PIN that a lock overtook while it was checked. A new PIN also unlocks the
profile, and signs it out of every device, since whoever knew the old PIN may hold one of them.
**D-104.**

## 7. The four access axes

Three are carried from `home` unchanged in meaning; the fourth — the module grant — is new here.

| Axis | Introduced | Question it answers | Refusal |
|---|---|---|---|
| **Module grant** | Household | *May this member use this module at all?* | `404` |
| **Household visibility** | `home` v1 | *Is this item shared with the household, or private to its owner?* | `404` |
| **Ownership** | `home` v9 | *Whose private root is this?* | `404` (owners excepted for children only) |
| **Membership** | `home` v10 | *Is this member in this **audience**, and since when?* | `404` |

**The membership axis is not chat-specific.** `home` only ever applied it to a conversation, which
is why it is easy to read as one. In Household an *audience* is any explicitly enumerated member
list attached to a container, and there are two in 1.0: a **chat conversation**
([modules/15-chat.md](modules/15-chat.md) FR-CT1) and a **`member_shared` calendar**
([modules/04-calendar.md](modules/04-calendar.md) FR-CA1). Both resolve through the same
`audience_id` on the sync feed row and the same predicate term, and a third audience added later is
a new row in an existing mechanism rather than a new axis.

**"And since when" is load-bearing**, and only for conversations so far. A member added to an
existing conversation carries a **floor** (FR-CT2) and must not see what was said before it — so the
membership axis is not a boolean but an interval, and both the API and the sync feed evaluate it as
one. See [03-platform-strands.md](03-platform-strands.md) §2.3.

Every read path resolves all four. Every write path resolves all four plus the level. Every
sync feed row carries the fields needed to evaluate all four without joining back to the
module's tables — see [03-platform-strands.md](03-platform-strands.md) §2.2.

> **Under D-93 the replicated path reads no feed row.** Stream definitions generated from the
> entity registry read each entity's own table and the grant through subqueries, and an audience
> through the readers the server keeps on each row it bounds
> ([03-platform-strands.md](03-platform-strands.md) §2, [modules/15-chat.md](modules/15-chat.md)
> and [modules/04-calendar.md](modules/04-calendar.md) Sync, where plan item 14 may resolve a
> `member_shared` calendar, which has no floor, through its member list instead). The check still
> lives in one place, the generator. The membership axis stays an interval on both paths: the API
> evaluates the floor, and a member is a reader of nothing before theirs.

## 8. Platform staff

Two platform-level roles. Neither is a household role and neither appears in any household's
member list.

| Platform role | Who | Can see | Can do |
|---|---|---|---|
| **`support`** | Customer support | Account metadata: email, verification state, locale, sign-in history, device list, household names and ids, member counts, roles, plan, subscription state, invoice history, storage totals per module, notification delivery outcomes, crash reports, feature-flag state | Resend verification and reset emails; extend a trial; apply a credit; re-issue an invoice; unblock a rate-limited account; toggle a feature flag; re-drive a failed notification |
| **`platform_admin`** | Karel | Everything `support` sees, plus platform-wide aggregates, the reference-data catalogs, and the platform audit log | Everything `support` can do, plus manage staff, edit the curated crop catalog and tariff presets, run migrations, and issue a household deletion on legal request |

**Neither can read household content. There is no mechanism by which they could.** There is no
impersonation feature, no "view as", no support session, no content-reading endpoint and — the
part that makes it structural rather than aspirational — **no database role that bypasses RLS
for content tables**. See [01-architecture.md](01-architecture.md) §2.3 and
[05-privacy-and-compliance.md](05-privacy-and-compliance.md) §6. **D-3.** Under D-93 one role does
bypass it, PowerSync's replication role, and PowerSync's bucket storage holds the replicated rows
outside it; both credentials are the sync service's own, and neither platform role holds either
(01 §2.3).

**FR-PS1 — The diagnostic bundle** is how content bugs are debugged without content access. A
member hits a problem and taps *"send diagnostics"*; the client assembles a bundle scoped to the
screen they were on, shows them **exactly what it contains, rendered, before it is sent**, lets
them redact fields, and attaches it to their ticket. It expires in 30 days. The member is the
one who decided to share, and they saw what they shared. **D-20.**

**FR-PS2 — Every staff action is doubly logged.** Once in the platform audit log (append-only,
separate schema, retained 7 years) and once, where it touches a household, in that household's
own activity log where the household can see it. A support agent extending a trial is visible
to the household as *"Household support extended your trial"*.

## 9. Rate limiting and abuse

| Surface | Limit |
|---|---|
| Login, per account | 10 failures / 15 min, then a cooldown of 1 min that doubles with each further failure, up to 1 hour; a wrong current password when changing it counts as a failure |
| Login, per IP | 60 failures / 15 min |
| Register, per IP | 5 / hour |
| Register, the note to an address that already has an account, per account | 3 / hour; a registration past it answers `202` as ever, and no note is sent |
| Password reset, per account | 3 / hour |
| Password reset, per IP | 20 / hour |
| Verification email resend, per account | 1 / min and 5 / hour |
| Verification email resend, per IP | 20 / hour |
| Invitation send, per household | 20 / day |
| Second-step codes, per account | 5 wrong / 5 min, the first code that turns it on included; the tenth wrong since the last right one locks the authenticator (FR-ID5) |
| Sign-in begun with Google or Apple, per IP | 60 / hour |
| Child PIN attempts | 10 wrong since the last right one, then owner unlock; a child's failed sign-ins count against the network as a password's do |
| Household code lookups that open no household, per IP | 30 / hour |
| Sync mutation batch | 500 mutations / batch, 60 batches / min / device |
| File upload | Plan-dependent; see [04](04-billing-and-entitlements.md) |
| API, authenticated, per user | 600 / min sustained, burst 100 |
| API, per household | 3 000 / min sustained, burst 500, shared by its members |

Every limit returns `429` with `Retry-After` and a problem document, and every limit is
per-tenant as well as per-user so one household cannot degrade another. A limit per account counts
the address asked for, whether or not an account has it, so that a refusal says nothing about
which addresses do (D-13). The rows the table did not first give (the registration note, the resend
per account, the reset and the resend per IP, and the household's API budget) and the shape of the
login backoff are **D-96**; the second step's and the provider sign-in's are **D-101**; the code
lookups' and the counting of a child's PINs are **D-104**.
