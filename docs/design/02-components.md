# 02 — Components

The inventory below is what the seventeen module specifications actually require. It is written
as *what must exist and in which states*, not as a visual description.

**Every stateful component has a component test in CI** ([06-clients §8](../prd/06-clients.md)),
so an undocumented state is an untested state.

## 0. The states every data-bearing component must have

Before the inventory, the checklist. Any component that renders household data needs all of
these designed, in both themes:

| State | Notes |
|---|---|
| **Loading** | Skeleton, not a spinner, where the shape is known |
| **Empty** | Teaching empty state — one sentence, one example, one action ([03-patterns §5](03-patterns.md)) |
| **Populated** | |
| **Error** | Named in words, with an action |
| **Offline** | Reads look identical to online. This is a requirement, not an aspiration: *"Any offline read — indistinguishable from online"* ([07-nonfunctional §2](../prd/07-nonfunctional.md)) |
| **Pending** | A queued local write. **Fully editable**; edits merge into the queued mutation |
| **Syncing** | Only shown when it takes longer than a moment |
| **Conflicted** | Tappable, opening the comparison |
| **Rejected** | The actual reason in a sentence, plus retry / edit / discard |
| **Permission-absent** | Not disabled — **gone**. See [03-patterns §2](03-patterns.md) |
| **Withdrawn** | The row was **retracted** while the member held it — access changed, so the client deleted it locally. Not an error, not an empty state, not somebody else's delete. See [03-patterns §2](03-patterns.md) |
| **Read-only (entitlement)** | Content visible, writes absent, banner explains |

## 1. Primitives

| Component | States and notes |
|---|---|
| **Button** | primary · secondary · ghost · danger; default / hover / focus-visible / pressed / loading / disabled. Focus ring visible in **both** themes on **both** surfaces. Min 44×44 pt |
| **Icon button** | As above, and **always labelled** for screen readers (N1, [06-clients §4](../prd/06-clients.md)) |
| **Input, textarea, select, stepper** | default / focus / filled / error / disabled / read-only. **Every input labelled; errors associated programmatically and stated in words, never only in red** |
| **Checkbox, radio, switch** | Including indeterminate for checkbox |
| **Chip / tag** | Filter chip, module chip (accent + icon + name), status chip |
| **Avatar** | Member avatar with a per-member colour (used by Calendar's who-overlay and Chores' grid); initials fallback; child badge |
| **Badge / counter** | Unread, overdue, pending count. Never colour-only |
| **Tooltip / popover** | Keyboard-reachable; never the only route to information |
| **Sheet / modal / drawer** | Focus trapped, escapable, restores focus. Mobile prefers sheets; web prefers side panels for editors and modals only for confirmation |
| **Toast** | With undo. Undo windows exist in Shopping (clear checked), Tasks and elsewhere |
| **Skeleton** | Shape-matched to the content it replaces |
| **Segmented control / tabs** | Keyboard arrow navigation |

## 2. Layout and navigation

| Component | Notes |
|---|---|
| **Tab bar (mobile)** | A fixed set in a fixed order — Home · Today · **Add** · Chat · More — and **Chat is the one that can be absent**. Add holds the centre slot and opens a capture sheet rather than pushing a destination ([06-clients §2](../prd/06-clients.md)); it occupies a slot, so a bar without Chat is **four slots**, not four plus a floating button. **Four and five are both first-class layouts and both are drawn** — never a five-slot bar with a hole in it ([DD-11](08-decisions.md), [04-navigation §1](04-navigation.md)) |
| **Sidebar (web)** | Module list, per-member ordered and filtered, plus global search |
| **App bar / page header** | Title, module accent, contextual actions, breadcrumb for tree modules |
| **Household switcher** | A user may be in several households, with different roles in each. Must show which household is active at all times, and must never allow a cross-household action to be ambiguous |
| **Section list** | Grouped, sticky headers — the shape of Today, Reminders, Shopping and the agenda |
| **Two-pane (web)** | Tree + detail, for Notes and Documents |
| **Empty state** | See [03-patterns §5](03-patterns.md). Seventeen of these are a deliverable |
| **Offline bar** | Persistent, unobtrusive: *"Offline — changes are saved and will sync"*. Never blocks content |
| **Banner** | Entitlement — **all six banner states**: `trialing` (the two DD-9 notice stages, from day 21 only; the first is dismissible), `past_due` (a payment-method prompt, not a wall), `grace`, `read_only`, `canceled`, `restricted`. `active` shows nothing and `suspended` is a full-screen lockout, not a banner ([05-screens §A](05-screens.md), [03-patterns §3](03-patterns.md)). Plus storage threshold, connection degraded, dashboard-default-changed notice, child privacy notice |

