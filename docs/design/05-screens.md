# 05 — Screen inventory

Every screen the 1.0 product needs, grouped by what builds it, with the priority taken from the
[roadmap](../prd/08-roadmap.md) and the design risk called out where there is one.

**Priorities** — `P0` Phase 0 (platform, no feature modules) · `P1` Phase 1 (Shopping, to
production quality) · `P2` Phase 2 (daily core) · `P3` Phase 3 (the differentiators) · `P4`
Phase 4 (breadth).

Unless a screen says otherwise, assume it needs the twelve states in
[02-components §0](02-components.md), in both themes, at 200 % text, in English and German.

---

## A. Platform — identity, household, billing · P0

The phase with no demo. It is also where the design system is established, so these screens set
the vocabulary for everything after them.

| Screen | Notes and states |
|---|---|
| **Sign in** | Email + password, **Sign in with Google**, **Sign in with Apple** (mandatory if any third-party sign-in is offered). Generic failure copy whatever the cause — never "no such account" |
| **Register** | Password **minimum 12 characters**, no composition rules. Strength feedback must not demand symbols. Enumeration-resistant: the response is identical whether or not the email exists. Plus the **breached-password rejection** ([FR-ID1](../prd/02-identity-and-access.md)): a compliant long password can still be refused against the local breach list, and the copy has to explain that without alarming the member or implying *their* account was compromised — it is the hardest sentence on the screen |
| **Verify email** | Plus the **unverified-but-working** state: the household works, the trial runs; what is blocked is inviting and becoming the payer. The block must explain itself **at the moment it blocks** |
| **MFA** | Enrol (TOTP + recovery codes), challenge on a new device, recovery-code use |
| **Password reset** | Request (always succeeds, visibly) and set. On use, every session and refresh-token family is invalidated — say so |
| **Account-takeover notice** | The refresh-token reuse email and its in-app equivalent. Rare, alarming, must be written calmly |
| **Sessions and devices** | Last-seen, approximate location, user agent; revoke one; **sign out everywhere**. Revoking a device discards its offline replica — say so |
| **Child sign-in** | **Household code → profile picker → PIN.** Three steps, no email, designed for a fourteen-year-old on their own phone. Plus the shared-tablet profile switcher (owner authorises the device once) |
| **PIN lockout** | Ten wrong attempts, owner unlock required. Must not read as punishment |
| **Create household** | Name, country, timezone, locale, base currency — **pre-filled from the device and confirmed**, not asked |
| **Invitation composer** | Email or link form; role; **the full grant matrix before the person exists**; optional starting dashboard layout. Link invitations expire in 72 h, email in 14 days |
| **Invitation acceptance** | *"See exactly what you are being given"* — household name, inviter, role, **the list of modules and levels** — then accept or decline. Declining is recorded and the inviter told |
| **Household switcher** | See [04-navigation §6](04-navigation.md) |
| **Account settings** | Profile, language, MFA, sessions, notification categories, quiet hours, and **first day of week** — the member's own, overriding the household default (see §C, Household settings) |
| **Account deletion** | The four situations resolved and stated up front ([03-patterns §5](03-patterns.md)). Available in-app on iOS, Android and web — both stores require it |
| **Leave household** | With the `last_owner` / `billing_payer` refusals stated together, not one at a time |
| **Subscribe / manage billing** | Plan, annual vs monthly, currency, next charge, payment method, invoices, usage lines, cancel, **take over billing**. Payer sees all; other owners see state only |
| **Entitlement banners** | **Six** of the eight states ([03-patterns §3](03-patterns.md)): `trialing` (from day 21 only), `past_due`, `grace`, `read_only`, `canceled`, `restricted`. **`active` shows nothing at all** — it is a state, not a banner — and `suspended` is the lockout below. Only `read_only` and `canceled` carry the **deletion date**, from the day the state is entered |
| **Suspended lockout** | The eighth state, and the only one that is **not a banner**: `suspended` refuses reads, so this is a full-screen block with no household content on it, the notice that accompanies it, and a route to support. Staff-initiated, never billing. **It carries no export affordance** (**Settled — [DD-15](08-decisions.md)**) — see the Export row |
| **Sync health** | **Ships in Phase 0.** Per device: last sync, cursor, pending mutations, conflicts awaiting resolution, replica-digest state, force re-snapshot. Under D-93 the cursor is the replica's last checkpoint, the digest state is its bucket-checksum state (with the digest's, if plan item 17 keeps that endpoint), and the re-snapshot is a re-download ([FR-HA19](../prd/modules/17-household-admin.md)) |
| **Diagnostic bundle** | Shows exactly what will be sent, **rendered**, with per-field redaction, before sending |
| **Privacy centre** | All six rights self-service; export; complaint link routed per country (ICO for UK) |
| **Export** | Request, progress, download; the file is available for 7 days. **No billing state blocks it** — it is an exempted write ([FR-BI1](../prd/04-billing-and-entitlements.md)), so it works in `grace`, `read_only`, `canceled` and `restricted`. **`suspended` is the exception and is not a billing state**: it refuses reads, the lockout shows no household content, and export is unreachable there. Say that on the lockout and route to support — never an export button that fails. This one is design's call, not the PRD's, and it is the one place the handoff narrows G5 — **Settled ([DD-15](08-decisions.md))** |
| **Please update** | The blocking screen for a client below the minimum API version, in five languages |
| **Offline bar** | The global one. Designed once here |

