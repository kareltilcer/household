# Modules — the model

Every module in Household obeys the same contract. This page states it once so that the
seventeen module specifications can be about their subject matter instead of restating
boilerplate.

## 1. What every module has

| | |
|---|---|
| **A stable id** | Lowercase, English, never renamed. It appears in routes, audit keys, sync entity names, translation keys and the storage catalog |
| **Its own migration block** | One numbered Goose block. It creates only its own tables |
| **Its own routes** | Mounted under `/api/v1/households/{household_id}/<id>/…` by the platform, behind the tenant and grant middleware |
| **Its own audit actions** | Declared, so the notification composer and the activity log can offer them |
| **Its own sync entities** | Declared with a merge policy and an access predicate |
| **Export and erase** | Mandatory. A module that cannot serialise and delete its data does not ship |
| **Zero imports of other modules** | Enforced by the build |

Optionally, and through registered catalogs only: dashboard widgets, metrics, lists, reminder
kinds, search scopes, and storage declarations.

## 2. Enablement and grants

Two switches, composed as a minimum ([01-architecture.md](../01-architecture.md) §5):

1. **Household enablement** — an owner turns the module on or off for everyone.
2. **Member grant** — `none` · `view` · `contribute` · `manage` per member.

`none` means **absent**, checked at nine surfaces
([02-identity-and-access.md](../02-identity-and-access.md) FR-AC2).

### The standard gate

Unless a module's page says otherwise:

| Operation class | Required level |
|---|---|
| Any read | `view` |
| Create, edit, complete, log | `contribute` |
| Structural change: create/delete a container, close a period, edit rules, change settings | `manage` |
| Hard delete of anything | `manage` |
| Personal preferences (own layout, own pins, own subscriptions, own notification categories) | `view` — these are not mutations of household data |

`owner` implies `manage` on every enabled module and cannot be reduced.

## 3. Onboarding

**Every module opens in its simplest usable state.** A module that requires configuration
before it does anything gets a **setup flow**, run by an owner, with these rules:

- It is **skippable**, and skipping leaves the module in a working default rather than a broken
  half-state.
- It is **resumable** and re-runnable from settings; no decision made in onboarding is permanent.
- It asks for the **fewest decisions that make the module correct**, and infers the rest from the
  household's country, currency, locale and timezone.
- It never asks a question whose answer it can compute. A Czech household is offered the Czech
  two-tariff electricity preset; it is not asked to describe its billing system.

Three modules have substantial setup — Finance, Utilities and Garden — and each specifies it.

## 4. Cross-module integration, and its one rule

> **A module never imports another module. Integration happens through a platform catalog.**

The integrations that exist in 1.0:

| From | To | Through |
|---|---|---|
| Every module | Dashboard | Widget catalog |
| Every module | Notifications, Today | Metric and list catalogs |
| Tasks, Calendar, Chores, Documents, Finance, Utilities, Garden, Property, Vehicles, Pets | Reminders | Reminder-kind catalog — ten modules, twenty-one kinds |
| Every module | Global search | Search-scope catalog |
| Documents, Chat, Notes | Storage metering | Storage catalog — the only three modules that own an object-storage prefix |
| Every module | Export, erasure | Privacy catalog |
| Every module | Offline clients | Sync-entity catalog |
| Property, Vehicles, Pets, Garden, Finance, Utilities, Tasks, Chores | Documents | A **document reference**: a typed link to a document id, resolved by the platform, so the referring module never reads the documents tables. **These modules hold no bytes of their own** — their files are Documents' rows, on Documents' meter, under Documents' privacy |
| Property, Vehicles, Pets | The **asset engine** | A platform-owned engine, not a module: shared `asset_*` tables, routes at `…/assets/{entity_type}/{entity_id}/…`, and grant resolution from `entity_type` rather than from the path. Specified in [12-property.md](12-property.md) and summarised as a strand in [03-platform-strands.md](../03-platform-strands.md) §10 |
| Chores, Finance | *(deferred: Allowance)* | Chore completions carry an optional value |

**D-40: cross-module links are references resolved by the platform, never joins.** A vehicle
carries `document_refs`; the platform resolves them, applies the caller's Documents grant and
privacy, and returns what the caller may see. If the caller has `none` on Documents, the vehicle
renders without them and says so. A module that joined to `documents` directly would leak past a
grant it does not know about.

## 5. The nine surfaces, again

Every module specification is checked against this list before it is considered complete. It is
the same list as [02](../02-identity-and-access.md) FR-AC2, restated as an authoring checklist:

1. Routes refuse with `404` when the module is `none` or disabled.
2. Sync entities are not delivered, and are retracted when a grant drops.
3. Widgets are not listed and not resolvable.
4. Search scope is not searched.
5. Notifications do not fire and metrics do not resolve.
6. Reminder kinds are not offered.
7. Activity-log events are filtered out.
8. Export excludes the module for a member who cannot see it.
9. Deep links resolve to a neutral screen.

## 6. The module list

**Owns blobs** means the module declares an object-storage prefix of its own and carries its own
line on the storage meter. Every other module's files are **document references** (**D-40**) —
they are Documents' bytes, on Documents' meter.

| Id | Name (en) | Name (cs) | Setup | Widgets | Reminder kinds | Owns blobs |
|---|---|---|---|---|---|---|
| `dashboard` | Dashboard | Nástěnka | — | host | — | — |
| `tasks` | Tasks | Úkoly | none | 2 | 1 | — (doc refs) |
| `reminders` | Reminders | Připomínky | none | 2 | own | — |
| `calendar` | Calendar | Kalendář | light | 2 | 1 | — |
| `shopping` | Shopping | Nákupy | none | 1 | — | — |
| `chores` | Chores | Domácí práce | light | 2 | 1 | — (doc refs) |
| `notes` | Notes | Poznámky | none | 1 | — | **✓** `notes/` (inline images) |
| `documents` | Documents | Dokumenty | none | 2 | 1 (expiry) | **✓** `documents/` |
| `finance` | Finance | Finance | **substantial** | 3 | 2 | — (doc refs: receipts) |
| `utilities` | Utilities | Energie a služby | **substantial** | 2 | 3 | — (doc refs: bills) |
| `garden` | Garden | Zahrada | **substantial** | 2 | 2 | — (doc refs: photos) |
| `property` | Property | Dům a vybavení | light | 1 | 3 | — (doc refs) |
| `vehicles` | Vehicles | Vozidla | light | 1 | 4 | — (doc refs) |
| `pets` | Pets | Mazlíčci | light | 1 | 3 | — (doc refs) |
| `chat` | Chat | Chat | none | 1 | — | **✓** `chat/` |
| `activity` | Activity log | Historie změn | none | 1 | — | — |
| `admin` | Household settings | Nastavení domácnosti | — | — | — | — |

Widgets total **24**; reminder kinds total **21** across ten modules, plus the Reminders module's
own standalone reminders. These are the numbers the catalog registry is asserted against.

## 7. How to read a module page

Each module page has the same sections:

- **What it is** — one paragraph, and what changed from `home` if it existed there.
- **Setup** — the onboarding flow, if any.
- **Functional requirements** — `FR-<PREFIX>n`, each with behaviour and error cases.
- **Data model** — tables, columns that matter, constraints that carry meaning.
- **Sync** — entities, merge policies, what is `additive`, what is `strict_version`.
- **Catalog contributions** — widgets, metrics, lists, reminder kinds, search scopes, storage.
- **Permissions** — anything that deviates from the standard gate.
- **Non-goals** — what this module deliberately does not do.