## 3. Data display

| Component | Notes |
|---|---|
| **List row** | The workhorse. Must carry: title, optional secondary line, optional module chip, optional member avatar, **sync state mark**, trailing action. Swipe actions on mobile must have a non-swipe equivalent |
| **Data table (web)** | Sortable, keyset-paginated (cursor, not page numbers), comfortable and compact densities, horizontal scroll contained. Numeric columns in the mono face, right-aligned, tabular figures |
| **Key–value detail block** | The right-hand pane of every asset, document and service |
| **Money value** | Amount + currency, optional original currency + stored FX rate, optional sign convention. Negative values distinguished by more than colour |
| **Metric tile** | A catalog metric rendered: label, value, optional trend, optional "not enough information" state |
| **Chart: time series** | Utilities consumption and cost, Pets weight, Finance budget burn-down. Must support **an "estimated" style** for interpolated points that are excluded from money ([FR-UT4](../prd/modules/10-utilities.md)) and an `is_approximate` mark on monthly aggregates ([FR-UT15](../prd/modules/10-utilities.md)) |
| **Chart: composition** | Storage by module and member; budget by category |
| **Chart: flow** | Finance's income → accounts → savings diagram ([FR-FI9](../prd/modules/09-finance.md)). N sources, M accounts. The hardest single visual in the product |
| **Progress** | Household weekly chore progress, checklist progress on a task card, storage against allowance. **No leaderboards, ever** ([D-51](../prd/modules/06-chores.md)) |
| **Timeline** | The activity log's entity timeline, including cross-module events |
| **Field diff** | Old value → new value, for money, tariffs, permissions and membership changes ([FR-AL4](../prd/modules/16-activity.md)) |
| **Search result row** | One uniform shape across every module: `{ module, entity_type, entity_id, title, snippet, path, updated_at, score }` ([FR-SE1](../prd/03-platform-strands.md); `SearchHit` in [openapi.yaml](../api/openapi.yaml)). `entity_type` is what separates a board from a card, or a folder from a document, and this row is the only place that distinction can live. **`snippet` and `path` are nullable**, so the row needs a no-snippet and a no-path variant that still reads as a result |

## 4. The load-bearing domain components

These are the ones where getting the interaction wrong breaks a requirement.

### 4.1 Hold-to-complete

**2000 ms press-and-hold**, carried from `home`. Used by: Tasks (complete a card), Chores
(complete an occurrence), Reminders (complete an occurrence), Garden (complete a task), and the
widgets that mirror them.

Non-negotiable, both parts ([06-clients §3](../prd/06-clients.md)):

- **A visible progress indicator** for the whole 2000 ms.
- **A mandatory immediate keyboard and screen-reader path** that does not require the hold. *A
  gesture that is the only way to do something is an accessibility failure.*

States: idle · holding (progress) · released-early (returns to idle, no action) · completing ·
completed · failed. Under `prefers-reduced-motion` the progress is stepped, not swept.

**Where it must not be used: Shopping check-off** ([FR-SH4](../prd/modules/05-shopping.md)). A
single tap. The gesture exists to prevent accidental completion of things that are expensive to
undo, and unchecking an item costs nothing.

### 4.2 Sync state mark

