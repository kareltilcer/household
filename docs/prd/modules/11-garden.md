# 11 — Garden (Zahrada)

> **Rebuilt.** `home`'s Zahrada is the most sophisticated module in the app — beds, seasons,
> plantings, a task generator, an eleven-rule agronomic plan check, harvest and storage logs, and
> a crop knowledge base built per install by pasting LLM output. It is also unusable by someone
> with four pots on a balcony, and its knowledge base is Czech-language and Czech-climate only.
>
> Household keeps every bit of that depth and puts two things in front of it: **progressive tiers**
> and a **curated, multi-language, climate-resolved crop catalog**.

## What it is

Growing things, at whatever scale the household actually grows them.

## The three tiers

**D-65: one data model, three UI tiers.** Not three modes with different data, and not two products.
A household picks a tier at setup, changes it whenever, and **never migrates or re-enters
anything** — a higher tier reveals more of the same objects and turns on more of the same engines.

| Tier | The household has | They get | They never see |
|---|---|---|---|
| **`pots`** | Named containers and the plants in them | Watering and feeding reminders, a photo journal, harvest notes, the crop catalog's care information | Beds, seasons, rotation, the plan check, succession, storage |
| **`beds`** | Beds or areas, plantings with dates | The above, plus generated sowing/transplanting/harvest tasks, planned-vs-actual dates, a harvest log with yields, companion warnings | Seasons as a formal object, rotation history, the full plan check |
| **`plot`** | Seasons, bed history, a plan | Everything: the eleven-check plan review, crop rotation over closed seasons, succession planning, the storage log, season close and yield reconciliation | — |

**The `beds` tier is where most people are**, and it is deliberately the one that gets the most
attention: raised beds and a small vegetable patch is the median European garden, and it sits
exactly in the gap that a "simple/advanced" pair would leave.

**Tier changes are non-destructive in both directions.** Dropping from `plot` to `beds` hides
seasons; it does not delete them, and the data returns intact on the way back up.

## Setup

**Substantial but short.** Four questions:

1. **"What are you growing in?"** — pots and containers · raised beds or a patch · a full plot or
   allotment. This sets the tier.
2. **"Where?"** — a town or a dropped map pin. Stored on the household at reduced precision.
   **Device location is never read** ([05](../05-privacy-and-compliance.md) §2). This resolves the
   climate profile: last-spring-frost and first-autumn-frost dates, a hardiness zone, and a growing-
   season length, from a bundled climate dataset. All three are shown and all three are editable,
   because a member knows their own frost pocket better than a dataset does. **A frost date is
   the one-year-in-ten date of a night at or below 2 °C** (**D-143**): a conservative date, from
   which a tender crop may go out. The dataset is computed from NASA POWER, by town, for the five
   countries (**D-144**), and holds the altitude its values hold at.
3. **"What do you grow?"** — a search over the curated catalog with the region's common crops
   offered first. Chosen crops become the household's shortlist; the whole catalog stays searchable.
4. **"Your growing space"** — for `pots`, a list of containers; for `beds` and `plot`, beds with
   dimensions.

Steps 3 and 4 are skippable and the module works empty.

## The crop knowledge base

**D-66: Household ships and owns a curated crop catalog. It is a product asset, not a per-install
import.**

`home` generates its knowledge base by producing an LLM prompt, pasting the answer back and badging
the result *unverified*. For one household that is a reasonable trade. For a product it is not: the
data would be wrong in ways nobody could see, different in every install, unmaintainable, and — since
the timings are Czech-climate — wrong in Bavaria and absurd in Andalusia.