**Design risk.** The invitation acceptance screen is the product's first impression for four of
five personas, and it has to render a seventeen-row grant matrix comprehensibly on a phone. It is
the highest-value screen in Phase 0 and deserves the most iteration.

---

## B. Shopping · P1

The first module built to production quality, chosen because it is the smallest module that
exercises the hardest part of the platform. **It is the design proving ground for the same
reason.**

| Screen | Notes |
|---|---|
| **List** | Quick-add field **always focused**, submit-and-stay; items grouped by category in **store-layout order**; checked items in a **collapsed section at the bottom, not gone**; who checked each item and when |
| **Lists overview** | Several lists (*Shopping*, *Hardware store*, *Christmas*), one default that quick-add targets, unchecked counts |
| **Item detail** | Quantity, unit, category, note, assignee, price. Every field optional |
| **Store layout editor** | Reorder categories to match how the shop is actually laid out, per list. *A small feature with a disproportionate effect on whether the module is used weekly* |
| **Staples** | One-tap suggestions learned from the household's own history; explicit staples; recurring staples that reappear on a cadence. **No cross-household data, no model, no inference** |
| **Trip summary** | Running total, and on clear-checked a recorded trip with total, date, store — plus the **optional, never forced** offer to record it as a Finance expense. A recorded trip is `additive`, so it is **created offline and corrected online only**: the edit affordance on a recorded trip is unavailable offline, in words ([03-patterns §1](03-patterns.md)) |
| **Empty state** | The template for the other sixteen |

**Non-negotiable interactions.**

- **Check off is a single tap.** Not the hold gesture ([FR-SH4](../prd/modules/05-shopping.md)).
- **Adding an item takes under two seconds and requires no decision.** Typing
  `milk, bread, 2 kg potatoes` creates three items.
- **Realtime**: two members in the same shop see each other's checks within a second.
- **The two-trolley case shows no conflict dialog to anyone** ([03-patterns §1](03-patterns.md)).

**Design risk.** This screen is used one-handed, while pushing a trolley, in bad light, sometimes
with no signal. Everything else in this handoff is secondary to getting it right, and gate G-C
tests it on two physical phones in aeroplane mode.

---

## C. The daily core · P2

### Dashboard

| Screen | Notes |
|---|---|
| **Dashboard** | An **ordered list** of widgets at `small` / `medium` / `large`, reflowing on phone, tablet and desktop. **No free-form grid** |
| **Widget catalog / arrange** | Only widgets whose module is enabled and on which the member has at least `view`. Unknown or now-unavailable keys are ignored, not errored |
| **Owner default layout** | Household default, plus a per-invitation layout. A member who customised is **not re-flattened** — they get a dismissible notice offering to adopt the new default |
| **Child layout** | **Suggested** (child may rearrange) or **locked** (arrange affordances **absent**, not disabled) |
| **Widget unavailable** | One slow module never blanks the dashboard |

