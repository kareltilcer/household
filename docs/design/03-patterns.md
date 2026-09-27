# 03 — Cross-cutting patterns

These are the patterns that make seventeen modules one product. Each one is specified once here
and referenced from the screen inventory rather than restated seventeen times.

## 1. Offline and sync

Household's central promise: **every read works offline and every write survives being offline**
([G3](../prd/00-overview.md)). The engine is [03-strands §2](../prd/03-platform-strands.md); what
the member sees is [06-clients §5](../prd/06-clients.md).

**The promise is not symmetrical across the two clients** ([00-brief §1](00-brief.md)). Mobile
holds a full local replica; the web app reads from cache and queues writes, and **a browser is
not the offline-first surface** ([06-clients](../prd/06-clients.md)). Everything below is drawn
in full on mobile. On a **web-only** screen — the tariff composer, the notification composer, the
Finance import wizard — draw the pending, syncing, conflicted and rejected states, and treat a
cold cache as a loading state rather than promising a complete offline read.

**Web-*primary* is not web-only, and the distinction decides whether a mobile form gets drawn.**
The Chores weekly grid is the module's primary *web* view ([FR-CO11](../prd/modules/06-chores.md)),
not a web-only screen: it pivots on mobile ([02-components §4.19](02-components.md)), its rows
carry hold-to-complete, and its chores appear in Today, which must be complete offline
([04-navigation §2](04-navigation.md)). Its mobile form is drawn in full, offline states included.

**The Finance ledger is the same case, and it is the one most likely to be misfiled.** It is
web-*primary* — mono numerics, compact density and keyset paging are a workspace shape — but
Finance is in the list→detail set that **pushes on mobile** ([04-navigation §7](04-navigation.md)),
and nothing in the PRD makes transaction history desktop-only. A member must be able to read their
own ledger on a phone, so its mobile list→detail form is drawn in full, offline states included.
Only the *import wizard* above is genuinely web-only.

| State | Presentation |
|---|---|
| **Online, synced** | **Nothing. The absence of an indicator is the indicator** |
| **Offline** | A persistent, unobtrusive bar: *"Offline — changes are saved and will sync"* |
| **Pending** | The row carries a subtle pending mark. **It is fully editable**; edits merge into the queued mutation |
| **Syncing** | A progress indication **only when it takes longer than a moment** |
| **Conflict** | The row is flagged and tappable, opening a plain comparison with both values, both authors, both times |
| **Rejected** | Flagged with the actual reason in a sentence, and an action: retry, edit, or discard |
| **Re-snapshot needed** | Handled silently unless it takes long enough to notice — and when it does, it is shown as **`syncing`**, not as a state of its own. No token, no icon and no word beyond that one ([01-foundations §8](01-foundations.md)) |

### Which changes ask, and which merge

**D-39: conflicts are surfaced, never hidden and never auto-resolved silently where a human would
care.** The dividing line is *whether a wrong answer costs anything*.

| Merge policy | What the member sees | Entities |
|---|---|---|
| `lww_field` | **Nothing.** Two people edited different fields and both succeeded | Tasks cards, note metadata, plantings, shopping items, contacts, vehicles, pets, properties |
| `state_set` | **Nothing.** A check and an uncheck race, and the later intent wins | Shopping checked state, chore completions, medication doses, reactions, read markers |
| `additive` | Nothing on merge — but **admission is not guaranteed**. A meter reading or usage reading can be rejected on a cross-row invariant. And **a correction is online-only**: an additive row has no offline update path, so the edit affordance must be *absent or unavailable offline* rather than queued ([D-24](../prd/03-platform-strands.md)) | Chat messages, meter readings, asset usage readings, harvests, fuel entries, service records, settlements, point ledger — **and three the PRD declares in their own module Sync sections rather than in D-24's summary table: shopping trips** ([05-shopping](../prd/modules/05-shopping.md)), **task comments** ([02-tasks](../prd/modules/02-tasks.md)) **and pet health entries, the weight series included** ([14-pets](../prd/modules/14-pets.md)) |
| `lww_row` | A **banner offering the preserved loser** — *"here it is"*, not a question. **The two cases are not the same size**: a note body's loser is kept for a stated **30 days** and recovered offline ([FR-NO10](../prd/modules/07-notes.md)); a chat message body's is preserved with **no stated retention window and no offline path**, because the edit is online-only inside FR-CT3's window ([15-chat](../prd/modules/15-chat.md)). Chat gets a rare online affordance, **never a thirty-day recovery flow** — [02-components §4.3](02-components.md) | Note bodies, chat message bodies |
| `strict_version` | **Always a question.** The conflict resolver | Money, tariffs, allocation rules, transactions, expense shares, calendar events, chore definitions, season close, permission changes |