A small, consistent mark on any row that can be pending, syncing, conflicted or rejected.
**Colour and icon and — on tap, or inline where there is room — words.** The absence of the mark
is the "synced" state; there is no green tick on every row
([06-clients §5](../prd/06-clients.md)).

### 4.3 Conflict resolver

Opened from a conflicted row. Shows **both values, both authors, both times, and no jargon**:

> *"You set the amount to 450. Petr set it to 500 at 18:40. Which is right?"*

Two clear choices plus a way to enter a third value. Used only for `strict_version` entities —
money, tariffs, allocations, calendar events, chore definitions — because for `lww_field`
entities nothing was lost and there is nothing to ask ([D-39](../prd/06-clients.md)).

**Settled ([DD-4](08-decisions.md)): an inbox plus row-level flags, not a modal at reconnect.**
Conflicts must always be *asked*, but not necessarily *now*. A member who reconnects after a week
may have several, and a reconnect that opens six modals is a reconnect people learn to avoid. So:

- **A persistent badge** wherever unresolved conflicts exist, and **a conflict inbox** listing
  them across modules.
- **A flag on each affected row**, in its own module, with the module's own context around it.
- **Resolution happens one at a time, from the row** — the inbox routes to the row rather than
  resolving in place, because "which amount is right" is only answerable next to what the amount
  is for.
- Nothing auto-resolves and nothing ages out. An unresolved conflict stays flagged.

**Notes is the special case**: note bodies are `lww_row`, the overwritten version is kept for **30
days**, and the conflict banner offers it back ([FR-NO10](../prd/modules/07-notes.md)). That is a
"here it is" affordance, not a question.

**Chat is not the same case.** Message bodies are also `lww_row` and the loser is also preserved,
but with **no stated retention window and no offline path** — an edit is online-only, inside
FR-CT3's window ([15-chat Sync](../prd/modules/15-chat.md)). So it is a rare online affordance,
and it must not be designed, or budgeted, as an offline recovery flow promising thirty days.

### 4.4 Rejected-mutation resolver

A rejected write is not a conflict. It carries **an actual reason in a sentence** and three
actions: retry, edit, discard. The reasons that will really occur:

| Reason | Copy must say |
|---|---|
| `monotonicity_violation` | *"That reading is lower than the one on 3 March. Is it a rollover, or a typo?"* — and offer the rollover path ([FR-UT3](../prd/modules/10-utilities.md)) |
| `entitlement` | The subscription state, and that the change is **held**, not lost ([FR-BI2](../prd/04-billing-and-entitlements.md)) |
| Quota / size / type on an attachment | What the limit is and what to do ([FR-FL4](../prd/03-platform-strands.md)) |
| Reference gone | What it pointed at |

### 4.5 Grant matrix

Seventeen modules × four levels (`none` · `view` · `contribute` · `manage`), per member. Appears
in three places: the invitation composer, the member detail, and the member-list overview where
**every member's grants are visible to every member** — *"the comparison is the point of the
screen"* ([FR-HA3](../prd/modules/17-household-admin.md)).

Must communicate, without a legend nobody reads, that `none` means the module is **absent** for
that person, and that `owner` implies `manage` everywhere and cannot be reduced. A `child` cannot
be given `manage` at all, and cannot exceed `view` on Finance — the control must express that as
*unavailable by construction*, not as a validation error after the fact.

### 4.6 Setup wizard

Three modules have substantial setup (Finance, Utilities, Garden) and five have light setup.
Every one obeys the same rules ([modules/00 §3](../prd/modules/00-module-model.md)):

- **Skippable**, and skipping leaves a **working default**, never a broken half-state.
- **Resumable** and re-runnable from settings.
- Asks the **fewest decisions that make the module correct** and infers the rest from the
  household's country, currency, locale and timezone.
- **Never asks a question whose answer it can compute.**

Component needs: step indicator, skip affordance that is as prominent as continue, a
**re-run entry point** in settings, and a **live worked example** panel (Finance step 4 shows
real numbers from the entered incomes before saving).

### 4.7 Quick add