**24 widgets** across the modules. They are interactive: hold-to-complete works inside them, and
actions call the owning module's endpoints.

### Reminders

| Screen | Notes |
|---|---|
| **Unified list** | Every reminder the member is subscribed to, **from every module**, chronological, grouped by week, **overdue first**, each row naming its source module and opening the source entity |
| **Own reminder editor** | Title, note, `due_on` (**a date, not a time**), recurrence, anniversary with a year count, linked entity, completion scope |
| **Subscriptions** | Per **reminder kind** — 21 kinds across ten modules, plus the module's own — each with a lead time (`0d` `1d` `3d` `1w` `2w` `1m` `3m` or custom) and a channel |
| **Snooze** | Personal, **even when completion is shared** |

**Design risk.** The subscriptions screen is a 21-row configuration surface that most members
will never open, and whose defaults are what make the feature work. Design the defaults, then
design the screen for the minority who change them.

### Tasks

Board · card detail · template picker (four starter templates) · label management · checklist ·
comments with mentions · cross-board move.

Column `kind` (`normal` / `now` / `done`) drives the *Doing* widget and completion semantics —
surface it in the column editor without making it jargon. Drag ordering is lexorank and merges
silently offline; **a conflict dialog for a drag would be absurd**.

### Notes

Tree browser with a **root switcher** (shared + one private root per member) · WYSIWYG editor
with a raw Markdown toggle · pinning at two scopes (household = shared and audited; personal =
a view preference) · language-aware search · **the conflict banner offering the preserved
overwritten body** for 30 days.

### Documents

Tree · upload (including from the camera) · detail with preview, thumbnail, raw and download ·
**document type + expiry** (the feature that turns a filing cabinet into something that tells you
your passport runs out in six months) · bulk multi-select move / archive / zip / delete ·
**storage screen** with the split by folder, member and type, the largest files, **derived-variant
overhead**, and what deleting a selection would recover · the **reference warning** before
deleting something another module points at.

Active types (HTML, SVG) are **download-only and never rendered in the app's origin** — the
detail screen needs that state.

### Chores

**Today** (mine first) · **This week** (the weekly grid: members across, days down — the module's
primary web view) · **All chores** (the definitions) · chore editor (four schedule kinds, four
assignment modes) · **points ledger** (every award, deduction and adjustment with a reason and an
actor) · rewards and redemption requests · verification queue · swap request/accept.

Non-negotiables: **hold-to-complete** (it moves the rotation and awards points) · **skip and
snooze exist** because the alternative is a permanently overdue item that trains everyone to
ignore the list · **overdue is shown once, prominently, then stops escalating** · **no
leaderboards, no inter-member comparison**.

**The other half of [FR-CO12](../prd/modules/06-chores.md)**: after `CHORE_STALE_DAYS` (default
14) an untouched overdue chore is flagged **to an owner** as *possibly not a real chore*, with a
one-tap delete or reschedule. An owner-facing surface with two actions and its own copy — and the
thing that stops "stops escalating" from quietly becoming a list of dead rows. *Pruning the list
is a feature.*

### Activity log

Filterable feed (module, action, entity type, actor, level, date, free text) · **entity timeline
including cross-module events** · field diffs · the **needs-connection** state, because the log
is deliberately not synced.

It shows **platform actions to the household** — *"Household support extended your trial"* — and
should look like a feature, not a log file.

### Household settings

Eight sections ([17-household-admin](../prd/modules/17-household-admin.md)). **This screen sits in
§C for coherence, but most of it is P0, not P2** — the per-section priority below is the one that
governs. Phase 0's client deliverables include settings, and its half of this screen is *profile,
members and grants, module enablement, storage, billing, data and sync health*; Phase 2 adds only
the notification composer and the per-module setup re-entry points
([08-roadmap](../prd/08-roadmap.md), Phase 0 *Clients* and Phase 2 *Household settings*). §2 in
particular carries the grant matrix, which §A calls the highest-value Phase 0 screen — designing it
a phase late would leave Phase 0 engineering building members and grants against nothing.

