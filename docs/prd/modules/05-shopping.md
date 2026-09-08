# 05 — Shopping (Nákupy)

> **New.** The most-used feature in every competing household app, and the best proving ground
> for the sync engine: it is the one screen where two people are genuinely editing the same
> thing at the same time, one of them in a shop basement with no signal.

## What it is

Shared lists that update live, work completely offline, and are fast enough to use one-handed
while pushing a trolley.

**The design constraint that shapes everything else:** adding an item must take under two seconds
and never require a decision. Everything else in this module — categories, quantities, stores,
staples — is optional structure layered on top of a free-text line.

## Setup

None. On first open the household gets one list called *Shopping*. That is the whole setup.

## Functional requirements

**FR-SH1 — Lists.** CRUD. A list has a name, an icon, an optional store, an archive flag and a
position. A household may have several — *Shopping*, *Hardware store*, *Christmas* — and one is
the default the quick-add targets.

**FR-SH2 — Items.** An item is a **line of text** plus optional structure:

| Field | Required | Notes |
|---|---|---|
| `text` | ✓ | Free-form. "milk", "2 % milk, the big carton" |
| `quantity`, `unit` | — | Parsed opportunistically from the text ("2 kg potatoes") and always editable; parsing never blocks the add |
| `category` | — | Auto-assigned from a translated catalog of common items; overridable; used for store-aisle grouping |
| `note` | — | |
| `checked` | — | With `checked_by` and `checked_at` |
| `assigned_to` | — | "Petr picks this up" |
| `price_minor`, `currency` | — | Optional, entered at the shop; feeds FR-SH8 |
| `source_ref` | — | Where it came from — a recipe, a pantry low-stock rule. **Unused in 1.0**, present so Meals/Pantry can arrive without a migration |

**FR-SH3 — Quick add.** One text field, always focused, submit-and-stay. Typing "milk, bread, 2 kg
potatoes" and submitting creates **three** items — comma and newline split, with quantity parsing
per line. This is the single most-used interaction in the module and it is specified as a
requirement rather than left to the UI.

**FR-SH4 — Check off.** A single tap. **No press-and-hold here** — the house gesture exists to
prevent accidental completion of things that are expensive to undo, and unchecking an item costs
nothing. Checked items drop to a collapsed section at the bottom, not out of existence.

**FR-SH5 — Clear checked.** One action removes all checked items from the list, with an undo
window. Cleared items are soft-deleted and feed the staples suggestion (FR-SH7).

**FR-SH6 — Categories and store layout.** Items group by category. A household can define a
**store layout** — an ordering of categories matching how their shop is actually laid out — per
list, so the list reads in walking order. This is a small feature with a disproportionate effect
on whether the module is used weekly or abandoned.

**FR-SH7 — Staples.** Items added and cleared repeatedly are learned per household and offered as
one-tap suggestions ("you usually buy: milk, bread, eggs"). Purely a client-side ranking over the
household's own history — **no cross-household data, no model, no inference service**. A household
may also mark an item as a staple explicitly, and pin a **recurring staple** that reappears on the
list on a cadence.

**FR-SH8 — Optional spend.** If members enter prices, the list shows a running total and, on
clear, records a **shopping trip** with a total, a date and an optional store. If Finance is
enabled and the member has `contribute` on it, they are offered — never forced — to record the trip
as an expense. The offer is a reference, not a join (**D-40**).

**FR-SH9 — Realtime.** Changes appear on other devices within a second when online. Two members in
the same shop see each other's checks, and the item shows *who* checked it, because "did you already
get the milk" is the question the module exists to prevent.

## Data model

`shopping_lists`, `shopping_items`, `shopping_categories` (household-level, seeded from a
translated reference catalog), `shopping_store_layouts`, `shopping_trips`.

`shopping_items` carries `list_id`, `text`, `quantity numeric NULL`, `unit`, `category_id`,
`position` (lexorank), `checked bool`, `checked_by`, `checked_at`, `assigned_to`, `price_minor`,
`currency`, `source_ref jsonb NULL`, plus house columns.

## Sync

**This module's sync behaviour is the specification's worked example.**

| Entity | Policy | Reasoning |
|---|---|---|
| `shopping.list` | `strict_version` | Structural, rare, low volume |
| `shopping.item` | `lww_field` | Text and quantity edits are independent and merge cleanly |
| `shopping.item_checked` | **`state_set`** | The critical one — see below |
| `shopping.item_position` | `lww_field` | A position is a field, not a set membership — see [Tasks](02-tasks.md) sync |
| `shopping.trip` | `additive` | |

**Why checked state is `state_set` and not a field.** Two members in the same shop, both offline,
both check "milk". With `lww_field` the later write wins and one of them sees their action undone
when they reconnect, which reads as a bug. With `state_set` the operation is *"set checked = true,
at client time T, by user U"*, and applying it twice is applying it once. Unchecking is the same
operation with `false`, and the latest client timestamp wins — with the 24-hour clamp from
[03](../03-platform-strands.md) §2.8 protecting against a badly skewed device.

**The offline case this module must get right**, stated as an acceptance criterion:

> **A — the two-trolley case.** Two members, both offline in the same shop. A adds "cheese" and
> checks "milk". B checks "milk" and "bread", and deletes "yoghurt", which both of them had before
> they went offline. Both reconnect.
> **Expected:** milk checked once, attributed to whoever the server received first; bread checked;
> cheese present and unchecked on both devices; yoghurt gone from both; no conflict dialog shown to
> anyone; both devices identical within two seconds of the second one reconnecting.
>
> **B — delete against a concurrent edit.** Same setup, but while B deletes "yoghurt" A renames it
> to "greek yoghurt".
> **Expected:** no conflict dialog. `shopping.item` is `lww_field` and soft delete is a field
> (`deleted_at`), so the two writes touch different columns and both land: the row carries A's text
> and B's tombstone, and it is gone from the list. **Delete wins over a concurrent edit on a
> `lww_field` entity** — not because deletion is special, but because nothing in the merge made it
> special, and a list that resurrects an item somebody deleted is worse than one that loses a
> rename nobody will see.
>
> **C — an offline delete of an item the deleter has never seen cannot happen**, and the suite
> asserts it: B's replica has no row for A's "cheese", so there is no affordance to delete it and
> no mutation is ever issued. This is stated because it is the case people reach for first, and it
> is not a case.

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `shopping.lists` — each list with its unchecked count, tappable straight into quick-add |
| Metric | `shopping.open_items`, `shopping.lists_with_items` |
| List | `shopping.open_items` |
| Search scope | `shopping.item` — text and note |
| Storage | Tables only; no blobs |

No reminder kind. A shopping list is not a due date, and recurring staples reappear on the list
rather than notifying — a push notification about milk is how notifications get turned off.

## Permissions

Standard gate. `manage` for creating and deleting lists and for editing the store layout;
everything else is `contribute`. **A `child` with `contribute` is fully useful here**, which is
deliberate: this is the module most likely to make a child's account feel real.

## Non-goals

- **No barcode scanning** in 1.0. It requires camera permission and a product database, and it is
  slower than typing for the twenty items a household actually buys.
- **No price comparison, no store integrations, no affiliate links, no ads.** Ever.
- **No inventory tracking.** That is Pantry, and it is deferred — `source_ref` is the hook.
- **No recipe import.** That is Meals, and it is deferred.
- No per-item permissions, no private items on a shared list.
