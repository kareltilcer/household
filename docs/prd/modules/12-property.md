# 12 — Property (Dům a vybavení)

> **New.** The first of three modules — with Vehicles and Pets — built on one shared **asset
> engine**. All three are the same shape: *a thing the household owns or cares for, which has
> documents, costs, recurring service dates, and a history*. The engine is specified here and
> referenced by the other two.

## The shared asset engine

**D-67: one engine, three modules, not one "Possessions" module.** People look for their car under
"car", not under "asset of type vehicle". The engine is a platform capability the three modules
share, and each exposes its own vocabulary, its own fields and its own screens over it.

**It does own routes**, and they are the one place in the API where a path is not under a single
module: schedules, service records and usage readings live at
`…/assets/{entity_type}/{entity_id}/…`, because the alternative is the same five endpoints written
three times over one implementation.

> **The grant is resolved from `entity_type`, not from the path prefix.** `property_item` resolves
> the Property grant, `vehicle` the Vehicles grant, `pet` the Pets grant, and the answer is
> identical to what the caller would get under that module's own routes — including `404` rather
> than `403` when the grant is `none` (**D-16**), and including the household-enablement switch. A
> member with `manage` on Vehicles and `none` on Pets sees exactly their vehicles' schedules here
> and no evidence that the pet ones exist. The resolution happens once, in the engine, so there is
> one place for it to be right.

What the engine provides:

| Capability | Behaviour |
|---|---|
| **Entity** | An owned thing with a name, a photo, a category, an acquisition date, a purchase price, a current status, and free-form notes |
| **Documents** | Typed document references (**D-40**) — manual, warranty, invoice, insurance policy, certificate — resolved through Documents with the caller's grant applied |
| **Service schedule** | Recurring maintenance defined by **interval, usage, or both**, whichever comes first |
| **Service history** | A dated log of what was done, by whom, at what cost, with which documents |
| **Costs** | Every service, purchase and recurring cost rolls into a total cost of ownership, and optionally into Finance |
| **Reminders** | Each schedule and each expiring document registers a reminder kind |
| **Warranty** | An expiry date with its own reminder and a link to the proof of purchase |
| **Disposal** | An entity can be retired, sold or lost with a date and a note; it leaves the active list and keeps its history |

**FR-AS1 — Dual-trigger service schedules.** A schedule may be time-based ("every 12 months"),
usage-based ("every 15 000 km", "every 500 operating hours"), or **both, whichever comes first**.
Usage-based schedules need a usage reading, which is why the engine carries a **usage log** — an
`additive` series of `(date, value_milli, unit)` readings per entity, exactly the shape Utilities
uses for meters. **D-68:** the same non-decreasing validation applies, and a usage-based schedule
with no readings degrades to showing "no reading yet" rather than being silently never due.

**"Exactly the shape Utilities uses" includes the integer**, and the wording is literal. A usage
value is stored as `value_milli` — thousandths of the named unit, so 123 456 km is `123456000` and
1 234.5 operating hours is `1234500` — for the same two reasons Utilities gives
([10-utilities.md](10-utilities.md) Data model): a monotonicity check is being run on these
numbers and a float comparison is the wrong instrument for one, and every threshold arithmetic
("15 000 km since the last service") must be reproducible to the unit by two people looking at the
same screen. Every usage-bearing field in the engine and its three modules uses the same suffix and
the same convention — schedule intervals, the last-done mark, the reading on a service record, the
odometer on a fuel entry.

**The `additive` admission caveat applies here too.** The non-decreasing rule is a cross-row
invariant, so a usage reading created offline can come back `rejected` with `monotonicity_violation`
against a neighbour the replica did not hold — see [03](../03-platform-strands.md) §2.5 and
[10-utilities.md](10-utilities.md) Sync, which states the client-side mitigation once for both.

**FR-AS2 — Predicting a usage-based due date.** From the last few usage readings the engine
estimates a daily rate and projects when the threshold will be crossed, so "your service is due in
about six weeks" is answerable. The estimate is labelled as one and is never presented as a date the
household committed to.

## What Property is

The house or flat itself and everything fixed in it: the boiler, the heat pump, the washing machine,
the roof, the alarm, the water filter. It answers *when was that serviced, what is still under
warranty, where is the manual, and what has this cost us*.

## Setup

Light. An owner names the property (or properties — a household may have a flat and a cottage) and
is offered a **starter checklist** of common items by country profile — boiler, smoke alarms, water
filter, gutters, chimney — each of which can be added with one tap **including its typical service
interval**, which is the part that makes the module useful on day one rather than after an evening
of data entry. **D-69.**

## Functional requirements

**FR-PP1 — Properties.** Name, type (house, flat, cottage, garage, allotment, other), address as
free text, size, year built, ownership (owned, rented, other), and — when rented — the lease end and
notice period, which drive a reminder. A household may have several; everything else in the module
hangs off one.

**FR-PP2 — Items.** An appliance, installation or structural element: name, category, brand, model,
serial number, location within the property, install date, purchase price, supplier, warranty
expiry, expected lifespan, status, photo, documents. Categories are reference data, translated, with
sensible default service intervals.

**FR-PP3 — Service schedules and history.** Per FR-AS1. Common cases are pre-filled from the
category: a gas boiler defaults to an annual service, smoke alarms to a monthly test and a ten-year
replacement, a water filter to six months.

**FR-PP4 — Contractors.** A light address book scoped to the household: name, trade, phone, email,
notes, and the services they performed. Not a CRM — a name and a number attached to the boiler so
that nobody has to search their messages for who came last time.

**FR-PP5 — Home inventory for insurance.** Any item can be flagged `insured` with a value, and the
module produces a **printable and exportable inventory** with photos, serial numbers, purchase dates
and values. This is a small feature that becomes the most valuable thing in the app on exactly one
very bad day.

**FR-PP6 — Meter locations.** A property records where the utility meters are, with a photo and
access notes. It is a document reference and a note, not a duplicate of Utilities — but "where is the
stopcock" is a question a house-sitter asks and this is where the answer lives.

**FR-PP7 — Costs.** Service costs, purchases and item-linked recurring costs roll up per item, per
property and per year. Where Finance is enabled and granted, a service cost may be recorded as a
Finance transaction with one tap — a reference, never a hidden join.

## Data model

`properties`, `property_items`, `property_item_categories` (reference data), `asset_service_schedules`,
`asset_service_records`, `asset_usage_readings`, `property_contractors`, plus document references.

The three `asset_*` tables are the shared engine's, owned by the platform, keyed by
`(entity_type, entity_id)` so that Vehicles and Pets use the same rows.

## Sync

| Entity | Policy |
|---|---|
| `property.property`, `property.item` | `lww_field` |
| `asset.service_schedule` | `strict_version` |
| `asset.service_record` | `additive` |
| `asset.usage_reading` | `additive` |
| `property.contractor` | `lww_field` |

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `property.due` — services and warranties coming up |
| Metric | `property.services_due_30d`, `property.services_overdue`, `property.warranties_expiring_90d`, `property.annual_cost` |
| List | Mirrors of each |
| Reminder kind | `property.service_due`, `property.warranty_expiry`, `property.lease_notice` |
| Search scope | `property.item`, `property.contractor` |
| Storage | Document references only |

## Permissions

Standard gate. `manage` for creating properties and editing schedules; `contribute` for logging a
service, adding a usage reading, or adding an item.

## Non-goals

- No smart-home control, no device integration, no energy monitoring (that is Utilities).
- No contractor marketplace, no booking, no quotes, no affiliate links.
- No property valuation or mortgage tracking.
- No renovation project management — a renovation is a Tasks board.