1. **Profile** · **P0** — name, avatar, country, timezone, base currency, locale, units, first day of week,
   **household code** (copy + regenerate; the screen says households with no child profile never
   need it). Changing the base currency **shows what will change before it changes**. The
   household's **first day of week is a default**, not the answer: it comes from the household
   locale ([17-household-admin §1](../prd/modules/17-household-admin.md)) and each member's own
   locale setting overrides it for them ([03-strands §9](../prd/03-platform-strands.md)), so both
   controls exist and this screen must say which one it is — two members of one household can
   genuinely see different week starts ([06-accessibility §2](06-accessibility-and-i18n.md)).
2. **Members** · **P0** — the list with **every member's grant matrix visible to every member**;
   invite; change role and grants (member is notified); remove; child profiles.
3. **Modules** · **P0** — enable / disable for the household, with *"your data is retained"* stated
   in the confirmation. The **per-module setup re-entry points are P2**, arriving with their
   modules.
4. **Notifications** · **P2** — trigger-rule composer over the live action catalog (**keys are
   picked, not typed**), per-language templates, scheduled digests, delivery log, test send. This
   section, and only this one, is what Phase 2 adds to the screen.
5. **Storage** · **P0** — total against allowance, trend, split by module and member, largest items,
   derived overhead, projected charge, links into each module's clean-up view.
6. **Billing** · **P0** — see §A.
7. **Data** · **P0** — export, delete household, transfer ownership, and **restrict** (GDPR Art. 18),
   which sits **here and not under billing**.
8. **Advanced** · **P0** — connected clients and versions; **sync health**.

**Design risk.** The notification composer is an owner-facing rule builder — the most
business-software-shaped screen in a consumer product. It must not become one. Bias hard toward
picking from a list of household-meaningful events over composing predicates.

---

## D. The differentiators · P3

The three heavy rebuilds. Each has a substantial setup flow, and each contains the single hardest
screen in its area.

### Utilities

| Screen | Notes |
|---|---|
| **Setup** | Four steps: what do you pay for · how much detail per service · **country + commodity preset** · enter what you know. The tariff engine is **never shown to a normal user** |
| **Services overview** | Per service: current balance **or headroom**, next advance, and any blocking gap |
| **Service detail** | Mode-dependent — `bills_only` / `readings` / `full`, upgradeable at any time with nothing lost |
| **Reading entry** | **The cellar screen.** Per-register value fields sized to the meter's digits and decimals, date, optional photo, source. Client-side pre-check against the neighbour it holds; rollover offered rather than refused; pending until the server takes it |
| **Readings list & consumption chart** | Estimated readings styled distinctly and **excluded from money**; monthly aggregates marked `is_approximate` where an interval crosses a boundary |
| **Tariff composer** | Ordered typed components with `applies_to`, labelled in **the words on that country's bill**, with a live human-readable breakdown |
| **Advances** | Versioned schedule; a recorded payment wins over the schedule for its month, attributed by **month key**, not payment date |
| **Billing period & settlement** | User-set, non-overlapping; the supplier's total, balance **and their final meter values per register**, so a discrepancy is attributable to consumption rather than only to money; computed vs invoiced in **both money and units** |
| **Blocked state** | *"A reading is needed for 2026-01-01"* — with the reading form pre-filled to that date and **no estimated value** |
| **Headroom** | *"Your advance is €80. €22 of that is fixed charges. €58 buys about 310 kWh at your rates."* Computable with **zero consumption data**, which is why it is what day one shows |
| **Bills-only** | Invoice list, spend history, year-on-year, price-change detection |
| **Meter replacement** | Close with a final reading, open a successor with an initial one, same date |

**Design risk.** The tariff composer. It must express eleven component types, ordering, and
compounding tax without becoming a formula editor, and it must be filled in by a person holding
a paper bill. Design it as *transcribing a bill*, not as *modelling a tariff*.

### Finance

