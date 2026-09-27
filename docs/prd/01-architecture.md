# 01 — Architecture

## 1. System shape

Household is **one Go binary** serving one HTTP API, backed by **one PostgreSQL cluster**
and **one S3-compatible object store**, with **two client applications** consuming the same
contract.

```
                    ┌──────────────────────────────────────────┐
   iOS / Android    │                                          │
   (Expo, RN, TS)   │        household-api (Go binary)         │
        │           │                                          │
        │  HTTPS    │  ┌────────────────────────────────────┐  │
        ├──────────▶│  │ platform: identity, tenancy, sync, │  │
        │  WSS      │  │ audit, storage, notify, scheduler, │  │
        │           │  │ search, files, billing, i18n       │  │
   Web SPA          │  └────────────────────────────────────┘  │
   (React 19, TS)   │  ┌────────────────────────────────────┐  │
        │           │  │ 17 feature modules, registered at  │  │
        └──────────▶│  │ compile time, importing no other   │  │
                    │  └────────────────────────────────────┘  │
                    └───────────┬─────────────────┬────────────┘
                                │                 │
                       ┌────────▼───────┐  ┌──────▼─────────────┐
                       │  PostgreSQL 17 │  │ S3-compatible      │
                       │  (RLS enforced)│  │ object storage, EU │
                       └────────────────┘  └────────────────────┘
```

**Everything is in the EU.** The application, the database, the object store, the backups,
the log store and the queue all run in a single EU region. There is no US failover and no
non-EU subprocessor in the request path (**D-5**).

This holds for **every** market including the United Kingdom, which is a launch market but not an
EU one (**D-89**): a UK household's data is EU-resident like everyone else's, which is lawful
because the UK treats the EEA as adequate. The market list does not change the deployment; it
changes the paperwork ([05-privacy-and-compliance.md](05-privacy-and-compliance.md) §11).

### Why a monolith, still

`home` is a modular monolith and it is the right shape here too, for reasons that got
*stronger* commercially rather than weaker:

- **The audit spine and the sync feed both require the mutation and its record to be in one
  transaction.** Across services that becomes an outbox, a relay, an at-least-once delivery
  guarantee, and a class of bug where the history disagrees with the data. In one process it
  is a `*sql.Tx` argument.
- **Cross-module reads are the product.** The dashboard fans out over every module; the
  reminder strand collects due dates from six; storage metering sums across all of them. In a
  monolith these are in-process interface calls with the tenant already in context.
- **Scale does not demand otherwise.** Households are small and independent; the workload
  shards perfectly by tenant, so the growth path is *more instances behind a load balancer*
  and eventually *sharded databases by household*, not *smaller services*.

The module boundary is enforced at build time rather than by process boundaries — see §4.

## 2. Multi-tenancy

This is the single largest change from `home`, which had no tenant concept because it did
not need one: the process *was* the household.

### 2.1 The rule

> **Every row that belongs to a household carries `household_id uuid NOT NULL`, and every
> query is constrained by it twice — once by the application and once by PostgreSQL.**

**D-1: shared database, `household_id` column, row-level security as the backstop.**
Rejected: schema-per-tenant (migrations across tens of thousands of schemas become the
operational bottleneck, and connection pooling degrades badly); database-per-tenant
(unrealistic at consumer price points).

### 2.2 How it is enforced

Three layers, and the third is the one that matters:

1. **Path scoping.** Household-scoped resources live under
   `/api/v1/households/{household_id}/…`. The tenant is never inferred from a body field, a
   header the client controls, or ambient session state. It is in the URL, so it is visible in
   logs, in traces, in cache keys and in code review.

2. **Tenant middleware.** One middleware resolves `{household_id}`, verifies the caller has a
   live membership in it, loads that membership's role and module grants, and carries them in
   the request's context. Every database transaction the request then opens starts with:

   ```sql
   SET LOCAL app.household_id = '<uuid>';
   SET LOCAL app.user_id      = '<uuid>';
   SET LOCAL ROLE household_app;
   ```

   `SET LOCAL` is transaction-scoped, so a pooled connection cannot leak the setting into the
   next request even if a handler panics. A transaction is a unit of work that commits before
   the handler answers, never one held across the whole request: that one would commit after
   the response had told the client its write succeeded
   ([ADR 0005](../adr/0005-tenancy-registry-and-row-level-security.md)).