**Design consequence:** a conflict dialog for a drag would be absurd, and a silent merge of an
allocation rule would be a wrong number nobody will ever find. The component vocabulary must make
those two things feel like different categories of event, not two severities of the same one.

### The offline write cases that must be designed

Three named scenarios from the PRD, each with an expected experience:

1. **The two-trolley case** ([05-shopping](../prd/modules/05-shopping.md)). Two members offline
   in the same shop, both checking "milk". Expected: milk checked once, no conflict dialog shown
   to anyone, both devices identical within two seconds of the second reconnecting.
2. **The cellar case** ([10-utilities](../prd/modules/10-utilities.md)). A reading taken with no
   signal, uploaded on reconnect — and possibly **rejected an hour later** for a monotonicity
   violation against a neighbour the phone did not hold. The reading form pre-checks against what
   it does hold, questions a low value *at the meter*, and keeps the pending state visible until
   the server has actually taken it.
3. **The far end of the garden** ([11-garden](../prd/modules/11-garden.md)). A task completed and
   a harvest logged with no signal. The crop catalog ships as a **cached versioned bundle** so
   *"how deep do I sow these"* is answerable offline.

### Attachments

Files are not in the change feed ([D-25](../prd/03-platform-strands.md)). A photo taken offline
lives in the app sandbox; **the metadata row syncs immediately** with `attachment_status:
pending` and every client renders a placeholder. A member who photographs a receipt in a car park
sees the row on every device before the bytes have moved.

### Sync health

The one screen that exists because nobody at the platform can look at a member's data
([D-3](../prd/09-decisions.md)). Per device: last sync, cursor position, pending mutation count,
conflicts awaiting resolution, replica-digest state, and **force re-snapshot**
([FR-HA19](../prd/modules/17-household-admin.md)); under D-93 the cursor position is the
replica's last checkpoint, the digest state its bucket-checksum state, and the re-snapshot a
re-download. **It ships in Phase 0**, before any feature module, because it is the only view
anyone gets of a sync failure.

## 2. Absence, not disabling

**`none` means absent, checked at nine surfaces** ([FR-AC2](../prd/02-identity-and-access.md)).
This is the pattern most likely to be got wrong by habit, because the reflex is to grey things
out.

| Surface | What the member sees |
|---|---|
| REST routes | `404`, not `403` — a `403` would confirm the household uses the module |
| Sync feed | Its entities are never sent, and are **retracted** if the grant is lowered — data the device already holds is deleted. See *When access is withdrawn* below |
| Dashboard catalog | Its widgets are **not offered** |
| Global search | Its results **do not exist** |
| Notifications | Nothing fires; no metric resolves |
| Reminders | Its reminder kinds are **not offered** in the subscription list |
| Activity log | Its events are **filtered out** |
| Export | It is **not in this member's export** |
| Deep link | Resolves to a **neutral "not available" screen**, never to a leak |

Navigation is the tenth surface and it is the client's own: a module a member has `none` on **is
not in the list**. Not greyed, not locked, not upsold ([D-38](../prd/06-clients.md)).

**No upsell, no teaser, no lock icon.** `403` would be an existence oracle
([D-16](../prd/02-identity-and-access.md)); a lock icon in the UI is the same disclosure by
another route. A member who was deliberately excluded from Finance must not learn that the
household uses Finance.

**Two switches compose as a minimum**: household enablement (an owner turns a module on or off
for everyone) and the per-member grant. A disabled module behaves exactly like `none` for
everybody — and **its data is retained**; the confirmation says so, because *"will I lose my
garden plan"* is the question and the answer is no ([FR-HA8](../prd/modules/17-household-admin.md)).

**An access change is announced.** Lowering a grant notifies the member — *"an access change a
member discovers by finding something missing is a bug"* ([D-78](../prd/modules/17-household-admin.md)).

