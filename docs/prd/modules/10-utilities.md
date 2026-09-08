# 10 — Utilities (Energie a služby)

> **Rebuilt.** `home`'s Elektřina module models one electricity meter with two registers, one
> price each and one monthly fee — the Czech VT/NT arrangement. Its *structure* is excellent: a
> reading is an instant, prices are versioned by effective date with the end derived rather than
> stored, money is integer minor units, nothing is interpolated, and the module never shows a
> number it has not earned. All of that is kept. What is replaced is the assumption that a tariff
> is three numbers.

## What it is

Every metered or billed service a household pays for — **electricity, gas, water, sewage, heat,
waste, internet, anything else** — with a tariff engine general enough to express how those
services are actually billed in different countries, and three depth modes so that a renter who
sees only an invoice is served by the same module as an owner reconciling an annual settlement.

## The three modes

**D-60: a service declares its mode, and a household can run different modes for different
services.** The gas contract can be in full mode while the internet bill is in bills-only mode,
because those are genuinely different relationships.

| Mode | The household records | They get | Who it is for |
|---|---|---|---|
| **`bills_only`** | Invoices and payments | Spend history, renewal and price-change tracking, payment reminders | Renters, flat-fee arrangements, shared buildings, internet and waste |
| **`readings`** | The above, plus meter readings | Consumption trends, per-period usage, "are we using more than last year" | Anyone with meter access who does not want to model prices |
| **`full`** | The above, plus tariffs, advance schedules and billing periods | Cost per interval, annual forecast, recommended advance, computed-vs-invoiced reconciliation — everything `home` does | Owners, energy-focused households |

A service is **upgraded** between modes at any time; nothing already recorded is lost or
re-entered, and downgrading only hides the deeper screens.

## Setup

**Substantial, and preset-driven.** The engine is never shown to a normal user.

**Step 1 — What do you pay for?** A multi-select of commodities, pre-ordered by the household's
country profile.

**Step 2 — Per service: how much detail?** The three modes, described in plain language
("I just get a bill" / "I read the meter" / "I want to check the annual settlement").

**Step 3 — Per service in `full` mode: pick your billing arrangement.** A **country + commodity
preset** — *Czech electricity, two tariffs (VT/NT)*, *Czech electricity, single tariff*, *German
electricity (Grundpreis + Arbeitspreis)*, *UK electricity (standing charge + unit rate)*, *UK
Economy 7*, *Polish electricity, G11/G12*, *Slovak electricity*, *Czech gas*, *German gas*, *Water
(volumetric + standing)*, *Water with sewage on volume*, *Heat (GJ)*, and a *Custom* escape hatch.

The preset creates the meter, its registers, and a tariff skeleton with the right **component
types in the right order** and empty values. The member fills in numbers from their bill, and the
form's labels are the words that appear on that bill in that country.

**Step 4 — Enter what you know.** The current tariff values, the current advance, the current
meter reading. Every one is optional; the module degrades to whatever it has.

**D-61: presets are versioned reference data, not code.** A country's billing arrangement changing
must be a data update, not a deploy — and a preset that does not exist yet must be addable by
`platform_admin` without shipping a release. Custom always exists as the fallback, so no household
is ever blocked by a missing preset.

## The domain model

```
Service  ──< Meter ──< Register
   │           └──< Reading (one value per register, per date)
   ├──< TariffVersion ──< TariffComponent   (ordered, typed)
   ├──< AdvanceSchedule / AdvancePayment
   ├──< BillingPeriod ──> Invoice
   └──< Bill (bills_only mode)
```

### Service

A contract for one commodity at one place: `commodity`, `supplier`, `account_number`, `place_label`,
`currency`, `mode`, `contract_start`, `contract_end`, `notice_period_days`, `document_refs`.

`contract_end` and `notice_period_days` drive a reminder — the moment a fixed-price contract can
still be switched is the moment the reminder is worth something, exactly as with subscriptions
(**D-58**).

### Meter and registers

| Field | Notes |
|---|---|
| `serial`, `location` | |
| `unit` | `kWh` · `m3` · `GJ` · `MWh` · `litre` — the unit the **dial** reads, not the unit billed |
| `digits`, `decimals` | For rollover detection and input validation |
| `multiplier` | Some meters read in units of 10 or 100 |
| `direction` | `import` · `export` · `bidirectional` |
| `registers[]` | One or more, each with a `key` (`total`, `peak`, `off_peak`, `day`, `night`, `vt`, `nt`, `export`), a translated label, and a direction |