3. **Row-level security.** Every tenant table has RLS enabled and forced, with a policy of the
   form:

   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON <t>
     USING      (household_id = app_household_id())
     WITH CHECK (household_id = app_household_id());
   ```

   `app_household_id()` reads `app.household_id` back, as `NULL` when it is unset, so a query
   with no tenant context reads nothing and writes nothing. `FORCE` matters: without it the
   table owner bypasses the policy, and the migration role is the table owner.

**The consequence is the point.** A handler that forgets its `WHERE household_id = $1` returns
an empty set, not another family's data. A handler that writes a row with the wrong
`household_id` gets an error, not a silent cross-tenant insert. **D-2.**

### 2.3 The roles

| PostgreSQL role | Used by | RLS |
|---|---|---|
| `household_migrate` | Migrations only, at deploy time | Bypasses (owns the tables) |
| `household_app` | Every request | **Enforced** — no bypass exists |
| `household_meter` | The nightly storage/usage sampler | Enforced; reads aggregate columns only |

There is deliberately **no support role and no bypass role**. Platform staff have no database
credential that can read household content, which is how [G8](00-overview.md) is made a
property of the system rather than a policy (**D-3**, and see
[05-privacy-and-compliance.md](05-privacy-and-compliance.md)).

### 2.4 What is *not* tenant-scoped

| Table group | Scope | Notes |
|---|---|---|
| `users`, `credentials`, `sessions`, `devices` | Global | A user exists independently of any household and may be in several |
| `households`, `memberships`, `invitations` | Household-keyed but not RLS-isolated the same way | The membership table is how tenancy is *resolved*, so it is read before a tenant context exists; it has its own policy keyed on `user_id` |
| `plans`, `subscriptions`, `invoices`, `usage_samples` | Household-keyed, billing schema | Readable by the billing service role; contains no content |
| `crop_catalog`, `tariff_presets`, `locales`, `country_profiles` | Global reference data | Curated by the platform, read-only to tenants, versioned |
| `platform_audit` | Global | Append-only record of platform-staff actions |

### 2.5 Users across households

A user may hold a membership in several households with a different role in each. There is no
"current household" on the session — the household is in the path on every request, so a
client can hold several open at once and the offline replica can hold several in parallel
stores. **D-4.**

## 3. Data model conventions

Applied by every module without exception; stated once here.

| Convention | Rule |
|---|---|
| **Primary keys** | `uuid` holding a **UUIDv7**. Clients generate them (the sync engine requires client-side id generation so an offline create has a stable identity) |
| **Tenant key** | `household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE` on every tenant row |
| **Row version** | `version bigint NOT NULL DEFAULT 1`, incremented on every update. The sync engine's optimistic-concurrency token |
| **Audit columns** | `created_by`, `created_at`, `updated_by`, `updated_at` — `timestamptz`, never local time |
| **Soft delete** | `deleted_at timestamptz NULL`. Hard delete is reserved for the destructive-operation gate and for erasure |
| **Ordering** | Lexorank `position text` where users order things by hand |
| **Money** | `amount_minor bigint` + `currency char(3)`. Never `numeric`, never a float |
| **Quantities** | Integers in the smallest sensible unit, with the unit named in the column (`_dkwh`, `_cm`, `_grams`), or `numeric` where a fraction is real data rather than a rounding artefact |
| **Dates** | `date` for calendar days, `timestamptz` for instants. A household's timezone converts between them and is never assumed |
| **Text search** | PostgreSQL full-text with a per-language configuration and `unaccent`; a generated `tsvector` column with a GIN index |
| **Enums** | PostgreSQL native enums for closed sets the product owns; `text` + a check constraint where the set is expected to grow |

### The two things every mutation does

Stated once, applied everywhere, never repeated in a module specification:

1. Writes an **audit event** through the spine, in the same transaction.
2. Writes a **sync change** to the household's change feed, in the same transaction.

A module that mutates without doing both is a bug the architecture test catches.

## 4. The module contract

A module is a Go package under `internal/modules/<name>` that registers itself at compile
time. It is the same contract `home` uses, extended for the four things Household adds.

```go
type Module interface {
    Name() string                         // stable id, e.g. "garden"
    Migrations() fs.FS                    // goose migrations, one numbered block
    RegisterRoutes(r chi.Router)          // mounted under the tenant middleware
    AuditActions() []audit.ActionDescriptor
}