### When access is withdrawn

Absence is the steady state; **retraction is the transition into it**, and it has its own design.
When a member loses access to data they already hold locally, the server emits `op: retract` rows
and the client **deletes them from the local store on receipt**
([03-strands §2.6](../prd/03-platform-strands.md), FR-SY7). Five ordinary events cause it: a grant
lowered to `none`, removal from a conversation or a `member_shared` calendar, an item moved from
shared to private, removal from the household, and a module disabled household-wide.

It can land **while the member is looking at the row**. So:

- Every data-bearing component needs the **withdrawn** state in
  [02-components §0](02-components.md) — content that was there and is now gone because access
  changed, which is not an error, not an empty state and not a deletion by another member.
- **Say which of the two it was**, in words, without naming what was withdrawn: access changed, or
  the module was turned off for the household. Silent disappearance is the bug D-78 names.
- A member sitting *inside* a withdrawn entity is moved out to the nearest surface they still
  have, with the same sentence. Never a dead screen, never a `403`-flavoured explanation.
- Retraction is **best-effort** (FR-SY8) — a device that never reconnects keeps its copy — so the
  UI must never imply the data has been recalled everywhere.

## 3. Entitlement states

Eight states, and the household is always in exactly one
([04-billing §3](../prd/04-billing-and-entitlements.md)). This is a banner and a write-affordance
problem, not a paywall problem.

| State | Read | Write | Upload | What the member sees |
|---|---|---|---|---|
| `trialing` | ✓ | ✓ | ✓ | **Nothing until day 21** — see below. **No card was required to get here** |
| `active` | ✓ | ✓ | ✓ | Nothing |
| `past_due` | ✓ | ✓ | ✓ | **Nothing is restricted.** A payment-method prompt, not a wall |
| `grace` | ✓ | ✓ | ✗ | 14 days. Uploads blocked; everything else works |
| `read_only` | ✓ | ✗ | ✗ | Banner naming the state, the fix, **and the deletion date** — the household is told from day one, so nobody is deleted by surprise |
| `canceled` | ✓ | ✗ | ✗ | Same, different wording |
| `restricted` | ✓ | ✗ | ✗ | **Owner-initiated, not billing.** Banner names **who** restricted it and **when**. **No deletion date** — a restricted household is still paying. Any owner lifts it instantly, but lifting **reveals** the billing state underneath; see the design rules |
| `suspended` | ✗ | ✗ | ✗ | Rare, staff-initiated, always with notice. **Not billing** — a full-screen lockout, not a banner. See the design rules below |

Design rules:

- **No read is ever refused by the billing gate.** `402` never applies to a read, in any state
  ([FR-BI1](../prd/04-billing-and-entitlements.md)), so no member loses sight of their own data
  for a money reason. **`suspended` is the one exception, and it is not a billing state** — it is
  abuse or legal, staff-initiated, and it refuses reads outright. It is therefore **a full-screen
  lockout, not a banner over content**: the only screen in the product that shows no household
  data at all. It carries the notice that always accompanies it and a route to support, and it
  needs designing rather than inheriting the banner treatment of the other seven.
- **No billing state blocks export**, `read_only` and `canceled` included: it is a **write** the
  gate deliberately exempts. So are leaving the household, deleting it, lifting a restriction,
  and anything under billing — *"a subscription you cannot resume because you did not pay is a
  trap"* ([FR-BI1](../prd/04-billing-and-entitlements.md)). **`suspended` is the exception here
  too**, for the same reason it is the exception to reads: it is not a billing state, and a screen
  that shows no household data cannot offer to package that data up. The lockout therefore does
  **not** carry an export affordance; it says export is unavailable while the household is
  suspended and routes to support, rather than offering a button that would fail.
  **Settled ([DD-15](08-decisions.md))** — the PRD says nothing about `suspended` beyond one table
  row, and FR-BI1's closed exemption list exempts export from the **billing** gate, which this is
  not. It is the one place this handoff narrows [G5](../prd/00-overview.md), so it is recorded as a
  decision rather than assumed.
- **Lifting a restriction is not a return to normal, and the lift control must say so.** If the
  subscription lapsed while the household was restricted, it lands in whichever state is more
  restrictive and lifting *reveals* that ([FR-BI7](../prd/04-billing-and-entitlements.md)
  precedence). So the control names the state the household will actually be in **before** it is
  used. An owner who lifts a restriction expecting service back and meets `read_only` with a
  deletion date has been ambushed by an action the UI presented as restoring.