| Screen | Notes |
|---|---|
| **Setup** | Five steps, and **the module's most important screen** is step 1: *"How does your household handle money?"* — **four illustrated answers**, each pre-selecting capabilities and a preset |
| **Period overview** | This period's headline; and the **missing-period** prompt, because the real failure mode is a month nobody entered |
| **Flow view** | Income → what each person keeps → what reaches the joint account → what leaves it for savings → what remains. **N sources, M accounts**, with the reconciliation note. Also where a member **posts** a movement that actually happened, in one tap — planned shown beside posted, with the difference named |
| **Allocation plan editor** | Ordered rules, **live worked example with the household's real numbers**, and the hard rule: **exactly one `remainder` per source**, refused at save with a message naming it |
| **Accounts** | Any number, six types; `personal` requires an owner and no other type may have one |
| **Ledger** | The unified transaction table. Mono numerics, compact density, keyset paging, the `source` discriminator (`manual` / `import` / `split` / `allocation` / `recurring`) visible |
| **Expense editor** | Five split methods, multi-payer, participants, receipt document reference. **Deterministic last-minor-unit assignment** shown in the preview |
| **Balances & settle up** | Net per member and per pair; the **simplified** transfer set *and* the un-simplified pairwise list, because some households settle with one person only. Simplification is a suggestion; the recorded settlement is what actually happened |
| **Budgets** | Per category per period: planned, actual, remaining, projection by elapsed days, rollover flag |
| **Recurring & subscriptions** | Definitions, **pending transactions the member confirms** (never auto-posted), **price history** — *"Netflix has gone up three times in two years"* — and the **cancellation-window** reminder, which fires at the notice period, not at expiry |
| **Import wizard** | Upload → preview → map → date format → decimal separator → sign convention → save the mapping by name; duplicates confirmed, never silently dropped or imported |
| **Conflict resolver** | **Finance is the module where a conflict dialog is the correct answer.** Everything money-bearing is `strict_version` |

**Design risk.** The flow view. It is a visualisation of an N-to-M money movement that must stay
readable on a phone, must reconcile exactly, and must show planned beside posted without implying
that the app moved anybody's money. **Household never moves money and must never look like it
does.**

### Garden

| Screen | Notes |
|---|---|
| **Setup** | Four questions: what are you growing in (**sets the tier**) · where (a town or a dropped pin, **snapping visibly to two decimals**) · what do you grow · your growing space |
| **`pots` home** | Containers, plants, watering and feeding **reminders** (a rhythm, not a plan), photo journal |
| **`beds` home** | Beds ordered within zones — **that order is the adjacency model** — plantings with five planned and four actual dates, generated task chain, harvest log, reduced companion checks |
| **`plot` home** | Seasons, the full eleven-check plan review, rotation over closed seasons, succession, storage log, season close |
| **Crop catalog browser** | ~300 crops, five languages, timings resolved against **this household's frost dates**. Per-field **provenance** — folklore and agronomy distinguishable by looking |
| **Household overrides** | Own crops and varieties; any catalog field overridable, **shown as an override rather than merged silently** |
| **Planting editor** | Quantity as **either** an area or a plant count (exactly one); planned dates default from the resolved windows, each with an `is_manual` flag |
| **Task list** | Generated tasks with `is_generated`; regeneration moves only **open, unedited, generated** tasks and leaves a **tombstone** where one was deleted |
| **Drift** | Recording an actual date changes **no** planned window; the detail states the drift and offers a one-action shift of remaining open tasks |
| **Plan-check panel** | Eleven checks, advisory always, dismissible per season with a note, with the explicit **`no_history`** state |
| **Season copy** | `dry_run` shows the whole prospective season **and its check**, side by side, **before the season exists** |
| **Season close** | Final yields, failures, observed frost dates — then it becomes rotation history |
| **Storage log** | Consumption recorded by **editing the remaining quantity in place**; no movements table |
| **Frost warning** | One warning naming the temperature and the plants. The single most valuable thing the module does for a balcony gardener |
| **Print** | *This month's work* with real checkboxes; *the season plan* on one page |

**Design risk.** Three tiers over one data model. A `pots` household must never see a bed, a
season or a rotation check, and moving up a tier must reveal — never migrate. Design the `beds`
tier first: it is the median European garden and *deliberately the one that gets the most
attention*.

---

## E. Breadth · P4

### Calendar