**D-62: registers are data, not an enum of two.** A single-rate meter has one register; a Czech
two-tariff meter has two; a three-rate time-of-use meter has three; a household with solar has an
import register and an export register on the same meter, or two meters. `home`'s hardcoded VT/NT
pair cannot express any of those but the second.

**Unit conversion is a first-class, versioned object.** Gas meters read m³ and gas is billed in kWh
via a **volume correction factor** and a **calorific value**, both of which change and both of which
appear on the invoice. They are stored as a versioned conversion on the meter with an effective
date, exactly like a tariff. Heat in GJ converts to kWh by a constant. A conversion that is a
constant in the code is a module that is wrong in one country. **D-63.**

### Readings

`read_on` (a date; the meter state at 00:00 of that day, carried from `home` D134), one value per
register, an optional photo (a document reference), an optional note, and a `source ∈ {manual,
estimated, supplier}`.

**FR-UT1 — Readings must not decrease**, validated against the neighbouring readings on **both**
sides so a back-filled reading cannot break the chain either. `422` naming the offending neighbour.
Carried from `home` FR-E1.

**FR-UT2 — Meter replacement is supported**, unlike `home`. A meter can be closed with a final
reading and a successor opened with an initial one on the same date; the interval across the swap
is computed from `(final − previous) + (current − initial)`. Without this, a household whose meter
is replaced — which happens — has a broken module and no way out.

**FR-UT3 — Rollover.** A reading lower than its predecessor by roughly `10^digits` is offered as a
rollover rather than refused, and confirmed by the member.

**FR-UT4 — Estimated readings are marked and excluded from cost calculation.** They appear on the
consumption chart with a distinct style and never contribute to a money figure. `home`'s rule —
*money is never interpolated; pictures may be* — carried over verbatim.

### The tariff engine

