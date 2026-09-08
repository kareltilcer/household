# 13 — Vehicles (Vozidla)

> **New.** Built on the shared asset engine specified in
> [12-property.md](12-property.md) §"The shared asset engine".

## What it is

Cars, motorbikes, bicycles, e-bikes, trailers, caravans and boats: what they cost, when they are
due for something legally required, and what has been done to them.

**The feature that sells it in Europe is the statutory inspection.** Every country has one, every
country calls it something different, and missing it is a fine and an uninsured vehicle.

## Setup

Light. Add a vehicle: type, make, model, year, registration, current odometer. The country profile
then **pre-fills the statutory schedule automatically**:

| Country | Inspection | Typical cadence |
|---|---|---|
| Czechia | STK + emissions | 4 years from new, then every 2 |
| Slovakia | TK + EK | 4 years from new, then every 2 |
| Germany | HU/AU (TÜV) | 3 years from new, then every 2 |
| Poland | Przegląd techniczny | 3 years, 2 years, then annually |
| UK | MOT | 3 years from new, then annually |

**D-70: statutory schedules are country reference data, versioned, not code.** Rules change, and a
country whose preset does not exist must be addable without a release. The member can always
override the date and the cadence.

## Functional requirements

**FR-VE1 — Vehicles.** Type, make, model, variant, year, registration, VIN, fuel or drivetrain
(petrol, diesel, hybrid, plug-in hybrid, electric, LPG, CNG, human), purchase date and price,
current owner (a member, or "household"), photo, status, disposal record.

**FR-VE2 — Odometer log.** An `additive` series of `(date, value_milli, unit)` readings,
non-decreasing, with `km`/`mi` per the household's unit preference. This is the usage log from the
asset engine ([12-property.md](12-property.md) FR-AS1) — including its integer storage and its
`monotonicity_violation` rejection path — and it drives every usage-based schedule. A fuel entry's
odometer is a reading in the same series and carries the same field, so consumption between full
fills (FR-VE6) is computed from one set of numbers rather than two that can disagree.

**FR-VE3 — Statutory dates.** Technical inspection, emissions test where separate, and — where the
country has one — a road-tax or vignette expiry. Each is a date with its own reminder kind and a
**long default lead time**, because these need booking.

**FR-VE4 — Insurance and documents.** Policy type (compulsory liability, comprehensive), insurer,
policy number, premium, payment cadence, start and end dates, and the policy document. The renewal
reminder fires at the **notice period**, not at expiry, so switching is still possible — the same
rule as Finance subscriptions and Utilities contracts (**D-58**).

**FR-VE5 — Service schedules and history.** Per FR-AS1, dual-trigger: "every 12 months or
15 000 km, whichever comes first" is the normal case and the engine expresses it directly. History
records date, odometer, garage, work done, cost and documents.

**FR-VE6 — Fuel and charging log.** Optional and off by default. Date, odometer, quantity, unit,
total cost, price per unit, full-or-partial flag, station. Produces consumption (l/100 km, kWh/100 km
or mpg per locale) and cost per distance. **Partial fills are handled correctly** — consumption is
computed between consecutive *full* fills, and partials in between are accumulated. Getting this
wrong produces nonsense numbers, which is why every fuel-log app that gets it wrong is abandoned.
**D-71.**

**FR-VE7 — Total cost of ownership.** Purchase, depreciation if a current value is entered,
insurance, tax, fuel, servicing and repairs, per year and per unit of distance. The number nobody
calculates and everybody wants.

**FR-VE8 — Multiple drivers.** A vehicle may be associated with several members, which affects who
is notified about its reminders by default. A `child` with a driving licence is an ordinary
associated driver.

**FR-VE9 — Bicycles and e-bikes are first-class.** Type-aware fields: frame number instead of VIN, no
statutory inspection, service intervals in distance or months, battery health notes. A household with
three bikes and no car should find this module useful, which it will not if every screen asks for a
registration plate.

## Data model

`vehicles`, `vehicle_fuel_entries`, `vehicle_insurance_policies`, `vehicle_statutory_dates`,
`vehicle_drivers`, plus the shared `asset_service_schedules`, `asset_service_records` and
`asset_usage_readings`, and document references. Country schedules live in
`vehicle_statutory_presets` as global reference data.

## Sync

| Entity | Policy |
|---|---|
| `vehicles.vehicle` | `lww_field` |
| `vehicles.fuel_entry` | `additive` |
| `asset.usage_reading` | `additive` |
| `vehicles.insurance_policy`, `vehicles.statutory_date` | `strict_version` |
| `asset.service_record` | `additive` |

Fuel entries and odometer readings being `additive` is the point: they are recorded at a petrol
station, frequently with no signal, and they cannot conflict.

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `vehicles.due` — inspections, insurance renewals and services coming up, per vehicle |
| Metric | `vehicles.inspection_due_60d`, `vehicles.insurance_expiring_60d`, `vehicles.services_due`, `vehicles.cost_per_km` |
| List | Mirrors of each |
| Reminder kind | `vehicles.inspection_due`, `vehicles.insurance_renewal`, `vehicles.service_due`, `vehicles.road_tax_due` (FR-VE3, where the country has one) |
| Search scope | `vehicles.vehicle` — make, model, registration |
| Storage | Document references only |

## Permissions

Standard gate. `manage` for adding or editing a vehicle and its schedules; `contribute` for odometer
readings, fuel entries and service records.

## Non-goals

- **No OBD, no telematics, no connected-car integration.**
- **No vehicle valuation service, no registration-lookup API** — the member types the details. A
  lookup means a third-party data processor and a per-query cost for a field entered once.
- No parking, tolls, fines or route tracking.
- No garage marketplace or booking.
- No trip logging or mileage claims — that is a business feature.