Shopping's `FR-SH3` is a requirement, not a UI choice: one text field, **always focused**,
submit-and-stay, and typing `milk, bread, 2 kg potatoes` creates **three** items. Under two
seconds, one-handed, while pushing a trolley, with no decision required.

The mobile **Add** tab is the general form of this: a capture sheet offering the six most likely
creates for this household, learned from use ([06-clients §2](../prd/06-clients.md)).

### 4.8 Widget shell

Dashboard widgets come in `small` · `medium` · `large` and reflow as an **ordered list**, never a
coordinate grid ([01-dashboard](../prd/modules/01-dashboard.md)).

**Settled ([DD-2](08-decisions.md)): sizes are column spans in a 2 / 4 / 6-column grid** — phone,
tablet, desktop — over a fixed row rhythm:

| Size | Phone (2 col) | Tablet (4 col) | Desktop (6 col) |
|---|---|---|---|
| `small` | 1 | 1 | 1 |
| `medium` | 2 (full) | 2 | 2 |
| `large` | 2 (full), **two rows** | 4 (full) | 3 |

Reflow is therefore deterministic from the ordered list alone, and a `large` widget degrades to
full width on a phone rather than becoming a mystery. The rhythm is fixed so that two `small`
widgets beside each other line up regardless of their content.

**`large` takes two rows on a phone**, because column span alone cannot separate it from `medium`
there — both are full width — and mobile is where most arranging happens. Without the second row
the arrange screen would offer three sizes with two outcomes, and a size set on a phone would
silently only change the member's desktop, since the layout is one stored `size` per widget across
every device ([FR-DB2](../prd/modules/01-dashboard.md)).

The shell must have:

- A **per-widget error state**: `{ key, error: "unavailable" }` renders the widget as
  unavailable and **the rest of the dashboard renders normally**. One slow module never blanks
  the screen ([FR-DB3](../prd/modules/01-dashboard.md)).
- A single-widget refresh.
- An arrange mode — and, for a locked child layout, **the arrange affordances are absent rather
  than disabled** ([FR-DB5](../prd/modules/01-dashboard.md)).

### 4.9 Reminder row

Used in the unified Reminders list, in Today, and in the `reminders.due` widget. Carries: date,
title, **the source module** (chip: icon + name), the entity it opens, an overdue mark, and a
snooze action. Rows from a module the member has `none` on are **absent, not greyed**
([FR-RE5](../prd/modules/03-reminders.md)).

### 4.10 Document reference

A typed link from Property, Vehicles, Pets, Garden, Finance, Utilities, Tasks or Chores into
Documents. The platform resolves it with the caller's Documents grant applied, so the component
has a state the referring module cannot predict: **"a document exists here but is not visible to
you"** ([D-40](../prd/modules/00-module-model.md)). That placeholder must not look like an error
and must not leak the title.

### 4.11 Attachment tile

Covers the offline upload path ([D-25](../prd/03-platform-strands.md)): the row exists and syncs
**before the bytes do**. States: `pending` (placeholder, on every device), `ready`, `failed`
(with a reason the member can act on: quota, size, type).

### 4.12 Money input

Minor-unit-safe. Locale-aware decimal separator on input, currency selector where multi-currency
is allowed, an FX rate field with the ECB reference suggestion, and a split preview where the
last minor unit is assigned deterministically (€10.00 three ways is 3.34 / 3.33 / 3.33, **the
same 3.34 every time**, [D-57](../prd/modules/09-finance.md)).

### 4.13 Meter / usage reading input

Utilities readings and the asset engine's usage log share a shape. Needs: per-register value
fields matching the meter's `digits` and `decimals`, a date (not an instant — the meter state at
00:00 of that day), an optional photo, a `source` mark (`manual` / `estimated` / `supplier`), and
**a client-side pre-check against the neighbouring reading the replica holds**, questioning a
lower value at the meter rather than rejecting it an hour later at the kitchen table
([10-utilities Sync](../prd/modules/10-utilities.md)).

The pending state stays visible until the server has actually taken it. This screen is used
standing in a cellar with no signal; it is the module's most important layout.

