# 08 — Roadmap

The scope decision was **fully saturated**: everything from `home`, generalized, plus Calendar,
Shopping, Chores, Property, Vehicles and Pets. That is seventeen modules and three new platform
strands, and it is a large build. This chapter is about **the order**, not about cutting it.

## The ordering principle

> **Build the platform first, then one module all the way to production quality, then the rest in
> parallel.**

The mitigation plan for the largest risk in that sequencing — the sync engine — is its own chapter:
[10-sync-risk.md](10-sync-risk.md). Phases 0 and 1 below are written to match it.

Three things must exist before any module is written, because retrofitting any of them is a rewrite
rather than an addition:

1. **Tenancy and RLS** — every table needs `household_id` and a policy from its first migration.
2. **The sync engine** — every entity needs a merge policy, a version column and client-generated
   ids from its first migration.
3. **Identity, grants and the module contract** — every route needs a grant gate from its first line.

Everything after that is genuinely parallelisable, because modules do not import each other.

## Phase 0 — Platform (no user-visible product)

| | |
|---|---|
| **Deliverable** | A running binary with no feature modules that can authenticate a user, create a household, invite a member, resolve grants, sync an entity offline, write an audit event, meter storage, and export and delete a household |
| **Contains** | Tenancy + RLS + the isolation test · identity (password, Google, Apple, MFA, sessions, devices) · households, memberships, invitations, child profiles · module contract and the eight catalogs · **the sync engine end to end** · audit spine · storage catalog and sampling · notifications (all three transports) · scheduler · search infrastructure · file pipeline · i18n infrastructure with five catalogs · billing and entitlement states · export and erasure · the nine architecture tests |
| **Proof it works** | A throwaway module of three entities exercising every merge policy, retraction, and the full export/erase path. Deleted afterwards |
| **Clients** | Auth, household creation, invitation, settings, and the sync client library. No feature screens |

### Phase 0 runs in this order

1. **Week 1 — the cheap half.** The **sync-ready schema** (`household_id`, `version`,
   client-generated UUIDv7 keys, tombstones, the denormalised access fields, and a declared merge
   policy per entity), enforced by architecture tests — **plus** the timeboxed buy-vs-build spike
   against off-the-shelf sync engines. Gate **G-A**. See [10-sync-risk.md](10-sync-risk.md) §1–2.
2. **The conformance suite** — a multi-client harness with scripted partitions, reordering and
   clock skew, written **before** the engine, covering 18 named scenarios and six invariants, then
   fuzzed. Gate **G-B**. Since the spike adopted PowerSync (D-93) it drives PowerSync clients
   against the real stack, so its schedules are seeded rather than deterministic
   ([10-sync-risk.md](10-sync-risk.md) §4).
3. **The engine**, satisfying it: PowerSync's replication, and the push, streams and client library
   that are Household's.
4. Everything else listed above — plus the **sync-health screen**, which moves here from the admin
   module, because with no-content-access it is the only view anyone gets of a sync failure.

**Phase 0 is the riskiest part of the whole programme** and it has no demo. That is worth saying out
loud, because the pressure to start a feature module early will be constant and yielding to it is how
`household_id` ends up missing from four tables. The suite in step 2 exists precisely to replace
the feedback loop that a phase with no UI otherwise lacks.

## Phase 1 — The first module, all the way

**Shopping**, built to production quality on both clients, with the offline acceptance criterion from
[modules/05-shopping.md](modules/05-shopping.md) passing on real devices.

Shopping is chosen deliberately: it is the smallest module that exercises the hardest part of the
platform. Two people editing the same list, both offline, in the same shop, is the sync engine's worst
case, and it is better to find its bugs in a module of two tables than in Finance.

**Offline writes ship per merge policy** ([D-84](09-decisions.md)), and **Shopping is the named
exception**: its checked state is `state_set` and its items are `lww_field`, and *both* ship
offline in this phase. `lww_field` stays gated everywhere else until Phase 2. Shopping is pulled
forward deliberately — gate G-C proves the engine on two physical phones, and it cannot do that
against a list nobody can add to without a signal.

**Exit criterion — gate G-C:** the shopping acceptance test passes on two physical phones in
aeroplane mode, and the sync-health screen
([modules/17-household-admin.md](modules/17-household-admin.md) FR-HA19) shows what happened.
**If it does not pass, the fallback is already written down: stop and build
[03](03-platform-strands.md) §2's engine on the schema and the write path, which are already
ours.** (It was to adopt one of the engines spiked in Phase 0 until D-93 adopted PowerSync at gate
G-A; [10-sync-risk.md](10-sync-risk.md) §7.) Naming the fallback in advance is what makes this a
gate rather than a wish, because the decision will otherwise be taken under schedule pressure by
the people who built the thing they would be abandoning.

## Phase 2 — The daily core

Built in parallel once Phase 1 has proved the platform.

