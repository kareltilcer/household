# 00 — Overview

## 1. What Household is

Household is a subscription app in which a family, a couple or a shared flat keeps the
running state of their home: what needs doing, when things happen, what the utilities
cost, what is planted where, what money went where, and where the documents are.

It is the commercial successor to `home` — a single-tenant Czech app built for one
household, whose architecture is sound and whose product assumptions are not. Household
keeps the architecture, discards the assumptions, and adds the four things a SaaS needs
that a self-hosted family app does not: **tenancy, identity, billing and offline clients**.

**One-line positioning:** *everything your household has to keep track of, in one app that
works on the tram, in the shop, and at the bottom of the garden.*

### What makes it defensible

Most competitors are one feature deep — a shared list, a shared calendar, an expense
splitter. Household's wedge is **depth in the boring, expensive, recurring parts of running
a home** that nobody else touches:

- **Utilities** with a real tariff engine — not "log your bill", but *forecast your annual
  reconciliation from meter readings against a composed tariff*, in whatever billing system
  your country uses.
- **Garden** with a curated agronomic knowledge base — crop timings resolved against *your*
  frost dates, rotation checked against *your* history.
- **Finance** that supports both a fully shared household budget and Splitwise-style
  expense splitting, because real households do both.

None of these are things a competitor adds in a sprint, and all three are stickier than a
shopping list: a household that has three seasons of garden history or two billing periods
of meter readings does not churn.

## 2. Who it is for

| Persona | Shape | What pulls them in | What keeps them |
|---|---|---|---|
| **Owner / organiser** ("Jana", 38) | Runs the household's logistics, invites everybody else, pays the subscription | A specific pain — the energy bill, the garden plan, the shared expenses | The dashboard: one screen that says what today needs |
| **Partner** ("Petr", 41) | Uses two modules and ignores the rest | Was invited; wants the shopping list and the calendar | Notifications that are actually relevant; never having to think about setup |
| **Teenager** ("Adam", 14) | Managed child profile on his own phone | Chores with visible progress; the family calendar | Pocket money tied to chores; not being nagged |
| **Flatmate** ("Klára", 26) | In one household for expenses only | Splitting rent and bills without a spreadsheet | Settle-up that everybody trusts; no access to anything else |
| **Gardener** ("Miloš", 62) | Uses Garden almost exclusively, on a tablet | The plan check and the sowing calendar | Three seasons of rotation history he cannot get anywhere else |

**Anti-persona:** the small business. Household is explicitly not a team or company product.
Nothing in it is designed for approval chains, cost centres, or more than about ten members.

## 3. Business model

| | |
|---|---|
| **Trial** | 30 days, full product, all modules, no card required |
| **Who pays** | The household's **creator** (or another owner who takes over billing) — one payer per household |
| **Base** | **€4.99/household/month billed annually**, or €5.99 month-to-month, including **5 GB** of object storage |
| **Extra storage** | **10 GB blocks at €1.00/month**, added automatically, capped at 20 blocks |
| **Members** | Unlimited within a fair-use ceiling — never priced per seat |
| **Multiple households** | Each household is billed independently; a user may be in a paid household and a trial one at once |

The reasoning behind each of those is in [04-billing-and-entitlements.md](04-billing-and-entitlements.md);
the short version:

- **Per household, not per seat**, because per-seat pricing taxes the exact behaviour the
  product needs in order to work. A household where only one person joined is a household
  that churns.
- **Storage blocks on top**, because storage is the only cost that scales with an individual
  household's behaviour rather than with headcount, and because it is honest: a family storing
  four hundred photos of their garden costs more to serve than one storing none. Priced coarsely
  (10 GB for €1) so that the invoice stays predictable and most households never see it at all.
- **Storage means object storage** — documents, chat attachments, photos. Database rows are
  governed by fair-use limits, not billed, because "your notes cost €0.02 this month" is both
  unmeterable in a shared cluster and absurd to explain.
- **No feature gating between paid tiers in 1.0.** There is exactly one paid plan. Every
  module is available to every paying household. A pricing matrix is a growth-stage problem;
  building the entitlement machinery for it now would cost more than it earns.

## 4. Goals

### Product goals

- **G1** — A household is created, a second member is invited and accepted, and the first
  real thing is recorded, in **under five minutes**, on a phone, without a manual.
- **G2** — Every module is usable by a household that has none of the prerequisites the
  `home` version assumed: no beds, no two-earner split, no Czech two-tariff meter, no
  allotment. Configurability is the feature, and the default configuration is the simplest
  one, not the fullest.
- **G3** — **Every read works offline and every write survives being offline.** A shopping
  list edited in a shop basement, a meter reading taken in a cellar, and a harvest logged at
  the far end of a garden all reconcile without the member thinking about it.
- **G4** — A member's access is exactly what the owner granted: a module they were not given
  is not merely hidden, it is absent from the API, from search, from notifications and from
  the offline replica.
- **G5** — A household can leave. Full export of everything they put in, in formats that are
  useful outside Household, on demand, without contacting support.
- **G6** — The product is correct in five languages and in **five launch markets** — Czechia,
  Slovakia, Germany, Poland and the **United Kingdom** — meaning each one's utility billing
  systems, currency, vehicle-inspection regime, document types and gardening climate, not merely
  its language. Not translated, *localized*.

  The UK is in the launch set and not an afterthought: it shares the source language, its utility
  billing (standing charge + unit rate, Economy 7) is already a preset, MOT is already a statutory
  schedule, and it is the one market where the product needs no translation at all. **It is,
  however, the one market outside the EU**, which has consequences for tax, for the supervisory
  authority and for one open legal question — all of them in
  [05-privacy-and-compliance.md](05-privacy-and-compliance.md) §11. **D-89.**