// Every one of these is optional. A module implements what it has.
type WidgetSource     interface{ Widgets() []dashboard.WidgetProvider }
type MetricSource     interface{ Metrics() []metrics.Descriptor }
type ListSource       interface{ Lists() []lists.Descriptor }
type StorageSource    interface{ Tables() []string; Blobs(ctx, HouseholdID) ([]storage.Usage, error) }
type SyncSource       interface{ SyncEntities() []sync.EntityDescriptor }   // new
type ReminderSource   interface{ ReminderKinds() []reminders.KindDescriptor } // new
type SearchSource     interface{ SearchScopes() []search.ScopeDescriptor }  // new
type ExportSource     interface{ Export(ctx, HouseholdID, io.Writer) error }// new
type EraseSource      interface{ Erase(ctx, HouseholdID) error }            // new
```

**A module imports no other module.** `internal/arch` fails the build on a cross-module
import, exactly as in `home`. Everything a module needs from another module it gets through
one of the registered catalogs, which are owned by the platform.

### The registered catalogs

| Catalog | Owner | Consumers | Purpose |
|---|---|---|---|
| **Widgets** | `platform/dashboard` | Dashboard | What a module shows on the landing screen |
| **Metrics** | `platform/metrics` | Notifications, dashboard | Named scalar values a summary or a condition can reference |
| **Lists** | `platform/lists` | Notifications | The itemised form of a metric |
| **Storage** | `platform/storage` | Billing, admin | Which tables and object prefixes a module owns, and how blob bytes are attributed |
| **Sync entities** | `platform/sync` | Sync engine, clients | Which entities replicate offline, their merge policy and their access predicate |
| **Reminder kinds** | `platform/reminders` | Reminders module, notifications | Date-bearing things a module produces that a member may want reminding about |
| **Search scopes** | `platform/search` | Global search | What a module contributes to cross-module search, and how a hit is rendered |
| **Export / erase** | `platform/privacy` | Data export, right to erasure | How a module serialises and how it deletes |

Four of these are new in Household, and each exists for the same reason the first four did:
a platform capability needs data from every module while importing none of them.

**D-6: the export and erase catalogs are mandatory, not optional.** A module that cannot
export its data cannot ship, because [G5](00-overview.md) and Article 20 of the GDPR are not
negotiable and retrofitting export across seventeen modules is how it never gets done. The
architecture test asserts that every registered module implements `ExportSource` and
`EraseSource`.

## 5. Module enablement and grants

Two independent switches, and they compose:

1. **Household-level enablement.** An owner enables or disables each module for the whole
   household. A disabled module's routes return `404` for that household, its widgets vanish
   from the catalog, its sync entities stop replicating, and its data is retained but
   inaccessible until it is re-enabled.
2. **Member-level grant.** For each *enabled* module, each membership carries an access level:
   `none` · `view` · `contribute` · `manage`. See
   [02-identity-and-access.md](02-identity-and-access.md).

The effective permission is the **minimum** of the two, and it is resolved once per request in
the tenant middleware and carried in the request context. A handler asks
`grant.Require(ctx, "garden", access.Contribute)`; it never re-derives the answer.

## 6. API shape

| | |
|---|---|
| **Style** | REST-ish JSON over HTTPS, OpenAPI 3.1, `snake_case` bodies |
| **Version** | `/api/v1` in the path. Mobile clients cannot be force-updated, so the version is explicit and old minors stay served |
| **Tenant scope** | `/api/v1/households/{household_id}/…` for everything household-owned |
| **User scope** | `/api/v1/me`, `/api/v1/auth/…`, `/api/v1/households` (the list you belong to) |
| **Platform scope** | `/api/v1/platform/…`, staff only, metadata only |
| **Pagination** | Opaque cursor + `limit`, keyset on a natural ordering key. A malformed cursor is `422`, never a silent page one |
| **Concurrency** | The row `version` is returned as an `ETag` and sent back in `If-Match` on updates that can conflict; `409` with the current representation on mismatch |
| **Idempotency** | `Idempotency-Key` accepted on every unsafe method, required on every sync mutation, and retained 7 days: a repeat of a request answered `2xx` is answered with that response and its effect is not repeated. A refused request stores nothing, so a repeat runs it again once the reason for the refusal has gone ([ADR 0006](../adr/0006-sync-ready-schema-and-the-mutation-spine.md)) |
| **Errors** | RFC 9457 `application/problem+json`, with a stable machine-readable `type` and a `code` clients switch on — never on the human-readable message |
| **Partial update** | `PATCH` with a JSON merge body. `PUT` is used only where the whole representation is genuinely replaced |

### Authentication, by client type

| Client | Credential | Why |
|---|---|---|
| Web SPA | `__Host-hh_session` cookie, `HttpOnly; Secure; SameSite=Lax`, plus a double-submit CSRF token | An XSS on the web app cannot exfiltrate a token it cannot read. Proven in `home` |
| Mobile apps | OAuth 2.0 style token pair — a short-lived access JWT plus a rotating refresh token in Keychain/Keystore, with reuse detection | Cookies are wrong on native; a refresh-token pair survives the app being killed and supports offline-first token renewal |

Both are minted by the same login endpoint, which branches on `client_type`. The session and
the token pair resolve to the identical identity and grants — there is one authorization path,
not two. **D-7.**

## 7. Realtime and sync

Household has **one** realtime channel and it exists to serve the sync engine.

- A single WebSocket per client at `/api/v1/households/{household_id}/stream`, authenticated
  by the same credential as the API.
- The default frame is a **nudge**, not a payload: *"the household's change feed has advanced
  to sequence N, and some of it is visible to you."* The client then pulls
  `GET …/sync/changes?since=`. This is a deliberate simplification of `home`'s v10 design,
  where per-user payload fan-out required teaching the broadcast hub about identity: if the
  payload never rides the socket, the socket never needs to know who may see it. **D-8.**
- **Chat is the single exception.** Message payloads ride the socket to resolved conversation
  members, because a pull round-trip is visible latency in a chat and nowhere else.

The full design of the change feed, the mutation queue, retractions and conflict policy is in
[03-platform-strands.md](03-platform-strands.md) §2. It is the largest single piece of new
platform work in the product.

## 8. Object storage

| | |
|---|---|
| **Store** | S3-compatible, EU region, private buckets, no public access under any condition |
| **Key shape** | `h/{household_id}/{module}/{entity_id}/{variant}` — the tenant is the first path segment, so a bucket policy, a lifecycle rule, a usage listing and a tenant erasure are all prefix operations |
| **Access** | Never direct. Uploads go through the API (which sniffs the type, enforces the size cap and the storage quota); downloads are served as short-lived pre-signed URLs the API issues after authorizing the caller |
| **Immutability** | Document bytes are write-once, as in `home`. A changed file is a new document |
| **Backups** | Object versioning plus cross-account replication within the EU |
| **Metering** | The per-prefix byte total is the billable quantity — see [04](04-billing-and-entitlements.md) |

**Pre-signed URLs carry the authorization decision, not the authorization.** They are issued
for a single object, expire in minutes, and are never handed out for a prefix. **D-9.**

## 9. Environments and deployment

| Environment | Purpose | Data |
|---|---|---|
| `dev` | Local. `docker compose`: Postgres + an S3-compatible store (RustFS) + the binary. Seeded fixtures | Synthetic |
| `staging` | Pre-production, same topology as production at one instance | Synthetic only — never a copy of production (**D-10**) |
| `production` | EU region, multi-AZ Postgres with a read replica, ≥2 API instances behind a load balancer | Real |

**Staging never holds production data.** Not an anonymised copy, not a subset. The debugging
value of real data is exactly the privacy exposure the no-content-access guarantee exists to
prevent, and the two cannot both be true.

### Migrations

Goose, one numbered block per module, run by `household_migrate` at deploy, forward-only, and
**expand/contract**: a release that changes a column ships the additive half first, then the
code, then the destructive half in a later release. With mobile clients in the field that
cannot be force-updated, a migration that breaks the previous minor version of the API is a
broken product for everyone who has not updated. **D-11.**

## 10. Architecture tests

`internal/arch` fails the build, not a review, on each of:

1. A module importing another module.
2. A tenant table without `household_id`, without RLS enabled, or without `FORCE ROW LEVEL SECURITY`.
3. A registered module that does not implement `ExportSource` and `EraseSource`.
4. A mutating route that does not write an audit event, or does not write a sync change.
5. A sync entity without a declared merge policy and access predicate.
6. A route not present in `openapi.yaml`, or a path in `openapi.yaml` with no route.
7. A user-visible string literal in client code that is not a translation key.
8. A `float` or `numeric` used for money.
9. A create operation for a sync entity that does not **require** a client-supplied `id`
   (**D-23**, **D-91**).

Numbers 1, 4 and 6 exist in `home` already and paid for themselves. Numbers 2, 3, 5, 7, 8 and 9
are the ones that make commercial and multi-tenant correctness structural instead of
disciplinary.

**Number 9 is the one that would otherwise be discovered late.** D-23 makes client-generated ids
mandatory because an offline create needs a stable identity immediately — but the requirement is
easy to satisfy on the sync path (`POST …/sync/mutations` carries `entity_id`) and easy to forget on
the REST path, where a `POST …/harvests` that mints its own id looks perfectly ordinary. An entity
that gets a server id online and a client id offline is precisely the dual-identity situation D-23
exists to prevent, so the test reads the OpenAPI document and the sync-entity registry together and
fails when a create schema for a registered sync entity does not have `id` in its `required` list.