| | |
|---|---|
| **Scope at launch** | ~300 crops covering the vegetables, herbs, soft fruit and common flowers grown in Central and Northern Europe |
| **Languages** | Every supported UI language, per crop and per variety, plus the Latin binomial as the stable identity |
| **Timings** | Expressed **relative to the local frost dates and hardiness zone**, never as absolute calendar weeks — `sow_indoor: last_frost − 6 weeks`, `transplant: last_frost + 1 week`, `direct_sow: soil ≥ 10 °C or last_frost − 2 weeks`. A window is a span of days from the last spring frost, the first autumn frost, or the first autumn frost of the year before the harvest, and a crop has one cropping: four windows (**D-145**). The soil a seed waits for is the crop's germination temperature |
| **Content per crop** | Family (drives rotation), hardiness class (drives frost logic), feeder class, root depth, sun, water, soil pH, rotation break years, spacing, plants per m², germination temperature and days, days to maturity, the four timing windows, harvest unit, expected yield per m² and per plant, storage methods and shelf life, common pests and diseases, companion and antagonist relationships, and care notes. Also what it is grown as, for how long and from what (seed, or a part of the plant), and the care tasks it calls for, which are what task generation reads (FR-GA12). The source format is `reference-data/garden` ([ADR 0022](../../adr/0022-the-crop-catalogs-source-the-reference-set-hook-and-the-climate-dataset.md)) |
| **Versioning** | The catalog is versioned. A household's data references a crop by stable id; a catalog update never silently changes a household's saved plan |
| **Provenance** | Every field carries a source. Folklore and agronomy are distinguishable by looking, which `home` established and which matters more when the data is the platform's claim rather than the user's own: a rule's claim is `agronomic` or `traditional`. A value drafted without an expert is flagged until one has checked it (PL-10) |

**FR-GA1 — Household overrides.** A household may add its **own crops and varieties** and may
override **any field** of a catalog crop for itself. Overrides are per household, survive catalog
updates, and are shown as overrides rather than merged silently. The resolution order is
**variety → household override → catalog**, implemented in **one** function with its own tests —
carried from `home` D103, whose reasoning holds exactly: four independent re-implementations of
"when do we sow Black Krim" is a bug nobody would ever find.

**FR-GA2 — Varieties.** A variety belongs to one crop and overrides only what differs. Every
timing, spacing, maturity, yield and storage field is nullable; null means inherit. A household's
own varieties are private to it; catalog varieties are shared.

**FR-GA3 — Climate resolution.** A crop's relative timing plus the household's frost dates produce
concrete date windows. Changing a frost date re-resolves every **planned, unedited** date and leaves
every manually-set one alone — the `*_is_manual` flag from `home`, carried.

**FR-GA4 — Suggesting catalog improvements.** A member may submit a correction or a missing crop.
It goes to a moderation queue for `platform_admin`, is never auto-published, and the submitter is
told the outcome. This is how the catalog improves without becoming user-generated content.

## Functional requirements by tier

### `pots` tier

**FR-GA5 — Containers.** Name, an optional photo, location (`balcony`, `windowsill`, `terrace`,
`greenhouse`, free text), size, and a position.

**FR-GA6 — Plantings, simplified.** A plant in a container: crop, optional variety, planted date,
optional expected harvest, status, notes, photos. No beds, no season, no generated task chain.

**FR-GA7 — Care reminders.** Watering and feeding cadences per plant, defaulted from the crop's
water and feeder classes and adjustable. **These generate reminders, not tasks** — the distinction
matters because the `beds` tier's generated tasks are a plan and these are a rhythm.

**FR-GA8 — Frost warnings** apply at every tier: when tonight's forecast minimum is at or below the
threshold and a tender or half-hardy plant is outside, one warning is published naming the
temperature and the plants. Carried from `home` FR-G15, and it is the single most valuable thing the
module does for a balcony gardener.

**FR-GA9 — The photo journal.** Dated photos per plant or container, which is what a small-scale
grower actually wants and what makes them open the app in a month when nothing is due.

### `beds` tier — adds

**FR-GA10 — Beds.** Name, code, type, dimensions, derived area, sun exposure, zone, soil notes,
active flag. Ordered by lexorank **within a zone**, and **that order is the adjacency model**: two
beds are neighbours iff they are consecutive in the same zone. Dragging beds into the order they
physically stand in is the whole of the data entry, and it makes adjacency checks possible without a
coordinate system, a drawing surface or a neighbour table. Carried from `home` D117 — a good idea
that deserves to survive.

**FR-GA11 — Plantings, full.** Bed or container, crop, variety, quantity as **either** an area or a
plant count (exactly one, `422` otherwise), rows, the five planned dates, the four actual dates,
status, notes. Planned dates default from the resolved catalog windows and each carries an
`is_manual` flag.

**The occupancy window** — first of sown/direct-sown/transplanted, through cleared-or-harvest-end —
is what "shares a bed" means everywhere in the module. Spring spinach and autumn leeks in one bed
never meet and must not warn. Carried from `home` D107.