### Business goals

- **G7** — Trial-to-paid conversion is measurable per acquisition module, so it is knowable
  whether Utilities or Garden or Finance is the thing that actually sells.
- **G8** — Support can resolve account, billing, entitlement and delivery problems **without
  ever reading household content**, and the platform makes reading it impossible rather than
  merely forbidden. D-93 makes one exception, the sync service's own database credentials, for
  which it rests on who holds them ([05-privacy-and-compliance.md](05-privacy-and-compliance.md)
  §6).
- **G9** — Storage cost per household is measurable daily and attributable per module, so the
  per-GB price is set from data and the meter can be shown to the customer.

### Engineering goals

- **G10** — Cross-tenant data disclosure is prevented **twice**: by application scoping and
  independently by PostgreSQL row-level security, such that a missing `WHERE` clause returns
  nothing rather than someone else's family. D-93 makes one exception, the replicated path, which
  PowerSync reads past row-level security: there it is prevented once, by stream definitions
  generated from the entity registry, which a read-path isolation test holds
  ([01-architecture.md](01-architecture.md) §2.3).
- **G11** — The module boundary from `home` survives: a module owns its routes, migrations,
  audit actions, sync entities and catalog contributions, and imports no other module. An
  architecture test fails the build on a cross-module import.
- **G12** — One HTTP contract serves both clients. The mobile and web clients consume a
  generated typed client from `openapi.yaml`; the document is the contract, not a description
  of one.

## 5. Non-goals

Stated so that nobody has to infer them.

### Not in the product at all

- **No cross-household social features.** No discovery, no friend requests, no public
  profiles, no messaging between households. Chat is scoped to a single household. This keeps
  Household out of the EU Digital Services Act's "online platform" obligations and out of the
  child-safety surface that user-to-user contact with strangers creates.
- **No business or team use.** No org hierarchy, no approvals, no cost centres, no SSO/SAML,
  no seats.
- **No bank account connections in 1.0.** No PSD2/AISP integration, no aggregator. Finance
  takes manual entry and file import. The internal model is built so that a transaction
  source can be added later without a data migration (**D-81**).
- **No AI features in 1.0.** No assistant, no photo recognition, no generated content, no LLM
  subprocessor, and therefore no AI disclosure in the DPA. `home`'s MCP endpoint does not
  cross over. See [future/ai-assistant.md](future/ai-assistant.md) for the shape it would take.
- **No smart-home or IoT integration.** No Home Assistant bridge, no smart-meter polling, no
  device control.
- **No self-hosted edition.** Household is EU-hosted SaaS only. The deployment shape stays
  self-host-*capable* (one Go binary, PostgreSQL, S3-compatible storage) so the option is not
  foreclosed, but it is not offered, supported or documented in 1.0.
- **No white-labelling, no third-party API, no public developer platform.**
- **No advertising, ever, and no sale or sharing of personal data for any purpose.** This is a
  product commitment, stated here because the business model depends on it being credible.

### Deferred, with integration points designed in

| Deferred | Designed-in hook |
|---|---|
| Meals & Recipes, Pantry | Shopping list items carry an optional `source_ref`; Garden harvest and storage rows are already shaped to feed a pantry |
| AI assistant | The module contract already exposes a machine-readable tool surface; nothing else is needed |
| Bank / open-banking import | Finance transactions carry a `source` discriminator from day one |
| Allowance / pocket money | Chore completions already produce a valued, auditable event |
| Wishlists, Guest mode, Travel, Emergency info, Health | Not modelled; see [08-roadmap.md](08-roadmap.md) |
| Passkeys, self-host edition, all-EU languages | See roadmap |

### Deliberately weaker than a specialist tool

Household will not beat YNAB at budgeting, Splitwise at settle-up graphs, Google Calendar at
scheduling or a dedicated maintenance system at asset management. It beats all of them at
*being one app where the household's things are related to each other*, and this
specification does not chase parity on any single axis.

## 6. What is inherited from `home`, and what is not

### Inherited, essentially unchanged

- The **modular monolith** with a compile-time module registry.
- The **audit spine**: every mutation writes a structured, queryable audit event in the same
  database transaction as the change, with field-level diffs for key entities.
- The **catalog pattern**: modules contribute widgets, metrics, lists and storage declarations
  through registered interfaces, so the host never imports a module.
- **Dashboard as a widget host** that owns no feature data.
- **Notes** and **Documents** in a folder tree with slug paths, two-scope pinning, private
  roots and immutable document bytes.
- **Tasks** (the Trello-style board) and the press-and-hold completion gesture, with its
  mandatory immediate keyboard path.
- The **shared / private / membership** three-axis access model.
- **Chat**, scoped to one household.

### Inherited in shape, rebuilt in substance

- **Finance** — the locked two-person Czech split becomes one of four configurable
  capabilities, with N earners, N accounts and user-defined allocation rules.
- **Utilities** (was Elektřina) — the Czech VT/NT model becomes a composable typed tariff
  engine across electricity, gas, water, heat and waste, with three depth modes.
- **Garden** — the allotment-scale planner becomes three progressive tiers over one data
  model, on a curated multi-language crop knowledge base instead of a per-install LLM import.
- **Reminders** (was Okno do budoucnosti) — the module survives, and its *mechanism* is
  promoted to a platform strand that six other modules publish into.

### Not inherited

SQLite, Litestream, the external `auth` service, session-only authentication, the
`admin`/`editor`/`reader` role names, the Czech-only string table, the MCP front door, and
the assumption — load-bearing in about forty call sites — that every row belongs to the one
household the process was deployed for.