**A tariff version is an ordered list of typed components**, effective from a date, governing every
day until the next version starts. The end is **derived, never stored** (carried from `home` D136 —
a stored end is a second source of truth that eventually contradicts the next row's start).

**FR-UT5 — The component types.**

| Type | Parameters | Applies to | Example |
|---|---|---|---|
| `standing_charge` | amount, period (`day`/`month`/`year`) | Time | UK standing charge; Czech *měsíční plat*; German *Grundpreis* |
| `capacity_charge` | amount per capacity-unit per period, capacity value | Time | Czech *plat za jistič* (per amp per month); German *Leistungspreis* (per kW) |
| `unit_rate` | amount per unit, register key | Consumption | VT price, NT price, single rate |
| `tiered_rate` | ordered blocks `{up_to, amount}`, register key, reset period | Consumption | Water block tariffs; several non-EU electricity systems |
| `time_of_use` | schedule of `{days, from, to} → register` | Mapping | Single-register meters priced by clock time |
| `per_unit_levy` | amount per unit, register key or all | Consumption | Czech *POZE*, energy taxes, renewable levies |
| `fixed_levy` | amount, period | Time | Fixed regulatory charges |
| `tax` | percentage, applies-to (a set of component ids or types), compounding order | Computed subtotal | VAT; excise |
| `discount` | percentage or amount, applies-to | Computed subtotal | Loyalty and switching discounts |
| `feed_in` | amount per unit, export register | Export consumption | Solar export payment — a **negative** cost |
| `self_consumption_credit` | amount per unit | Computed | Where a jurisdiction credits self-consumed generation |

**FR-UT6 — Components are ordered and each declares what it applies to.** VAT applied to the whole
bill is one component with `applies_to: all`; VAT applied only to energy and not to a regulatory
levy is one component with `applies_to: [that levy's id excluded]`. Ordering plus an explicit
`applies_to` is what makes a compounding tax expressible without an expression language.

**D-64: no formula language, no user-written expressions.** A typed, ordered component list covers
every arrangement encountered in the target markets, is validatable, is renderable as a
human-readable breakdown, and cannot be a code-injection surface. A tariff DSL would be all three
of the opposite.

**FR-UT7 — Prices may be stored VAT-inclusive or VAT-exclusive**, declared per tariff version,
because Czech bills quote inclusive and German bills quote both. The engine normalises internally
and every displayed figure states which it is.

**FR-UT8 — Cost calculation.** For an interval between two readings, priced by one tariff version:

- **Consumption components** are computed per register from the register's delta, converted to the
  billed unit through the meter's effective conversion, with **one rounding per component**.
- **Time components** (standing, capacity, fixed levies) are **pro-rata by day** and summed per
  `(calendar month × tariff version)` chunk with **one rounding per chunk** — so a whole month
  inside one version costs exactly the monthly figure to the minor unit, and pro-rata only appears
  at a period's ends and at a mid-month price change. Carried from `home` D143.
- **Taxes and discounts** apply to their declared subtotal, in order, one rounding each.
- Where a breakdown is displayed, **the components are rounded and the largest one takes the
  remainder**, so the parts sum to the whole by construction. Carried from `home` D158.

**FR-UT9 — An interval containing a tariff change is not priced.** If a tariff `effective_from`
falls strictly inside an interval, the module reports a **block** — *"a reading is needed for
2026-01-01"* — computes nothing from that date onward, leaves everything before it valid and
visible, and offers the reading form pre-filled with that date and **no estimated value**. Carried
from `home` D137, and it is the module's defining honesty property.

### Advances, periods and the settlement

**FR-UT10 — Advance schedule**, versioned by effective date exactly like a tariff: amount and due
day. A **recorded payment wins over the schedule for its month**; attribution is by the month key,
not by the payment date, so a March advance paid on 2 April still belongs to March. Carried from
`home` D144.

**FR-UT11 — Billing periods** are user-set, inclusive and non-overlapping. When the end date is
unknown it defaults to one year minus a day and is badged *estimated*, because suppliers frequently
do not state it in advance. Recording the invoice stores the supplier's **total, balance, and their
final meter values per register**, so a discrepancy can be attributed to consumption rather than
only to money — which is how an estimated reading on the supplier's side becomes visible instead of
looking like a pricing surprise. Carried from `home` D154.

**FR-UT12 — Prediction.** The boundary between fact and forecast is the **latest reading, not
today**. Average daily consumption per register over the elapsed period is projected to the period
end, with each future day priced by the tariff effective **on that day** — so next January's prices
entered in August immediately show their effect. Once a closing reading exists the forecast span is
empty and the period is entirely actual.

**Refusals are explicit:** fewer than two readings, no tariff effective at the period start, or an
unresolved block produce *"not enough information to forecast"* naming exactly what is missing.
**The module never shows a number it has not earned** — carried verbatim, and enforced by the API
types: `cost_total` and `balance` are **nullable and absent**, never zero, in an insufficient-data
or blocked state. Carried from `home` D161.

**FR-UT13 — Balance and recommended advance.** A calendar month counts toward a period iff the
period contains that month's first day, which makes a year-long period exactly twelve months
whatever day it starts on. Then `balance = advances − cost`, and the recommended advance is the
shortfall spread over the months not yet due, rounded up, floored at zero, and omitted when no
month remains. The counted months are listed with their amounts, so the rule is visible rather than
folklore. Carried from `home` D145/D146.

**FR-UT14 — Headroom.** *"Your advance is €80. €22 of that is fixed charges. €58 buys about
310 kWh at your rates."* Computable with **zero consumption data**, which is why it is what the
overview shows on day one, before any prediction is possible. Where a meter has several registers
the figure is given per register and at a stated mix, and the copy names the mix as a heuristic
rather than a measurement. Carried from `home` FR-E9.

**FR-UT15 — History.** Consumption and cost per month per register, with `is_approximate` set
whenever a contributing interval crosses a month boundary — because monthly consumption is
approximate by construction and pretending otherwise is a lie the chart tells. Past periods show
computed versus invoiced in **both money and units**.

### Bills-only mode

**FR-UT16 — Bills.** `issued_on`, `due_on`, `period_from`, `period_to`, `amount`, `currency`,
`paid_on`, an optional `document_ref` (the scanned invoice), an optional consumption figure copied
off the bill. Gives spend history, year-on-year comparison, payment reminders and price-change
detection with none of the modelling.

**FR-UT17 — Upgrading from bills-only** keeps every bill; they become the invoice record of
retrospective billing periods where the dates allow.

### Solar and export

**FR-UT18 — Export is an ordinary register with a `feed_in` component**, so a household with
photovoltaics records import and export readings and the engine produces a net cost that may be
negative. Self-consumption is not measured — Household does not talk to an inverter — and the
module says so rather than estimating it.

## Data model

`utility_services`, `utility_meters`, `utility_registers`, `utility_meter_conversions`,
`utility_readings`, `utility_reading_values`, `utility_tariff_versions`,
`utility_tariff_components`, `utility_advance_schedules`, `utility_advance_payments`,
`utility_billing_periods`, `utility_bills`, plus `utility_presets` as global reference data.

Units and money, stated once and enforced by column names: consumption is an integer in the
register's smallest unit (`value_milli` — thousandths of the dial unit, which covers a gas meter
reading to three decimals and an electricity meter to one); money is `amount_minor`. Neither floats
nor whole currency units would do — a Czech electricity price is 4 858,65 Kč/MWh — and determinism
matters in a formula whose entire point is that two people can reproduce it. Carried from `home`
D148, generalised.

