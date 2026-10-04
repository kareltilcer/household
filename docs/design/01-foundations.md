# 01 — Foundations

Everything here ships as `@household/tokens`, consumed by both clients as CSS custom properties
and as a typed JS object. **The token file is the contract between design and both codebases**;
a value that exists only in a design file does not exist.

## 1. The three layers

**Primitives → semantic → component**, for colour. Only semantic and component tokens may appear
in application code; a primitive used directly, or a raw colour, is a lint error
([06-clients §3](../prd/06-clients.md)). The scales beside them are spent by name
([D-152](../prd/09-decisions.md)).

| Layer | Contains | Named like | Who may use it |
|---|---|---|---|
| **Primitive** | The raw colour ramps | `neutral-200`, `indigo-600` | Only the semantic layer |
| **Semantic** | Role-named values that survive a rebrand | `surface`, `text-primary`, `danger` | Application code |
| **Component** | Per-component overrides where a semantic value is genuinely wrong for one component | `button-primary-bg` | That component only |
| **Scale** | The type scale, the 8-point space scale, radii, elevation, motion durations and easings | `space-2`, `radius-card`, `dur-fast` | Application code, by name |

### The semantic set the PRD names

`surface` · `surface-raised` · `text-primary` · `text-muted` · `accent` · `danger` · `warning` ·
`positive` · `border` · `focus`

That list is a floor, not a ceiling. Household needs more, and every addition must be
role-named and defined in **both** themes:

**The additions the screen inventory requires.** These are design's own call — the token system
is design's to own ([00-brief §7](00-brief.md)) — but they are listed rather than left implicit,
because a token invented per module is how five modules end up with five greys:

