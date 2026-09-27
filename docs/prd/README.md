# Household — Product Requirements

**Version 1.0 · specification stage · 2026-09-07**

This directory is the complete product specification for Household. It is split so that
each file stays reviewable on its own; read them in the order below the first time.

## Core

| # | File | What it settles |
|---|---|---|
| 00 | [Overview](00-overview.md) | What Household is, who it is for, the business model, goals and non-goals |
| 01 | [Architecture](01-architecture.md) | Multi-tenancy, the modular monolith, the five registered catalogs, the deployment shape |
| 02 | [Identity & Access](02-identity-and-access.md) | Accounts, households, memberships, the three roles, per-module grants, child profiles, platform staff |
| 03 | [Platform strands](03-platform-strands.md) | Audit spine, **sync engine**, storage & metering, notifications, scheduler, search, files, realtime, i18n/l10n |
| 04 | [Billing & entitlements](04-billing-and-entitlements.md) | Trial, subscription, per-GB metering, plan limits, dunning, what happens when you stop paying |
| 05 | [Privacy & compliance](05-privacy-and-compliance.md) | GDPR posture, data-subject rights, minors, retention, subprocessors, the no-content-access guarantee |
| 06 | [Clients](06-clients.md) | The Expo apps, the web app, the shared design system, offline UX, accessibility |
| 07 | [Non-functional requirements](07-nonfunctional.md) | Performance, availability, security, observability, scale targets |
| 08 | [Roadmap](08-roadmap.md) | Release phasing from 1.0 to 2.0 |
| 09 | [Decision register](09-decisions.md) | Every decision D1–Dn with its rationale and the alternative that was rejected |
| 10 | [De-risking the sync engine](10-sync-risk.md) | The mitigation plan for the product's largest technical risk: schema-before-engine, buy-before-build, tiered offline writes, the conformance suite, and the three gates |

## Modules

| # | File | Czech name | Origin |
|---|---|---|---|
| 00 | [The module model](modules/00-module-model.md) | — | generalized |
| 01 | [Dashboard](modules/01-dashboard.md) | Nástěnka | ported |
| 02 | [Tasks](modules/02-tasks.md) | Úkoly | ported |
| 03 | [Reminders](modules/03-reminders.md) | Připomínky | ported + renamed |
| 04 | [Calendar](modules/04-calendar.md) | Kalendář | **new** |
| 05 | [Shopping](modules/05-shopping.md) | Nákupy | **new** |
| 06 | [Chores](modules/06-chores.md) | Domácí práce | **new** |
| 07 | [Notes](modules/07-notes.md) | Poznámky | ported |
| 08 | [Documents](modules/08-documents.md) | Dokumenty | ported |
| 09 | [Finance](modules/09-finance.md) | Finance | **rebuilt** |
| 10 | [Utilities](modules/10-utilities.md) | Energie a služby | **rebuilt** |
| 11 | [Garden](modules/11-garden.md) | Zahrada | **rebuilt** |
| 12 | [Property](modules/12-property.md) | Dům a vybavení | **new** |
| 13 | [Vehicles](modules/13-vehicles.md) | Vozidla | **new** |
| 14 | [Pets](modules/14-pets.md) | Mazlíčci | **new** |
| 15 | [Chat](modules/15-chat.md) | Chat | ported |
| 16 | [Activity log](modules/16-activity.md) | Historie změn | ported |
| 17 | [Household administration](modules/17-household-admin.md) | Nastavení domácnosti | rebuilt |

## Deferred

[`future/`](future/) holds specifications for work that is deliberately **not** in 1.0 but
whose integration points are designed into 1.0 so that adding it later is not a rewrite.

## Conventions used throughout

- **FR-xx** — a functional requirement. Every mutating FR writes an audit event and a sync
  change in the same transaction as the mutation; this is stated once, here, and never
  repeated. **The two-letter prefix is globally unique across this specification** — `FR-AC`
  is access control and only access control, `FR-AL` is the activity log, `FR-CH` is child
  profiles, `FR-CT` is Chat, `FR-FI` is Finance, `FR-FL` is the files strand. A collision makes
  a cross-reference ambiguous, which is how two teams implement two different requirements.
- **D-n** — a decision, defined in [09-decisions.md](09-decisions.md).
- **Money** is an integer in the currency's minor unit plus an ISO 4217 code. Never a float.
- **Identifiers** are UUIDv7. Clients may generate them (the sync engine requires it).
- **Timestamps** are RFC 3339 with an explicit offset. Dates without a time are `YYYY-MM-DD`
  and carry the household's timezone implicitly.
- **English** is the source language of all identifiers, enum values, log messages and code.
  User-visible text is never hardcoded.