| Module | Why here |
|---|---|
| **Dashboard** | Every later module needs somewhere to appear |
| **Household settings** | Its Phase 0 half already exists (profile, members, grants, module enablement, storage, billing, data, sync health); this phase adds the notification composer and the per-module setup entry points as their modules land |
| **Reminders** (module + strand) | Six later modules depend on the strand |
| **Tasks** | Ported, low risk, exercises lexorank offline |
| **Notes** | Ported, introduces private roots and language-aware search |
| **Documents** | Introduces the file pipeline and is a dependency of five later modules |
| **Chores** | Makes the `child` role real |
| **Activity log** | Cheap once the spine exists, and it is the transparency surface |

**Exit criterion:** a household can be used daily by a real family. This is the first internal
dogfooding milestone and it should run for at least a month before Phase 3 ships.

## Phase 3 — The differentiators

The three heavy rebuilds, each with substantial setup flows, each buildable independently.

| Module | Largest risk |
|---|---|
| **Utilities** | The tariff engine's generality, and the preset data for five countries |
| **Finance** | The allocation engine reproducing `home`'s worked example exactly, and the import wizard |
| **Garden** | The curated crop catalog — ~300 crops in five languages with climate-relative timings is **content work on the critical path** and must start during Phase 0 |

**The crop catalog is the longest-lead item in the entire programme.** It is not engineering, it
cannot be parallelised late, and Garden cannot ship without it. Commissioning it should be among the
first actions taken, not something discovered in Phase 3.

## Phase 4 — Breadth

| Module | Notes |
|---|---|
| **Calendar** | Large: recurrence with exceptions, timezones, and three external sync protocols. Could move earlier if research says it is the acquisition driver |
| **Property, Vehicles, Pets** | One shared asset engine, then three thin modules. The cheapest breadth in the plan |
| **Chat** | Ported; the realtime exception and the storage clean-up page are the real work |

## Phase 5 — General availability

Not a feature phase. The work that turns a complete product into a sellable one:

- External penetration test and remediation.
- Load testing to the Year-3 targets in [07-nonfunctional.md](07-nonfunctional.md).
- Backup restore drill, failover drill, incident runbooks.
- App Store and Play submission, including the store-rule checks in
  [04](04-billing-and-entitlements.md) §7.
- Legal: terms, privacy policy in five languages, DPA, sub-processor list, cookie posture.
- **UK launch-market items** ([05](05-privacy-and-compliance.md) §11): Art. 27 UK representative
  appointed, UK VAT registration, ICO routing in the privacy centre, and **counsel's answer on
  whether the Online Safety Act's Schedule 1 exemptions cover a closed household chat** — the one
  item on this list that can change what ships.
- Support tooling, the diagnostic bundle flow, help content in five languages.
- Pricing **validated** against the instrumentation in [04](04-billing-and-entitlements.md) §8. The
  launch figures are set (€4.99 annual / €5.99 monthly, 5 GB included, 10 GB blocks at €1); what §8
  confirms is that 5 GB keeps the large majority of households at zero blocks
  ([D-34](09-decisions.md)).
- A closed beta with real households in at least Czechia, Slovakia, Germany and the **United
  Kingdom** — between them they exercise every launch currency, both tariff shapes and both unit
  systems.

## After 1.0

Ordered by expected value, to be re-ordered by evidence:

| # | Item | Why |
|---|---|---|
| 1 | **Meals & Recipes + Pantry** | The strongest cross-module story in the product: meal plan → shopping list → pantry → garden harvest. The `source_ref` hook already exists |
| 2 | **Allowance / pocket money** | Chores' point ledger is already shaped for it; it completes the child story |
| 3 | **Bank import via open banking** | Finance's `source` discriminator already exists. Gated on whether manual + CSV proves insufficient |
| 4 | **Guest / house-sitter mode** | A time-limited read-only slice — and the best acquisition surface in the list |
| 5 | **Wishlists & gifts** | Cheap, delightful, and a natural invite-a-relative loop |
| 6 | **Remaining EU languages** | Infrastructure exists; it is translation and QA |
| 7 | **AI assistant** | [future/ai-assistant.md](future/ai-assistant.md). Deliberately last: it needs a settled data model, and it introduces a subprocessor and a disclosure |
| 8 | **Passkeys** | |
| 9 | **Emergency & key info, Travel & packing, Health & meds** | Health is special-category data and needs its own legal review |
| 10 | **Self-host edition** | Only if there is demand and someone to support it |

## What would change this plan

Stated so that changing it is a decision rather than a drift:

- **If beta research says Calendar is the acquisition driver**, it moves to Phase 2 and Chat moves
  after Phase 5.
- **If the sync engine is not solid at the end of Phase 1**, gate G-C fires and the fallback is to
  build [03](03-platform-strands.md) §2's engine rather than to carry on with the adopted one
  (D-93). There is no version of this product that ships on a sync engine nobody trusts.
- **If the crop catalog cannot be sourced at acceptable quality**, Garden ships at `pots` and `beds`
  tiers only, with `plot` deferred — the tier model makes that a supported outcome rather than a
  crisis.
- **If store rules make the web-only purchase flow unworkable**, [04](04-billing-and-entitlements.md)
  §7's reader fallback becomes the primary posture and the marketing site carries more weight.