| Token | For |
|---|---|
| `surface-sunken`, `surface-overlay`, `surface-inverse` | Grouped lists, sheets, tooltips |
| `text-on-accent`, `text-on-danger`, `text-disabled`, `text-link` | Contrast pairs that must be tested independently |
| `border-strong`, `border-subtle`, `divider` | Tables need three, not one |
| `info` | The fourth status alongside danger/warning/positive — used by the offline bar and staleness badges, which are neither a problem nor a success |
| `status-synced`, `status-pending`, `status-syncing`, `status-conflict`, `status-rejected`, `status-offline`, `status-overdue`, `status-blocked`, `status-estimated`, `status-private`, `status-locked`, `status-stale`, `status-no-history` | **One token per status state, all thirteen** — the same thirteen [§8](#8-iconography) draws and [06-accessibility §1](06-accessibility-and-i18n.md) triple-encodes. Colour · icon · word is the rule, so a state without a token has no declared contrast pair, fails no build, and gets whatever colour the module that needed it first invented. Several will alias `danger` / `warning` / `positive` / `info`; **aliasing is fine, absence is not** |
| `accent-<module>` × 17 | One alias per module so application code can key by module id — resolving to **six** hues, not seventeen: the five family accents plus Garden ([DD-1](08-decisions.md)). Seventeen names, six values. See §3 |
| `chart-1 … chart-8`, `chart-grid`, `chart-axis` | Utilities, Finance, Pets and Garden all draw. A shared categorical ramp is cheaper than four |
| `focus-ring-offset` | The focus ring needs an offset colour on both `surface` and `surface-raised` |

### Contrast is a build gate

Token *pairs* are contrast-tested in CI and a failing pair fails the build
([06-clients §4](../prd/06-clients.md)). So the token file must declare **which pairs are
intended to be used together**, not just the values. Design owns that list.

Minimums: **4.5:1** body text, **3:1** large text and UI component boundaries — in *both* themes,
for every declared pair.

## 2. Themes

Three states: **light** (default), **dark**, **system**. Both themes are first-class and every
screen is reviewed in both.

- Define the complete light palette on the root. Redefine **only** the tokens that change for
  dark. Never give a colour its only definition inside a dark block.
- **Dark is not an inversion.** Household's dark theme carries a family's finances and documents
  at 23:00; it should be calm, low-glare and low-contrast-fatigue, not pure black on pure white
  reversed.
- `home` was dark-default because it had two users who wanted that. Household is light-default
  because it is a consumer product that must look right in a screenshot on a store listing.

## 3. Colour and the seventeen accents

**Per-module accent hues distinguish modules without ever being the only carrier of meaning**
([06-clients §3](../prd/06-clients.md)). Seventeen distinguishable hues that all pass 3:1 against
both surfaces in both themes is the single hardest colour problem in this project.

**Settled ([DD-1](08-decisions.md)): five families plus Garden, not seventeen hues.** Each family
carries a hue; modules within a family are distinguished by icon and label:

| Family | Modules | Character |
|---|---|---|
| **Time & work** | Tasks, Reminders, Calendar, Chores | The things that ask something of you today |
| **Money** | Finance, Utilities | The things with a number that must be right |
| **Things we own** | Property, Vehicles, Pets | The asset engine's three faces |
| **Keeping** | Notes, Documents, Shopping | Capture and retrieval |
| **Household** | Dashboard, Chat, Activity, Household settings | The platform itself |

Garden sits outside the five and takes its own hue — it is the module a member may use
exclusively, and it is the one place where a distinct identity earns its cost.

**Sixteen module names above, plus Garden, is the seventeen** — the ids in
[modules/00 §6](../prd/modules/00-module-model.md), `admin` appearing here under its product name,
*Household settings*. **Today and Add are not in the table because they are not modules**: Today is
a platform screen ([FR-DB7](../prd/modules/01-dashboard.md)) and Add is a tab that opens a sheet.
They render in the Household family's hue, they get icons (§8), and they get **no key in the accent
map** — which is keyed by module id and has exactly seventeen of them (§1, §10).

Rules that hold whatever the palette:

- **A hue never carries meaning alone.** Module identity is hue **plus** icon **plus** name.
- **Status colours are reserved.** `danger`, `warning`, `positive`, `info` are never used as a
  module accent, in any theme.
- Accents are used for identity and emphasis, **not** for large fills. A module's screen is
  `surface`, not its accent.

## 4. Typography

| | |
|---|---|
| **UI face** | One variable sans. **Latin Extended-A mandatory** (Czech, Slovak and Polish diacritics are not optional); Latin Extended-B required before phase-2 languages |
| **Numeric face** | One monospace, for numeric columns — ledgers, meter readings, tariff breakdowns, odometers |
| **Hosting** | **Self-hosted. No third-party font CDN**, ever |
| **Figures** | Tabular, lining figures in every table and every money value. Proportional figures in prose |

**Diacritics are a layout problem, not only a glyph problem.** `Ď`, `Ř`, `Ł`, `Ő` and `Ä` all
sit above the cap height. Line heights must accommodate them without clipping at 200 % text
scaling, and a design that only checks English ascenders will clip in four of five launch
languages.

A type scale of eight steps, defined in rem, with line heights as unitless multipliers so 200 %
scaling stays proportional:

`display` · `title-1` · `title-2` · `title-3` · `body-lg` · `body` · `caption` · `overline`

Plus a parallel `num-lg` / `num` / `num-sm` in the mono face, sharing the same vertical rhythm so
a money value in a table row sits on the same baseline as its label.

## 5. Space, radius, elevation

- **8-point space scale.** A 4 pt half-step is permitted at the two smallest sizes and nowhere
  else.
- **Radii**: a small set (control, card, sheet, pill, full). Radii do not vary by module.
- **Elevation**: **two elevated levels above the page ground, three surface steps in all.** Dark
  themes cannot rely on shadow, so **every elevation level must also be expressible as a surface
  step**, and the ramp is `surface` (the ground, level 0) → `surface-raised` (level 1) →
  `surface-overlay` (level 2). There is no level 3: a third would have no dark-theme surface to
  land on, which is the whole reason the ramp is capped. `surface-sunken` sits **below** the
  ground for grouped-list wells and is not on the elevation ramp at all.

## 6. Density

| | Mobile | Web |
|---|---|---|
| **Comfortable** | The only mode | Default |
| **Compact** | — | Available, and the default for tables |

**The Garden season planner, the Finance ledger, the Utilities tariff breakdown and the Chores
weekly grid are tables, and tables want compact** ([06-clients §3](../prd/06-clients.md)).
Compact reduces row height and horizontal padding; it **never** reduces font size below `body`
and **never** reduces a hit target below 44×44 pt where the row is interactive.

**Every one of the five screens below has interactive rows**, so on all of them the 44 pt floor
binds and compact cannot buy row height. Say what it *does* buy there, rather than leaving each
screen to invent it:

| On an interactive row, compact | On a non-interactive row |
|---|---|
| Horizontal cell padding drops one space step · the optional secondary line is suppressed (its content moves to a column or the detail pane) · vertical padding shrinks until the row hits 44 pt and stops · borders become `divider` rather than `border` | All of the above, plus row height is free to go below 44 pt |

So compact is a **column-density** change on these screens, not a row-height one. That is still
worth having — it is what fits a ledger's eight columns without horizontal scroll — but it is a
smaller win than the word "compact" suggests, and designing it as row-squeezing will produce a
target-size failure in CI.

**Settled ([DD-3](08-decisions.md)): five screens default to compact** — the Finance ledger, the
Chores weekly grid, the Garden season plan, the Utilities tariff breakdown and the activity log.
Everything else on web defaults to comfortable, and one global member preference overrides both.
Web does not default to compact throughout: a member who opens the web app occasionally should
not meet a dense workspace, and a member who lives in the ledger gets the right density without
having to find a setting first.

## 7. Motion

- Durations and easings are a scale. Three durations (`fast` / `base` / `slow`) plus one
  entrance and one exit easing is enough.
- **`prefers-reduced-motion` is respected**, and **no essential information is conveyed by motion
  alone** ([06-clients §4](../prd/06-clients.md)). Under reduced motion, transitions become
  instant state changes — they do not become slower animations.
- **The 2000 ms hold progress indicator is the one animation that cannot be removed**, because it
  is the only feedback that the gesture is working. Under reduced motion it must still show
  progress — as a stepped or non-animated fill rather than as a smooth sweep.
- Sync indication has a deliberate rule: *"A progress indication only when it takes longer than a
  moment"* ([06-clients §5](../prd/06-clients.md)). Design the threshold, not just the spinner.

## 8. Iconography

Two sets, and they are not the same job:

1. **Module icons** — seventeen, plus Today and Add. These carry identity alongside the accent
   hue and must be recognisable at 20 px in a sidebar and at 28 px in a tab bar.
2. **Status icons** — the ones N2 makes load-bearing. `synced`, `pending`, `syncing`, `conflict`,
   `rejected`, `offline`, `overdue`, `blocked`, `estimated`, `private`, `locked`, `stale`,
   `no_history`. **These are not decoration.** Every one appears next to text that says the same
   thing, and a member who cannot distinguish the colours must be able to distinguish these.

`synced` is an exception to *where* it is drawn, never to *whether*. **No row carries it** — the
absence of a mark is the synced state ([03-patterns §1](03-patterns.md),
[02-components §4.2](02-components.md)) — so it is drawn for the surfaces that state sync state in
words: the sync-state mark's on-tap form, the conflict inbox, and sync health. Thirteen icons,
twelve of them on rows.

**Every icon-only control has a label** ([06-clients §4](../prd/06-clients.md)). There is no
exception for "obvious" icons.

**Re-snapshot needed is the one sync state with no icon of its own**, and that is deliberate. It
appears in the offline table ([03-patterns §1](03-patterns.md), from
[06-clients §5](../prd/06-clients.md)) as *"handled silently unless it takes long enough to
notice"* — and when it does take long enough, what the member is shown is **`syncing`**, because
that is what it is: a long sync. It therefore reuses `status-syncing`'s token, icon and word, and
adds no fourteenth state. **The count stays thirteen** ([06-accessibility §1](06-accessibility-and-i18n.md)).

**Settled ([DD-10](08-decisions.md)): a licensed open set is the base; the seventeen module icons
and the thirteen status icons are drawn in-house.** All of it is **bundled, never fetched** — the
same reasoning that self-hosts the fonts (N8). The two in-house sets are where an icon carries
meaning rather than decoration, and they are the two the licensed set will not fit: no general
icon library contains a `no_history`, an `estimated` or a `rejected`-versus-`conflict`
distinction, and module identity should not be whatever the set happened to have.

## 9. Numbers, money, dates and units

The formatting rules are product requirements, not typography preferences.

| Thing | Rule | Source |
|---|---|---|
| **Money** | Integer minor units + ISO 4217 code. **The currency follows the household; the *formatting* follows the member's locale** | [PRD conventions](../prd/README.md), [03-strands §9](../prd/03-platform-strands.md) |
| **Zero-decimal currencies** | Read from the ISO 4217 exponent. Never assume 2 | [09-finance](../prd/modules/09-finance.md) |
| **Multi-currency rows** | Show the original amount and currency alongside the base-currency value; the FX rate is stored on the row and is visible | [D-55](../prd/modules/09-finance.md) |
| **Rounding display** | Where a breakdown is shown, components are rounded and **the largest takes the remainder**, so the parts sum to the whole | [FR-UT8](../prd/modules/10-utilities.md) |
| **Meter and usage values** | Stored as integer thousandths (`value_milli`). Rendered to the register's own decimals | [10-utilities](../prd/modules/10-utilities.md), [FR-AS1](../prd/modules/12-property.md) |
| **Timestamps** | RFC 3339 with an explicit offset. Rendered in the member's locale, resolved against the **member's effective timezone** — the household's, unless that member has overridden it ([03-strands §9](../prd/03-platform-strands.md)). The override is real and rare, so *"today"* is not always the same day for two members of one household; see [06-accessibility §2](06-accessibility-and-i18n.md) | PRD conventions |
| **Dates without a time** | `YYYY-MM-DD`, carrying the **effective** timezone implicitly, by the same rule. A reminder is a **day**, not an instant | [03-reminders](../prd/modules/03-reminders.md) |
| **Numbers, dates, first day of week** | Member locale, via ICU. **Never hand-rolled** | [03-strands §9](../prd/03-platform-strands.md) |
| **Units** | Household setting. Metric default; imperial available for length, area, mass, temperature, volume | ibid |
| **Two clocks** | Some rows show both: *"added at 18:22, synced at 19:40"*. `client_time` is advisory; server receipt is authority | [D-26](../prd/03-platform-strands.md) |

**A missing number is not zero.** Where the product cannot compute a figure, the API returns the
field **absent**, not `0` ([FR-UT12](../prd/modules/10-utilities.md)). The design must have a
visual form for *"not enough information"* that is distinguishable from a genuine zero, and it
must name what is missing.

## 10. What the token file must emit

- Every semantic and component token, in both themes, as a resolved value. The primitives are
  reference data that no stylesheet declares
  ([ADR 0024](../adr/0024-design-tokens-icons-and-the-illustration-kit.md)).
- The **declared contrast pairs** CI tests.
- The per-module accent map, keyed by the module's stable id (`garden`, `utilities`, …) — these
  ids never change and are the same keys used in routes, audit keys and translation keys.
  **Seventeen keys, six distinct values** (§3): the map is an alias layer over the five family
  accents plus Garden, not seventeen hues.
- Density variants for the web spacing scale.
- Motion durations and easings, plus the reduced-motion substitutions.