- **Queued offline mutations are held, not lost**, and offered for replay if the subscription
  resumes ([FR-BI2](../prd/04-billing-and-entitlements.md)). The read-only UI must say that.
- **Nothing is retracted for lapsing.** The local replica stays exactly where it is.
- **Restriction lives next to export and deletion, not next to billing** — it is GDPR Article 18
  made self-service, not a billing action ([FR-HA20](../prd/modules/17-household-admin.md)).

### The trial countdown

**Settled ([DD-9](08-decisions.md)): silent, then escalating.** Three stages over the 30 days:

| Days | What the member sees |
|---|---|
| **1–20** | **Nothing.** No countdown, no badge, no card prompt. The trial is the product, not a sales funnel |
| **21–25** | A **dismissible** in-app notice: how long is left and what happens next |
| **26–30** | A **persistent but non-blocking** banner. Never a modal, never an interstitial, never a blocked action |

The rejected alternatives were a countdown from day one — which taxes the whole trial with a
reminder that the member is being sold to — and nothing until day 25, which is short notice for a
household that has to agree on a purchase together. **Twenty-one days is chosen so that the first
notice lands after three full weeks of real use**, which is long enough for the household to know
whether they want it.

**Only `read_only` and `canceled` carry a deletion date.** They are the two states that start the
**12-month** retention window, and their banner carries the date from the day the state is entered,
so nobody is deleted by surprise ([D-32](../prd/04-billing-and-entitlements.md)). The states before
them do not: `grace` is fourteen days of blocked uploads with no deletion consequence, and a
`restricted` household is still paying. **Putting a deletion date on a `grace` or `restricted`
banner tells a household it is about to lose data that is in no danger** — which is precisely the
surprise D-32 exists to prevent, aimed the wrong way. None of these banners is
dismissible-forever, and none of them ever blocks a read.

### Storage thresholds

Soft, and **never enforced by deletion** ([FR-BI3](../prd/04-billing-and-entitlements.md)):
nothing below 80 % · one in-app notice to owners at 80 % · at 100 %, owners told the next block
will be added and **uploads still succeed** · blocked only at 20 blocks, and **reads, downloads
and exports are unaffected permanently**.

The storage screen must show *"what deleting this would actually recover"*, including
derived-variant overhead, because *"why is my 2 MB file using 3 MB"* is otherwise a support ticket
([FR-DO6](../prd/modules/08-documents.md), [FR-ST4](../prd/03-platform-strands.md)).

## 4. Empty states

**Seventeen modules with an empty list and a plus button is a product nobody adopts.** Each empty
state does three things ([06-clients §3](../prd/06-clients.md)):

1. **Explains the module in one sentence** — what it is for, in the member's own words.
2. **Shows one example** — a real-looking row, visually marked as an example.
3. **Offers one action** — one, not three.

Beyond the first-run empty state, three others need designing and are frequently forgotten:

- **Filtered-empty** — "no results for this filter", with a clear-filter action. Not the teaching
  state.
- **Permission-empty** — does not exist. See §2: absence, not an empty state.
- **Not-enough-information** — Utilities' *"not enough information to forecast"*, Garden's
  *"rotation can't be checked yet — no history"*. These name **exactly what is missing** and
  offer the action that supplies it.

## 5. Destructive actions

**Nothing is destroyed without a plain sentence saying what will be lost**, and the confirmation
**names the object**.

| Situation | The confirmation must say |
|---|---|
| Delete a board / folder with children | The **count** of what goes with it ([FR-TA1](../prd/modules/02-tasks.md), [FR-NO2](../prd/modules/07-notes.md)) |
| Delete a referenced document | **What references it** — *"this is the service invoice on your Škoda"*. It does not block; the household's files are theirs ([FR-DO12](../prd/modules/08-documents.md)) |
| Disable a module | That **the data is retained** and re-enabling restores everything |
| Remove a member | What happens to their content: household content stays, their **private root** is deleted after a 30-day export window |
| Delete the household | Type the name. All members notified. **30-day reversible window** |
| Delete an account | The four situations are resolved and stated **before** anything happens: sole owner with no members · sole owner with members (**blocked**, with both unblocking options offered) · ordinary member · billing payer |
| Leave a household | The two refusals name what unblocks them: `last_owner` → promote someone; `billing_payer` → hand over billing or cancel. **A payer who is also the last owner hits both, and the flow says so at once rather than one at a time** ([FR-HH4](../prd/02-identity-and-access.md)) |
| Regenerate the household code | Future sign-ins with the old code stop; **existing sessions are untouched** |
| Change base currency | **Show what will change before it changes** ([FR-HA2](../prd/modules/17-household-admin.md)) |