**Creating a reading offline is the whole point; correcting one offline is not possible.** A
reading is `additive`, and an additive row has no offline update path — a correction is an
ordinary online edit ([03-patterns §1](03-patterns.md)). So the *create* form queues as usual,
and the **edit affordance on an already-synced reading is unavailable offline**, in words, rather
than accepting a change the platform cannot queue. The same holds for every other `additive` row
in the product: fuel entries, service records, settlements, point-ledger rows, **recorded shopping
trips, task comments and pet health entries including the weight series**
([03-patterns §1](03-patterns.md) has the full list). Shopping is the one to watch — it is the
Phase 1 offline proving ground, so its trip summary is the first screen that has to draw an
edit affordance which is present online and unavailable offline.

### 4.14 Tariff component editor

An **ordered list of typed components** — eleven types, each with its own parameters and an
explicit `applies_to` ([FR-UT5](../prd/modules/10-utilities.md)). **There is no formula language
and no user-written expression** ([D-64](../prd/modules/10-utilities.md)); the editor is the
whole of the expressiveness, so its ordering, its `applies_to` picker and its live breakdown
preview are the feature.

The **labels come from the country preset**, and they are the words that appear on that
household's actual bill — *Grundpreis*, *plat za jistič*, *standing charge*. The engine is never
shown to a normal user.

### 4.15 Allocation rule editor

An ordered rule list with `from` / `basis` / `mode` / `value` / `to`, a **live worked example**
using the household's real incomes, and one hard validation: **exactly one `remainder` rule per
source**, refused at save with a message naming the source
([FR-FI4](../prd/modules/09-finance.md)).

### 4.16 Import mapping wizard

Finance CSV / camt.053 ([FR-FI19](../prd/modules/09-finance.md)): upload → preview first rows →
map columns → date format → decimal separator → sign convention → save the mapping under a name.
Plus a **duplicate confirmation** step; suspected duplicates are shown, never silently dropped
and never silently imported.

### 4.17 Recurrence editor

Two different ones, and they must not be confused:

- **Reminders** — an RRULE subset, **series-only editing**, no per-occurrence exceptions, and
  **no time of day** ([03-reminders](../prd/modules/03-reminders.md) non-goals).
- **Calendar** — RFC 5545 with `rdate`/`exdate`, and the standard three-choice edit: **this
  occurrence · this and following · all** ([FR-CA3](../prd/modules/04-calendar.md)). Each has a
  distinct implementation and distinct consequences, and the dialog must say which.

### 4.18 Plan-check panel

Garden's eleven advisory checks ([FR-GA18](../prd/modules/11-garden.md)). Each returns a
severity, a translated title and detail, and the entities it points at. Requirements that shape
the component:

- **A warning never blocks a save.** Advisory, always.
- **Dismissal** silences one warning for one season, with a note, reversibly. *Without it,
  members stop reading the panel by April, and the panel is the feature.*
- History-dependent checks return the explicit state **`no_history`** — *"rotation can't be
  checked yet — no history"* — which is neither a pass nor a warning and must not look like
  either.

### 4.19 Weekly grid

Chores' primary web view: members across, days down ([FR-CO11](../prd/modules/06-chores.md)).
Compact by default. Must survive twelve members and 200 % text scaling, which almost certainly
means it scrolls in one axis and pivots on mobile.

### 4.20 Print layouts

**Settled ([DD-14](08-decisions.md)): three real print targets, and they ship in 1.0 as their own
line.** Two are in Garden ([FR-GA23](../prd/modules/11-garden.md)) — *this month's work* with real
checkboxes, and *the season plan* on one page — and the third is Property's insurance inventory
([FR-PP5](../prd/modules/12-property.md)). These need their own low-fidelity styling: no dark
theme, no accents, ink-cheap, and legible from a garden pocket.

They do not all land in one design set. The **stylesheet itself and Garden's two layouts are
DS-3**; **Property's inventory is DS-4**, with the module whose tables it prints
([07-delivery §1](07-delivery.md)).
