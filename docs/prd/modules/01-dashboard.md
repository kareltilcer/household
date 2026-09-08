# 01 — Dashboard (Nástěnka)

## What it is

The landing screen. A **widget host that owns no feature data**: modules contribute widgets
through the widget catalog and the host renders whichever ones the member has chosen, in the
order and size they chose.

Carried from `home` with three changes: layouts can be **predefined by an owner**, layouts are
**per member per household**, and the widget catalog is filtered by module grant.

## Functional requirements

**FR-DB1 — The catalog.** `GET …/dashboard/catalog` lists widgets available *to this member* —
every registered provider whose module is enabled in the household and on which the member has
at least `view`. Each entry carries `key`, `module`, a translation key for the title and
description, `default_size`, and the minimum grant it requires.

**FR-DB2 — Per-member layout.** An ordered list of `{ widget_key, visible, size }` with
`size ∈ {small, medium, large}`, stored server-side per (member, household) so it follows the
member across devices. A member with no layout gets the **effective default** (FR-DB4). Unknown
or now-unavailable keys are ignored rather than erroring — a module can be disabled at any time.

Setting a layout is a **personal preference**, so it requires only `view`.

**FR-DB3 — Render.** `GET …/dashboard` returns `{ layout, widgets: [{ key, size, data }] }`,
resolving each visible widget's provider concurrently with a bounded fan-out and a per-widget
timeout. A widget that fails or times out returns `{ key, error: "unavailable" }` and the screen
renders without it — **one slow module never blanks the dashboard**. A single widget refreshes
alone via `GET …/dashboard/widgets/{key}`.

**FR-DB4 — Owner-defined default layouts.** New in Household, and the reason it exists is that a
household's first-run experience is otherwise seventeen widgets nobody chose.

| Scope | Who sets it | Applies to |
|---|---|---|
| **Household default** | An owner | Every member who has not customised their own layout, and every newly invited member as their starting point |
| **Per-invitation layout** | The inviting owner | That specific invitee, at acceptance. Optional; falls back to the household default |
| **Child layout** | An owner | **Enforced** for `child` members — see FR-DB5 |

A member who has customised their layout is **not** re-flattened when the household default
changes; they are shown a dismissible notice offering to adopt it. Silently rearranging somebody's
home screen is not a feature.

**FR-DB5 — Child layouts are owner-controlled.** For a `child` member an owner may set the layout
as either:

- **suggested** — the child receives it and may then rearrange freely, or
- **locked** — the child cannot add, remove, resize or reorder; the layout is exactly what the
  owner set, and the arrange affordances are absent rather than disabled.

Locked is the default for children under the household's configured age threshold and can be
lifted at any time. **D-41.**

**FR-DB6 — Actions inside widgets** call the **owning module's** endpoints, never a
dashboard-specific one, and carry `meta.via = "dashboard"` so the activity log records where a
change came from. Completion uses the house press-and-hold gesture with its mandatory keyboard
path ([06-clients.md](../06-clients.md) §3).

**FR-DB7 — Today.** The mobile *Today* tab is not a widget and not part of this module's layout.
It is a platform screen assembled from the reminder strand and the metric catalog
([06-clients.md](../06-clients.md) §2), and it is deliberately not customisable — a screen whose
job is "what does today ask of me" stops working when it can be rearranged into something else.

## Data model

**`dashboard_layouts`** — `(household_id, user_id)` unique; `entries jsonb` (ordered array of
`{widget_key, visible, size}`), `is_locked bool`, `source enum(default, invitation, custom)`,
`updated_at`.

**`dashboard_default_layouts`** — `(household_id, audience enum(all, child))` unique;
`entries jsonb`, `lock_children bool`.

## Sync

| Entity | Policy | Notes |
|---|---|---|
| `dashboard.layout` | `lww_row` | Personal, single row per member. Whole-row LWW is correct: a layout is one artefact |
| `dashboard.default_layout` | `strict_version` | Structural; owners editing concurrently should conflict, not merge |

Widget **data** is never synced — it is derived from other modules' entities, which are synced
themselves. The offline dashboard renders from the local replica by running the widget's client-
side projection over local data. **D-42:** widgets declare both a server resolver and a client
projection over the same entities, and a shared test vector asserts they agree.

## Catalog contributions

The host contributes nothing to any catalog. It is the consumer of one.

## Permissions

| Operation | Level |
|---|---|
| Read catalog and own dashboard | `view` on the dashboard module |
| Set own layout | `view` (personal preference) |
| Set household default layout | `owner` |
| Set or lock a child's layout | `owner` |

## Non-goals

- No user-authored or third-party widgets. The catalog is what the modules ship.
- No cross-household dashboards.
- No free-form grid positioning — an ordered list with three sizes reflows correctly on a phone,
  a tablet and a desktop, and a coordinate grid does not.