**FR-GA12 — Task generation.** Tasks derive from the planting and the resolved crop record: sow
indoors, prick out, harden off, transplant, direct sow, support, mulch, pest check, harvest. Each
carries a `generation_key` and `is_generated`.

On regeneration the generator may move an **open, unedited, generated** task. It **never** touches
one that is done, skipped or edited, and a generated task the member deleted leaves a **tombstone**
so it does not resurrect. Carried from `home` D110.

**Watering and weeding are not generated** — they exist only as manual kinds and, at `pots` tier, as
care reminders. A cadence of chores nobody ticks off is how a task list loses its credibility, and
both are decided by looking at the garden rather than at a list. Carried from `home` D118.

**FR-GA13 — Drift.** Recording an actual date that differs from the plan changes **no** planned
window. The detail view states the drift and offers a one-action shift of the planting's remaining
open tasks by an offset. Carried from `home` D119.

**FR-GA14 — Harvest log.** Planting, date, quantity, unit (defaulted from the crop so the form never
asks), destination, quality, note. Harvests sum per planting into an actual yield shown against the
catalog's expected yield.

**FR-GA15 — Companion warnings.** At this tier the plan check runs in a **reduced form**: only the
checks that need no history — companions, same-family-in-a-bed, over-booking, frost-risky
transplants, and planned dates outside the crop's window.

### `plot` tier — adds

**FR-GA16 — Seasons.** A year with expected frost dates and a status of `planning` → `active` →
`closed`. A season may be created by copying a previous year with an optional **rotation shift** —
rotating bed assignments by an offset over the ordered active beds, either per planting or per family
block, then re-anchoring planned dates against the new season's frost dates.

**`dry_run=true` returns the whole prospective season plus its check, without persisting.** The
member sees what the shift fixed and what it broke, side by side, **before** the season exists. A
copy that silently reproduces last year's rotation error is worse than typing the year in by hand.
Carried from `home` D129.

**FR-GA17 — A planting belongs to the season of its harvest.** Garlic sown in October 2026 is a 2027
planting and its sow date legitimately falls in the previous calendar year. Carried from `home` D105.

**FR-GA18 — The plan check.** Eleven checks, computed on read, each returning a key, a severity, a
translated title and detail, and the entities it points at:

| | Check |
|---|---|
| C1 | Incompatible companions in overlapping occupancy |
| C2 | Same family in the same bed within the rotation break |
| C3 | Rotation break violated against closed-season history |
| C4 | Bed over-booked for its area |
| C5 | Workload spike in one week |
| C6 | Family concentration across the plot |
| C7 | Active bed with nothing planned |
| C8 | Feeder succession — heavy after heavy, with the legume tip |
| C9 | Frost-risky transplant date |
| C10 | Planned date outside the crop's resolved window |
| C11 | Adjacent-bed companion conflict and seed-saving cross-pollination risk |

Severities are per check and configurable; a check can be disabled entirely. **A warning never
blocks a save** — the check is advisory, always. Carried from `home` D109.

**Dismissal** silences one warning for one season with an optional note, and is reversible. Without
it, members stop reading the panel by April, and the panel is the feature.

**History-dependent checks (C3, C8) return the explicit state `no_history` rather than a pass** when
there are no closed seasons, and the UI says *"rotation can't be checked yet — no history"*. There is
no historical back-fill importer, so rotation checks are structurally silent in the first season and
only sharp from the third. Stated in the UI rather than hidden. Carried from `home` D120.

**FR-GA19 — Season close.** One screen collects final yields, failures and observed frost dates, then
closes the season, which **becomes rotation history**. Closed seasons are read-only at `contribute`;
reopening requires `manage` and is audited, because reopening rewrites the record C3 and C8 depend on.

**FR-GA20 — Storage.** What was preserved and how much is left: product, method, location, initial
and remaining quantity, stored date, best-before, status. Consumption is recorded by **editing the
remaining quantity in place** — there is no movements table, because the audit spine's field diffs
already answer "when did we eat the last jar". Carried from `home` D121.

**FR-GA21 — Compatibility and succession rules.** Three scopes: crop pairs, family pairs, and
succession (predecessor → successor with a minimum gap). Pairs are stored in canonical order and
matched both ways, so symmetry is structural rather than a discipline. **An explicit crop pair beats
a family pair** — that precedence is why both exist. Catalog rules can be disabled by a household but
not deleted; household rules can be deleted outright.