Undo, where it exists (Shopping's clear-checked, soft deletes), is a **toast with a real window**,
not a hidden bin.

## 6. Setup and first run

**G1: a household is created, a second member is invited and accepted, and the first real thing
is recorded, in under five minutes, on a phone, without a manual.**

**Settled ([DD-6](08-decisions.md)): the sequence below.** The PRD sets the target and does not
specify the flow; this is the flow.

1. **Register or sign in.** Google / Apple / email. Apple is mandatory if any third-party sign-in
   is offered ([FR-ID2](../prd/02-identity-and-access.md)).
2. **Create the household** — name, country, timezone, locale, base currency. Country, timezone
   and currency are **pre-filled from the device and confirmed**, not asked.
3. **"What brought you here?"** — pick one module. This chooses the starting dashboard layout and
   the module the app opens into. It is **not** a module-enablement screen; everything stays on.
4. **Do the thing.** Straight into that module's capture surface.
5. **Invite** — offered after the first real record exists, never before.

**Step 3 is the one that needs guarding.** It looks like a module-enablement screen and it is
not: nothing is disabled by the answer, every module stays on, and the choice is re-made simply
by opening a different module. What it buys is a dashboard that is useful on day one instead of
seventeen widgets nobody chose ([FR-DB4](../prd/modules/01-dashboard.md)), and an app that opens
where the member's actual reason for arriving lives. Copy it as *"what brought you here?"*, never
as *"choose your modules"*, and offer a skip that lands on the household default layout.

An unverified account can do all of this. Verification gates **what leaves the household** —
inviting, becoming the billing payer — not what happens inside it
([FR-HH1](../prd/02-identity-and-access.md)), and the UI must explain that when it blocks the
invite, not earlier and not vaguely.

**Module setup flows** follow [02-components §4.6](02-components.md): skippable, resumable,
re-runnable, inferring from the country profile. **A skipped setup leaves a working module.**

## 7. Capture versus configure

Principle 2, made concrete. Every module has a **capture surface** that takes the minimum and a
**configure surface** that takes the rest, and the capture surface never requires the configure
surface to have been visited.

| Module | Capture | Configure |
|---|---|---|
| Shopping | A line of text | Categories, store layout, staples |
| Utilities | A number and a date | Tariffs, advances, billing periods |
| Finance | An amount and a description | Accounts, the allocation plan, budgets, categories |
| Garden | A crop in a bed | Beds, seasons, rotation, the plan |
| Documents | A photo | Type, expiry, folder, title |
| Chores | Tick it | Schedule, rotation, points, verification |

## 8. Notifications

- **Permission is requested contextually** — the first time the member does something that
  implies wanting to be told — **never on first launch** ([06-clients §6](../prd/06-clients.md)).
- **The system permission and the in-app category preferences are shown together**, so
  *"notifications are off"* is diagnosable in one screen. This is one design, not two.
- Four categories, each independently mutable per member per household: `direct` · `household` ·
  `reminders` · `digest`, plus a master switch and **quiet hours in the member's own timezone**.
- **Deep links from a notification resolve to the exact entity** — and resolve correctly on cold
  start, when the member is in a *different household*, and when they **no longer have access**,
  which shows a neutral message and never a leak.

## 9. Child profiles

A child is a **managed sub-profile created by an owner**, not a self-registering user
([D-17](../prd/02-identity-and-access.md)). Design consequences:

- **Sign-in has no email**: household code → profile → 4–6 digit PIN. On a shared tablet an owner
  authorises the device once and profiles switch without re-authentication. The **household code**
  is 8 characters in an unambiguous alphabet (no `0`/`O`, no `1`/`I`) and is presented as an
  identifier, **not as a secret to guard**.
- **The dashboard may be locked.** When it is, the arrange affordances are **absent, not
  disabled** ([FR-DB5](../prd/modules/01-dashboard.md)).
- **The one asymmetry is stated to the child, in the UI, at profile creation**: *"a parent can see
  everything here"* ([FR-CH3](../prd/02-identity-and-access.md)). Adults' private roots are
  readable by nobody, owners included. This sentence is a design deliverable and must be written
  for a fourteen-year-old.
- `manage` is unavailable to a child **by construction**, and Finance is capped at `view`. The
  controls express that as unavailable, not as a rejected save.
- **Ten wrong PINs lock the profile** until an owner unlocks it — a screen a child sees alone and
  which must not read as punishment.
- Chores is the child's product: points are **a ledger with a reason and an actor**, never a
  silently editable counter, and **there are no leaderboards** ([D-51](../prd/modules/06-chores.md)).

## 10. Privacy surfaces

- **Private roots** exist in Notes, Documents and Calendar (a `personal` calendar is a private
  root, not a hidden flag — [D-44](../prd/modules/04-calendar.md)). The root switcher is a
  first-class navigation element, not a filter.
- **A private calendar event on a shared calendar renders as a busy block with no title** — and
  it works offline, because the busy block is **a real synced row**
  ([D-88](../prd/03-platform-strands.md)). It carries the recurrence rule, so a weekly private
  event produces a weekly busy block. Design must make "busy, no detail" unmistakable and
  unclickable-into.
- **The diagnostic bundle** shows the member **exactly what it contains, rendered, before it is
  sent**, and lets them redact fields ([FR-PS1](../prd/02-identity-and-access.md)). This is a
  privacy commitment expressed entirely as a screen.
- **The activity log is member-facing**, and it shows **what the platform did to the household**
  too — *"Household support extended your trial"*
  ([FR-AL7](../prd/modules/16-activity.md)). It is the transparency surface, and it should look
  like a feature, not like a log file.
- **The privacy centre** carries all six data-subject rights self-service, with the complaint link
  routed to the member's own supervisory authority — the ICO for UK residents
  ([05-privacy §3](../prd/05-privacy-and-compliance.md)).

## 11. Cross-module integration, as the member sees it

A module never imports another module; integration is a **platform-resolved reference**
([D-40](../prd/modules/00-module-model.md)). Three visible consequences:

1. **A file lives in Documents.** A vehicle's service invoice, a garden photo, a receipt — all of
   them are Documents rows shown in place. If the caller has `none` on Documents, the vehicle
   renders **without them and says so**.
2. **An offer is never an automatic action.** Shopping offers to record a trip as a Finance
   expense; Property offers to record a service cost as a Finance transaction. *Offered, never
   forced* ([FR-SH8](../prd/modules/05-shopping.md), [FR-PP7](../prd/modules/12-property.md)).
3. **Widgets act on the owning module's endpoints**, carrying `via = "dashboard"` so the activity
   log records where a change came from ([FR-DB6](../prd/modules/01-dashboard.md)). A widget is
   a real interactive surface, not a link.

## 12. Honesty about computed numbers

**The module never shows a number it has not earned** ([FR-UT12](../prd/modules/10-utilities.md)),
and this generalises across the product.

| Situation | Presentation |
|---|---|
| Cannot compute | The field is **absent**, not zero, and the screen names exactly what is missing |
| Blocked by a gap | Utilities: *"a reading is needed for 2026-01-01"*, with the reading form pre-filled to that date and **no estimated value** ([FR-UT9](../prd/modules/10-utilities.md)) |
| Estimated input | Marked with a distinct style and **excluded from every money figure** ([FR-UT4](../prd/modules/10-utilities.md)) |
| Approximate aggregate | Monthly consumption is approximate by construction when an interval crosses a boundary, and the chart says so ([FR-UT15](../prd/modules/10-utilities.md)) |
| Projected | Asset service prediction is *"due in about six weeks"* and is **never presented as a date the household committed to** ([FR-AS2](../prd/modules/12-property.md)) |
| No history yet | Garden's `no_history` state — neither a pass nor a warning |
| Negative remainder | Shown as zero **with a footnote**, never clamped in the data ([FR-FI8](../prd/modules/09-finance.md)) |
