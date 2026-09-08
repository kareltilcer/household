# 08 — Design decision register

Every design decision the PRD left open, resolved, **with the alternative that was rejected and
why**. The convention is the PRD's own: *a decision without a rejected alternative is a note, not
a decision* ([09-decisions.md](../prd/09-decisions.md)).

Referenced throughout this handoff as **DD-n**. Decided 2026-09-08.

## Foundations

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **DD-1** | **Five module colour families plus Garden.** Time & work · money · things we own · keeping · household, each with one hue; Garden takes its own. Identity within a family is icon and name | Seventeen distinct hues; or one brand accent with no module colour | Seventeen hues that all pass 3:1 against both surfaces in both themes, while avoiding the four reserved status colours, would be mutually indistinguishable — the opposite of what they are for. A single accent is coherent but loses at-a-glance module recognition on Today and in search, where a member is scanning across modules. Garden is outside the five because it is the one module a member may use exclusively |
| **DD-2** | **Widget sizes are column spans in a 2 / 4 / 6-column grid** (phone / tablet / desktop) over a fixed row rhythm, plus **a second row for `large` on phone**, where column span alone cannot distinguish it from `medium` | Size means height at full width always; or fixed pixel footprints that wrap | Full-width-always is very legible on a phone and wastes most of a desktop. Fixed footprints produce ragged edges and gaps at widths nobody designed for. Column spans keep reflow deterministic from the ordered list alone, which is what the no-free-form-grid non-goal in [01-dashboard](../prd/modules/01-dashboard.md) requires. On a phone both `medium` and `large` are full width, so without the extra row the arrange screen would offer three sizes with two outcomes on the platform where most arranging happens — and one `size` is stored per widget for every device ([FR-DB2](../prd/modules/01-dashboard.md)) |
| **DD-3** | **Five web screens default to compact**: the Finance ledger, the Chores weekly grid, the Garden season plan, the Utilities tariff breakdown, the activity log. Comfortable elsewhere; one member preference overrides | Compact everywhere on web; or comfortable everywhere with compact opt-in | Compact-everywhere treats every web visitor as a power user, and many open the web app occasionally. Comfortable-everywhere makes every ledger and grid user find a setting before the screen works. The five are precisely the screens the PRD already calls tables |
| **DD-5** | **One systematic illustration language** — limited palette from the family accents, one construction kit, no per-module bespoke artwork | Bespoke artwork per module; or no illustration at all | Seventeen bespoke pieces plus four Finance illustrations is a long-lead commitment with real coherence risk and a translation cost. A purely typographic treatment is cheapest and is the weakest tool for the job the PRD gives empty states — teaching a module in one sentence with one example |
| **DD-10** | **Licensed open icon set as the base; the 17 module icons and 13 status icons drawn in-house.** All bundled, never fetched | A fully licensed set; or a fully bespoke set | The status set is load-bearing under N2 and no general icon library contains a `no_history`, an `estimated`, or a `rejected` that reads as distinct from a `conflict`; module identity should not be whatever the set happened to have. A fully bespoke set is a second long-lead content commitment on top of the illustrations. Bundling follows the same reasoning that self-hosts the fonts (N8) |

## Interaction and flow

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **DD-4** | **Conflicts surface as an inbox plus row-level flags**, resolved one at a time from the row | A modal at reconnect; or row flags with no inbox | `strict_version` conflicts must always be asked ([D-39](../prd/06-clients.md)) but not necessarily *now*. A reconnect that opens six modals is a reconnect people learn to avoid, and it blocks the member at the moment they came back to do something else. Row-flags-only leaves a conflict on an unvisited screen unresolved indefinitely and silently. The inbox routes to the row rather than resolving in place, because "which amount is right" is only answerable next to what the amount is for |
| **DD-6** | **First run: register → create household → "what brought you here?" → straight into that module's capture surface → invite after the first real record** | Landing on an empty dashboard; or inviting before the first record | G1 requires a first real thing recorded in under five minutes without a manual. An unchosen dashboard on day one is the problem [FR-DB4](../prd/modules/01-dashboard.md) exists to solve. Asking for somebody else's email before the product has proved anything is the weakest possible moment to ask. Step 3 disables nothing — it chooses a starting layout and an opening screen, and it must never be worded as module selection |
| **DD-7** | **Today is five groups, conditional alerts first**, then overdue, timed, all-day, in progress. Empty groups are not rendered | A strictly chronological flat list with undated items appended; or a mine-first / household-second split | Overdue items, all-day items and undated *doing* tasks are not chronologically comparable, so a flat list sinks the overdue among today's and strips the conditional alerts of urgency. A mine-first split breaks the single-timeline reading that makes Today an answer rather than a filter. Conditional alerts lead because `garden.frost_risk_tonight` and `garden.plan_warnings` exist to be conditions, not decoration |
| **DD-8** | **The Add sheet ranks on a slow-moving window and never reorders while open.** Cold start comes from module enablement and the member's `contribute` grants | Recency-weighted ranking; or a member-pinned set with no learning | The sheet's value is muscle memory, so **stability matters more than accuracy**. Recency-weighting tracks a busy week and prevents muscle memory ever forming. A pinned set is perfectly predictable and puts a configuration screen between someone and their first quick capture — a screen most people never open |
| **DD-9** | **The trial is silent for 20 days**, then a dismissible notice on days 21–25, then a persistent non-blocking banner for the last five | A countdown from day one; or nothing until day 25 | A countdown from day one taxes the whole trial with a reminder that the member is being sold to, in a product whose posture is explicitly no-dark-patterns (N10). Five days is short notice for a household that has to agree on a purchase together, and some would simply lapse. Twenty-one days puts the first notice after three full weeks of real use |
| **DD-11** | **The four-tab mobile layout is first-class, designed in DS-0** alongside the five-tab one | Waiting for counsel's answer on the UK Online Safety Act; or treating four as a collapsed five | The four-tab case already exists through module enablement and through a member with `none` on Chat — both ordinary day-one configurations. The UK question ([D-89](../prd/modules/15-chat.md)) only decides how many households meet it. A five-slot bar with a hole in it is exactly the "hidden, not absent" failure N6 exists to prevent |