### Every tier

**FR-GA22 — Weather.** Twice-daily forecast fetch for the household's coordinates, cached ~90 days,
driving the frost warnings and the first/last-frost countdown. A failed fetch is logged and
swallowed; the page renders from cache or without weather and never shows an error nobody can act on.

**FR-GA23 — Print and export.** A print stylesheet with two targets — *this month's work* with real
checkboxes, and *the season plan* on one page — plus a CSV export of plantings and harvests. The
deliberate answer to a garden with no signal, alongside the offline replica.

## Data model

`garden_settings`, `garden_containers`, `garden_beds`, `garden_seasons`, `garden_plantings`,
`garden_tasks`, `garden_task_tombstones`, `garden_harvests`, `garden_storage_items`,
`garden_rules`, `garden_check_dismissals`, `garden_weather_days`, `garden_crop_overrides`,
`garden_varieties` (household-owned), `garden_photos` (document references).

Global reference data, Garden's set of `reference-data`: the crops with their varieties, the
botanical families, the pests and diseases, the rules, and the climate profiles. A name is carried
in every language on its own record, not in a translations table
([ADR 0008](../../adr/0008-reference-data-pipeline.md)). The tables they load into are the
module's (`crop_catalog`, `crop_catalog_varieties`, `crop_catalog_rules`, `climate_profiles` and
those of the families and of the pests and diseases).

## Sync

| Entity | Policy | Notes |
|---|---|---|
| `garden.bed`, `garden.container`, `garden.season` | `strict_version` | Structural |
| `garden.planting` | `lww_field` | Dates and quantities merge; two members rarely edit the same planting |
| `garden.task` | `lww_field` | |
| `garden.task_completion` | `state_set` | The far-end-of-the-garden case |
| `garden.harvest` | **`additive`** | A harvest is an observation of a moment, like a meter reading |
| `garden.storage_item` | `lww_field` | The remaining quantity is edited in place, and two people eating from the same jar is a merge the household can live with |
| `garden.rule`, `garden.settings` | `strict_version` | |
| Crop catalog | **not synced as household data** | Shipped as a versioned reference bundle the client downloads and caches; household overrides sync normally |

**The catalog bundle is the reason Garden works offline properly.** A phone at the bottom of a garden
with no signal must be able to answer "how deep do I sow these" — so the catalog for the household's
region ships as a compact, versioned, cached bundle rather than as a lookup.

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `garden.work` — tasks and care reminders overlapping the next 30 days, overdue first, grouped by week, with hold-to-complete |
| Widget | `garden.harvest_ready` — plantings inside their harvest window |
| Metric | `garden.tasks_due_7d`, `garden.tasks_overdue`, `garden.plan_warnings`, `garden.harvest_season`, `garden.beds_unplanned`, `garden.frost_risk_tonight` |
| List | Mirrors of the countable ones, plus `garden.harvest_ready` and `garden.frost_sensitive_now` |
| Reminder kind | `garden.task_due`, `garden.care_due` |
| Search scope | `garden.planting`, `garden.crop` — crop and variety names, notes |
| Storage | Tables plus the garden-photo document references |

**`garden.frost_risk_tonight` and `garden.plan_warnings` exist to be conditions, not decoration** —
the first gates the frost alert entirely, the second gates a February planning nudge that stays
silent once the plan is clean. Carried from `home`.

## Permissions

Standard gate.

| Operation | Level |
|---|---|
| See the plan, tasks, harvests, catalog | `view` |
| Complete a task, log a harvest, add a photo, edit a planting, adjust storage | `contribute` |
| Create or edit beds, containers, seasons, rules, settings; close a season | `manage` |
| Reopen a closed season | `manage` |

## Non-goals

- **No plant identification from photos, no disease diagnosis** — AI features, and there are none in
  1.0.
- **No soil-test integration, no sensor integration, no irrigation control.**
- **No marketplace, no seed swapping, no community feed, no cross-household sharing.**
- **No garden layout drawing or coordinate map.** Ordered beds within zones is the adjacency model,
  and it is enough for every check that exists.
- **No historical back-fill** of seasons before the household joined.
- **No houseplant care as a separate product** — houseplants are containers at the `pots` tier, and
  the crop catalog covers common ones, but Household is not competing with a dedicated houseplant app.