Month · week · day · **agenda** (the mobile default; month is the web default) · event editor
with recurrence · **the three-choice occurrence edit** (this / this and following / all, each
with distinct consequences the dialog must state) · participants and RSVP · **the "who" overlay**
by member colour · **busy blocks** for private events, which must be unmistakable and
uninspectable · connection setup per provider · **per-remote-calendar direction and scope**
(off / import / two-way, and **details or busy-only**) · connection health with a **staleness
badge** · external conflict resolution (external wins for events it owns, Household wins for its
own, the loser preserved and surfaced) · **disconnect**, which asks whether to keep the mirrored
events as ordinary Household events or remove them.

The external-connection screen is also a **privacy screen**: it is the one place household
content can leave the EEA, so the copy names the recipient at the moment of connecting, offers
busy-only first, and is **never available to a child profile**.

### Property · Vehicles · Pets

One asset engine, three vocabularies. Shared screens — **entity list, entity detail, service
schedule editor (interval, usage, or both whichever comes first), service history, usage log** —
rendered three times in three languages of their own. *People look for their car under "car".*

| Module | Its own screens |
|---|---|
| **Property** | Starter checklist by country (one tap adds an item **with its typical service interval**) · contractors · **meter locations** (*"where is the stopcock"*) · **the printable insurance inventory**, which becomes the most valuable thing in the app on exactly one very bad day |
| **Vehicles** | Statutory dates pre-filled per country (**STK / TK / HU-TÜV / przegląd / MOT**) · insurance with a **notice-period** renewal reminder · **fuel and charging log** with correct partial-fill handling · total cost of ownership · **a bike variant that never asks for a registration plate** |
| **Pets** | Health record (six entry types) · **medication doses**, ticked per dose, **shared across the household** — *"did you already give it"* · **daily routine** that resets and shows who did it · **vet card with the out-of-hours number one tap from the top** · feeding details and allergies, so the pet screen is *the thing you hand to whoever is looking after them* · weight chart · a **gentle** deceased/rehomed flow |

**Design risk.** Pets shares tables with an asset engine and **must not read like asset
management**. Language, defaults and tone carry that difference entirely.

### Chat

Conversation list · thread with replies, mentions, reactions (**a fixed emoji set, desired-state
not toggle, because a double tap fires twice**) · attachments with async thumbnails · unread and
the **floor** (a member added today sees nothing before joining) · **storage clean-up page**:
largest attachments, oldest, total per conversation, multi-select delete and **move to
Documents** as a custody transfer so the household stops paying twice · mute per conversation ·
search bounded by the floor.

**Design risk.** Chat may ship **disabled in UK households** if counsel's answer on the Online
Safety Act goes the other way ([D-89](../prd/modules/15-chat.md)). The four-tab mobile layout
must look designed, not broken.

---

## F. Cross-cutting screens

Owned by no module, needed by all.

| Screen | Priority |
|---|---|
| **Global search** — one result row shape across every module the caller may see | P2 |
| **Today** — [04-navigation §2](04-navigation.md) | P2 |
| **Add sheet** — [04-navigation §3](04-navigation.md) | P2 |
| **Conflict inbox** — the cross-module list, plus the persistent badge; routes to the row, never resolves in place ([DD-4](08-decisions.md)) | P0 |
| **Conflict resolver** and **rejected-mutation resolver** | P0 |
| **Tab bar at four and five destinations** — both are finished layouts ([DD-11](08-decisions.md)) | P0 |
| **In-app contextual help** — the surface (inline hint, expandable, or panel), the content model, and the hard-screen set: tariff composer, allocation editor, merge/conflict explanation, household code, storage metering ([DD-13](08-decisions.md)) | P2 model, per-module thereafter |
| **Offline bar**, pending / syncing / rejected marks | P0 |
| **Storage picture** (settings) — total against allowance, split, largest items, derived overhead | P0 (§C.5) |
| Per-module storage clean-up views (Documents, Chat) | P2 / P4 |
| **Notification permission + categories**, shown as one screen | P0 |
| **Neutral "not available"** — the deep-link and grant-loss landing | P0 |
| **404 for a moved slug path** | P2 |
| **Please update** | P0 |