Constraints: `effective_from` unique per `(service, kind)` among live rows; billing periods
non-overlapping per service (a service-level check, returning `422`); a reading's values must cover
exactly the meter's registers.

## Sync

| Entity | Policy | Notes |
|---|---|---|
| `utilities.service`, `utilities.meter`, `utilities.register` | `strict_version` | Structural |
| `utilities.tariff_version`, `utilities.tariff_component` | **`strict_version`** | A half-merged tariff is a wrong bill |
| `utilities.reading` | **`additive`** | A reading is an observation of a moment. It is created offline and never merged; a correction is an ordinary online edit under `If-Match`, audited with a field diff, and refused if it would break FR-UT1's monotonicity against either neighbour |
| `utilities.advance_payment`, `utilities.bill` | `strict_version` | Money |
| `utilities.billing_period` | `strict_version` | |

**Readings being `additive` is what makes the cellar case work.** A member walks to the cellar with
no signal, photographs the meter, types the numbers. The row is created locally with a client id and
uploaded on reconnect. It cannot conflict with anything, because nobody else recorded the same
observation. The photo follows per [03](../03-platform-strands.md) §2.7.

**What `additive` does not promise is that the reading will be accepted**, and this is the one place
in the product where that distinction has a member standing in a cellar. FR-UT1 is a *cross-row*
invariant: a reading is validated against its neighbours on both sides, and a back-filled reading can
break the chain in a way no single row can express. A replica that does not hold the neighbouring
reading cannot check it, so the mutation is created happily offline and comes back `rejected` with
`monotonicity_violation` on reconnect — possibly an hour later, at the kitchen table, with the meter
two floors away.

Two requirements follow, and both are this module's, not the platform's:

1. **The entity declares its cross-row invariant** in its sync registration
   ([03](../03-platform-strands.md) §2.5), so the client knows to pre-check.
2. **The client checks against the neighbours it *does* hold, at the meter.** A reading below the
   previous one the replica already has is questioned on the spot — as a rollover offer (FR-UT3) or
   a plain "that is lower than your last reading, is that right?" — rather than accepted silently and
   rejected later. It cannot catch every case, and the reading form says so by keeping the pending
   state visible until the server has actually taken it.

Conformance scenario 17 ([10-sync-risk.md](../10-sync-risk.md) §4) is exactly this.

Everything computed — intervals, summary, forecast, history — is derived on read and never synced.
The client recomputes them locally from the synced inputs using the shared engine and the shared
test vectors ([06-clients.md](../06-clients.md) §1), so the offline overview is a real overview and
not a stale cache.

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `utilities.overview` — per service: current balance or headroom, next advance, and any blocking gap |
| Widget | `utilities.readings_due` — services whose reading is overdue relative to the household's chosen cadence |
| Metric | `utilities.reading_overdue_count`, `utilities.projected_balance` (per service), `utilities.spend_ytd`, `utilities.blocked_services` |
| List | `utilities.readings_due`, `utilities.blocked_services`, `utilities.contracts_ending` |
| Reminder kind | `utilities.reading_due`, `utilities.advance_due`, `utilities.contract_notice` |
| Search scope | `utilities.service`, `utilities.bill` — supplier, account number, notes |
| Storage | Tables plus bill and reading-photo document references |

## Permissions

Standard gate.

| Operation | Level |
|---|---|
| See services, readings, costs, forecasts | `view` |
| Add a reading, record a payment, record a bill | `contribute` |
| Create or edit a service, meter, tariff, advance schedule or billing period | `manage` |

**Adding a reading is `contribute` deliberately** — it is the one action a household wants everybody
able to do, including a teenager sent to the cellar.

## Non-goals

- **No smart-meter or inverter integration**, no HAN adapters, no Home Assistant bridge, no
  supplier API. Every number is entered by a person or read off an invoice.
- **No tariff comparison or switching service.** That is a regulated affiliate business.
- **No half-hourly or interval data import** in 1.0.
- **No automatic invoice parsing** — that is an AI feature and there are none.
- **No estimated readings generated by the app.** A member may record one from the supplier and it
  is marked and excluded from money.
- **No cost allocation between members** in this module. If a household splits the energy bill, the
  bill becomes a Finance expense; Utilities does not model who owes whom.