## Scope

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **DD-12** | **The marketing site and the store listings are both in scope**, in DS-5 | Store assets only, with marketing as a separate programme; or neither | Phase 5 gates on store submission, so somebody owns the store assets regardless. Putting the site here too buys one coherent identity across acquisition and product from one token package. The cost is real and is named rather than absorbed: **a marketing site is a different discipline from product UI** and is budgeted as its own body of work |
| **DD-13** | **In-app contextual help**, with the content model landing in DS-2 so every later module authors its own | A separate documentation site; or short in-app hints linking out to fuller articles | The product's thesis is *"without a manual"*, and a member stuck inside the Utilities tariff composer should not have to leave the app to get unstuck. A site is cheaper and updatable without a release, which is the real trade being made. Authoring help per module as it is designed costs almost nothing; retrofitting it across seventeen modules in five languages in Phase 5 is a project |
| **DD-14** | **The print stylesheets ship in 1.0, as their own line.** Three targets: the stylesheet plus Garden's two layouts in **DS-3**, Property's insurance inventory in **DS-4** with the module whose tables it prints | A thin browser-default-plus-overrides layer; deferring past 1.0; or putting all three in DS-3 | [FR-GA23](../prd/modules/11-garden.md) and [FR-PP5](../prd/modules/12-property.md) state them as functional requirements, so deferring needs the PRD amending. The split is not a hedge: Property is a Phase 4 module, so drawing its inventory in DS-3 would mean laying out entity, service and document tables that DS-4 has not designed yet — while the stylesheet, which is the part everything else inherits, still has to be settled early with Garden — and print is Garden's stated answer for a plot with no signal, alongside the offline replica. They are effectively a small second design system (theme-free, ink-cheap, legible from a garden pocket) and need explicit budget rather than being absorbed into Garden's screens |

## Billing and entitlement

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **DD-15** | **The `suspended` lockout carries no export affordance.** It says export is unavailable while the household is suspended and routes to support, rather than offering a button | An export button on the lockout, since [FR-BI1](../prd/04-billing-and-entitlements.md)'s exemption list is closed and names `POST …/exports`; or a lockout that shows enough of the household to package it up | The PRD says nothing about `suspended` beyond one table row, so this is design's call rather than the PRD's. FR-BI1's exemptions are exemptions from the **billing gate's `402`**, and `suspended` is not a billing state — it refuses reads outright, for abuse or legal reasons, which no `402` exemption speaks to. A screen that shows no household data cannot honestly offer to package that data up, and a button that always fails is worse than a sentence saying why. **This is the one place the handoff narrows [G5](../prd/00-overview.md)** — export on demand without contacting support — so it is recorded here rather than assumed: if the intent is that a suspended household can still export, that is a **PRD amendment** to [04-billing §3](../prd/04-billing-and-entitlements.md), on the same footing **DD-14** says deferring print would need one |

## Still open — needs an answer from outside design

| # | Question | Who answers | What design is doing meanwhile |
|---|---|---|---|
| **OQ-1** | Does the UK Online Safety Act's Schedule 1 exemption cover a closed household chat? The answer could mean **shipping Chat disabled in UK households** ([D-89](../prd/modules/15-chat.md)) | Counsel, on the Phase 5 checklist | Nothing is blocked. **DD-11** makes the four-tab layout first-class regardless, so either answer is already a supported configuration |

## Not open — do not reopen in review

Settled by the PRD, not by this handoff:

- The five mobile destinations, and Today's non-customisability.
- Dashboard as an ordered list with three sizes, never a coordinate grid.
- Shopping check-off as a single tap, not the hold gesture.
- The 2000 ms hold gesture, and its mandatory keyboard and screen-reader path.
- `404` not `403`; absence, not disabling; no lock icons and no upsell on ungranted modules.
- Light as the default theme, dark as first-class.
- Four grant levels, three roles, one paid plan, no feature gating between paying customers.
- No AI, no advertising, no location permission, no cross-household anything.
