# Household — Implementation plan

**Living document · created 2026-09-26 · derived from [PRD v1.0](prd/README.md), [`openapi.yaml`](api/openapi.yaml)
(320 paths, 486 operations) and [`design/v1`](../design/v1/) (synced 2026-09-26)**

This is the build plan for the whole of Household, from an empty repository to general availability.
Each numbered item below is **one pull request**, sized so that one `/implement` session can take it
from reading its inputs to an open PR. The plan changes as the build teaches us things, and the rules
for changing it are part of the plan.

**96 items** (cap: 100 PRs, so 4 are held in reserve). Progress is counted from the item headings, not kept here.

---

## How to use this plan

### Status

Every item carries exactly one status in its heading, and nowhere else:

| Status | Meaning | Set when |
|---|---|---|
| `planned` | Not merged | Default |
| `done` | Merged to `main` | By the item's own PR, so it becomes true on `main` when that PR merges. The same PR fills in its **PR** line once it is open |

Work in progress is not recorded here: an open PR titled `[NN] …` is the record.

### Rules for changing the plan

1. **`done` items are history.** Their text is not rewritten. Only the **PR** line may be corrected.
2. **`planned` items may be rewritten, split, merged, reordered or renumbered** when implementation shows
   they are wrong. Put the rewrite in the PR that discovered the need. Fix every **after #n**
   reference the change touches, in the same edit.
3. **The cap is 100 items.** Splitting an item uses a reserve slot, or merges something else. The
   reserve is for work that turned out bigger than planned, not for new scope.
4. **Every rewrite adds one line to the [Change log](#change-log)** with the reason.
5. **Gates are not rewritten to pass.** If a gate's condition is wrong, change it in the PRD with a
   decision entry first ([09-decisions.md](prd/09-decisions.md)), then here.
6. **Numbers are the build order.** Every item an item's **after** list names has a lower number, so
   the lowest-numbered `planned` item can always start. A rewrite that makes an item wait for a later
   one renumbers the `planned` items between them, and every reference to them, in the same edit.
   `tooling/src/plan.test.ts` fails a plan that breaks this.

### Starting an item

1. Check that every item in its **after** list is `done`. Items with no dependency on each other may run
   in parallel, and after gate G-C most of Phases 2–4 can.
2. Read, in this order: the item, the [conventions](#conventions-every-pr-follows) below, the item's
   **Inputs**, and any open question from [Decisions to settle](#decisions-to-settle-during-implementation)
   that names the item.
3. Run `/implement` with the item number and title. The PR title is `[NN] <item title>` and the branch is
   `feat/NN-<slug>`.

### Precedence of sources

**PRD > `openapi.yaml` > `docs/design` > `design/v1`.** The PRD is authoritative
([docs/design/README.md](design/README.md) says the same). `design/v1` is a clickable ES5 prototype.
It is the behavioural reference for screens, copy intent, states and worked numbers. It is not code to
ship.

Where two sources disagree:
- Follow the higher one.
- Record the disagreement in the PR description.
- Amend the lower one only if it is a document in this repository. `design/v1` is left as is.

`home` means the predecessor repository at `../ws-tilcer-home`. It is a reference for porting logic and
tests, never a dependency.

---

## Plan decisions

These are the choices the PRD leaves open. They are **plan decisions (PL-n)**, not product decisions.
An item may overturn one by recording why in the Change log.

| # | Decision | Why |
|---|---|---|
| **PL-1** | **One monorepo**: `server/` (Go module), `apps/web`, `apps/mobile`, `packages/{api,i18n,tokens,icons,domain,sync,test-vectors}`, `tooling/` (guards over the workspace itself), `reference-data/`, `fixtures/`, `docs/adr/`, `docs/runbooks/`. pnpm workspaces + Turborepo for TypeScript | The contract, the tokens, the strings and the vectors are shared ([06-clients](prd/06-clients.md) §1). One repository makes a contract break a build break |
| **PL-2** | **Server libraries follow `home` where it had one**: chi v5, goose v3, coder/websocket, aws-sdk-go-v2 (S3), golang-jwt (EdDSA), webpush-go. New for Household: pgx v5 + sqlc on PostgreSQL 17, kin-openapi (edge validation), x/crypto argon2id, pquerna/otp, coreos/go-oidc, stripe-go | Proven in `home`. The new ones are the standard choice for each job |
| **PL-3** | **Tests hit real PostgreSQL**: compose locally and a service container in CI. No database mocks. TS unit tests use Vitest; web E2E uses Playwright + axe; mobile uses Jest + React Native Testing Library, with Maestro for E2E | RLS, the change feed and `SET LOCAL` cannot be tested against a mock |
| **PL-4** | **Web**: React 19, Vite, React Router 7, TanStack Query persisted to IndexedDB, Radix primitives for behaviour, CSS Modules over token custom properties, dnd-kit, Milkdown for Notes, Stripe Payment Element | Carries `home`'s proven stack. CSS variables make "semantic tokens only" a lint rule |
| **PL-5** | **Mobile**: Expo managed workflow (current SDK), expo-router, PowerSync's React Native SDK on op-sqlite (the replica, [D-93](prd/09-decisions.md); a dev build, not Expo Go), expo-secure-store, expo-notifications, react-native-svg, native Apple and Google sign-in. **Tablet is a layout of the mobile app**, not a third codebase (design/v1 draws 24 tablet rows) | [06-clients](prd/06-clients.md) and [D-36](prd/09-decisions.md). The prototype's tablet rows are two-pane layouts of the same app |
| **PL-6** | **Sync replicates through PowerSync, self-hosted, and pushes through Household's own API** (item 5's verdict, [D-93](prd/09-decisions.md), [ADR 0001](adr/0001-sync-engine.md)). The streams are generated from the entity registry. The conformance suite drives PowerSync clients against the real stack | [10-sync-risk](prd/10-sync-risk.md). The spike found PowerSync retracting for every cause of access loss with writes still through the spine; the suite tests Household's half, which is where the rules live |
| **PL-7** | **Contract tooling**: the TS client is generated with openapi-typescript + openapi-fetch; Go validates request bodies against the same document at the edge. A `contract_pending` list names operations not yet built. It only ever shrinks and is empty at GA | [G12](prd/00-overview.md), architecture test 6 |
| **PL-8** | **Environments**: dev is docker compose (Postgres 17, RustFS for S3, Mailpit). **Staging is DigitalOcean + Coolify from Phase 0**, synthetic data only ([D-10](prd/09-decisions.md)). **Dogfooding runs on a separate environment from item 30**: it holds the team's real data, so it is on an EU-established provider ([D-5](prd/09-decisions.md)) and under production's data rules. **Production is an EU provider chosen in item 88** | Phones need a reachable server for gate G-C. Real dogfood data may not sit on staging. Production's multi-AZ requirements are a Phase 5 decision |
| **PL-9** | **Translations**: every UI PR ships English plus Claude-drafted `cs`, `sk`, `de` and `pl`. Drafted keys are listed in `packages/i18n/review/`. Native review clears them before GA (item 95) | A missing catalog is a build break ([03 §9](prd/03-platform-strands.md)). Drafting inline costs less than a translation phase |
| **PL-10** | **Reference content is drafted by Claude with a source for every field**, in `reference-data/`, schema-validated in CI and flagged for expert review. This covers crops, climate, tariff presets, statutory vehicle rules, document types, categories and templates | Your decision (2026-09-26). The crop catalog is the longest-lead item ([08-roadmap](prd/08-roadmap.md)) |
| **PL-11** | **design/v1 is used three ways**: tokens, icons and illustration are ported mechanically (item 23); `fixtures.js` becomes the canonical seed (item 30), and each module PR adds its own data; each engine file's `checks()` becomes that module's shared test vectors. Screens are cited by **ledger id** (`ledger.js`: A-1…F-20; client suffix `-m`/`-w`) | The prototype's numbers are already cross-checked across files. Re-deriving them is how they drift |
| **PL-12** | **Porting from `home` ports logic and tests, not schema.** `home` is single-tenant SQLite. Every ported query gains `household_id`, RLS and the mutation spine | [00-overview](prd/00-overview.md) §6: *"the assumption — load-bearing in about forty call sites — that every row belongs to the one household"* |
| **PL-13** | **Type**: IBM Plex Sans and IBM Plex Mono (SIL OFL), self-hosted with Latin Extended-A and B subsets and tabular figures. Newsreader, which appears only in the design artifacts' chrome, is not used. **Icons**: Lucide (ISC), vendored and tree-shaken, for general glyphs; module and status icons are drawn in-house | [01-foundations](design/01-foundations.md) N8, [DD-10](design/08-decisions.md) |

---

## Conventions every PR follows

### Definition of done

- [ ] CI is green, including every check that exists at this point:
  - the architecture tests;
  - the contract diff and the tenant-isolation test;
  - the conformance suite;
  - unit, component and vector tests;
  - the strict type check and lint;
  - axe and the pseudolocalisation pass on touched routes;
  - bundle budgets.
- [ ] Operations this PR implements are removed from `contract_pending`. Any change to `openapi.yaml` is deliberate, and its reason is in the PR.
- [ ] Every client screen covers its ledger row's required states (the preset minus its declared exclusions) and passes [07-delivery §3](design/07-delivery.md):
  - both themes;
  - 200 % text;
  - colour, icon **and** word;
  - 44 pt targets;
  - absence, not disabling;
  - destructive copy that names the object.
- [ ] New strings are present in all five catalogs, with drafts flagged (PL-9). No user-visible string is a literal.
- [ ] If a decision was taken or behaviour changed, the PRD is updated in the same PR ([07 §6](prd/07-nonfunctional.md)).
- [ ] This plan is updated: the item's status set to `done`, its **PR** line, and any rewrites, each rewrite with a Change log line.

### Every module's server PR also

Follow the [module model](prd/modules/00-module-model.md):
- [ ] **Identity and structure.** A stable module id; its own goose migration block; routes under the tenant and grant middleware.
- [ ] **Audit actions** with summary keys.
- [ ] **Sync entities**, each with:
  - a merge policy;
  - the `state_set` key and resolution, where the policy is `state_set`;
  - any `additive` cross-row invariant;
  - a redacted projection where one is needed.
- [ ] **Offline-write flags** set for the D-84 phase. A `strict_version` entity whose server item merges after item 67 ships with offline writes on; item 67 turns them on for every module merged before it.
- [ ] **Export and erase** implemented.
- [ ] **Catalog contributions**: widgets with their D-42 client projection, metrics, lists, reminder kinds, search scopes and storage.
- [ ] **Absence.** `404`, not `403`. The nine absence surfaces are tested for a member with `none`.
- [ ] **Ported data.** The module's `design/v1` fixture is added to the seed with any drift fixed. Its `checks()` are added to `packages/test-vectors`.
- [ ] **After item 53:** help entries authored ([DD-13](design/08-decisions.md)), and the setup re-entry point registered if the module has a setup.
- [ ] Any sync policy or key the PRD leaves unstated is decided, written into the module's PRD page, and listed in the PR.

---

## Phases and gates

| Phase | Items | Exit |
|---|---|---|
| **0 — Platform** | 1–30 | **G-A** after 4 and 5: the sync-ready schema is enforced and the buy-vs-build verdict is written. **G-B** after 17: 18 scenarios plus fuzz are green. Item 30 closes [08-roadmap](prd/08-roadmap.md)'s Phase 0 deliverable |
| **1 — Shopping** | 31–34 | **G-C** at 34: the Shopping acceptance test passes on two physical phones in aeroplane mode. **If it fails, build the engine** ([10 §7](prd/10-sync-risk.md); the vendor was adopted at G-A, D-93) |
| **2 — Daily core** | 35–54 | A real family can use it daily. **At least a month of internal dogfooding** before Phase 3 ships (not before it starts) |
| **3 — Differentiators** | 55–74 | Utilities, Finance and Garden reproduce their worked examples; `strict_version` offline writes are enabled |
| **4 — Breadth** | 75–87 | Feature-complete: all 17 modules on both clients |
| **5 — General availability** | 88–96 | `contract_pending` is empty, and the [non-code checklist](#outside-the-pr-list-ga-prerequisites-that-are-not-code) is ticked |

Two content items, 22 and 54 (the crop catalog), run in parallel with everything from item 7 onward. The
roadmap is explicit that this content must start during Phase 0.

---

## Decisions to settle during implementation

These are open points the reading surfaced: gaps in the PRD, disagreements between the prototype and the
PRD, and gaps in the contract. Each is settled in the item named. **Rows marked ★ need an answer from
you**, not from the implementing session.

| # | Question | Source | Settle in |
|---|---|---|---|
| Q1 ★ | **CZK and PLN prices.** [04 §1](prd/04-billing-and-entitlements.md) says local prices are set "on the same basis" but names no figures. The prototype assumed EUR everywhere, which contradicts the PRD | 04 §1; design/v1 `household.js` | 19 |
| Q2 | **Sync engine: build or adopt.** A verdict of *adopt* rewrites items 12, 13, 17 and 18. **Settled by item 5: adopt PowerSync for replication, keep the write path ([D-93](prd/09-decisions.md))** | 10-sync-risk §2 | 5 |
| Q3 | **FR-CT1 against grants.** The general conversation should contain every member, but two of the five fixture members (Petr and Miloš) hold `none` on Chat. The prototype lets the grant win | 15-chat; design/v1 `chat.js` | 85 |
| Q4 | **Finance shares.** The prototype settled that a share may only name a member who holds Finance. Confirm it and write it into FR-FI11. **The Finance fixture breaks this rule**: only Jana holds Finance, yet its shares and balances name Petr and Miloš. If the rule is confirmed, either the seed grants them Finance (which moves other personas' vectors) or the Finance fixture is re-cut. Record the choice under Q16 | 09-finance, D-59; design/v1 `finance.js`, `fixtures.js` | 63 |
| Q5 | **Search while offline.** The prototype says *"search needs a connection"*; [03-patterns](design/03-patterns.md) says offline reads are indistinguishable from online ones | design/v1 `spine.js` | 36, 38 |
| Q6 | **A member who can create nothing.** Do they get an Add tab, or a four-slot bar? The prototype drops the tab; [08-decisions](design/08-decisions.md) treats the five destinations as fixed | design/v1 `nav.js` | 28 |
| Q7 | **A child's private root.** Readable by an owner (FR-NO4), but is it searchable by them (FR-NO7)? | 07-notes | 43 |
| Q8 | **`chores.due` completion scope.** Personal or household? The prototype is internally inconsistent. Also: can points exist with no child profile, and what happens when a rotation member loses the grant mid-cycle? | 06-chores; design/v1 `ledger.js` GAPS | 49 |
| Q9 | **PIN lockout.** The PRD says 10 attempts, then owner unlock. The prototype pauses after 5. **The PRD wins**; the fixture is corrected | 02 FR-CH5 | 11 |
| Q10 | **Unstated sync policies**: Finance import/rules/price history; Utilities conversions/advance schedules; Garden overrides/varieties/dismissals/photos and the `task_completion` key; `vehicle_drivers`; pet `routine_items` | module pages | 62–64, 56, 69, 81, 82 |
| Q11 | **Contract gaps**: no route serves the Calendar ICS feed; no receiver for Google push notifications; Chores rewards and Shopping categories/staples have no PATCH or DELETE; no path for the reference-data reads or the Garden region bundle; `POST …/notifications/broadcast` has no PRD requirement (implement it with a PRD entry, or remove it with a decision entry). Three creates accept a client id without requiring it (D-91): `postTasksCardsByCardIdChecklist` (`id`), `postShoppingListsByListIdItems` (`ids`) and `postChoresRedemptions` (`id`); architecture test 9 fails each once its entity names it among its creates. No operation lists a household's clients and their versions, which C-57 shows (FR-HA18); item 9 records each device's version. No operation takes the ID token that native Sign in with Apple and Google's native SDK hand the client, in place of a code and a PKCE verifier. **The reference-data reads: settled by item 7** (`/reference/countries`, `/reference/units`) | `openapi.yaml` vs PRD | 76, 77, 49, 31, 7, 68, 53, 40, 27, 29 |
| Q12 | **Reading anchors** (FR-UT9): a conversion change also blocks, and each service has its own reading cadence | design/v1 `utilities.js` | 57 |
| Q13 | **Tokens**: emit resolved values or add primitives? Many semantic tokens in the prototype sit off the primitive ramp | design/v1 `foundations.js` | 23 |
| Q14 | **Vendors not named in the PRD**, each EU-established: weather provider, email provider, analytics store, error aggregation, and an IP-to-place source for the session and device lists and the takeover notice (FR-ID7; items 8 and 9 answer `approximate_location` null, and item 9 moved the choice to item 30). The office-to-PDF converter (LibreOffice headless is assumed) | 05 §10, 07 §5 | 71, 30/88, 92, 30, 30, 14 |
| Q15 ★ | **UK Online Safety Act** (OQ-1). Counsel's answer decides whether Chat ships disabled in the UK. Item 85 ships a per-country switch either way | 05 §11, DD-11 | counsel → 85 |
| Q16 | **Fixture drifts** to fix when porting the seed: Stage 8 has Property and Pets toggled off; the vehicles widget date; the washing-machine warranty date; `garden.task_due` names the wrong bed and crop; Petr's persona note is stale | design/v1 `github.md` | 30 and each module |
| Q17 | **Subscribe flow.** The PRD says Stripe Elements / PaymentSheet; the contract's `billing/checkout-session` and `billing/portal-session` describe a hosted checkout and a hosted portal. The PRD wins, so those operations are amended in `openapi.yaml` before the client is generated | 04 §6; `openapi.yaml` tag `billing` | 19 |

---

## Phase 0 — Platform

No user-visible product. It is the riskiest phase, and it has no demo. The conformance suite
(item 12) replaces the feedback loop that a UI would otherwise give.

### 1 · Monorepo, toolchain and CI · `done`

Phase 0 · after — · size M

- **Scope**
  - **Layout** per PL-1: pnpm workspaces and Turborepo; a Go module in `server/`; package stubs.
  - **TypeScript strictness**: `tsconfig.base.json` with the strict flags from [06-clients](prd/06-clients.md). ESLint with `no-explicit-any` and `no-non-null-assertion` as errors.
  - **Go and formatting**: golangci-lint; Prettier and gofmt.
  - **Pinned toolchain**: Node LTS and Go 1.26.
  - **Local environment**: `docker-compose.yml` (Postgres 17, RustFS, Mailpit), `.env.example`, and a task runner with `up`, `gen`, `test` and `lint`.
  - **CI (GitHub Actions)**:
    - Go build, vet and test against a Postgres service;
    - turbo typecheck, lint and test;
    - OpenAPI validation (openapi-spec-validator and Redocly);
    - govulncheck, pnpm audit, gitleaks and CodeQL.
  - **Repository docs**:
    - a `CLAUDE.md` distilling the PRD conventions (money, UUIDv7, timestamps, English source, 404-not-403, the mutation spine) and this plan's workflow;
    - a PR template carrying the Definition of done;
    - a `docs/adr/` template.
- **Inputs**
  - PRD: [README](prd/README.md) conventions, [01 §9](prd/01-architecture.md), [06 §8](prd/06-clients.md), [07 §6](prd/07-nonfunctional.md)
  - API: [api/README](api/README.md) (the validation commands)
  - home: `CLAUDE.md`; the `frontend/package.json` tooling
- **Done when**
  - A fresh clone reaches a green `test` with only docker, pnpm and Go installed.
  - CI is green, and the committed `openapi.yaml` validates under both validators.
- **PR:** [#4](https://github.com/kareltilcer/household/pull/4)

### 2 · Server skeleton and contract enforcement · `done`

Phase 0 · after 1 · size M

- **Scope**
  - **Process basics**: `cmd/household-api`; config from the environment; graceful shutdown; `/healthz` and `/readyz`.
  - **Logging**:
    - A redacting JSON logger with a **field allowlist** ([FR-NF5](prd/07-nonfunctional.md)).
    - `request_id` and `household_id` on every line.
    - Panic recovery.
  - **Errors**: RFC 9457 problem documents, with the Go `ProblemCode` enum generated from the OpenAPI schema.
  - **Routing and validation**: chi mounted at `/api/v1`; request-body validation at the edge against `openapi.yaml` (kin-openapi); response validation in tests.
  - **Pagination**: the opaque keyset cursor helper, where a malformed cursor returns `422`.
  - **Database**: pgxpool, plus goose with a platform block and per-module blocks assembled by the registry.
  - **Roles and fixtures**:
    - A bootstrap that creates `household_migrate`, `household_app` and `household_meter`.
    - UUIDv7 generation.
    - A `testsupport` package that clones a template database per test package.
  - **Architecture test 6**: routes ⇄ `openapi.yaml`, with `contract_pending` seeded with all 486 operation ids. It fails on:
    - an undeclared route;
    - a route implemented while still pending;
    - a stale pending entry.
  - **Architecture test 8**: no `float` or `numeric` money, checked across Go types and migrations.
- **Inputs**
  - PRD: [01 §6, §9, §10](prd/01-architecture.md); [07 §4–5](prd/07-nonfunctional.md)
  - API: [api/README](api/README.md)
  - home: `backend/internal/platform/{httpx,config,db,reqctx,idgen,cursor}`, `backend/internal/arch`
- **Done when**
  - An invalid body returns `422` with a problem `code`.
  - A test proves that a field not on the allowlist is dropped from the logs.
  - Both architecture tests fail on deliberate violations kept in `testdata`.
- **PR:** [#5](https://github.com/kareltilcer/household/pull/5)

### 3 · Module registry, tenancy and row-level security · `done`

Phase 0 · after 2 · size L

- **Scope**
  - **Module contract**: the `Module` interface and all optional catalog interfaces, including Sync, Reminder, Search, Export and Erase ([01 §4](prd/01-architecture.md)); the compile-time registry.
  - **Minimal tenancy schema**: `users`, `households`, `memberships`, `module_enablement`, `module_grants`. Their flows come in items 8–10.
  - **Tenant middleware**:
    - Resolves `{household_id}` from the path and checks membership, returning `404` if there is none.
    - Computes the effective level as min(enablement, grant) and carries it in the request context.
    - Has an entitlement hook, filled in by item 16.
    - Opens each of the request's transactions with `SET LOCAL app.household_id`, `app.user_id` and `ROLE household_app`; a transaction is a unit of work that commits before the handler answers ([ADR 0005](adr/0005-tenancy-registry-and-row-level-security.md)).
  - **Grant check**: `grant.Require(ctx, module, level)`. `404` for `none` or disabled; `403` only for *"can see, may not do"*.
  - **Policies**: an RLS policy template, plus the membership policy keyed on `user_id`.
  - **Architecture tests 1, 2 and 3**:
    - 1: cross-module imports;
    - 2: tenant tables have `household_id`, RLS and `FORCE`;
    - 3: every module implements Export and Erase.
  - **[FR-NF4](prd/07-nonfunctional.md) isolation test**: reads another household's rows by primary key and expects zero, on every commit.
- **Inputs**
  - PRD: [01 §2, §4, §5, §10](prd/01-architecture.md); [02 §5, §7](prd/02-identity-and-access.md); D-1–D-4, D-16
  - home: `platform/registry`, `arch/arch_test.go`, `bootstrap`
- **Done when** a test module in `testdata` proves each of the following:
  - `404` for `none` and for a disabled module.
  - A handler missing its `WHERE` returns an empty set.
  - A cross-tenant insert errors.
  - Each architecture test fails on its violation.
- **PR:** [#6](https://github.com/kareltilcer/household/pull/6)

### 4 · Sync-ready schema, entity registry and the mutation spine · `done`

Phase 0 · after 3 · size L · **gate G-A (schema half)**

- **Scope**
  - **Base columns** as migration helpers and Go types:
    - UUIDv7 `id`, supplied by the client;
    - `household_id`;
    - `version`;
    - `created_by/at` and `updated_by/at`;
    - `deleted_at`.
  - **Sync-entity registry.** Each entity declares:
    - its merge policy (one of five);
    - its `state_set` key and resolution;
    - any `additive` cross-row invariant;
    - its redacted projection ([D-88](prd/09-decisions.md));
    - its access fields;
    - its offline-write flag ([D-84](prd/09-decisions.md)).
  - **`sync_changes`**, partitioned monthly, with the [03 §2.2](prd/03-platform-strands.md) indexes.
  - **Audit spine**: `audit_events` and `audit_changes` with `summary_key`/`summary_args` and field diffs (FR-AU1–3). `actor_type` is left extensible for the AI-assistant hook.
  - **Mutation spine**: one service-layer entry point that writes the row, the audit event and the change row(s) in one transaction, with `meta.via`.
  - **Concurrency and retries**: ETag/`If-Match` helpers; `Idempotency-Key` storage for unsafe REST methods.
  - **Architecture tests**:
    - 4: a mutating route that writes no audit event or no change;
    - 5: an entity with no policy or predicate, or a `state_set` with no key or resolution;
    - 9: an OpenAPI create schema for a sync entity that does not require `id`.
- **Inputs**
  - PRD: [01 §3, §10](prd/01-architecture.md); [03 §1, §2.2, §2.5](prd/03-platform-strands.md); [10-sync-risk §1, §3](prd/10-sync-risk.md); D-22–D-26, D-82, D-84, D-88, D-91; [future/ai-assistant.md](prd/future/ai-assistant.md) (hooks)
  - home: `platform/audit`
- **Done when**
  - Each of architecture tests 4, 5 and 9 fails on its violation.
  - A spine test proves the row, the audit event and the change commit and roll back together.
- **PR:** [#7](https://github.com/kareltilcer/household/pull/7)

### 5 · Sync engine spike and written verdict · `done`

Phase 0 · after 4 · size M (timeboxed) · **gate G-A**

- **Scope**
  - **Candidates**: PowerSync and ElectricSQL, self-hosted in docker. Replicache/Zero are checked on paper for licence, maturity and React Native support. **Verify each project's current state; do not trust summaries.**
  - **Hardest cases**: run scenario 3 (two offline checks of one shopping item) and scenario 7 (a grant revoked offline) against each, on item 4's schema.
  - **What to judge**:
    - Can it express all four access axes?
    - Does access loss propagate as deletion?
    - Do writes go through our own API?
    - How good is the React Native story?
    - Can it be self-hosted in the EU?
  - **Isolation**: spike code lives in `spikes/` and is deleted before merge.
- **Inputs**
  - PRD: [10-sync-risk §2](prd/10-sync-risk.md); [03 §2](prd/03-platform-strands.md); D-83; [05 §1](prd/05-privacy-and-compliance.md) (residency)
- **Done when**
  - `docs/adr/0001-sync-engine.md` records the verdict and the requirement that forced it.
  - If the verdict is *adopt*, items 12, 13, 17 and 18 are rewritten in the same PR (Q2).
- **PR:** [#8](https://github.com/kareltilcer/household/pull/8)

### 6 · Shared packages: API client, i18n, vectors and money · `done`

Phase 0 · after 2 · size L

- **Scope**
  - **`@household/api`**:
    - Generated on build with openapi-typescript and openapi-fetch.
    - Exhaustive `ProblemCode` handling, and typed `402`/`404`/`409`/`410`. A `409` is `version_conflict` with `current`, or, from any operation that accepts `Idempotency-Key`, `idempotency_in_progress` without it (item 4), whatever the operation declares.
    - `If-Match` and `Idempotency-Key` middleware.
    - UUIDv7 generation.
  - **`@household/i18n`**:
    - ICU MessageFormat catalogs for `en`, `cs`, `sk`, `de` and `pl`.
    - Typed keys, so a missing key fails compilation.
    - A pseudo-locale build target.
    - Slavic plural test cases.
    - The `review/` ledger.
    - A Go renderer (`internal/platform/i18n`) that reads the same catalogs for email, push and audit summaries.
  - **Architecture test 7**: an ESLint rule forbidding user-visible string literals in `apps/*`.
  - **`@household/test-vectors`**: a JSON vector format with runners in Go and in Vitest.
  - **`@household/domain` v0**: money as minor units, with ISO 4217 exponents and rounding half-up exactly once. Deterministic minor-unit splitting follows the household's member order ([D-57](prd/09-decisions.md)).
- **Inputs**
  - PRD: [06 §1](prd/06-clients.md); [03 §9](prd/03-platform-strands.md); D-29, D-37, D-57
  - Design: `fixtures.js` (module names), `screencopy.js` (cs/de titles as catalog seeds), `finance.js` `tenEuroRun`
- **Done when**
  - A missing key breaks the type check.
  - The €10 three-way split (3,34 / 3,33 / 3,33, in every participant order) passes in Go and TS from one JSON file.
- **PR:** [#9](https://github.com/kareltilcer/household/pull/9)

### 7 · Reference-data pipeline and country profiles · `done`

Phase 0 · after 3, 6 · size M

- **Scope**
  - **Source files**: YAML/JSON under `reference-data/` with JSON Schemas enforced in CI. Every field carries a `source` and a per-language value.
  - **Loader**: versioned and idempotent, writing into global reference tables. It is the path by which data changes ship without a code change ([D-61](prd/09-decisions.md), [D-70](prd/09-decisions.md)); admin editing arrives in item 21.
  - **Country profiles** for CZ, SK, DE, PL and UK:
    - base currency and default VAT;
    - public-holiday source;
    - default units;
    - first day of week;
    - inspection naming (STK/TK/HU/przegląd/MOT);
    - the pointer to each country's document-type set.
  - **Units and conversions** for metric and imperial.
  - **Read endpoints** for authenticated users, added to `openapi.yaml` (Q11).
  - **Module sets come later**: each module's own reference sets (categories, templates, presets) land with that module.
- **Inputs**
  - PRD: [03 §9](prd/03-platform-strands.md) (the localisation table); [01 §2.4](prd/01-architecture.md); D-61, D-70
- **Done when**
  - CI rejects a record missing a language or a source.
  - The loader is idempotent.
- **PR:** [#10](https://github.com/kareltilcer/household/pull/10)

### 8 · Identity I — accounts, web sessions, email, rate limits · `done`

Phase 0 · after 3, 6 · size L

- **Scope**
  - **Registration** (FR-ID1):
    - Passwords hashed with Argon2id and at least 12 characters.
    - Breached-password screening against a **local** k-anonymity dataset, including the dataset build script ([D-12](prd/09-decisions.md)).
    - An enumeration-resistant `202` whose email differs by case.
  - **Email verification**: a 24-hour single-use token. An unverified account works but cannot extend outbound trust.
  - **Web sign-in** (FR-ID3, `client_type=web`): the `__Host-hh_session` cookie; double-submit CSRF plus an Origin allowlist; sliding expiry; logout. `client_type=mobile` is refused `422` until item 9.
  - **Password reset** (FR-ID6): a 1-hour token that invalidates everything and confirms by email to the old address.
  - **Password change** (`POST /auth/password`): the current password, counted against the account as a sign-in failure is; every other session ends. It keeps no `Idempotency-Key`, whose fingerprint would be a fast hash of the passwords (D-97).
  - **Rate limiter**: per IP, account, user and household, per the [02 §9](prd/02-identity-and-access.md) table, returning `429` with `Retry-After` and a problem document.
  - **Email transport**: SMTP, with templates rendered from i18n keys in the recipient's language.
  - **Profile and sessions**:
    - `/me` profile and preferences: language, timezone override, first day of week. The account-wide quiet hours are `/me/notification-preferences` without a household, which item 15 builds whole.
    - `/me/sessions`: list, revoke, and sign out everywhere (FR-ID7).
  - **Audit context** (item 4): a request the session cookie authenticates records `via: web` (`mutation.WithVia`), and the spine writes the actor's display name as each audit event's `actor_label`.
  - **`Idempotency-Key` outside a household** (item 4): `idempotency_keys` holds a member's keys in their household, so the `/auth` and `/me` routes, and item 10's household create, need keys of their own; decide where they live and serve the same answers ([ADR 0006](adr/0006-sync-ready-schema-and-the-mutation-spine.md)).
- **Inputs**
  - PRD: [02 §1–2, §9](prd/02-identity-and-access.md); [07 §4](prd/07-nonfunctional.md); D-12, D-13
  - API: tags `auth` and `me`
  - Design: A-1–A-4, A-9, A-10, A-12, A-19; `auth.js` (the 12-message failure register with enumeration verdicts)
  - home: `platform/auth` (sessions and CSRF)
- **Done when**
  - Enumeration tests assert identical response shapes.
  - Limits are tested.
  - The implemented operations are off `contract_pending`.
- **PR:** [#11](https://github.com/kareltilcer/household/pull/11)

### 9 · Identity II — mobile tokens, MFA, Google and Apple, client versions · `done`

Phase 0 · after 8 · size L

- **Scope**
  - **Mobile token pair** (FR-ID3 mobile, FR-ID4):
    - An access token signed EdDSA, valid 15 minutes, carrying only `sub`, `sid`, `iat`, `exp` and `client` ([D-15](prd/09-decisions.md)).
    - A rotating, single-use refresh token. Reusing one revokes its whole family and sends an email ([D-14](prd/09-decisions.md)).
  - **Devices**: registration; a push-token slot; revoking a device ends its sync, and its replica is discarded on next contact (FR-ID7; hook for item 13: it is issued no further PowerSync token, and item 18's client discards the replica on that refusal).
  - **MFA** (FR-ID5): TOTP plus recovery codes, required on a new device.
  - **Federated sign-in** (FR-ID2): Google and Apple via OIDC with PKCE. `sub` is the stable identifier, and linking to an existing account needs an explicit confirmation.
  - **Account-takeover notice.**
  - **Client versions** ([06 §7](prd/06-clients.md), FR-HA18): a client-version header and a minimum supported version. Below it, a blocking *please update* problem is returned.
  - **Audit context** (item 4): a request the access token authenticates records `via: mobile` (`mutation.WithVia`).
  - **Item 8's account routes for a device** ([ADR 0009](adr/0009-accounts-sessions-throttles-and-the-breach-corpus.md)): `POST /auth/login` with `client_type=mobile`, which item 8 refuses `422`; `POST /auth/logout` and `DELETE /me/sessions` end the device's token family too; a handler can mark its response unstorable, so that the account's `Idempotency-Key` never keeps a TOTP secret or recovery codes; the session list's `approximate_location`, null until an IP-to-place source is chosen (Q14), which the takeover notice needs as well.
- **Inputs**
  - PRD: [02 §2](prd/02-identity-and-access.md); [06 §7](prd/06-clients.md); [17 FR-HA18](prd/modules/17-household-admin.md); D-7, D-14, D-15
  - Design: A-5–A-8, A-11, A-13, A-21, C-57
- **Done when** each of these is tested:
  - reuse detection;
  - the MFA new-device rule;
  - OIDC against a mock identity provider;
  - the please-update response.
- **PR:** [#12](https://github.com/kareltilcer/household/pull/12)

### 10 · Households, memberships, invitations and grants · `done`

Phase 0 · after 4, 7, 8 · size L

- **Scope**
  - **Create a household** (FR-HH1): any user can. The creator becomes owner and payer of record; a trial hook fires; an 8-character household code is generated and can be regenerated.
  - **Invitations** (FR-HH2/3):
    - By email (14 days) or link (72 hours, `max_uses`).
    - Each carries the proposed role and grants, plus a starting-dashboard placeholder.
    - Accept or decline; a decline notifies the inviter.
    - Limited to 20 per day, per household: a `ratelimit.Limit` on item 8's throttles.
    - Only a verified inviter may send one (FR-ID1): `users.email_verified_at`, refused `403 account_unverified`.
  - **Roles and grants**:
    - Roles: owner, member and child.
    - Module enablement: disabling returns `404`, emits a retraction hook and keeps the data.
    - Four grant levels with the FR-AC3/AC4 defaults, and child caps.
  - **Changing access**: a role or grant change emits a retraction hook plus the [D-78](prd/09-decisions.md) notification hook.
  - **Leaving and removal** (FR-HH4–6):
    - Leave refuses with `last_owner` and `billing_payer`, both reported together.
    - Remove member.
    - Transfer ownership.
  - **Household settings**: timezone, locale, units and first day. A country change updates reference data, not history (FR-HA1). A new household's units and first day of week default to its country's profile (item 7), and a country without one is refused; `first_day_of_week` counts 0 as Sunday.
  - **`Idempotency-Key`** (item 4): the household-scoped routes here are not a module's, so they mount `idempotency.Middleware` themselves; creating a household uses item 8's keys outside a household.
  - **Deferred**: the base-currency change lands in item 62.
- **Inputs**
  - PRD: [02 §3–5, §7](prd/02-identity-and-access.md); [17 FR-HA1, HA3–HA8, HA17](prd/modules/17-household-admin.md)
  - API: `/households`, `…/invitations`, `…/members`, `…/modules`, `…/ownership`, `…/leave`
  - Design: A-22–A-26, A-36, C-49–C-51; `household.js` (grant wording); `nav.js`; `fixtures.js` (five personas)
- **Done when**
  - The five personas' grants resolve exactly as in `fixtures.js`.
  - Accepting an invitation yields exactly the proposed grants.
  - The REST surface returns `404` for `none`.
- **PR:** [#13](https://github.com/kareltilcer/household/pull/13)

### 11 · Child profiles · `done`

Phase 0 · after 9, 10 · size M

- **Scope** (FR-CH1–5):
  - **Profile**: display name, optional birth year and avatar, and a hashed 4–6-digit PIN.
  - **Sign-in**: household code + profile + PIN, issuing mobile tokens: `device.Store.SignIn` for the device the body names, as item 9's `identity.admit` issues them, with no second step (FR-ID5).
  - **Shared tablet**: each profile that uses it signs in on it once with its PIN, the tablet holding one sign-in per profile, and switches between them without re-authentication ([D-104](prd/09-decisions.md), which rejected a sign-in an owner issues for the tablet).
  - **Lockout**: **10 wrong PINs lock the profile until an owner unlocks it** (Q9). An owner can reset the PIN.
  - **Graduation**: an email is attached and verified, and the content is kept.
  - **Restrictions**: no `manage`; Finance capped at `view`; no inviting, no settings, no deleting other people's items.
  - **Item 10's surface** ([ADR 0011](adr/0011-households-as-the-platforms-own-module.md)): a profile is a membership, `admin.membership`, written through `internal/platform/household` with `household.Defaults(access.Child, …)` (FR-AC4), whose `Membership.child` item 10 answers empty; the sign-in finds the household by `households.join_code`, which no policy lets a caller read before a household's context yet, so this item adds that read.
  - **Privacy flags**: excluded from analytics ([D-18](prd/09-decisions.md)); a child's private root is readable by an owner (flag consumed by items 43 and 46).
- **Inputs**
  - PRD: [02 §6](prd/02-identity-and-access.md); [05 §7](prd/05-privacy-and-compliance.md); D-17–D-19
  - API: `…/children/*`
  - Design: A-14–A-18; `account-ui.js` (test PIN and household code)
- **Done when**
  - Lockout and unlock are tested.
  - Granting a child `manage` returns `422`.
  - Graduation keeps the child's content.
- **PR:** [#14](https://github.com/kareltilcer/household/pull/14)

### 12 · Conformance suite · `done`

Phase 0 · after 4, 10 · size L · **gate G-B (harness)**

- **Scope**
  - **Harness**: a multi-client conformance suite in TypeScript (`packages/sync`, its `conformance/` directory) against the real stack in containers: PostgreSQL with logical replication, PowerSync and the API ([ADR 0001](adr/0001-sync-engine.md); the spike's harness is the starting point). It has:
    - N clients on `@powersync/node`, each with its own SQLite file;
    - partitions scripted two ways: disconnecting a client, and a network that refuses requests and loses responses in flight;
    - reordering as the order in which clients reconnect and upload, scripted per scenario, and within one client, whose connector drains its queue in order, a held `deferred` or `entitlement` mutation replayed after a later write to the same row ([10 §4](prd/10-sync-risk.md));
    - duplicate delivery by replaying an upload batch;
    - clock skew through the mutation's `client_time`;
    - a seeded random-number generator for every schedule.
  - **Scenarios**: all **18 scenarios** of [10 §4](prd/10-sync-risk.md) as executable specifications, with the six invariants checked after each. Convergence compares every replica with the server's rows.
  - **Fuzzing**: seeded random operation schedules over the same invariants; a short run on each change, a long one nightly.
  - **CI**: a job that brings the stack up, with PowerSync's image pinned beside PostgreSQL's.
  - **Before the engine**: scenarios start skipped, and items 13, 16 and 17 switch them on.
  - **Stand-ins**: until items 13 and 17 land, the suite runs against stand-ins of its own, as the spike's harness did: a hand-written sync configuration, a test signing key PowerSync is configured with, a replication role and publication over test tables, and a stand-in push endpoint (the spike's was its Go `backend/`, which wrote through the real spine). Items 13 and 17 replace each with the real one.
  - **Its own connector**, as the spike's harness had, doing what item 18's will: completing every answered mutation, and holding and replaying an `entitlement` rejection (scenario 14) and a `deferred` one (scenario 8). Items 16 and 13 turn those scenarios green before item 18 exists, and item 17 keeps them so; item 18's connector then replaces it.
- **Inputs**
  - PRD: [10 §4, §7](prd/10-sync-risk.md); [03 §2](prd/03-platform-strands.md); D-93
  - ADR: [0001](adr/0001-sync-engine.md), and the spike's `spikes/sync-engine` in the commit that added it: `harness/`, and the `sql/`, `powersync/` and `backend/` its stand-ins came from
  - Design: `sync.js`, `conformance.js`
- **Done when**
  - All 18 scenarios are encoded with explicit expected outcomes.
  - A deliberately broken connector and a deliberately broken stream are caught against the stand-ins: one that retries a rejection forever, and one that leaks another household's rows. This proves the suite can fail.
- **PR:** [#15](https://github.com/kareltilcer/household/pull/15)

### 13 · Sync engine I — PowerSync, generated streams and the push · `done`

Phase 0 · after 9, 12 · size XL

- **Scope**
  - **Deployment** of PowerSync ([ADR 0001](adr/0001-sync-engine.md)):
    - The Open Edition service, its image pinned, in docker compose beside a PostgreSQL with `wal_level=logical`. Item 30 carries it to staging and item 88 to production.
    - Its bucket storage in a PostgreSQL database of its own, whose credential only the service holds: it keeps every household's replicated rows outside row-level security ([05 §6](prd/05-privacy-and-compliance.md)).
    - A replication role with `REPLICATION` and `BYPASSRLS`, created by `bootstrap`, and the `powersync` publication. PostgreSQL lets only an administrator holding both grant them ([ADR 0004](adr/0004-database-roles-migration-blocks-and-test-databases.md)), so under one that lacks them `bootstrap` fails and names what is missing. `BYPASSRLS` grants no privilege, so the role reads through a `SELECT` grant on each table in the publication and on no other, since it reads past row-level security. The role and the bucket storage's credential are the one exception to [D-3](prd/09-decisions.md) ([01 §2.3](prd/01-architecture.md)): item 21's no-content-access test leaves the role out, and the read-path isolation test below holds it.
    - `REPLICA IDENTITY FULL` on each replicated table, as the spike ran them, unless the suite shows PowerSync correct without it.
    - Telemetry sharing off, and the replication connection's `debug_api` off, since it opens the admin API's `execute-sql`, which reads the database through the replication role; both held by a test on the configuration.
    - A runbook for the replication slot: lag, and the bound set by `max_slot_wal_keep_size`.
    - Its failure behaviour ([07](prd/07-nonfunctional.md) FR-NF3), recorded in the PRD: what a client shows and keeps while PowerSync is unreachable and the API is not, and how replication recovers a lost slot, after a restore or past `max_slot_wal_keep_size`. Item 89 tests it.
  - **Credentials**: a contract operation hands a client PowerSync's URL and a token of its own, including for a web session, and refuses a revoked device (item 9's hook: a device with no live `device_sessions` row). The token is signed with item 9's EdDSA keys, `HOUSEHOLD_TOKEN_KEYS`, which the API publishes as a JWKS for PowerSync (`token.Keys.JWKS`); the spike signed HS256, so this is the first proof. It carries `sub` and the `aud` PowerSync checks against its configured audience, which item 9's access token, carrying only the claims item 9 lists, does not, and the API accepts no token with that audience. The token's lifetime bounds how long a revoked device keeps syncing ([FR-ID7](prd/02-identity-and-access.md)), so it is set here and kept short. The contract change is deliberate and cites D-93.
  - **Streams generated from the registry**: each sync entity's declared access (item 4's `sync.Entity`) becomes its stream definitions, generated by `go generate` into the committed sync configuration. An architecture test holds the committed configuration equal to the generated one, and every table a stream reads in the `powersync` publication, at the replica identity above and readable by the replication role, so a later module's table cannot be left out.
    - The grant is two streams: an owner of an enabled module, and a member whose grant on an enabled module is above `none`.
    - Every table a stream's subquery reads is looked up by the caller or by the subscribed household, never by constants alone: PowerSync caps one connection's parameter results at 1000 (`PSYNC_S2305`), and item 12's stand-in streams, whose module enablement was looked up by module alone, refused every connection once 250 households enabled the module. The generator is held to it by a test, and the suite's self-test `keeps each stream to the caller and the household` runs it against 300 households.
    - Admin's entities (item 10, [ADR 0011](adr/0011-households-as-the-platforms-own-module.md)): the settings, the memberships with their grants, and the module enablement reach every member of the household whatever their grant on `admin`, a child's default being `none`; the invitations reach the members granted `admin`. `sync.Access` has no axis for the first yet, so this item adds one.
    - The household is a subscription parameter, so there is one replica per household (D-4).
    - Item 18's withdrawn state needs a client to tell a row it lost access to from one another member deleted, which a stream that drops tombstones, as the spike's did, does not allow.
  - **Tenant isolation on the read path**: a test connects a member of two households to one of them and asserts that none of the other's rows arrive, nor any row of a household they are not in. The spike's members each belonged to one household, so its runs could not show that the subscription parameter bounds a replica ([ADR 0001](adr/0001-sync-engine.md)). This is FR-NF4's read-path twin, since the replication role bypasses row-level security.
  - **Push** (`POST …/sync/mutations`):
    - An ordered batch, one transaction per mutation.
    - Outcomes `applied`/`merged`/`conflict`/`rejected`/`deferred`, each but `applied` always carrying a `code` ([10 §6](prd/10-sync-risk.md)).
    - Per-mutation idempotency held for 7 days.
    - Limits of 500 mutations per batch and 60 batches per minute per device.
    - Client clocks clamped to ±24 hours and flagged.
    - Offline-write flags checked per entity.
  - **Merge policies**:
    - `additive`, including the cross-row invariant path that answers `monotonicity_violation`;
    - `state_set`, keyed, resolving by `latest_client_time` or `monotonic`;
    - `lww_field`, by server receipt.
  - **One service layer** shared by REST and sync: each applied mutation goes through `mutation.Apply`, recording `via: sync`.
  - **The conformance suite** (item 12, [ADR 0013](adr/0013-conformance-suite-stand-ins-and-the-oracle.md)) moves onto the engine: the conformance module (`server/internal/conformance`) registered in the API the suite runs against, its entities' streams generated with the rest, the stand-in's push, credentials, token and hand-written configuration replaced, an engine target beside the stand-in's (`packages/sync/conformance/harness/target.ts`), and the scenarios below switched on in `scenarios/index.ts`. The contract caps a batch with `maxItems: 500`, so the edge answers a larger one `422` before the `413` the operation declares: settle which.
  - **Contract**: `getSyncChanges` and `postSyncSnapshot`, which PowerSync's protocol replaces, are removed from `openapi.yaml` and from `contract_pending`, citing D-93. PRD 03 §2.3 is amended to match, as is the contract's opening description, which names both paths as the offline-first data path. So are `Device.sync_cursor` and the descriptions of `deleteMeSessions` and `deleteMeDevicesByDeviceId`, which invalidate a device's sync cursor the server no longer holds. The `/platform/households` description, which says no database role bypasses row-level security, names the replication role as the exception, as PRD 05 §6 does.
- **Inputs**
  - PRD: [03 §2.3–2.5, §2.8](prd/03-platform-strands.md); [10 §3](prd/10-sync-risk.md); [07 §3](prd/07-nonfunctional.md) (FR-NF3); [01 §2.3](prd/01-architecture.md); [02 FR-ID7](prd/02-identity-and-access.md); [05 §6](prd/05-privacy-and-compliance.md); D-3, D-22–D-26, D-84, D-90, D-93
  - ADR: [0001](adr/0001-sync-engine.md)
  - API: tag `sync`
- **Done when** the suite passes scenarios 1, 3, 4, 5, 8, 9, 10, 15 and 17, plus the `state_set` half of 13.
- **PR:** [#16](https://github.com/kareltilcer/household/pull/16)

### 14 · Files and storage metering · `planned`

Phase 0 · after 4, 10 · size L

- **Scope**
  - **S3 client**, with RustFS in dev.
  - **Upload pipeline** (FR-FL1):
    - a 100 MB cap and sniffing from the bytes;
    - blocked and active types;
    - a quota check returning `402` with the amount over;
    - SHA-256 and write-once keys `h/{hh}/{module}/{entity}/{variant}`;
    - the metadata row, audit event and change in one transaction;
    - `attachment_status`.
  - **Delivery** (FR-FL2): per-object pre-signed URLs valid for minutes ([D-9](prd/09-decisions.md)); `nosniff`; active types download-only.
  - **Derived variants** (FR-FL3): a Postgres-backed job queue after commit produces thumbnails, scaled images, PDF first pages, and office-to-PDF via a LibreOffice headless sidecar with a timeout (Q14).
  - **Storage catalog** (FR-ST1): tables, prefixes and attribution.
  - **Usage sampling** (FR-ST2): as `household_meter`, by module and member, with object and row counts. Item 15's scheduler runs it nightly.
  - **Storage picture API** (FR-ST4, HA14): the largest items, and what deleting something would recover.
  - **Fair-use counters.**
  - **Avatars**: the upload behind `Me.avatar_url`, which `PATCH /me` refuses to set to anything but null until then (item 8), and behind a child profile's `avatar_url`, which `postChildren` refuses the same way (item 11), with the profile list's (`postAuthChildProfiles`).
- **Inputs**
  - PRD: [01 §8](prd/01-architecture.md); [03 §3, §8](prd/03-platform-strands.md); [04 §4–5](prd/04-billing-and-entitlements.md); D-9, D-25, D-28; FR-NF3
  - Design: C-54; `household.js` (storage arithmetic)
  - home: `platform/{blobstore,storage}`
- **Done when**
  - The refusal matrix is tested: `413`, `415`, `422`, `402`, `502`.
  - Samples break down by module and member.
  - No URL is issued before authorisation.
- **PR:** —

### 15 · Scheduler and notification transports · `planned`

Phase 0 · after 10, 6 · size L

- **Scope**
  - **Scheduler**:
    - In-process, with an advisory-lock leader so only one instance fires.
    - A job registry for modules.
    - Household-timezone resolution that is DST-safe.
    - The expiry sweep with [03 §5](prd/03-platform-strands.md)'s retention table, and item 8's tables: ended `sessions`, spent and expired `email_tokens`, `auth_throttles` whose window and block have passed, and `account_idempotency_keys` past seven days. And item 9's: `refresh_tokens` used a month ago, `device_sessions` revoked and without tokens, ended or expired `mfa_challenges`, expired `mfa_trusts`, and used or expired `oauth_states`.
    - Invitation and token expiry.
    - Item 14's usage sampling, nightly (FR-ST2).
  - **Transports**:
    - Web Push (VAPID) subscriptions on `/push/*`.
    - Expo push tokens per device, in item 9's `devices.push_token`, which `Device.push_enabled` reads.
    - Email, over item 8's `mail.SMTP`, which sends from an in-memory queue that a restart loses ([ADR 0009](adr/0009-accounts-sessions-throttles-and-the-breach-corpus.md)); a notification that must survive one needs a durable queue here.
  - **Preferences**: four categories plus a master switch and quiet hours, per member per household, and the account-wide defaults `/me/notification-preferences` answers without a household.
  - **Direct notifications** for modules: assignments, mentions, and access changes ([D-78](prd/09-decisions.md)), the last through item 10's `household.Hooks.Changed`. Item 10's invitation and decline emails move onto the transport, and the expiry sweep takes invitations past their time. The owners are told when ten wrong PINs lock a child profile (A-18's *ask Jana*), from item 11's `admin.child.lock` event, and item 11's graduation email moves onto the transport with the invitations'.
  - **Filtering at send time**, per recipient, by grant and by privacy (FR-NT5).
  - **Delivery log** (FR-NT6): `404`/`410` from a push service deletes the subscription; repeated failure marks a device stale.
  - **Rendering**: in the recipient's language, with coalescing, through item 6's Go renderer (`internal/platform/i18n`). Its ICU subset formats no date, time or amount of money yet ([ADR 0007](adr/0007-shared-packages-client-catalogs-and-vectors.md)): this item adds the ones its messages need to both renderers and to `vectors/i18n.json`, or passes them pre-formatted.
  - **Deferred**: rules and digests land in item 53.
- **Inputs**
  - PRD: [03 §4–5](prd/03-platform-strands.md); [06 §6](prd/06-clients.md); D-78
  - Design: F-20; `notify.js`
  - home: `platform/{scheduler,push}`, `modules/admin` (listener)
- **Done when** each of these is tested:
  - two instances fire a job once;
  - quiet hours defer delivery;
  - a grant of `none` suppresses delivery;
  - outcomes are logged.
- **PR:** —

### 16 · Entitlements and the 402 gate · `planned`

Phase 0 · after 10, 13, 15 · size M

- **Scope**
  - **Billing schema.** Item 10's `household.Hooks.Created` starts the trial, in the transaction that creates the household, and the `entitlement` of `Household` and `HouseholdSummary`, which item 10 leaves out, is filled in. The households a user may own (five, [04 §5](prd/04-billing-and-entitlements.md)) are among the fair-use ceilings, where the contract's `postHouseholds` answers `403` and 04 §5 a `429`: settle which.
  - **State machine**: eight states with their precedence (`restricted` against a lapse).
  - **The gate** (FR-BI1): `402` on unsafe methods in non-writing states, with a **closed** exemption list (billing, exports, deletion, leave, restriction). `grace` blocks uploads only.
  - **Restriction** (FR-BI7, [D-87](prd/09-decisions.md)): owner-set, owner-lifted, with its own problem code, and banner data naming who restricted the household and when.
  - **Hourly transitions**: trial, dunning and grace, plus the [DD-9](design/08-decisions.md) trial-notice stages.
  - **Retention**: a 12-month countdown with three warnings, then deletion handed to item 20.
  - **Queued mutations** (FR-BI2): `entitlement` rejections are held and replayed if the subscription resumes (scenario 14).
  - **`suspended` on the replicated path** ([D-93](prd/09-decisions.md)): PowerSync's reads pass no tenant middleware, so the Sync ✗ of [04 §3](prd/04-billing-and-entitlements.md) is held on item 13's credentials and streams as well, and a suspended household replicates nothing further to any device, a new one included. Whether its replicas are also emptied, which [03 §2.6](prd/03-platform-strands.md) does not list as access loss, is decided here and recorded in the PRD.
  - **Fair-use ceilings** ([04 §5](prd/04-billing-and-entitlements.md)): a warning at 80 %, then `429`.
  - **Banner API.**
  - **The conformance suite** ([ADR 0013](adr/0013-conformance-suite-stand-ins-and-the-oracle.md)): switches on scenario 14 and `no-loss-lapse`, with the target's `setEntitlement`, and settles the code an entitlement rejection carries, `entitlement` in PRD 10 §4 and `entitlement_read_only` among the problem codes; the suite's connector holds either.
- **Inputs**
  - PRD: [04 §1, §3, §5](prd/04-billing-and-entitlements.md); D-30–D-32, D-87, D-93
  - Design: DD-9, DD-15; A-30, A-31; `household.js` (the eight-state table)
- **Done when**
  - A table-driven test over state × method × path proves the exemption list exactly.
  - Scenario 14 is green.
- **PR:** —

### 17 · Sync engine II — conflicts, retraction, visibility, audiences, observability · `planned`

Phase 0 · after 13, 14, 16 · size XL · **gate G-B**

- **Scope**
  - **Remaining merge policies**: `lww_row` with the loser preserved; `strict_version` conflicts carrying the server's row, against the base version the client sends.
  - **Retractions** for all five causes of access loss, each a row leaving every bucket the member holds, wired to item 10's hooks (`household.Hooks.Lost`, run in the transaction of the change), proven in the suite, and written into FR-SY7 ([03 §2.6](prd/03-platform-strands.md)) in place of its `retract` rows:
    - a grant lowered to `none`;
    - removal from an audience;
    - an item moved from shared to private;
    - removal from the household;
    - a module disabled.
    - **Not** a lapsed entitlement.
  - **[D-88](prd/09-decisions.md) visibility**:
    - Private rows reach their owner, and so does every row a private item or private root bounds, such as a private note's body or a private event's overrides. A stream reads each entity's own table, not the feed row on which the module set the visibility and owner it took from the parent, so each such row carries them itself, rewritten when the parent moves between shared and private, or its stream reaches them through the parent in a subquery the suite shows correct beside the grant's. A rewrite of those two fields alone is not an edit of the row, for the reason given for an audience's readers below.
    - Each entity's redacted projection is declared on its `sync.Entity` as a column list, replacing item 4's `Redact` function, beside the `Columns` item 13 added for what a full row sends. It is generated into a stream that writes a client table of its own.
    - Item 13's generator (`sync.Streams`) withholds every entity whose access includes `Owner` or `Audience` from every stream, so that none reaches a replica until this item generates its visibility and audience streams.
    - That stream reaches every member with the grant, the owner included, and where an audience bounds the row, only its readers; the client shows the owner's full row over it.
  - **[D-90](prd/09-decisions.md) audiences**:
    - Each audience row keeps its readers on the row: the members whose floor it is at or above. That is every row the audience bounds, each with a stream of its own (in Chat the message, its body, its reactions and its attachments' metadata), since a row resolved through the audience's membership instead would reach the whole audience, below the floor included.
    - The mutation that writes the row writes them, and the one that changes the audience rewrites them. The streams test the caller against them: `auth.user_id() IN readers` on the row, or a subquery on a reader table.
    - Removal from the household (item 10's hook) takes the member out of the readers of every audience they were in: readers left behind would reach them again if they were re-added with the grant.
    - A rewrite of the readers alone is not an edit of the row. Item 4's `touch_entity` bumps `version` and sets `updated_by` on every update, so as an ordinary update it would turn each queued or `If-Match` edit to a row of the audience into a conflict (a `strict_version` event) or a preserved loser (an `lww_row` body). Keep the readers out of the version, which changes the trigger ADR 0006 decided and is therefore recorded in a new ADR (ADR 0006 is accepted, so it is not rewritten), or in a reader table of their own, if the suite shows its subquery correct beside the grant's (the probes accepted it only alone, [ADR 0001](adr/0001-sync-engine.md)). [PRD 01 §3](prd/01-architecture.md) already notes that such a rewrite does not count as an update.
    - Scenarios 16 and 18 hold it.
    - An audience with no floor, a `member_shared` calendar, may be resolved through its member list in the stream instead, if the suite shows that subquery correct beside the grant's (no probe tried the two together). Record the choice and amend [04-calendar](prd/modules/04-calendar.md) Sync to match.
  - **The feed**: `sync_changes` has no reader under D-93, but the spine writes it until this item decides, and item 4 made its monthly partitions only three months ahead. Either:
    - name a consumer, and schedule the table's partition maintenance (`sync_changes_add_partitions`, moving any rows that reached the default partition into their month's before creating it) and its retention; or
    - stop the spine writing it (and taking its per-household lock), and drop it through an expand/contract migration.
    - Either way, record the choice in a new ADR (ADR 0006 is accepted, so it is not rewritten), and amend PRD 03 §2.2, 07 §1 and CLAUDE.md, and PRD 01 §3 and §10's check 4 if the write stops. Stopping the write before gate G-C passes (item 34) removes a write that G-C's fallback, building [03 §2](prd/03-platform-strands.md)'s engine, builds on, so the ADR weighs that.
    - The push's response requires `seq`, the feed sequence after the batch (`SyncMutationBatchResult`). It has no reader under D-93 and no source once the feed stops, so the contract drops or redefines it, citing D-93.
  - **Compaction**: PowerSync's compact job, scheduled nightly. Until it runs, bucket storage keeps the operations a row's later ones superseded, its earlier data among them, so once item 20 builds the nightly erasure job (FR-PR4) it runs compaction after that job, and a row erased under [05 §4](prd/05-privacy-and-compliance.md) leaves bucket storage the night it leaves the database, not at a later compaction.
  - **Divergence** ([D-85](prd/09-decisions.md)): PowerSync verifies bucket checksums at every checkpoint, which holds a replica to its buckets but not the buckets to PostgreSQL ([10 §5](prd/10-sync-risk.md)). Decide whether `postSyncDigest` stays for that, and if it does, the point in PostgreSQL's history it is computed at, since 10 §5 evaluates it at the client's feed cursor and a PowerSync client has none; what `postSyncReset` becomes, and what `getSyncState` reports now that the server holds no device's cursor or pending count. Amend the contract for each.
  - **Realtime**: PowerSync's connection carries synced data, so the socket's nudge has no reader. Its other frames still need a way to the client: Chat's payloads ([D-8](prd/09-decisions.md)), and the contract's `entitlement_changed` and `access_changed`, the second being how grants reach a client as derived capability state ([17 Sync](prd/modules/17-household-admin.md)). Decide for each whether `…/stream` keeps it or a synced table carries it, and amend the contract, PRD 01 §7 and PRD 07 §1's connection target, which names only the socket (40 000 at Year 3) and so none for PowerSync's connections. A socket that stays is built here as first planned: authenticated by cookie or JWT, and working across instances through PostgreSQL LISTEN/NOTIFY.
  - **Metrics hooks**: queue depth, conflict rate, divergence (checksum failures, and the digest's mismatches if it stays) and replication lag.
  - **The conformance suite** ([ADR 0013](adr/0013-conformance-suite-stand-ins-and-the-oracle.md)): switches on scenarios 2, 6, 7, 11, 12, `13-rotation`, 16 and 18 and the five `loss-*` cases, with the target's `compact` and `uploadAttachment` (item 14's upload). The suite reads scenario 2's *the loser is surfaced* as the later write answered `merged`, carrying the row: confirm it or rewrite the scenario. The audience and visibility rewrites this item builds replace the administrator's in the suite (`Admin`).
- **Inputs**
  - PRD: [03 §2.3, §2.5–2.7](prd/03-platform-strands.md); [10 §5–7](prd/10-sync-risk.md); D-8, D-85, D-88, D-90, D-93
  - ADR: [0001](adr/0001-sync-engine.md)
- **Done when** — this is **G-B**:
  - All 18 scenarios and a fuzz run are green; CI runs a short fuzz run per PR and a long run nightly.
  - The PR asks for a second-engineer review of the generated streams, the push and the retraction path ([10 §8](prd/10-sync-risk.md)).
- **PR:** —

### 18 · `@household/sync` client library · `planned`

Phase 0 · after 17, 6 · size L

- **Scope**
  - **Replica**: PowerSync's SDKs behind one interface: `@powersync/react-native` on op-sqlite (PL-5), `@powersync/web` on wa-sqlite over IndexedDB for the web's queued writes and cache ([06 §1](prd/06-clients.md)), and `@powersync/node` in tests.
    - The client schema is generated from the registry.
    - One database per household ([D-4](prd/09-decisions.md)), subscribed to its household's streams: the generated configuration's (item 13, `deploy/powersync/sync-config.yaml`), whose names the library generates from the registry as the conformance suite's manifest is.
  - **Connector**:
    - Credentials from item 13's operation. A device refused as revoked discards its replica ([FR-ID7](prd/02-identity-and-access.md)).
    - Each local write records what its mutation needs and a row write does not: a stable `mutation_id`, the `client_time` it was made at, its `base_version`, and any `action`. The spike carried a check's time in the `checked_at` column the check wrote, which serves one entity only, and stamped every other write with its upload time, which neither `state_set` resolution nor D-26's clamp can use.
    - The upload queue sent in order as `POST …/sync/mutations` batches, several queued transactions to a batch up to the 500-mutation ceiling: a device may send 60 batches a minute ([02 §9](prd/02-identity-and-access.md)), and one back from days offline can hold more transactions than that while PowerSync applies no checkpoint. One `Idempotency-Key` per batch, whose mutations stay fixed until it is answered: a retry sends the same batch under the same key, since a different body under a key already in use is refused `422` on the header, which locates no mutation. The batches a `413` splits it into are new batches with keys of their own, and a key is renewed only by the `409` rule below. An edit to a row still pending merges into its queued mutation ([06 §5](prd/06-clients.md)), and never changes a mutation a retry may already have sent.
    - Every answered mutation completed. Outcomes other than `applied` are recorded in a local-only table with the mutation each answers, since the next checkpoint replaces the local write: the conflict inbox shows the member's change from it ([06 §5](prd/06-clients.md)), and a rejection keeps what they typed (scenario 17).
    - A response that answers no mutation is not an answer. A `401` renews the API credential the push was sent with (not item 13's token, which the API refuses) and a `429` waits, both then throwing; a `413` splits the batch; a `422` rejects the mutation it locates ([ADR 0003](adr/0003-contract-enforcement-at-the-edge.md)) and sends the rest again; a `402` or a `404` answers every mutation in it alike, `entitlement` or `not_found`.
    - A `409 idempotency_in_progress` ([D-92](prd/09-decisions.md)) is thrown, so the batch is sent again; once D-92's five minutes have passed it is sent under a fresh key, and per-mutation idempotency (FR-SY5) answers each mutation from its stored result.
    - It throws only on a transport failure, a `5xx`, a `401`, a `409` or a `429`, since PowerSync applies no checkpoint while the queue holds anything.
  - **Per-row state**: synced, pending (the upload queue, or a `deferred` mutation held to replay, whose change the client shows over the row the next checkpoint writes), syncing (its batch in flight), conflict or rejected (the outcomes table), and withdrawn: a row that left the replica because access changed, which the client tells from one another member deleted ([03-patterns](design/03-patterns.md), *When access is withdrawn*). PowerSync removes both alike when a stream drops tombstones, as the spike's did, so this item and item 13 settle how the client tells them apart.
  - **Surfacing API** for the conflict inbox and for rejections ([DD-4](design/08-decisions.md)). Held mutations are kept and replayed: scenario 14's entitlement, and scenario 8's `deferred`.
  - **Connectivity and files**:
    - The client half of whatever item 17 kept: the socket's consumer, with backoff, and the digest, computed and posted periodically ([10 §5](prd/10-sync-risk.md)).
    - The attachment pending queue ([D-25](prd/09-decisions.md)).
    - Offline-write flags respected before a local write: a row that cannot be written offline shows *needs a connection*.
  - **The suite's connector** (`packages/sync/conformance/harness/connector.ts`, item 12) is replaced by this one, and its unit tests state ADR 0001's rules this one keeps. The suite records each write's mutation id, client time and base version as PowerSync's row metadata (`trackMetadata`, `_metadata`, a delete through `_deleted`), which this item may adopt.
- **Inputs**
  - PRD: [03 §2](prd/03-platform-strands.md); [06 §1, §5](prd/06-clients.md); [10 §5](prd/10-sync-risk.md); D-93
  - ADR: [0001](adr/0001-sync-engine.md)
  - Design: `sync.js` (the 7-step ladder, 4 visible shapes, 4 rejection reasons, 7 honesty situations); `Sync and Honesty.dc.html`
- **Done when**
  - The conformance suite's 18 scenarios pass through `@household/sync` on Node.
  - A queued write and the replica survive the database being closed and reopened before the queue drains ([03 §2.1](prd/03-platform-strands.md), *nothing is lost*). The spike never restarted a client, so this is the first proof.
  - The web build's replica and connector pass a smoke test in a real browser, and the React Native build typechecks against it.
- **PR:** —

### 19 · Stripe billing and storage blocks · `planned`

Phase 0 · after 16, 14 · size L

- **Scope**
  - **Subscriptions** on Stripe Billing (EU entity):
    - A customer per payer.
    - Annual and monthly prices per currency, from config: EUR and GBP from [04 §1](prd/04-billing-and-entitlements.md); **CZK and PLN need figures (Q1)**.
    - Payment Element on web: card, SEPA Direct Debit, Apple Pay, Google Pay; SCA. The `billing` operations are amended in the contract to match (Q17).
  - **Webhooks**: signature-verified and idempotent. They drive the state machine.
  - **Stored data**: a payment-method summary only.
  - **Invoices**: list, download and email.
  - **Dunning**: emails at 1, 3, 5 and 7 days, plus owner banners.
  - **Payer**:
    - Must be verified.
    - Take-over handshake (FR-BI6).
    - Proration.
  - **Storage blocks**: blocks = ceil(max(0, daily-average − 5 GB) / 10 GB), capped at 20, beyond which uploads get `402`. They are reported as metered usage.
  - **Transparency**: the projected charge (FR-BI4) and notices at 80 % and 100 %. Members and children never see billing (FR-BI5).
  - **Support actions** for item 21: extend trial, credit, re-issue invoice.
- **Inputs**
  - PRD: [04 §1, §4, §6](prd/04-billing-and-entitlements.md); D-31, D-33, D-34
  - API: tag `billing`
  - Design: A-27–A-29, C-55; `household.js`
- **Done when**
  - Stripe test-mode fixtures pass.
  - The block vectors hold: an 18 GB average is 2 blocks and €2; a 40 GB upload deleted the same day is about 1.3 GB on the average.
- **PR:** —

### 20 · Export, erasure and diagnostics · `planned`

Phase 0 · after 14, 15, 17 · size L

- **Scope**
  - **Exports** (FR-PR2):
    - A household export (owners) and a personal export (`/me`), both async.
    - A ZIP holding `manifest.json`, `<module>.json` from each `ExportSource`, a `files/` tree, the derivative hooks (`.ics`, `.csv`, `.md`, `.html`), and `activity-log.csv` redacted as for the requester.
    - Ready within 24 hours, downloadable for 7 days.
  - **Account deletion** (FR-PR3–4):
    - Each household is resolved first.
    - A 30-day window: the account is disabled and revoked immediately, and an email carries a cancel link. A disabled account's sign-in fails as a wrong password does (`401 invalid_credentials`, FR-ID3), and its sessions end. `POST /me/deletion` keeps no `Idempotency-Key`, since its body carries the password ([D-97](prd/09-decisions.md)).
    - A nightly job then runs `EraseSource` everywhere, deletes object prefixes, writes an identity tombstone, and relabels authorship as *Former member*.
    - PowerSync's compaction (item 17) runs after that job each night, so an erased row's superseded data leaves bucket storage with it ([05 §6](prd/05-privacy-and-compliance.md), [D-93](prd/09-decisions.md)).
  - **Household deletion** (FR-PR6): the owner types the household name, every member is notified, and the same 30-day window applies.
  - **Private roots** when a member leaves (FR-PR7), from item 10's `household.Hooks.Lost` with the cause `left` or `removed`. Admin's tables, the platform's (item 10), are exported and erased with the household.
  - **A child profile removed from its household** (item 11) is an account nobody can sign in to, since it is nothing outside its household: it is erased as a deleted account is, from the same hook.
  - **Lapsed deletion**: households past item 16's retention window.
  - **Diagnostic bundle** (FR-PS1):
    - The client assembles it; preview and redaction happen on the client.
    - It carries **sync metadata only**: the last checkpoint, queue depth, checksum or digest mismatches, and the last N outcome codes.
    - It expires after 30 days.
  - **Analytics consent** (FR-PR9): stored per member; children excluded.
- **Inputs**
  - PRD: [05 §3–5, §9](prd/05-privacy-and-compliance.md); [02 FR-ID8, FR-PS1](prd/02-identity-and-access.md); [10 §6](prd/10-sync-risk.md); D-6, D-35, D-93
  - Design: A-20, A-33–A-35, C-56
- **Done when**
  - Each archive's structure validates against its manifest.
  - A generic erasure test over the registry leaves zero tenant rows for the household.
- **PR:** —

### 21 · Platform staff, feature flags and reference-data admin · `planned`

Phase 0 · after 10, 7 · size M

- **Scope**
  - **Staff identities**: `support` and `platform_admin`, with MFA required.
  - **Staff API** (`/platform/*`): metadata-only endpoints, plus the support actions in [02 §8](prd/02-identity-and-access.md), among them unlocking a locked second step and turning one off whose owner has lost both the authenticator and the codes (D-100), which clears `mfa_totp` and `mfa_recovery_codes`.
  - **Platform audit log**: a separate schema, append-only, kept 7 years.
  - **Double logging** into the household's own activity ([D-75](prd/09-decisions.md), FR-PS2).
  - **Feature flags** per household and per platform, so a module can ship dark.
  - **Reference-data admin**: preset and catalog versioning, and the moderation queue for catalog suggestions (FR-GA4). Delivered as the API plus a minimal admin page in the web app. An edit writes the tables item 7's loader writes on every deploy, so this item decides whether the next load keeps an edit or overwrites it from `reference-data/` ([ADR 0008](adr/0008-reference-data-pipeline.md)).
  - **No-content-access test** ([05 §6](prd/05-privacy-and-compliance.md)): connects as every role and expects zero rows from an unrelated household. PowerSync's replication role (item 13), which with its bucket storage's credential is the one exception to [D-3](prd/09-decisions.md), is left out; item 13's read-path isolation test holds it instead.
- **Inputs**
  - PRD: [02 §8](prd/02-identity-and-access.md); [05 §6](prd/05-privacy-and-compliance.md); D-3, D-75, D-93
  - API: tag `platform`
  - home: `platform/statusreport`
- **Done when**
  - The role matrix is tested.
  - The no-content-access test runs in CI.
  - A staff action appears in the household's activity.
- **PR:** —

### 22 · Crop catalog I — schema, climate data and the first 100 crops · `planned`

Content · after 7 · size L

- **Scope**
  - **Source format** in `reference-data/garden/`: crops, varieties and rules (crop pairs, family pairs, succession).
  - **Names**: `en`, `cs`, `sk`, `de` and `pl`, plus Latin.
  - **Timings**: offsets from the household's frost dates. **No absolute dates.**
  - **Harvest and storage fields**, for the pantry hook.
  - **Provenance** on every field.
  - **Validator**: a JSON Schema plus a completeness check.
  - **Pipeline**: item 7's ([ADR 0008](adr/0008-reference-data-pipeline.md)). The schemas sit in `reference-data/schemas/`, each field is a value with its source and `drafted` flag (the flags are the review ledger), and `reference.Read` runs the checks. The first module set to land, this or another, adds the loader's registry hook for a module's datasets.
  - **Climate dataset** for the five countries: frost dates, hardiness zone and season length by town or grid, with its licence recorded.
  - **Content**: about 100 of the most common crops, drafted with sources. Companion claims are marked *agronomic* or *traditional*. Everything goes on the review ledger.
- **Inputs**
  - PRD: [11-garden](prd/modules/11-garden.md) (the catalog, FR-GA1–GA4, D-65, D-66); [08-roadmap](prd/08-roadmap.md) (longest lead); [future/meals-and-pantry.md](prd/future/meals-and-pantry.md)
  - Design: `garden.js` (15 crops, 5 varieties, 7 compatibility claims)
  - home: `modules/garden/seed` (82 rules, 64 Czech companion pairs)
- **Done when**
  - The validator is green.
  - 100 crops exist in all five languages.
  - Every drafted field is on the review ledger.
- **PR:** —

### 23 · Tokens, icons and the illustration kit · `planned`

Phase 0 · after 1 · size L

- **Scope**
  - **`@household/tokens`**, ported mechanically from `foundations.js`:
    - about 45 semantic tokens and 13 status tokens;
    - the accent map (17 modules → 6 values);
    - the type scale (title-1 line height 1.22);
    - space, radii, motion and thresholds, density;
    - both themes.
  - **Token outputs** (resolved values or primitives, per Q13):
    - CSS custom properties: `:root`, dark-theme deltas, and density/scale/motion attributes;
    - a TS object;
    - an RN theme, with rem converted to px.
  - **Contrast in CI**: the `PAIRS` table and ratio function run as a test, with the `EXEMPT` list and its reasons.
  - **Lint**: no primitive tokens and no raw colours in application code (stylelint and ESLint).
  - **Fonts**: self-hosted per PL-13.
  - **`@household/icons`**:
    - 13 status and 19 module/navigation glyphs from `icons.js` as React and react-native-svg components;
    - vendored Lucide for the 55 base glyphs;
    - the `LABELS` accessibility keys;
    - a greyscale-distinguishability test.
  - **Illustration kit**: a renderer for web and RN with 18 parts, 11 compositions and 8 rules.
- **Inputs**
  - PRD: [06 §3](prd/06-clients.md)
  - Design: [01-foundations](design/01-foundations.md); DD-1, DD-3, DD-5, DD-10; `foundations.js`, `icons.js`, `illustration.js`, `conformance.js` (late colour spends), `Foundations.dc.html`, `Icons and Illustration.dc.html`
- **Done when**
  - The contrast test is green in both themes.
  - Icon snapshots pass.
  - The illustration compositions render the same on web and RN.
- **PR:** —

### 24 · Web foundation — app, primitives, twelve-state harness, quality gates · `planned`

Phase 0 · after 23, 6 · size L

- **Scope**
  - **App**: `apps/web` per PL-4, with `@household/api` wired for the cookie, CSRF and problem handling.
  - **Localisation**: `@household/i18n`'s translator and its `en-XA` pseudo-locale (item 6) behind a runtime locale switch; all formatting through `Intl`. Architecture test 7 already applies to `apps/web`.
  - **Display modes**: light, dark and system themes; comfortable and compact density ([DD-3](design/08-decisions.md)); text scaling.
  - **Primitives** from [02-components](design/02-components.md):
    - buttons, inputs, dialogs and sheets, menus, toasts;
    - list row; a data table with compact density; key–value block;
    - money value in mono with tabular figures; metric tile; three chart shapes;
    - sync mark;
    - **hold-to-complete**: 2000 ms, with an immediate keyboard and screen-reader path and reduced motion;
    - teaching empty state; skeletons; banners.
  - **Twelve-state harness**: a dev-only route rendering nine data bodies × 12 states × 2 themes at 200 % text.
  - **Tests and gates in CI**:
    - Vitest and RTL;
    - Playwright plus axe on every route in both themes;
    - a pseudo-locale E2E pass;
    - a bundle budget;
    - a CSP-clean build.
  - **Build-id reload prompt.**
- **Inputs**
  - PRD: [06 §3–4, §7–8](prd/06-clients.md)
  - Design: [02-components](design/02-components.md), [03-patterns](design/03-patterns.md), [06-accessibility](design/06-accessibility-and-i18n.md); `components.js`, `Components and States.dc.html`, `ledger.js` (the twelve states)
  - home: the frontend (Radix, TanStack persistence, the Playwright + axe setup)
- **Done when** the harness is axe-clean in both themes and every gate runs in CI.
- **PR:** —

### 25 · Web shell, sync UI, auth and account · `planned`

Phase 0 · after 24, 18, 9, 15, 20 · size XL

- **Scope**
  - **Shell**:
    - The sidebar with per-member order and visibility (F-13, F-15, [D-38](prd/09-decisions.md)).
    - The household switcher (A-36).
    - A search-field slot.
    - The app bar (F-14).
    - Absence derived as in `nav.js`: no trace of an ungranted module.
  - **Deep links**: all four situations, and the neutral *not available* screen (F-16, F-17).
  - **Sync UI** over IndexedDB:
    - the offline bar (A-37) and sync marks (F-8);
    - the conflict inbox (F-5), conflict resolver (F-6) and rejected-mutation resolver (F-7);
    - the withdrawn treatment (F-9);
    - the not-enough-information state (F-10).
  - **Auth** (A-1–A-13):
    - the breached-password copy;
    - *unverified but working*;
    - MFA enrol, challenge and recovery;
    - password reset;
    - the takeover notice;
    - Google and Apple on the web.
  - **Account settings** (A-19): profile, language, MFA, sessions and devices, notification categories, quiet hours and first day.
  - **Item 9's web half** ([ADR 0010](adr/0010-mobile-tokens-second-step-providers-and-client-versions.md)): every request names the client, `Household-Client: web/<version>`, and a `400 update_required` shows *please update*; a `409` sign-in is the `MfaChallenge`, whose `methods` and `recovery_codes_left` the second-step screens read (A-7, A-8), answered at `/auth/mfa/verify`, which sets the trust cookie when *trust this browser* is ticked; *make new recovery codes* is `POST /auth/mfa/recovery-codes`; the takeover notice is the `email.token_reuse` email and its in-app equivalent; the provider sign-in keeps its PKCE verifier until the callback, and Apple, which answers with a form posted to the redirect URI, needs a page that accepts it, or Apple's JS in popup mode; `link_required` sends the member to sign in with their password and link the provider from their account.
  - **Item 11's web half** ([ADR 0012](adr/0012-child-profiles-pins-and-graduation.md)): the page a child profile's graduation link opens, `/graduate`, reads its token from the fragment and posts `postAuthGraduationConfirm` with the password the young adult chooses; the owner's member screen makes, re-PINs, unlocks and graduates child profiles, and shows a locked one.
  - **Item 8's web half** ([ADR 0009](adr/0009-accounts-sessions-throttles-and-the-breach-corpus.md)): every unsafe request sends `X-CSRF-Token` from the `__Host-hh_csrf` cookie, and a `403 csrf_failed` signs the member in again; the routes the emails link to, `/verify-email` and `/reset/set`, read their token from the fragment; `/sign-in` and `/reset` exist by those names; a `null` timezone or first day follows the household or the locale. The design's register copy says a fingerprint prefix of the password leaves the device; the server screens it at set time instead and no range endpoint exists, so the copy says what happens.
  - **Web Push**: permission asked in context.
  - **Account deletion** (A-20).
  - **Please update.**
- **Inputs**
  - PRD: [02](prd/02-identity-and-access.md); [06 §2, §5–6](prd/06-clients.md)
  - Design: [04-navigation](design/04-navigation.md), [03-patterns](design/03-patterns.md); `nav.js`, `sync.js`, `auth.js`, `account-ui.js`, and the Shells, Sync and Auth artifacts
- **Done when**
  - E2E passes register → verify → sign in → MFA.
  - The listed rows reach their required states.
- **PR:** —

### 26 · Web household — create, invite, members, grants, children, modules · `planned`

Phase 0 · after 25, 10, 11 · size L

- **Scope**
  - **First run** ([DD-6](design/08-decisions.md)): register → create household from confirmed device defaults (A-22) → *"what brought you here?"* → that module's capture surface → invite afterwards. Modules register their capture surface as they land.
  - **Invitations**:
    - The composer (A-23) with the 17-row grant matrix in plain words.
    - The acceptance screen (A-24) showing exactly what is being given.
    - The inviter's notice of a decline (A-25).
  - **§1 Profile** (C-49): household code, country change, timezone, locale and units.
  - **§2 Members and grants** (C-50):
    - role and grant changes, with the D-78 notice;
    - remove and promote;
    - the nudge when there is only one owner;
    - child profiles: create, PIN reset, unlock, locked dashboard, graduate.
  - **§3 Modules** (C-51): each toggle says what it will do.
  - **Leaving** (A-26): both refusals shown at once.
  - **Ownership transfer.**
- **Inputs**
  - PRD: [02 §3–6](prd/02-identity-and-access.md); [17 HA1, HA3–HA8, HA17](prd/modules/17-household-admin.md)
  - Design: `household.js`, `onboarding-ui.js`, `admin-ui.js`, `Household and Billing.dc.html`
- **Done when**
  - Critical path 1 passes E2E: register → create household → invite → accept ([06 §8](prd/06-clients.md)).
  - The grant matrix reads without a legend at phone width.
- **PR:** —

### 27 · Web billing, storage, data, privacy and sync health · `planned`

Phase 0 · after 26, 16, 19, 20 · size L

- **Scope**
  - **Billing**:
    - Subscribe (A-27, Payment Element).
    - Manage billing (A-28 = C-55): invoices, the method summary, cancel and resume.
    - Take over billing (A-29).
  - **Entitlement banners** (A-30): the trial stages, `past_due`, `grace`, `read_only` with its deletion date, `canceled`, and `restricted` naming who and when.
  - **Suspended lockout** (A-31): no export button ([DD-15](design/08-decisions.md)).
  - **Read-only mode** app-wide: writes are absent, and a banner explains.
  - **Storage** (C-54): trend, split by module and member, the largest items, what deleting recovers, and projected blocks and charge.
  - **Data** (C-56):
    - export request, progress and download (A-35);
    - household deletion with the typed name;
    - restrict and lift;
    - transfer.
  - **Privacy centre** (A-34): rights, analytics consent, and the supervisory authority by country (the ICO for the UK).
  - **Diagnostic bundle** (A-33): rendered in full before it is sent, with redaction.
  - **Sync health** (A-32): per device, the last sync, the last checkpoint (FR-HA19's cursor position under D-93), pending count, conflicts, checksum or digest state (item 17), and a forced re-download.
  - **Clients and versions** (C-57), over an operation this item adds to the contract (Q11), reading item 9's `devices.app_version`.
- **Inputs**
  - PRD: [04](prd/04-billing-and-entitlements.md); [05 §3–4, §9](prd/05-privacy-and-compliance.md); [17 HA14–16, HA18–20](prd/modules/17-household-admin.md); [10 §6](prd/10-sync-risk.md); D-93
  - Design: `household.js`
- **Done when** critical path 3 passes E2E: subscribe (Stripe test mode) → lapse (clock advanced) → read-only → export.
- **PR:** —

### 28 · Mobile foundation — Expo app, primitives, replica, shells · `planned`

Phase 0 · after 23, 6, 18, 9, 15 · size XL

- **Scope**
  - **App**: `apps/mobile` per PL-5, with EAS profiles for dev, staging and production, targeting iOS 16+ and Android 10+.
  - **Primitives**: RN versions of item 24's. Hold-to-complete exposes an accessibility action.
  - **Display**: `@household/i18n`'s translator, themes, and dynamic type to 200 %.
  - **A `crypto.getRandomValues` polyfill**, loaded before the first import of `@household/api`: its `newId` mints UUIDv7s with it, and Hermes does not provide it.
  - **The `Intl` the translator needs on Hermes**: `Intl.PluralRules`, which intl-messageformat selects every plural with and Hermes has not provided, polyfilled from FormatJS's CLDR data for the five languages if the engine still lacks it. A test renders `vectors/i18n.json`'s plural and grouping cases on the device's engine, since Node's ICU is the only one the vectors otherwise run on.
  - **Data and session**:
    - a PowerSync replica per household, through `@household/sync` (PL-5);
    - the token pair in SecureStore;
    - the version header.
  - **Navigation**:
    - The tab bar at five and at **four** destinations (F-11, F-12, [DD-11](design/08-decisions.md)), with Q6 settled here.
    - A More list with per-member arrange.
    - Two-pane tablet layouts.
  - **Sync UI**: the offline bar, sync marks, the conflict inbox and both resolvers, and the withdrawn treatment.
  - **Deep links**: cold start, a different household, and lost access (F-16, F-17).
  - **Please update** (A-21) as a blocking screen.
  - **Push**: permission asked in context, and the Expo token registered.
  - **Tooling**: a dev-build twelve-state harness; Jest and RNTL; Maestro in CI on an Android emulator; a bundle budget.
- **Inputs**
  - PRD: [06](prd/06-clients.md)
  - Design: [04-navigation](design/04-navigation.md); `nav.js`, `sync.js`, `components.js`, `Shells and Navigation.dc.html`
- **Done when**
  - Dev builds run on iOS and Android.
  - The Maestro smoke test is green.
  - The harness passes RN accessibility checks.
- **PR:** —

### 29 · Mobile auth, child sign-in, household and account · `planned`

Phase 0 · after 28, 9, 10, 11, 15, 16, 20 · size L

- **Scope**
  - **Sign-in** (A-1–A-13): native Apple sign-in (mandatory) and Google sign-in. Item 9's provider flow takes a code and a PKCE verifier; the native SDKs hand the client an ID token instead, so this item adds the operation that takes one, or signs in through an in-app browser (Q11). Every request names the client, `Household-Client: mobile/<version>`; the device's id, its token pair and its trust token are kept in SecureStore; a `refresh_token_invalid` discards the replica and signs in again ([ADR 0010](adr/0010-mobile-tokens-second-step-providers-and-client-versions.md)).
  - **Children**:
    - child sign-in (A-14–A-16): the code opens the profile list (`postAuthChildProfiles`), and the sign-in is a device's (`postAuthChildLogin`);
    - the tablet profile switcher (A-17), over the one sign-in per profile the tablet holds ([D-104](prd/09-decisions.md));
    - lockout (A-18), which lasts until an owner unlocks it or sets a new PIN, not a timed pause.
  - **Account**:
    - Account settings (A-19), with notification permission and categories designed as one screen (F-20).
    - In-app account deletion (A-20), which both stores require.
  - **Household**:
    - Create a household, plus the first-run flow (A-22).
    - The switcher (A-36).
    - Invitation acceptance with the grant matrix on a phone (A-24); the composer (A-23).
    - Leave (A-26).
    - A read-only view of members and grants.
  - **Entitlement**: banners and read-only mode, with **no purchase link** — store-rule wording only ([04 §7](prd/04-billing-and-entitlements.md)).
  - **Data and privacy**: sync health (A-32), diagnostic bundle (A-33), privacy centre (A-34), export request (A-35).
- **Inputs**
  - PRD: as items 25–27, plus [04 §7](prd/04-billing-and-entitlements.md)
  - Design: `auth.js`, `account-ui.js`, `household.js`
- **Done when** Maestro passes each flow:
  - sign in;
  - child PIN sign-in, including lockout;
  - accept an invitation.
- **PR:** —

### 30 · Proof module, staging, seed and end-to-end critical paths · `planned`

Phase 0 · after 27, 29, 20 · size L · **Phase 0 exit**

- **Scope**
  - **The throwaway module `proof`**:
    - Three entities covering **all five merge policies**, including a `state_set`, an `additive` with a cross-row invariant, a private entity with a redacted projection, and an audience.
    - Full REST and sync paths, plus export and erase.
    - Minimal list screens on both clients.
  - **Staging** on DigitalOcean + Coolify:
    - the server image;
    - the web build on nginx with strict CSP and HSTS;
    - Postgres 17 and S3-compatible storage;
    - PowerSync with its bucket storage, the Postgres at `wal_level=logical` (item 13);
    - EU SMTP (Q14) and Stripe test mode;
    - item 8's settings: `HOUSEHOLD_WEB_URL`, the proxies to trust, and the breached-password corpus, built per [the runbook](runbooks/breached-passwords.md);
    - item 9's: `HOUSEHOLD_TOKEN_KEYS`, `HOUSEHOLD_MFA_KEYS`, the redirect URIs and the Google and Apple credentials, per [their runbook](runbooks/sign-in-keys-and-providers.md), and the IP-to-place source for `approximate_location` (Q14), which item 9 left null;
    - migrations run as `household_migrate`;
    - secrets in Coolify environment variables;
    - synthetic data only;
    - EAS staging builds pointing at it.
  - **Canonical seed** (`fixtures/seed/`), loaded by a Go command: the five personas and two households from `fixtures.js`, with drifts fixed (Q16).
  - **Critical paths as Playwright + Maestro E2E** ([06 §8](prd/06-clients.md)):
    - register → create household → invite → accept;
    - offline capture → reconnect → converge, on `proof`;
    - subscribe → lapse → read-only → export.
  - **Observability baseline**: OpenTelemetry traces, Prometheus RED metrics, and scrubbed error aggregation, all EU-hosted (Q14).
  - **Dogfood environment and checklist** ([10 §8](prd/10-sync-risk.md)): a separate environment for the team's real use, per PL-8, never staging (D-10), with the same services, PowerSync among them. The month of `proof` dogfooding starts here.
- **Inputs**
  - PRD: [08-roadmap](prd/08-roadmap.md) Phase 0 (*Proof it works*); [10 §8](prd/10-sync-risk.md); [01 §9](prd/01-architecture.md); D-10
  - Design: `fixtures.js`; `conformance.js` `WALKS`
- **Done when**
  - Phones reach staging.
  - The three critical paths pass in CI and in a staging smoke run.
  - Every line of the Phase 0 deliverable in 08-roadmap is ticked.
- **PR:** —

---

## Phase 1 — Shopping, all the way

The smallest module that exercises the hardest part of the platform: two people, one list, both offline.

### 31 · Shopping — server · `planned`

Phase 1 · after 30 · size L

- **Scope**
  - **Lists** (`strict_version`, one default).
  - **Items** (`lww_field`): free text plus optional quantity, unit, category, assignee, price and note. `source_ref` is reserved.
  - **Checked state**: `state_set` keyed by item, resolving by `latest_client_time`, recording who checked it.
  - **Positions**: `lww_field` lexorank. The shared TS + Go implementation with vectors is ported from `home`, and Tasks reuses it.
  - **Categories**: 14, seeded from a translated catalog with keywords in all five languages.
  - **Store layouts** per list.
  - **Staples**: explicit, ranked by the staple rule, and recurring via the scheduler.
  - **Clearing and trips**:
    - Clear checked items, with an undo window.
    - Trips (`additive`), recorded on clear with a running total.
    - The Finance offer made by reference only. It stays absent until item 63 lands, and it resolves through item 36's reference resolver.
  - **Realtime**: within 1 second, showing who checked.
  - **Quick-add parser**: in `@household/domain` with a Go twin and the `PARSE_TESTS` vectors. It splits on commas and newlines; *keep as one* is offered on undo.
  - **Catalogs**: the `shopping.lists` widget (with its D-42 projection), 2 metrics, the `open_items` list, and a search scope.
  - **Offline writes**: `item`, `checked` and `trip` are enabled offline, the D-84 exception.
  - **Contract**: decide PATCH/DELETE for categories and staples (Q11).
- **Inputs**
  - PRD: [05-shopping](prd/modules/05-shopping.md); [10](prd/10-sync-risk.md) scenario 3; D-84
  - API: `…/shopping/*` (16 operations)
  - Design: `shopping.js` (parser table, categories, staple rule, two-trolley log)
  - home: `platform/lexorank`
- **Done when** scenario 3 and acceptance cases A, B and C pass in the conformance suite on real Shopping entities.
- **PR:** —

### 32 · Shopping — web · `planned`

Phase 1 · after 31, 25 · size M

- **Scope**
  - **Screens**: B-1–B-8 for web:
    - the lists overview and a list with an always-focused quick add;
    - checked items collapsed to the bottom;
    - store order;
    - staples;
    - item detail;
    - the trip summary with the optional Finance offer;
    - the teaching empty state.
  - **Honest offline edit**: an edit affordance that is present online and says in words why it is unavailable offline.
  - **Two-trolley behaviour**: realtime, and no conflict dialog.
- **Inputs**
  - Design: `shopping.js`, `Shopping.dc.html`
- **Done when** all rows reach their required states; four rows declare *conflicted* unreachable, per the ledger.
- **PR:** —

### 33 · Shopping — mobile · `planned`

Phase 1 · after 31, 29 · size L

- **Scope**
  - **Screens**: B-1–B-8 on the primary surface.
  - **Hand and light**: usable one-handed in bad light; adding takes under 2 seconds; check-off is **one tap, never a hold**.
  - **Offline**: fully offline for items and checks.
  - **The teaching empty state** becomes the **template** for the 16 modules that follow, composed from the illustration kit.
  - **Children**: a child with `contribute` is fully useful here.
- **Inputs**
  - PRD: [05-shopping](prd/modules/05-shopping.md) (mobile)
  - Design: DS-1 in [07-delivery](design/07-delivery.md)
- **Done when** Maestro passes the offline add → check → reconnect flow.
- **PR:** —

### 34 · Gate G-C — two phones in aeroplane mode · `planned`

Phase 1 · after 32, 33 · size M · **gate G-C**

- **Scope**
  - **Run the acceptance test** on **two physical phones** in aeroplane mode, following a protocol in `docs/runbooks/gate-g-c.md`. The results are recorded with sync-health captures.
  - **Automation**: a Maestro script for the reproducible part.
  - **Fix what it finds**: small fixes go in this PR; large ones become a split into a reserve slot.
  - **Verdict**: written in `docs/adr/0002-gate-g-c.md`.
  - **Remove the `proof` module** (its tables, routes and screens) only once the dogfood log shows a month of use since item 30 ([10 §8](prd/10-sync-risk.md)). If the gate passes sooner, `proof` stays, and the first Phase 2 item to merge after the month is up removes it. Start the Phase 2 dogfood log.
- **Inputs**
  - PRD: [10 §7](prd/10-sync-risk.md); [05-shopping](prd/modules/05-shopping.md) (acceptance); [17 FR-HA19](prd/modules/17-household-admin.md); D-93
- **Done when**
  - The gate passes, **or** it fails.
  - On a fail, the ADR takes the fallback [10 §7](prd/10-sync-risk.md) names since D-93, building [03 §2](prd/03-platform-strands.md)'s engine on the schema and the write path ([ADR 0001](adr/0001-sync-engine.md)), and this plan is rewritten before any Phase 2 item starts.
- **PR:** —

---

## Phase 2 — The daily core

Everything from here to item 87 is parallelisable, because modules import no module. Each module's
server item comes before its client items.

### 35 · Reminders strand, recurrence and the Reminders server · `planned`

Phase 2 · after 34 · size XL

- **Scope**
  - **Recurrence** in `@household/domain`, with a Go twin: the RRULE subset of FR-RE2, the short-month clamp, and caps. It carries the 7 vectors from `reminders.js`.
  - **Strand** (platform migration block):
    - **Kind registry**: 21 kinds, registered as their modules land; the total is asserted in item 96.
    - **Subscriptions**: per kind, using the lead set `0d`…`3m` or custom, with a channel and defaults by kind.
    - **Completion and snooze**: completions shared or personal by kind; personal snoozes ([D-43](prd/09-decisions.md)).
    - **Upcoming aggregation**: across the resolvers, applying lead windows and snoozes, with a 60-day overdue window.
    - **Materialisation**: an hourly job, delivering through item 15.
  - **The module**:
    - Own reminders, with series-only edits.
    - Anniversaries, which pass rather than complete.
    - Sync: `reminder` (`lww_field`), `completion` and `snooze` (`state_set`), `subscription` (`lww_row`).
    - Catalogs: widgets `reminders.due` and `this_month`, 4 metrics, a search scope.
- **Inputs**
  - PRD: [03 §6](prd/03-platform-strands.md); [03-reminders](prd/modules/03-reminders.md); D-27, D-43
  - API: `…/reminders/*` (12 operations across two tags)
  - Design: `reminders.js` (the 21 kinds, lead classes, `expand` vectors, `agendaFor`)
  - home: `modules/events`, `platform/recur`
- **Done when**
  - The vectors pass in both languages.
  - Client-side expansion equals the server's upcoming list for the fixture.
- **PR:** —

### 36 · Catalog hosts — dashboard server, metrics, lists, global search · `planned`

Phase 2 · after 34, 35 · size L

- **Scope**
  - **Dashboard server**:
    - The catalog, filtered by enablement and grant (FR-DB1).
    - A per-member layout (`lww_row`).
    - Owner default layouts per audience, including per invitation, with adopt-notice data (FR-DB4): item 10 keeps an invitation's `dashboard_layout` on `invitations`, which accepting it applies from here on.
    - Child layouts, suggested or locked ([D-41](prd/09-decisions.md)).
    - A bounded fan-out with a per-widget timeout, an `unavailable` state, and single-widget refresh (FR-DB3).
    - Widget actions carry `meta.via=dashboard`.
  - **The [D-42](prd/09-decisions.md) contract**: each widget declares a server resolver and a client projection, and a vector harness proves they agree.
  - **Metric and list resolution**, per recipient.
  - **Global search** (FR-SE1–3):
    - one scope registry;
    - per-language `tsvector` with `unaccent`;
    - grants and privacy applied **before** ranking;
    - one hit shape for every module.
  - **Today helpers**: the read support for Today ([DD-7](design/08-decisions.md)), so Today can also be computed offline on the client.
  - **Cross-module references** ([D-40](prd/09-decisions.md)): the platform reference resolver and reverse index, used by six modules.
  - **Q5**: settle search while offline.
- **Inputs**
  - PRD: [01-dashboard](prd/modules/01-dashboard.md); [03 §7](prd/03-platform-strands.md); D-38, D-40, D-41, D-42
  - API: `…/dashboard/*`, `…/search`
  - Design: DD-2, DD-7; `dashboard.js` (24 keys, `reflow`, catalog filter), `spine.js` (`todayFor`, 19 scopes)
  - home: `modules/dashboard`, `platform/{catalog,metrics,lists}`
- **Done when** the design vectors hold:
  - catalog sizes 24 / 3 / 9 / 2 / 4 across the personas;
  - the unknown key `meals.planner` is dropped;
  - 19 search scopes for Jana, 2 for Klára;
  - *porek* finds *pórek*.
- **PR:** —

### 37 · Dashboard, Today and search — web · `planned`

Phase 2 · after 36, 25 · size L

- **Scope**
  - **Dashboard** (C-1–C-10):
    - the ordered list at 2/4/6 columns with deterministic reflow;
    - catalog and arrange;
    - the owner default editor and the adopt notice;
    - child layouts, suggested or locked, with arrange affordances *absent*;
    - the unavailable widget;
    - the widget shell;
    - widgets for Shopping and Reminders.
  - **Search** (F-1, F-2).
  - **Today** on the web (F-3), in five groups ([DD-7](design/08-decisions.md)).
- **Inputs**
  - Design: `dashboard.js`, `spine.js`, `Dashboard and Widgets.dc.html`, `Today and Cross-cutting Screens.dc.html`
- **Done when** the design's `reflow` vectors hold at all three widths.
- **PR:** —

### 38 · Dashboard, Today, Add sheet and search — mobile · `planned`

Phase 2 · after 36, 29 · size L

- **Scope**
  - **Screens**: C-1–C-10 on mobile, with `large` taking two rows on a phone.
  - **The Today tab** (F-3), computed from the replica while offline.
  - **The Add sheet** (F-4, [DD-8](design/08-decisions.md)): ranked on a slow-moving window, cold-starting from enablement and grants, and never reordering while open.
  - **Search** (F-1), following Q5.
  - **Widget projections** that work offline.
- **Inputs**
  - Design: `dashboard.js`, `spine.js`
- **Done when**
  - `todayFor` block counts match (Jana 5, Adam 4, Petr 2, Klára 0).
  - Today renders offline.
- **PR:** —

### 39 · Reminders — web and mobile · `planned`

Phase 2 · after 35, 37, 38 · size M

- **Scope**
  - **Screens**: C-11–C-14 on both clients:
    - the unified list with source badges and deep links;
    - the own-reminder editor with recurrence;
    - subscriptions for 21 kinds with lead times;
    - personal snooze.
  - **Completion** by hold-to-complete, with its keyboard path.
  - **Anniversaries.**
  - **Offline**: the list expands on the client, so it is complete rather than a cached window.
- **Inputs**
  - PRD: [03-reminders](prd/modules/03-reminders.md)
  - Design: `reminders.js`, `Reminders and Tasks.dc.html`
- **Done when** the `agendaFor` row counts match (Jana 15, Petr 1, Adam 3, Klára 0 — the empty state, Miloš 3).
- **PR:** —

### 40 · Tasks — server · `planned`

Phase 2 · after 34, 35, 36 · size L

- **Scope**
  - **Structure**:
    - Boards (`strict_version`, with archive and restore).
    - Columns: kind `normal`, `now` or `done` (`strict_version`).
  - **Cards** (`lww_field`):
    - Markdown body and priority.
    - Assignment: `422` if the assignee holds `none`; the assignee gets a direct notification.
    - `due_on`, which feeds the personal `tasks.card_due` kind.
  - **Moving cards**:
    - Within and across boards, with the composite foreign key and the `done_at` invariant.
    - Lexorank positions from item 31. On an exact collision the column is rebalanced and the new ranks are emitted.
  - **Card parts**:
    - Checklists.
    - Labels: idempotent attach and detach.
    - Links: document references, resolved through item 36's reference resolver.
    - Comments (`additive`), with mentions that notify.
  - **Reads**: the board tree with no N+1, under a query budget; card search.
  - **Templates**: four starters as translated reference data, through item 7's pipeline ([ADR 0008](adr/0008-reference-data-pipeline.md)); the first module set to land adds the loader's registry hook for a module's datasets.
  - **Catalogs**: 2 widgets, 5 metrics plus lists, a search scope.
  - **Offline**: `lww_field` offline writes enabled entity by entity as the suite goes green.
- **Inputs**
  - PRD: [02-tasks](prd/modules/02-tasks.md)
  - API: `…/tasks/*` (31 operations)
  - Design: `tasks.js` (templates, the lexorank vectors for six offline reorders)
  - home: `modules/todo`
- **Done when**
  - Interleaved offline reorders converge in both receive orders.
  - The query budget holds.
- **PR:** —

### 41 · Tasks — web · `planned`

Phase 2 · after 40, 37 · size L

- **Scope**
  - **Screens**: C-15–C-22 for web:
    - a board with keyboard-accessible drag and drop (dnd-kit);
    - card detail;
    - the template picker;
    - labels, checklist, and comments with mentions;
    - cross-board move;
    - the column editor, without jargon.
  - **The `tasks.doing` widget**, with hold-to-complete.
- **Inputs**
  - Design: `tasks.js`, `work-ui.js`, `gaps-ui.js` (archive a board, FR-TA1)
- **PR:** —

### 42 · Tasks — mobile · `planned`

Phase 2 · after 40, 38 · size L

- **Scope**
  - **Screens**: C-15–C-22 on mobile.
  - **Reordering**: works offline, with no conflict dialog.
  - **Tablet**: a two-pane board with its card.
- **PR:** —

### 43 · Tree library and Notes — server · `planned`

Phase 2 · after 34 · size L

- **Scope**
  - **Platform tree library** (`internal/platform/tree`), shared by Notes and Documents with no module importing the other:
    - folders and two roots, shared and private per member;
    - the root-scoped sibling-uniqueness index;
    - slug paths and a resolver with no redirects;
    - the tree read model;
    - move, with `422` for moving into itself and `409` for cascades;
    - pins at two scopes.
  - **Notes**:
    - CRUD, with hard delete needing `manage`.
    - Private roots answer `404`; a child's is readable by an owner (Q7).
    - Full-text search per note language, with `unaccent`.
    - Pins (`state_set`).
    - Inline images under `notes/`, metered. An image referenced only by a preserved loser is kept for 30 days.
  - **Sync**:
    - Folders are `strict_version`; metadata is `lww_field`.
    - The body is `lww_row` with the loser preserved, and a 30-day sweep.
    - Moving a note from shared to private retracts it: its rows leave the buckets of everyone but its owner (item 17, [D-93](prd/09-decisions.md)).
  - **Catalogs**: the widget and metrics. **Export** as `notes/*.md`.
- **Inputs**
  - PRD: [07-notes](prd/modules/07-notes.md); D-19, D-93
  - API: `…/notes/*` (15 operations)
  - Design: `notes.js` (the sibling index, the 404 resolver, the preserved loser)
  - home: `modules/notes`, `platform/{slug,slugpath}`
- **Done when**
  - Both 404 bodies are character-identical.
  - The loser survives, and is pruned after 30 days.
- **PR:** —

### 44 · Notes — web · `planned`

Phase 2 · after 43, 37 · size L

- **Scope**
  - **Screens**: C-23–C-27 for web:
    - the tree browser with the root switcher;
    - a WYSIWYG editor with a raw-Markdown toggle (Milkdown);
    - pasting and uploading images;
    - the conflict banner showing the preserved body;
    - pins at two scopes;
    - language-aware search.
  - **A moved slug path** returns 404 (F-18).
  - **Safety**: rendering is sanitised, and CSP-clean.
- **Inputs**
  - Design: `notes.js`, `Notes and Documents.dc.html`
  - home: the Notes frontend
- **PR:** —

### 45 · Notes — mobile · `planned`

Phase 2 · after 43, 38 · size M

- **Scope**
  - **Screens**: C-23–C-27 on mobile.
  - **A moved slug path** returns 404 (F-18).
  - **Editor**: choose an RN Markdown editor, recording the choice in the PR.
  - **Offline**: editing works offline, and the loser banner appears after reconnecting.
- **PR:** —

### 46 · Documents — server · `planned`

Phase 2 · after 43, 14, 35, 36 · size XL

- **Scope**
  - **Structure**: folders, roots and pins through the tree library.
  - **Upload** through item 14's pipeline, with the full FR-DO1 refusal matrix and a successor link.
  - **Content**: `…/content?variant=original|download|preview|thumbnail`:
    - an immutable ETag and Range support;
    - `409` while a preview is pending;
    - active types download-only.
  - **Derived variants**: office conversion, metered separately.
  - **Document types**: 11 types as reference data, with a lead time and scope per type, per country ([D-53](prd/09-decisions.md)). They go through item 7's pipeline, each country's set under the key its profile's `document_type_set` names (`cz`, `sk`, `de`, `pl`, `gb`). `expires_on` feeds the `documents.expiry` kind.
  - **References** ([D-40](prd/09-decisions.md)):
    - documents registered as a reference target with item 36's resolver;
    - deleting a referenced document warns and names the referrer (FR-DO12).
  - **Bulk operations**: move, archive, zip and delete. A zip names the pending files it leaves out.
  - **Storage visibility** (FR-DO10).
  - **Catalogs**: 2 widgets, 4 metrics, lists and a search scope.
  - **Export** under `files/`.
- **Inputs**
  - PRD: [08-documents](prd/modules/08-documents.md); [03 §8](prd/03-platform-strands.md); D-40, D-53
  - API: `…/documents/*` (17 operations)
  - Design: `documents.js` (11 types, the serving matrix, the storage meter)
  - home: `modules/documents`
- **Done when**
  - The serving matrix is tested.
  - The design's storage-overhead vector holds (6,10 + 0,64 GB).
- **PR:** —

### 47 · Documents — web · `planned`

Phase 2 · after 46, 37 · size L

- **Scope**
  - **Screens**: C-28–C-35 for web:
    - the tree;
    - upload;
    - detail with preview, raw and download, plus the download-only variant;
    - type and expiry;
    - bulk operations;
    - the storage screen;
    - the reference warning.
- **PR:** —

### 48 · Documents — mobile · `planned`

Phase 2 · after 46, 38 · size L

- **Scope**
  - **Screens**: C-28–C-35 on mobile.
  - **Capture**: the single-file picker and the camera, both OS-mediated.
  - **Offline upload**: pending, then either ready or failed with a reason the member can act on.
  - **Caching**: bytes in a member-controlled LRU cache; thumbnails in the replica.
- **PR:** —

### 49 · Chores — server · `planned`

Phase 2 · after 35 · size XL

- **Scope**
  - **Definitions** (`strict_version`), with four schedules:
    - `fixed_interval`, anchored on the last completion ([D-49](prd/09-decisions.md));
    - `calendar`;
    - `monthly_nth`;
    - `on_demand`.
  - **Assignment modes**: unassigned, fixed, rotating, `weekly_rotation`.
  - **Occurrences**: materialised only when due or acted on.
  - **Completion**: a keyed `state_set`. **Rotation advances on the server** ([D-52](prd/09-decisions.md), scenario 13).
  - **Changes to an occurrence**: skip (the rule depends on the mode), snooze, swaps.
  - **Verification**: optional, off by default ([D-50](prd/09-decisions.md)), with a queue.
  - **Points**:
    - an `additive` ledger;
    - bonuses and penalties;
    - rewards and redemptions (Q11 decides PATCH/DELETE for rewards).
  - **Progress**: streaks and household progress, with **no leaderboards** ([D-51](prd/09-decisions.md)).
  - **Stale chores**: flagged after 14 days, with an owner prune.
  - **Setup**: starter sets and the reset day.
  - **Catalogs**: the `chores.due` kind (Q8), 2 widgets, 5 metrics, a search scope.
- **Inputs**
  - PRD: [06-chores](prd/modules/06-chores.md); D-49–D-52
  - API: `…/chores/*` (19 operations)
  - Design: `chores.js` (D-49: 1 row versus 14; the D-52 vectors; skip rules; weekly-grid arithmetic)
- **Done when**
  - Two offline completions advance the rotation once.
  - The design vectors pass.
- **PR:** —

### 50 · Chores — web · `planned`

Phase 2 · after 49, 37 · size L

- **Scope**
  - **Screens**: C-36–C-44 for web:
    - the weekly grid, compact by default, pivoting below 700 px;
    - all chores and the editor;
    - points and rewards;
    - the verification queue;
    - swaps;
    - the stale-chore prune.
- **Inputs**
  - Design: `chores.js`, `Chores, Activity and Notifications.dc.html`
- **PR:** —

### 51 · Chores — mobile · `planned`

Phase 2 · after 49, 38 · size L

- **Scope**
  - **Screens**: C-36–C-44 on mobile, with Today showing the member's own chores first.
  - **Completion** by hold-to-complete.
  - **The child experience**, including the locked dashboard.
  - **Points and rewards.**
  - **Tablet**: the weekly grid without its pivot.
- **PR:** —

### 52 · Activity log — server, web and mobile · `planned`

Phase 2 · after 34, 37, 38 · size M

- **Scope**
  - **A reader over the audit spine**:
    - Filtered feed with keyset pagination.
    - Summaries rendered in the reader's language.
    - The cross-module entity timeline, which also requires access to the entity.
    - Field diffs.
    - Statistics.
    - Append-only.
  - **The two redaction rules**: private events are redacted on read, and excluded from `q=` matching entirely.
  - **Filtering and provenance**: by grant; platform actions shown ([D-75](prd/09-decisions.md)); `meta.via`.
  - **Not synced** ([D-76](prd/09-decisions.md)): the last page is cached, with a needs-connection state.
  - **Screens**: C-45–C-48 on both clients, compact on web.
  - **Catalogs and export**: the widget, metrics and search; `activity-log.csv`.
- **Inputs**
  - PRD: [16-activity](prd/modules/16-activity.md); D-21, D-75, D-76
  - Design: `activity.js`, `activity-ui.js`
  - home: `modules/logging`
- **PR:** —

### 53 · Notification composer, setup re-entry and in-app help · `planned`

Phase 2 · after 36, 15 · size L

- **Scope**
  - **Trigger rules** (FR-NT3, server):
    - match an audit action key or prefix;
    - filter by module, entity and level;
    - an audience that respects grants;
    - per-language templates;
    - coalescing.
  - **Scheduled digests** (FR-NT4, server): time, days, and day of month with the short-month clamp; metric tokens resolved per recipient.
  - **Test send and delivery log** (FR-HA11–13): the rendered body is dropped after 7 days. Rules and schedules sync as `strict_version`.
  - **Broadcast** (`POST …/notifications/broadcast`): implemented with a PRD entry, or removed from the contract with a decision entry (Q11).
  - **Composer screens** on both clients:
    - C-52, the composer, which must not read like business software;
    - C-53, the delivery log and test send.
  - **Setup re-entry** (C-58, HA9): the per-module framework.
  - **In-app help** ([DD-13](design/08-decisions.md)):
    - the content model and its three surfaces (F-19);
    - entries for every module built so far.
    - **From here on, every module PR writes its own help.**
- **Inputs**
  - PRD: [03 §4](prd/03-platform-strands.md); [17 HA9–HA13](prd/modules/17-household-admin.md)
  - Design: DD-13; `notify.js`, `spine.js` (`HELP_FIELDS`)
  - home: `modules/admin` (rules, schedules)
- **PR:** —

### 54 · Crop catalog II — the remaining crops · `planned`

Content · after 22 · size L

- **Scope**
  - **Crops**: about 200 more, reaching about 300, with varieties and rules in five languages plus Latin, each with sources.
  - **Climate data**: coverage completed for the five countries.
  - **Review**: the review ledger and a coverage report.
- **Done when**
  - The validator is green.
  - The coverage report is committed.
- **PR:** —

---

## Phase 3 — The differentiators

Each module's engines land first in `@household/domain` with vectors (D-37). The server's Go twin is held
to the same vector file.

### 55 · Utilities engine in `@household/domain` · `planned`

Phase 3 · after 6 · size L

- **Scope**
  - **Tariff engine**:
    - All 11 component types, with `applies_to` and ordering.
    - VAT normalised whether prices include it or not.
    - **Rounding**: once per consumption component; time components pro-rata by day, summed per month × version chunk; taxes and discounts once each, in order; displayed breakdowns by largest remainder.
    - Versioned conversions (gas m³ → kWh; GJ → kWh) and registers as data.
  - **Intervals**:
    - Blocking: a tariff or conversion change inside an interval blocks pricing.
    - Meter swaps and rollovers.
    - Estimated readings kept out of money.
    - Months counted by the first-day rule.
  - **Projections**:
    - A forecast with each future day priced by its own tariff.
    - The balance and a recommended advance.
    - Headroom with no readings at all.
    - Monthly history, flagging approximate figures.
- **Inputs**
  - PRD: [10-utilities](prd/modules/10-utilities.md) (UT5–UT15, UT18); D-60–D-64
  - Design: `utilities.js` `checks()`
  - home: `modules/electricity` (D134–D161)
- **Done when** `test-vectors/utilities.json` passes in TS, including:
  - 211,67 / 183,45 (the two VAT orderings);
  - 162,00 for a whole month inside one version;
  - the block at 2026-01-01;
  - the rollover 99 926,5 → 320,8;
  - the 44 kWh conversion error;
  - headroom 2 100;
  - balance −476,30;
  - the months rule;
  - the 175,78 settlement difference.
- **PR:** —

### 56 · Utilities — server I: engine twin, presets, structure · `planned`

Phase 3 · after 55, 34 · size XL

- **Scope**
  - **Go engine**, passing the same vectors.
  - **Presets**: **13 tariff presets for five countries**, drafted with sources and versioned (D-61), through item 7's pipeline ([ADR 0008](adr/0008-reference-data-pipeline.md)).
  - **Services** in three modes ([D-60](prd/09-decisions.md)).
  - **Meters and registers**: meters with unit, digits, decimals, multiplier and direction; registers; conversions.
  - **Tariffs**: tariff versions carry a VAT flag, and `effective_from` is unique; components are ordered.
  - **Money over time**:
    - Advance schedules and payments.
    - Billing periods (overlap returns `422`) and bills with per-register finals.
    - Upgrading from bills-only keeps the bills (UT17).
  - **Sync and history**: `strict_version` throughout. Tariffs are audited with field diffs.
  - **Q10**: decide the sync policies for conversions and advance schedules.
- **Inputs**
  - PRD: [10-utilities](prd/modules/10-utilities.md)
  - API: `…/utilities/*` (40 operations, shared with item 57)
- **PR:** —

### 57 · Utilities — server II: readings and computed views · `planned`

Phase 3 · after 56, 35 · size L

- **Scope**
  - **Readings** (`additive`):
    - Values cover the meter's registers exactly.
    - Two-sided monotonicity: `422` over REST and `monotonicity_violation` over sync, naming the neighbour (scenario 17).
    - The invariant is declared, so the client can pre-check it.
    - Rollover is offered, not refused.
    - Meter replacement (UT2).
    - A photo is attached by reference.
    - Corrections happen online under `If-Match`.
  - **Reading anchors and cadence** (Q12).
  - **Computed views**: overview, forecast, history, reconciliation and headroom. The blocked state has cost and balance **absent**, not zero. All computed within budget, never cached (FR-NF2).
  - **Reminder kinds**: `reading_due`, `advance_due` and `contract_notice` ([D-58](prd/09-decisions.md)).
  - **Catalogs**: 2 widgets, 4 metrics, 3 lists, search.
  - **Export**: `utilities-readings.csv`.
- **Done when** the cellar case passes on real entities: the local check accepts the reading, and the server rejects it against 2026-09-06.
- **PR:** —

### 58 · Utilities — web I: setup, services, readings, tariff composer · `planned`

Phase 3 · after 57, 37 · size L

- **Scope**
  - **Setup** (D-1–D-4), driven by presets.
  - **Services**: the overview and detail in all three modes (D-5–D-8).
  - **Readings**: entry (D-9) and the list (D-10).
  - **Tariff composer** (D-12): **eight controls, no free-text or expression fields**, rendered as a human-readable breakdown.
  - **Meter replacement** (D-18).
  - **Mode upgrade** (D-19): nothing is lost.
- **Inputs**
  - Design: `utilities.js`, `utilities-ui.js`, `Utilities.dc.html`
- **PR:** —

### 59 · Utilities — web II: consumption and money views · `planned`

Phase 3 · after 58 · size M

- **Scope**
  - **Consumption**: the chart (D-11).
  - **Money over time**:
    - Advances (D-13).
    - Billing period and settlement (D-14).
    - Bills-only invoices and spend history (D-17).
  - **States with a reason**: the blocked state (D-15) and headroom (D-16).
  - **Compact breakdown** by default ([DD-3](design/08-decisions.md)).
  - **Charts** follow the dataviz rules.
- **PR:** —

### 60 · Utilities — mobile · `planned`

Phase 3 · after 57, 38 · size L

- **Scope**
  - **Screens**: D-1–D-19 on mobile, led by the **cellar screen** (D-9):
    - offline capture;
    - a pre-check against the neighbours the phone holds;
    - the rollover and *lower than last time?* questions asked at the meter;
    - a photo stays pending until it uploads;
    - a rejection surfaced once, with the typed value kept.
  - **Offline overview and forecast**, computed by the local engine.
- **PR:** —

### 61 · Finance engines in `@household/domain` · `planned`

Phase 3 · after 6 · size L

- **Scope**
  - **Allocation engine**:
    - Bases: `own_income`, `total_income`, `source_balance` and `fixed`.
    - Modes: percent, amount and remainder, optionally `per_earner`.
    - **Exactly one remainder per source**, with an error that names the source.
    - The three FI7 invariants.
    - A negative remainder is displayed as 0 with a footnote and stored as it is.
  - **Splits**: five split methods, with adjustments taken out first and the last minor unit assigned by household order.
  - **Balances and settle-up**:
    - pairwise and net balances;
    - simplified and pairwise settle-up suggestions.
  - **Also**:
    - budget projection with rollover;
    - FX from the stored rate ([D-55](prd/09-decisions.md));
    - dedup normalisation.
- **Inputs**
  - PRD: [09-finance](prd/modules/09-finance.md) (FI3–FI9, FI11–FI14, FI17, FI19); D-54–D-57
  - Design: `finance.js` `checks()`
  - home: `modules/finance`
- **Done when** `test-vectors/finance.json` passes, including:
  - `homeRun`;
  - 68 400,00 = 61 900,00 + 6 500,00 and 8 386,67;
  - the 116 620,00 counter-example;
  - −12 026,67;
  - €10 three ways;
  - all five split methods;
  - Petr → Jana 1 240 and Miloš → Jana 310.
- **PR:** —

### 62 · Finance — server I: structure, allocation, FX, currency · `planned`

Phase 3 · after 61, 34 · size XL

- **Scope**
  - **Go engines**, passing the same vectors.
  - **Schema constraints**:
    - a partial unique index for the one remainder;
    - personal accounts must have an owner;
    - ISO 4217 checks.
  - **Accounts and income**: six account types; income entries with a period choice.
  - **Allocation**:
    - Plans and rules, versioned by `effective_from` (`strict_version`).
    - Allocation **derived on read**.
    - Flow-view data, and *post a movement* ("record that you moved it").
    - Missing-period detection.
  - **Categories**:
    - A two-level category tree with country defaults.
    - Rules applied to history (FI20).
  - **FX**: a daily ECB job, with the rate stored on each row.
  - **Base-currency change** ([D-77](prd/09-decisions.md), HA2): previewed, recomputed from stored rates, audited.
  - **Grant defaults**: `none` by default; a child capped at `view` ([D-59](prd/09-decisions.md)).
  - **Q10** for rules and price history.
- **Inputs**
  - PRD: [09-finance](prd/modules/09-finance.md); [17 HA2](prd/modules/17-household-admin.md)
  - API: `…/finance/*` (50 operations, shared with items 63–64)
- **PR:** —

### 63 · Finance — server II: ledger, sharing, budgets, recurring · `planned`

Phase 3 · after 62, 35, 36 · size XL

- **Scope**
  - **Ledger**:
    - One transaction ledger with a `source` discriminator ([D-81](prd/09-decisions.md)).
    - Hard delete, with the full row in the audit event.
  - **Shared expenses**:
    - Multiple payers and participants.
    - Shares that sum to the transaction and name only Finance-granted members (Q4).
    - Settlements (`additive`, writable offline).
    - Balances and settle-up.
    - Unsplit joint expenses (FI15).
  - **Budgets**, with rollover.
  - **Recurring**:
    - Materialised as pending, **never auto-posted**.
    - Price history.
    - Cancellation-window reminders ([D-58](prd/09-decisions.md)).
  - **Inbound one-tap hand-offs** from Shopping, Property, Vehicles, Pets and Utilities.
  - **Catalogs**: 3 widgets, 6 metrics, lists, search.
  - **Export**: the CSVs.
- **PR:** —

### 64 · Finance — import: server and wizard · `planned`

Phase 3 · after 63, 37 · size L

- **Scope**
  - **CSV import**: detects the delimiter and encoding; maps date, decimal and sign; saves named mappings.
  - **camt.053 XML.**
  - **Batches and dedup**: batches; a hash plus the bank reference; suspected duplicates **shown for confirmation**, never silently dropped.
  - **Rules** applied on import.
  - **Wizard screens**: D-35 and D-36 on web. Mobile gets the same flow with the file picker, or honest absence — decide in the PR.
  - **Q10** for import tables.
- **PR:** —

### 65 · Finance — web I: setup, flow view, plan, accounts · `planned`

Phase 3 · after 63, 37 · size L

- **Scope**
  - **Setup step 1** (D-20): the **four illustrated answers**, from illustration-kit compositions.
  - **Setup steps 2–5** (D-21).
  - **Periods**: the period overview (D-22) and the missing-period prompt (D-23).
  - **Flow view** (D-24): stage-major on narrow screens, node-major on wide ones. **It never implies the app moved money.**
  - **Post a movement** (D-25).
  - **Allocation plan editor** (D-26), with a live worked example. The domain preview must equal the server's result.
  - **Accounts** (D-27).
- **Inputs**
  - Design: `finance.js`, `finance-ui.js`, `gaps-ui.js` (category tree, rules, income period), `Finance.dc.html`
- **PR:** —

### 66 · Finance — web II: ledger, expenses, balances, budgets, conflicts · `planned`

Phase 3 · after 65 · size L

- **Scope**
  - **Ledger** (D-28), compact.
  - **Expense editor** (D-29), with all five split methods.
  - **Balances and settle-up** (D-30), showing both suggestion lists.
  - **Money over time**: budgets (D-31), recurring and subscriptions (D-32), price history (D-33), the cancellation-window reminder (D-34).
  - **Finance conflict resolver** (D-37): *"you set 450, Petr set 500 at 18:40."*
- **PR:** —

### 67 · Finance — mobile · `planned`

Phase 3 · after 63, 38, 66 · size L

- **Scope**
  - **Screens**: D-20–D-37 on mobile:
    - expense capture;
    - the ledger;
    - balances;
    - offline settlement;
    - confirming a pending recurring bill;
    - the flow view, stage-major at 360 px;
    - the plan editor;
    - the conflict resolver.
  - **Offline writes**: **`strict_version` enabled for Finance entities, and for every module whose server item merged before this one** (D-84, Phase 3), now that the conflict UI exists on both clients. Admin's entities (item 10) stay online only: a client never changes its permissions offline (D-80, [ADR 0011](adr/0011-households-as-the-platforms-own-module.md)).
- **PR:** —

### 68 · Garden — reference bundle and resolution · `planned`

Phase 3 · after 22, 34 · size L

- **Scope**
  - **Loading**: the catalog and climate profiles load into versioned global tables through item 7's loader, as `household-api migrate` runs ([ADR 0008](adr/0008-reference-data-pipeline.md)).
  - **Bundle**: a per-region bundle and its endpoint, added to `openapi.yaml` (Q11). Clients cache it; it is not synced.
  - **Resolution function**: variety → household override → catalog. One function serves four consumers.
  - **Climate resolution**:
    - a town or map pin, rounded to 2 decimals;
    - frost dates, hardiness zone and season length;
    - manual edits protected by `is_manual`.
  - **Occupancy windows.**
  - **Versioned upgrades** keep overrides.
- **Inputs**
  - PRD: [11-garden](prd/modules/11-garden.md) (GA1–GA3); D-66
  - Design: `garden.js` (Black Krim resolving through three layers; Kuřim vs Córdoba, 84 days apart)
  - home: `modules/garden` (`resolve.go`, `timing.go`, `occupancy.go`)
- **Done when** the resolution vectors pass in TS and Go.
- **PR:** —

### 69 · Garden — server I: places, plantings, harvests · `planned`

Phase 3 · after 68, 35 · size L

- **Scope**
  - **Settings and tier**: the tier is a read filter, so moving between tiers reveals or hides and never migrates ([D-65](prd/09-decisions.md)).
  - **Places**:
    - containers;
    - beds, with zones and lexorank adjacency.
  - **Plantings**: area **or** count, never both; occupancy; the harvest-season rule.
  - **Varieties and overrides.**
  - **Photo journal** (GA9).
  - **Care cadences** produce the `care_due` reminder kind (GA7), not tasks.
  - **Harvests** (`additive`) against expected yield.
  - **Storage items**, edited in place.
  - **Q10** for Garden's unstated policies and the `task_completion` key.
- **Inputs**
  - API: `…/garden/*` (58 operations, shared with items 70–71)
  - Design: `garden-ui.js`
- **Done when** the tier walk keeps the same row counts (14 / 4 / 41 / 88 / 14 / 8 / 4).
- **PR:** —

### 70 · Garden — server II: tasks, seasons, rules, the plan check · `planned`

Phase 3 · after 69 · size XL

- **Scope**
  - **Task generation**:
    - A generation key, tombstones, and a permanent exemption for edited tasks.
    - Drift display, and a one-action shift.
    - The `task_due` reminder kind.
  - **Seasons**:
    - Copy with a rotation offset, including a `dry_run` that writes zero rows.
    - Close.
    - Reopen, which needs `manage` and is audited.
  - **Rules**:
    - crop pairs, family pairs and succession;
    - a crop pair beats a family pair;
    - the built-in seed comes from items 22 and 54.
  - **Plan check C1–C11**:
    - pure Go over a snapshot;
    - configurable severities and per-check disabling;
    - per-season dismissal with a note, reversible;
    - `no_history` for C3 and C8;
    - the reduced set at the beds tier;
    - **never blocks a save**;
    - 800 ms at p95.
- **Done when** the design vectors hold:
  - 18 findings on 37 entities;
  - closing 2026 moves rotation findings from 2 to 7 and feeder findings from 0 to 5;
  - the dry run writes 0 rows.
- **PR:** —

### 71 · Garden — server III: weather, frost, catalogs, exports · `planned`

Phase 3 · after 70, 21 · size M

- **Scope**
  - **Weather**:
    - Fetched twice daily from an **EU-established provider** (Q14), sending rounded coordinates only.
    - About 90 days cached.
    - On failure, it renders from cache (FR-NF3).
  - **Frost warnings**:
    - thresholds: tender plants at ≤ 2 °C, half-hardy at ≤ −2 °C;
    - exemptions for plantings under glass or with the haulm cut;
    - the metrics `frost_risk_tonight` and `plan_warnings`.
  - **Catalogs**: the `garden.work` widget with hold-to-complete, `harvest_ready`, 6 metrics, search.
  - **Catalog suggestions**: queued for moderation in item 21's admin (GA4).
  - **Export**: CSV of plantings and harvests (GA23).
- **Done when** at −2 °C the warning names 6 plantings in beds 3, 7 and 11, and at 6 °C it publishes nothing.
- **PR:** —

### 72 · Garden — web I: setup, pots, beds, catalog, planting editor · `planned`

Phase 3 · after 69, 37 · size L

- **Scope**
  - **Setup**: the four questions (D-38).
  - **Tier homes**: pots (D-39) and beds (D-40).
  - **Catalog**: the browser (D-42) and household overrides (D-43).
  - **Planting editor** (D-44), echoing the resolved dates of its timing window.
  - **Tasks**: the generated list with tombstones (D-45) and drift detail (D-46).
  - **Storage log** (D-50).
  - **Frost warning** (D-51).
- **Inputs**
  - Design: `garden.js`, `garden-ui.js`, `Garden.dc.html`
- **PR:** —

### 73 · Garden — web II: plot tier, plan check, print · `planned`

Phase 3 · after 70, 72 · size L

- **Scope**
  - **Plot tier**: the plot home and the season planner (D-41), compact.
  - **Plan-check panel** (D-47).
  - **Seasons**: the copy dry run (D-48) and close (D-49).
  - **Print** ([DD-14](design/08-decisions.md)):
    - the **print stylesheet** (D-54): greys only, statuses as words, no theme;
    - the **"this month's work"** layout (D-52);
    - the **season plan** layout (D-53).
    - Both fit A4 and US Letter.
- **Done when** "this month's work" fits one A4 page (201,5 mm of 269 mm).
- **PR:** —

### 74 · Garden — mobile · `planned`

Phase 3 · after 71, 38 · size L

- **Scope**
  - **Screens**: D-38–D-51 on mobile, with **tablet layouts** for Miloš.
  - **Offline at the end of the garden**:
    - the catalog answers from the cached bundle;
    - the work list completes by hold;
    - harvests are logged.
  - **Photo journal** capture.
  - **Frost warning.**
- **PR:** —

---

## Phase 4 — Breadth

### 75 · Calendar — server I: calendars, events, recurrence, privacy · `planned`

Phase 4 · after 35 · size XL

- **Scope**
  - **Calendars** in four scopes:
    - household;
    - personal, as a private root ([D-44](prd/09-decisions.md));
    - `member_shared`, an audience with no floor: every member of the calendar is a reader of each of its rows, and a join or a departure rewrites the readers, unless item 17 chose to resolve it through its member list ([04-calendar](prd/modules/04-calendar.md) Sync, D-93);
    - external.
  - **Events**:
    - Each has its own IANA timezone ([D-45](prd/09-decisions.md)).
    - All-day events.
  - **Recurrence**: RFC 5545 with RDATE and EXDATE, extending the domain library in TS and Go.
  - **Editing a series** ([D-46](prd/09-decisions.md)): overrides and the three-way edit (this, this and following, all). Following creates `continues_series_id`; orphaned overrides are surfaced.
  - **Participants and RSVP** (`state_set`).
  - **Privacy** ([D-88](prd/09-decisions.md) as [D-93](prd/09-decisions.md) carries it): a private event on a shared calendar reaches its owner whole, and declares its redacted busy projection as the column list item 17 generates into a client table of its own, which reaches the owner as well; the projection carries its own test.
  - **Availability** data for the who overlay.
  - **Public holidays**: each country's set, under the key its profile's `holiday_set` names (`cz`, `sk`, `de`, `pl`, `gb`), as reference data through item 7's pipeline. Germany's vary by Land and the United Kingdom's by nation (the profiles' notes), so a household there chooses its region within the set.
  - **Catalogs**: the `calendar.event` kind, 2 widgets, 3 metrics, search.
  - **Export**: `calendar.ics`.
- **Inputs**
  - PRD: [04-calendar](prd/modules/04-calendar.md); D-44–D-46, D-88, D-93
  - API: `…/calendar/*` (21 operations, shared with items 76–77)
  - Design: `calendar.js`
- **Done when** these vectors pass:
  - editing the Pilates series touches 1, 67 and 104 terms for the three choices;
  - rent on the 31st lands on 30 Sep;
  - a wall-clock time holds across a DST change;
  - the busy row keeps 5 fields and drops 9.
- **PR:** —

### 76 · Calendar — server II: connections, ICS, CalDAV and iCloud · `planned`

Phase 4 · after 75 · size L

- **Scope**
  - **Connections**:
    - Per member, and **never for a child**.
    - Credentials encrypted with a secret-store key, in a separate table, and absent from exports and logs.
  - **Per remote calendar**: direction (`off`, `import`, `two-way`) and detail, with busy-only offered first ([D-47](prd/09-decisions.md)).
  - **Sync**: incremental, plus a weekly full reconciliation; ETag concurrency; a deleted event becomes a cancellation.
  - **Conflicts** resolve by **ownership**, with the loser preserved ([D-48](prd/09-decisions.md)).
  - **Health**: a staleness badge, notify once, proactive token refresh.
  - **Disconnect** asks keep or remove.
  - **ICS**:
    - subscription polling;
    - the **ICS export feed** as a new route (Q11), amending the contract.
  - **CalDAV**: generic CalDAV with discovery and sync-collection; iCloud with an app-specific password.
- **Inputs**
  - PRD: [04-calendar](prd/modules/04-calendar.md) (CA8–CA13); [05 §10](prd/05-privacy-and-compliance.md); D-47, D-48, D-86
- **PR:** —

### 77 · Calendar — server III: Google Calendar · `planned`

Phase 4 · after 76 · size M

- **Scope**
  - **OAuth**: consent that names what leaves Household ([D-86](prd/09-decisions.md)); token refresh.
  - **Sync**: sync tokens, plus watch channels and a **webhook receiver** (Q11, amending the contract).
  - **Disclosure**: an entry in the privacy notice.
- **PR:** —

### 78 · Calendar — web · `planned`

Phase 4 · after 76, 77, 37 · size L

- **Scope**
  - **Screens**: E-1–E-14 for web, with month view by default.
  - **Editing**: the event editor with recurrence, and the three-choice occurrence edit.
  - **People**: participants, the who overlay, busy blocks.
  - **Connections**: framed as privacy screens.
  - **External conflicts** and **disconnect**.
- **Inputs**
  - Design: `calendar.js`, `Calendar.dc.html`, `gaps-ui.js` (the four scopes, member lists)
- **PR:** —

### 79 · Calendar — mobile · `planned`

Phase 4 · after 76, 77, 38 · size L

- **Scope**
  - **Screens**: E-1–E-14 on mobile, with agenda view by default.
  - **Offline**: the who overlay works offline.
  - **Tablet**: a seven-column week.
  - **Children**: no connection flow at all.
- **PR:** —

### 80 · Asset engine and Property — server · `planned`

Phase 4 · after 35, 46 · size XL

- **Scope**
  - **Platform asset engine**:
    - The tables, and the routes `…/assets/{entity_type}/{entity_id}/…`.
    - The **grant is resolved from `entity_type`**, not from the path: `404` for `none`, and enablement applies.
    - Schedules by time, usage or both, whichever comes first (FR-AS1).
    - Service records, and usage readings that are `additive` and monotonic ([D-68](prd/09-decisions.md)).
    - A projected due date labelled an estimate (FR-AS2), and *"no reading yet"* rather than never due.
    - The due computation also runs in TS and Go, with vectors.
  - **Property**:
    - Properties, including leases with a notice reminder.
    - Items, with categories as reference data carrying default intervals.
    - Contractors.
    - A starter checklist by country ([D-69](prd/09-decisions.md)).
    - Meter locations (PP6).
    - Costs, with a one-tap Finance transaction (PP7).
    - Insured-inventory data (PP5).
  - **Catalogs.**
- **Inputs**
  - PRD: [12-property](prd/modules/12-property.md); [03 §10](prd/03-platform-strands.md)
  - API: `…/assets/*`, `…/property/*`
  - Design: `assets.js`, `property-ui.js`
- **Done when** these vectors pass:
  - the Octavia is due 20 Nov 2026 at 30,8 km/day;
  - the bike is due 21 Sep;
  - the water filter shows *no reading yet*.
- **PR:** —

### 81 · Vehicles — server · `planned`

Phase 4 · after 80 · size L

- **Scope**
  - **Vehicles**: drivetrain, and type-aware bicycles and e-bikes.
  - **Drivers**, who set the reminder audience (Q10).
  - **Odometer**: the asset usage log, in km or miles.
  - **Statutory presets**: five countries as versioned reference data ([D-70](prd/09-decisions.md)), with derivation and override, through item 7's pipeline. The inspection is named by the country profile's `inspection_label` (STK, TK, HU/AU, Przegląd techniczny, MOT).
  - **Dates and cover**: statutory dates and insurance, both `strict_version`, with notice-period reminders.
  - **Fuel and charging log** (`additive`): consumption is **computed between full fills** ([D-71](prd/09-decisions.md)), in l/100 km, kWh/100 km or mpg.
  - **Total cost of ownership**, with depreciation.
  - **Catalogs.** `road_tax_due` is **absent**, not zero, for a Czech passenger car.
- **Inputs**
  - PRD: [13-vehicles](prd/modules/13-vehicles.md)
  - Design: `assets.js`, `vehicles-ui.js`
- **Done when**
  - Four countries land on 2026-10-05 and Germany a year later.
  - Consumption is 5,47 l/100 km against the naive 5,73.
- **PR:** —

### 82 · Pets — server · `planned`

Phase 4 · after 80 · size L

- **Scope**
  - **Pets**: deceased or rehomed pets are archived gently, never deleted ([D-72](prd/09-decisions.md)).
  - **Health entries** (`additive`), typed.
  - **Care schedules** through the asset engine; the next due date counts from completion.
  - **Medication**:
    - Courses (`strict_version`).
    - **Doses** (`state_set`) **keyed on `dose_occurrence`**: given once for the animal ([D-73](prd/09-decisions.md)).
    - Doses generated with correct timezone and day boundaries.
  - **Daily routine**: completions keyed on (item, date).
  - **Records**: vets with an out-of-hours number, feeding and allergies, insurance.
  - **Species presets.**
  - **Weight** with a target range.
  - **Costs**, with the Finance hand-off.
  - **Default grant** `contribute` for everyone, children included (FR-PE10).
  - **Chores link**: a chore can reference a pet.
  - **Q10** for routine items.
- **Inputs**
  - PRD: [14-pets](prd/modules/14-pets.md)
  - Design: `assets.js`, `pets-ui.js`
- **PR:** —

### 83 · Assets — web: Property, Vehicles, Pets and the insurance inventory · `planned`

Phase 4 · after 81, 82, 37 · size XL

- **Scope**
  - **Shared asset screens** (E-15–E-19), worded in **three vocabularies**. No asset-engine word leaks into Pets.
  - **Property** (E-20–E-22), plus the **insurance inventory print**, the third print target (E-23, DD-14).
  - **Vehicles** (E-24–E-28).
  - **Pets** (E-29–E-35).
- **Inputs**
  - Design: `Property, Vehicles, Pets and Chat.dc.html`
- **PR:** —

### 84 · Assets — mobile · `planned`

Phase 4 · after 81, 82, 38 · size XL

- **Scope**
  - **Screens**: E-15–E-35 on mobile.
  - **Vehicles offline**: fuel and odometer entries at a petrol station with no signal.
  - **Pets offline**: doses and routine ticked offline.
  - **Pets detail**: the weight chart, and the vet one tap from the top.
- **PR:** —

### 85 · Chat — server · `planned`

Phase 4 · after 46, 17 · size XL

- **Scope**
  - **Conversations**: general, group and direct. Q3: the grant wins.
  - **Membership**: a message-id floor, and readers on every row the floor bounds (the message, its body, its reactions and its attachments' metadata): the members whose floor its message is at or above. The write that creates such a row sets its readers, and a change of membership rewrites them **in the same transaction** ([D-90](prd/09-decisions.md) as D-93 carries it; item 17's mechanism). There is no `floor_seq`, since nothing pulls the feed.
  - **Messages**:
    - the envelope is `additive`, and the body is `lww_row` with the loser preserved;
    - editing within a window;
    - a tombstone on delete;
    - reply quotes.
  - **Reactions and reads** (`state_set`):
    - reactions keyed on (message, user, emoji), as desired state;
    - read markers monotonic.
  - **Unread counts** are bounded by the floor.
  - **Attachments** under `chat/`, with async thumbnails.
  - **Move to Documents**: a custody transfer that moves storage attribution.
  - **Clean-up and deletion**: clean-up data with thresholds; the bin; the general conversation cannot be deleted.
  - **Realtime payload exception**: marshalled once per audience.
  - **Push** respecting mutes and quiet hours.
  - **Floor-aware search.**
  - **Per-country switch** (Q15).
  - **Export**: `chat.html`.
- **Inputs**
  - PRD: [15-chat](prd/modules/15-chat.md); D-74, D-89, D-90, D-93
  - API: `…/chat/*` (21 operations)
  - Design: `chat.js`
  - home: `modules/chat` (v10/v10.1)
- **Done when**
  - Scenarios 16 and 18 are green on real entities.
  - The move-to-Documents storage vector holds.
- **PR:** —

### 86 · Chat — web · `planned`

Phase 4 · after 85, 37 · size M

- **Scope**
  - **Screens**: E-36–E-42 for web:
    - the conversation list and thread;
    - attachments;
    - unread counts and the floor;
    - **the storage clean-up page**;
    - mute;
    - search bounded by the floor.
- **PR:** —

### 87 · Chat — mobile · `planned`

Phase 4 · after 85, 38 · size L

- **Scope**
  - **Screens**: E-36–E-42 on the Chat tab.
  - **Offline sending**: queued in order, with a pending state.
  - **Attachments** from the picker.
  - **Tab bar**: when Chat is disabled for the country, or the member holds `none` on it, the four-tab bar applies.
- **PR:** —

---

## Phase 5 — General availability (code only)

### 88 · Production infrastructure · `planned`

Phase 5 · after 1–87 (the Phase 4 exit, crop catalog included) · size L

- **Scope**
  - **Provider**: an ADR choosing an EU-established provider in a single EU region.
  - **Infrastructure as code**: Terraform or OpenTofu.
  - **Database**:
    - multi-AZ Postgres 17 with a read replica;
    - WAL archiving (RPO ≤ 5 min);
    - encrypted backups kept 35 days, with separately managed keys;
    - logical replication for PowerSync ([D-93](prd/09-decisions.md)): a provider whose administrator can create a role with `REPLICATION` and `BYPASSRLS` (item 13), and a replication slot that survives a failover.
  - **Compute**: at least two API instances behind a load balancer, and PowerSync, its image pinned, with its bucket storage (item 13).
  - **Object storage**: versioning plus cross-account EU replication.
  - **Secrets and edge**:
    - A managed secret store.
    - TLS 1.3, HSTS preload, and certificate-transparency monitoring.
  - **Delivery**:
    - Zero-downtime deploys with expand/contract migrations.
    - EAS production profiles and update channels.
  - **Services**:
    - An EU email provider with SPF, DKIM and DMARC.
    - The breached-password corpus on a volume beside each API instance, about 8 GB, refreshed quarterly ([runbook](runbooks/breached-passwords.md)), and `HOUSEHOLD_TRUSTED_PROXIES` set to the load balancer's addresses, without which every client shares one sign-in budget.
    - Live Stripe.
    - Expo push credentials.
    - Item 9's keys and provider credentials in the secret store, rotated per [their runbook](runbooks/sign-in-keys-and-providers.md).
- **Inputs**
  - PRD: [01 §1, §9](prd/01-architecture.md); [07 §3–4](prd/07-nonfunctional.md); D-5, D-11, D-93
  - ADR: [0001](adr/0001-sync-engine.md)
- **PR:** —

### 89 · Observability, alerting and resilience drills · `planned`

Phase 5 · after 88 · size L

- **Scope**
  - **Signals** from [07 §5](prd/07-nonfunctional.md):
    - RED per endpoint and per-module error rates;
    - sync queue depth and conflict rate, and **divergence rate as an alert** ([D-85](prd/09-decisions.md));
    - PowerSync's replication lag and the write-ahead log its slot retains, alerting before `max_slot_wal_keep_size` is reached (item 13's runbook, [ADR 0001](adr/0001-sync-engine.md));
    - push outcomes;
    - storage per household;
    - the entitlement distribution;
    - job lag.
  - **Logs**: an EU-hosted store kept 12 months.
  - **Availability**: external uptime monitoring against 99.9 %.
  - **Failure behaviour** (FR-NF3): tested for object storage, push, Stripe, weather and PowerSync outages (item 13).
  - **Drills**: a **monthly automated restore drill** into an isolated environment, and a failover drill, each ending with PowerSync replicating again.
  - **Runbooks**: incident response, breach notification (72 hours, to the EU authority and the ICO), restore and failover, PowerSync's replication slot among them.
  - **Cost per household** (FR-NF6).
- **PR:** —

### 90 · Performance and load · `planned`

Phase 5 · after 88 · size M

- **Scope**
  - **Load tests**: k6 scenarios to the Year-3 targets (4 000 rps, and 40 000 WebSockets if item 17 keeps the socket).
  - **Server budgets**: the p50, p95 and p99 budgets of [07 §2](prd/07-nonfunctional.md), and **query-count budgets** on every endpoint (FR-NF1).
  - **Sync at volume**: PowerSync's concurrent client connections at the Year-3 target item 17 restates for them in [07 §1](prd/07-nonfunctional.md) (one API process serves at most 200, [ADR 0001](adr/0001-sync-engine.md)); its bucket storage, compaction and replication lag; the initial sync of a median household; rewriting an audience's readers; and `sync_changes`' partitioning and retention if item 17 kept the feed.
  - **Client budgets**: mobile cold start under 1.2 s from cache; web LCP and INP.
  - **Fixes** for what the tests find.
- **PR:** —

### 91 · Security hardening · `planned`

Phase 5 · after 88 · size M

- **Scope**
  - **Browser security**: strict-CSP review (no `unsafe-inline`) and security headers.
  - **Disclosure**: `security.txt` and a disclosure policy.
  - **Supply chain**: an SBOM per release, and DAST added to CI.
  - **Limits**: a review of per-household rate limits.
  - **Operations**: secret-rotation runbooks and the dependency-patch SLA (critical ≤ 72 h).
  - **Threat model**: a review of the four access axes.
  - **Penetration test**: remediation of findings. The test itself is off the PR list; a large finding takes a reserve slot.
- **PR:** —

### 92 · Analytics and pricing instrumentation · `planned`

Phase 5 · after 88 · size M

- **Scope**
  - **Analytics** (FR-PR9):
    - Opt-in, into an EU-hosted store (Q14).
    - A decline as easy as accepting.
    - **Children excluded, and the exclusion tested.**
  - **Product metrics**: screen views, activation, funnels, and trial-to-paid conversion by the **first module configured** ([G7](prd/00-overview.md)).
  - **Crash reports**, scrubbed.
  - **Pricing metrics** ([04 §8](prd/04-billing-and-entitlements.md)): object bytes and requests, egress, push and email volume, storage percentiles, the share buying a block, churn split.
  - **Dashboards.**
- **PR:** —

### 93 · Store readiness · `planned`

Phase 5 · after 1–87 · size M

- **Scope**
  - **Listings**: iOS and Android metadata and screenshots in five languages.
  - **Permissions**: the justification table (FR-PR1), generated from app config.
  - **Purchase posture per store and jurisdiction** ([04 §7](prd/04-billing-and-entitlements.md)): an external-link entitlement where available, otherwise the reader posture. Config-driven.
  - **Store requirements verified**: Sign in with Apple and in-app deletion.
  - **Privacy forms**: privacy labels and data-safety forms.
  - **Beta channels**: TestFlight and Play internal testing, opt-in from settings.
  - **EAS Submit.**
- **PR:** —

### 94 · Marketing site, legal pages and web purchase entry · `planned`

Phase 5 · after 88 · size L

- **Scope**
  - **Site**: static, built from `@household/tokens` ([DD-12](design/08-decisions.md)), in five languages.
  - **Pricing** per currency, and sign-up leading into the web purchase flow.
  - **Legal pages**:
    - terms;
    - the privacy notice, with a children's section, the sub-processor list, the calendar-connection disclosure, the sync service's database credentials as the one place the no-content-access guarantee rests on who holds them ([05 §6](prd/05-privacy-and-compliance.md), D-93), and the UK Art. 27 representative and ICO;
    - cookie posture;
    - the DPA page.
  - **Drafts for counsel**: the legal text is drafted here for counsel's review, which is off the PR list.
- **PR:** —

### 95 · Help, translation review and the accessibility sweep · `planned`

Phase 5 · after 1–87 · size L

- **Scope**
  - **Help**: entries completed for every module in five languages.
  - **Translations**: the review ledger cleared once native reviewers sign off.
  - **Sweeps**: pseudolocalisation and 200 % text across every route on both clients.
  - **Accessibility**: WCAG 2.1 AA audit remediation, plus a VoiceOver and TalkBack checklist.
  - **Persona walkthroughs**: `conformance.js` `WALKS` (five personas, 34 steps) as E2E.
- **PR:** —

### 96 · Release candidate — contract closure and launch · `planned`

Phase 5 · after 88–95 · size M

- **Scope**
  - **Contract closure**: `contract_pending` is **empty** (all 486 operations, plus any added under Q11 and Q17).
  - **Totals asserted**: 24 widgets and 21 reminder kinds.
  - **Final checks**:
    - all nine architecture tests green;
    - offline-write flags at their 1.0 state;
    - feature-flag defaults set.
  - **Beta**: fixes from the closed beta in CZ, SK, DE and the UK.
  - **Release**: tags at 1.0.0; as-built notes in the PRD; the GA checklist below ticked.
- **PR:** —

---

## Outside the PR list: GA prerequisites that are not code

Tracked here so they are not forgotten. None of them takes a numbered slot.

- [ ] Second-engineer review of the sync protocol, the policy registry and the retraction path ([10 §8](prd/10-sync-risk.md))
- [ ] A month of dogfooding the `proof` module, then Phase 2, on real phones
- [ ] External penetration test before GA
- [ ] Counsel's answer on the UK Online Safety Act Schedule 1 exemption (Q15)
- [ ] UK Art. 27 representative appointed; UK VAT registration; EU OSS registration
- [ ] DPAs with every sub-processor: hosting, email, weather, Stripe, Expo, analytics, error aggregation
- [ ] Counsel review of the terms, privacy notice (five languages) and DPA
- [ ] Native-speaker review of `cs`, `sk`, `de` and `pl` (clears PL-9 drafts)
- [ ] Agronomic review of the crop catalog; expert review of the tariff presets and statutory vehicle rules
- [ ] CZK and PLN price points (Q1)
- [ ] App Store and Play developer accounts; external-purchase-link entitlements where available
- [ ] Closed beta with real households in at least CZ, SK, DE and the UK

---

## Change log

| Date | Items | Change |
|---|---|---|
| 2026-09-26 | all | Plan created: 96 items across Phases 0–5, with 4 reserve slots |
| 2026-09-26 | 7, 16, 17, 19, 25, 28–32, 34, 36, 37, 39, 40, 44–46, 53, 55, 57, 63, 67–69, 78, 79, 88, 93, 95, 96 | Review fixes: added missing dependencies (G-B, the client items, the reminder strand, the conflict UI, Google, GA). Added a dogfood environment and a month gate on removing `proof`. Moved the reference resolver to item 36 and F-18 to the Notes clients. Assigned the offline `strict_version` writes. Recorded contract gaps (Q11, Q17). Corrected vectors that differed from design/v1. Removed hand-kept progress |
| 2026-09-26 | PL-1, PL-8, 1, 14 | Item 1: MinIO replaced by RustFS as the dev S3 store, because MinIO's repository is archived and its images are no longer published. PL-1 gains `tooling/`, a workspace package for guards over the workspace itself (strict flags, catalog pins, local/CI parity) |
| 2026-09-27 | 3 | Item 3: the tenant middleware resolves the caller in a transaction of its own, and each unit of work opens its own transaction with the tenant settings, committed before the handler answers, instead of one transaction held for the request, which would commit after the response ([ADR 0005](adr/0005-tenancy-registry-and-row-level-security.md), PRD 01 §2.2 amended). A tenant table added later also adds its rows to the isolation fixture (`server/internal/arch/testdata/isolation/fixture.sql`) |
| 2026-09-27 | 4, 6, 8, 9, 10, 13, 17, Q11 | Item 4: `tenant.InTx` is read-only and `mutation.Apply` is the only write, committing only what it records; the feed takes a per-household lock so a household's rows commit in `seq` order, and is keyed `(household_id, seq, occurred_at)` because it is partitioned by month (PRD 03 §2.2 amended); the contract gains `idempotency_in_progress`, and a key stores only a `2xx` response (D-92, [ADR 0006](adr/0006-sync-ready-schema-and-the-mutation-spine.md)); item 6's typed `409` admits it beside `version_conflict`. Items 8, 9 and 13 set the audit `via`, item 8 the actor label, item 17's partition maintenance handles the default partition, and its compaction horizon is the greatest `seq` it dropped, since monthly partitions overlap in `seq`. `Idempotency-Key` covers module routes; item 10 mounts it on its household routes, and item 8 decides where the keys of routes outside a household live. Q11 records three creates that do not require the client's id |
| 2026-09-27 | 5, 9, 12, 13, 16, 17, 18, 20, 21, 27, 28, 30, 31, 34, 43, 75, 85, 88–90, 94, PL-5, PL-6, Q2 | Item 5: the spike's verdict is to adopt PowerSync, self-hosted, for replication and keep the write path, every push going through the mutation spine (D-93, [ADR 0001](adr/0001-sync-engine.md)). Items 12, 13, 17 and 18 are rewritten around it. The conformance suite drives PowerSync clients against the real stack instead of an in-process engine. Item 13 deploys PowerSync, generates its streams from the entity registry, and gains item 9 as a dependency, for the tokens PowerSync validates. Item 17 adds the visibility and audience streams and decides what becomes of `sync_changes`, the digest, the reset and the stream. Item 18 wraps PowerSync's SDKs. PL-5's replica is op-sqlite in a dev build, PL-6 and G-C's fallback (now: build the engine) follow, and items 9, 20, 27, 28, 31 and 90 drop the replaced cursor, snapshot and simulator. Items 75 and 85 keep an audience's readers on each row instead of `floor_seq`. Item 12 runs against stand-ins of its own until items 13 and 17 land; item 13's PowerSync token carries an audience item 9's access token does not; item 17 keeps `sync_changes`' partitions while the spine still writes it; item 18's connector records each write's `client_time`, handles a refusal of the whole batch, and proves the queue survives a restart, which the spike did not test. PowerSync's replication role, with its bucket storage's credential, is the one exception to D-3 (PRD 01 §2.3, 05 §6), so item 21's no-content-access test leaves it out and item 13 amends the contract's statement that no role bypasses row-level security. Items 30 and 88 deploy PowerSync to staging, the dogfood environment and production, whose provider must let an administrator create that role. Item 34's failed gate takes the new fallback, not a vendor. Item 12 scripts reordering as the order in which clients reconnect. Items 17 and 85 put readers on every row an audience bounds, not only on messages, and item 17 may resolve a `member_shared` calendar, which has no floor, through its member list. Item 17 also settles the push response's `seq` and every frame the socket carries, not only Chat's, and weighs the digest against what bucket checksums cannot see: the buckets against PostgreSQL. Item 18's connector handles a `409 idempotency_in_progress` and a `422`. Item 12 carries a connector of its own that holds and replays scenario 14's and scenario 8's mutations, since items 13, 16 and 17 need those scenarios green before item 18 exists. Item 18's connector sends several queued transactions to a batch, since a device may send 60 a minute, and its withdrawn state is a row that left the replica, which items 13 and 18 must tell from a deletion by another member. Item 13 holds the bucket storage's credential to the service alone, item 27 shows the last checkpoint that FR-HA19 still asks for, item 75 leaves item 17 its choice for a `member_shared` calendar, and item 94's privacy notice states the sync service's credentials as PRD 05 §6 requires. Item 13's isolation test connects a member of two households, since the spike's members each belonged to one; item 17 schedules PowerSync's compaction nightly, since bucket storage keeps superseded data until it runs, and builds a socket it keeps; item 18 carries the client half of the socket and the digest if item 17 keeps them; item 89 alerts on PowerSync's replication lag, which the ADR says is monitored. Item 16 holds a `suspended` household's Sync ✗ on PowerSync's read path, which passes no tenant middleware. Item 75 declares its busy projection as item 17's column list rather than two feed rows, and item 43 retracts a note made private through its streams rather than by emitting retractions. Item 17's redacted stream keeps an audience's readers, its metrics keep the divergence item 89 alerts on, its feed decision amends PRD 07 §1 and weighs G-C's fallback, and item 18 shows a held `deferred` mutation as pending. Item 20, whose nightly erasure job item 17 precedes, runs item 17's compaction after it; item 17's feed decision also amends PRD 01 §3 and §10 if the write stops. Item 13 defines PowerSync's failure behaviour under FR-NF3, keeps its `debug_api` off, and holds every streamed table in the publication; item 89 tests PowerSync's outages and drills its recovery, and item 90 measures its concurrent connections, which one API process caps at 200, and `sync_changes` at volume if item 17 kept it. Item 17 keeps a rewrite of an audience's readers from counting as an edit, since item 4's `touch_entity` would bump every row's version and turn queued edits into conflicts, and takes a member removed from the household out of every audience's readers; item 13 amends the contract's device sync cursor; item 18 keeps a batch's mutations fixed under its key and gives a split batch keys of its own; item 12 names item 16 among the items that switch scenarios on. Item 13's member stream checks the module's enablement as the owner's does, and its Inputs name the D-3 exception, the bucket storage and the sync token it builds; item 17 records keeping an audience's readers out of the version in a new ADR, since ADR 0006's trigger bumps it on every update, and its streams test a reader table as well as readers on the row. Item 17 takes a reader table, which the probes accepted only alone, only once the suite shows it beside the grant, as it does the calendar's member list, and restates PRD 07 §1's connection target for PowerSync, which item 90 measures; item 18's connector renews the API's credential on a `401`, not PowerSync's token; items 13 and 21 count the bucket storage's credential in D-3's one exception, as D-3 does. Item 12 scripts a held `deferred` or `entitlement` mutation replayed after a later write to the same row, the one reorder within a client; item 17 holds every row a private item or root bounds to its owner, since a stream reads no feed row, and settles the point a kept digest is computed at, since a PowerSync client has no feed cursor. Item 17 keeps a rewrite of the visibility and owner such a row carries from counting as an edit, as it does an audience's readers, and writes the row leaving the buckets into FR-SY7; item 13's replication role reads the tables later modules create through a `SELECT` grant, which `BYPASSRLS` does not give; item 12's stand-ins include the replication role and publication, and its Inputs name the spike's SQL, configuration and backend as well as its harness; item 90 load-tests the socket only if item 17 keeps it; items 20, 21, 27, 34, 43 and 85 name D-93 among their Inputs. Item 13's replication role reads only the tables in the publication, not every table by default privileges, since it reads past row-level security, and its contract change amends the contract's description of the offline data path; item 18's connector keeps each outcome other than `applied` with its mutation, since the next checkpoint replaces the local write that the conflict inbox and scenario 17 need; items 13, 17 and 18 name ADR 0001 among their Inputs |
| 2026-09-28 | 6, 15, 24, 28 | Item 6: the API client is generated on every build and not committed, the server renders the clients' own catalogs through a Go module in `packages/i18n`, both renderers share one ICU subset held by `vectors/i18n.json`, and money rounds ties away from zero with a refund split as its charge negated (D-94, [ADR 0007](adr/0007-shared-packages-client-catalogs-and-vectors.md)). Item 15 adds the date, time and money arguments its messages need to both renderers, since the subset has none; items 24 and 28 take `@household/i18n`'s translator and pseudo-locale rather than building a runtime; item 28 installs a `crypto.getRandomValues` polyfill, which `newId` needs on Hermes, and `Intl.PluralRules` where Hermes still lacks it, with the i18n vectors' plural cases run on the device's engine |
| 2026-09-28 | 7, 10, 21, 22, 40, 46, 56, 68, 75, 81, Q11 | Item 7: reference data is JSON under `reference-data/`, one record per file, each field a value with its source and a `drafted` flag that is the review ledger, and every text in the five languages, which a test holds to `i18n.Locales`. The server embeds it, `reference.Read` checks it against JSON Schemas and across files, and `household-api migrate` loads it after the migrations: a row's version, and its dataset's, move only when a value changes, so a repeated load writes nothing, and no row is ever deleted (D-11). The reads are a fourth scope, `/api/v1/reference/…`, for any authenticated user, with every name in every language ([ADR 0008](adr/0008-reference-data-pipeline.md); PRD 01 §2.4 amended: the languages are not a `locales` table). The United Kingdom's profile is `GB`, its ISO 3166-1 code, and like every profile defaults to metric units, as PRD 03 §9 does; the contract's `first_day_of_week` counts 0 as Sunday, and its household's `country` is a `CountryCode`. Item 10 takes a new household's units and first day, when the request omits them, from its country's profile, and refuses a country without one; item 21's admin edits write the loader's tables, so it decides what the next load does to one. Items 22, 40, 46, 56, 68, 75 and 81 put their sets through the same pipeline, and the first of them adds the registry hook for a module's datasets; items 46 and 75 define the sets a profile's `document_type_set` and `holiday_set` name, and item 81 labels the inspection with `inspection_label` |
| 2026-09-28 | 8, 9, 10, 14, 15, 20, 25, 30, 88, Q14 | Item 8: passwords are Argon2id at RFC 9106's second parameters, screened against Have I Been Pwned's corpus kept as a sorted file of 8-byte SHA-1 prefixes that `cmd/breach-dataset` builds; a web session is bound to its CSRF token, both cookies `__Host-`, and a failed check or a foreign origin answers the new protocol-level `403 csrf_failed`; sign-in throttles count in PostgreSQL by the address asked for, and the API's per-user and per-household buckets in memory; a signed-in user's `Idempotency-Key` lives on their account and a request before sign-in, or one whose body carries a password, keeps none; the emails go out after the response ([ADR 0009](adr/0009-accounts-sessions-throttles-and-the-breach-corpus.md); D-95 a session lasts 30 days from its last use with no maximum; D-96 the resend limit, the registration note's limit, the network's limits on a reset and a resend, the household's API budget and the login cooldown; D-97 no key before sign-in or on a password; PRD 01 §6 and 02 §2, §9 amended). The contract gains `csrf_failed` and `invalid_credentials`, `first_day_of_week` and a nullable `timezone` on `Me`, a `410` on a spent reset link and an email format the edge checks, and loses the sign-in's `403`, which FR-ID3's generic failure contradicts. Item 8 also builds `POST /auth/password`, which no item named, and leaves the account-wide quiet hours to item 15, which owns `/me/notification-preferences`. Item 9 adds the mobile sign-in item 8 refuses, ends a device's family on sign-out, and keeps secrets out of the account's keys; item 10 counts invitations on item 8's throttles and checks the inviter is verified; item 14 lets `avatar_url` be set; item 15 sweeps item 8's tables and sends email durably if it must; item 20 makes a disabled account's sign-in fail generically and keeps no key on `POST /me/deletion`; item 25 sends the CSRF token and reads the emails' links from the fragment; items 30 and 88 deploy the corpus and trust the load balancer; Q14 adds an IP-to-place source |
| 2026-09-29 | 9, 11, 13, 15, 21, 25, 27, 29, 30, 88, Q11, Q14 | Item 9: a device signs in with a token pair whose access token, EdDSA under `HOUSEHOLD_TOKEN_KEYS` and named by its key's thumbprint, authenticates only while its device's sign-in is live, read per request; a refresh token rotates, a reuse revokes the family and sends the takeover notice, except a retry within a minute while the next token is unused (D-98), and a device's sign-in lasts until revoked (D-99); the second step is TOTP sealed under `HOUSEHOLD_MFA_KEYS` with recovery codes kept as HMACs, asked of every browser and device not trusted for 30 days, ten wrong codes lock it until a recovery code or support (D-100), and five wrong codes in five minutes per account and sixty provider starts an hour per IP are limited (D-101); Google and Apple sign in by OIDC with PKCE checked on the server, and an identity whose address any account has answers `link_required` (D-102); a client names itself in `Household-Client`, and one below its type's minimum is answered `400 update_required` before the contract is checked ([ADR 0010](adr/0010-mobile-tokens-second-step-providers-and-client-versions.md); PRD 02 §2, §9 and 06 §7 amended). The contract gains `update_required` and `UpdateRequiredProblem`, `trust_token`, `DeviceSignIn`, `recovery_codes_left`, `mfa_recovery_codes_left`, `OauthCallbackRequest`, and `POST /auth/mfa/recovery-codes` for A-6's new set, which no operation served. Q14's IP-to-place source moves to item 30, `approximate_location` staying null. Item 11 signs a child in through the device store; item 13 signs PowerSync's tokens with the same keys and publishes `token.Keys.JWKS`; item 15 fills `devices.push_token` and sweeps item 9's tables; item 21 unlocks and turns off a second step for support; items 25 and 29 send the client header and build the second step, the takeover notice and the provider sign-in, item 25 with a page Apple's form post reaches, item 29 with an operation for the native SDKs' ID token or an in-app browser (Q11); item 27 adds the operation C-57 needs (Q11); items 30 and 88 deploy the keys and providers per the new runbook |
| 2026-09-29 | 10, 11, 13, 15, 16, 17, 20, 36, 67 | Item 10: the household surface is `admin`, a module the platform serves itself (`module.PlatformModule`), whose every write goes through the spine as four `strict_version` entities never written offline, `admin.household_settings` on `households`, `admin.membership` carrying its grants, `admin.module_enablement` and `admin.invitation`; memberships and enablements gain an `id` and the base columns; a household's settings, code and payer are its own row's; `tenant.Assume` holds a household for its creator and an invitation's holder, and architecture test 4 keeps it out of modules; invitations have a policy of their own, by token and by verified address; leaving keeps its key on the account ([ADR 0011](adr/0011-households-as-the-platforms-own-module.md); D-103: no child is invited, an email invitation is its address's, an owner's invitations lapse with their ownership, every member reads the members and the settings, the payer stays an owner; PRD 02 FR-HH2, FR-HH3, FR-HH6, FR-AC3 and modules/17 Data model, Sync and Permissions amended). The contract gains `postHouseholdsByHouseholdIdJoinCode`, `max_uses` and `uses`, `LeaveBlockedProblem`, `Membership.version` and member `ETag`s, the 80 characters of `HouseholdCreate.name` on `HouseholdUpdate.name`, the `403` of revoking and resending, and an invitation's id as its addressee's token, and loses `postHouseholds`' unverified `403`, which FR-HH1 contradicts. Item 11 writes a child's membership through the surface and adds the household code's read path; item 13 streams admin's settings, members and enablement to every member; item 17 retracts from `household.Hooks.Lost`; item 15 notifies from `household.Hooks.Changed` and takes over the invitation emails; item 16 starts the trial from `household.Hooks.Created`, fills `entitlement` and settles the household ceiling's status; item 20 starts a private root's window from `Lost`; item 36 applies an invitation's `dashboard_layout`; item 67 leaves admin's entities online only |
| 2026-09-29 | 11, 13, 14, 15, 20, 25, 29 | Item 11: a child profile is a `users` row with no address whose one credential is a `child_pin`, and a `memberships` row whose role is `child`, carrying its birth year and whether its dashboard is locked, both keyed on the client's `id`; the household code opens its household's child profiles and no adult (`postAuthChildProfiles`), thirty unknown codes an hour per network; the sign-in is a device's with no second step; ten wrong PINs since the last right one, counted on `credentials.failures` before each is checked, lock the profile until an owner unlocks it or sets a new PIN, which also signs it out of every device; a shared tablet holds one sign-in per profile; a graduation's link, 14 days, sets the password that verifies the address and makes the profile a member (`postAuthGraduationConfirm`), and lapses with its sender's ownership, as an invitation does; a child profile cannot create a household, leave, or link a provider, and one removed is signed out of every device; the shared tablet signs each profile in once with its PIN, which this item's scope first had an owner authorise; the household surface serves every child route with identity's account half, and the two PIN routes keep no key ([ADR 0012](adr/0012-child-profiles-pins-and-graduation.md); D-104; PRD 02 §4, §6, §9 and FR-ID3, 05 §7 and modules/17 amended). The contract gains `postAuthChildProfiles`, `postAuthGraduationConfirm` and `ChildProfileList`, a required `DeviceSignIn` and a PIN pattern on `ChildLoginRequest`, the `403` of a child's household, leaving and provider link, and says what each child operation does. Item 13 streams a child's lock and dashboard lock, never its birth year; item 14 lets a child's avatar be set; item 15 tells owners of a lock and moves the graduation email onto the transport; item 20 erases a removed child profile's account; items 25 and 29 build the graduation page, the owner's child controls, the profile list and the tablet switcher |
| 2026-09-29 | 12, 13, 16, 17, 18 | Item 12: the conformance suite is `packages/sync/conformance`, with a stack of its own (PostgreSQL with logical replication and PowerSync 1.26.1, `conformance:up`), run in CI on every change and in a nightly long fuzz run; its scenarios write a test module of its own, `conformance` (`server/internal/conformance`, block 98), one entity for each shape they need; the stand-ins are `cmd/conformance-standin` (a sign-in, PowerSync credentials signed HS256, a push writing items and their checks through the spine) and hand-written streams with the household as the subscription's parameter; every replica is judged against the suite's own statement of the access predicate, computed from PostgreSQL apart from the streams, and invariant 5 bucket by bucket, a bucket made again starting from nothing; each write records its mutation as PowerSync's row metadata; the access changes are the administrator's, since item 10's routes grant only the contract's modules; every scenario waits, named with the item that switches it on, scenario 13 as two keys and the causes of access loss as keys of their own ([ADR 0013](adr/0013-conformance-suite-stand-ins-and-the-oracle.md)). Item 13 moves the suite onto the engine and settles the batch's `maxItems` against its declared `413`; item 17 switches on its scenarios and confirms how scenario 2's loser is surfaced; item 18's connector replaces the suite's; item 16 switches on scenario 14 and settles the entitlement rejection's code. Item 13's generated streams look up every table by the caller or the subscribed household, since PowerSync refuses a connection whose parameter results pass 1000, which item 12's stand-in streams reached at 250 households |
| 2026-09-30 | 13, 16, 17, 18, 25, 30, 88, 89 | Item 13: PowerSync 1.26.1 runs beside the development PostgreSQL, now at `wal_level=logical` (`pnpm run up:sync`, `deploy/powersync`); `household-api bootstrap` makes its replication role, `household_powersync`, with `REPLICATION` and `BYPASSRLS`, refusing an administrator that cannot give them, and its bucket storage; a platform migration makes the `powersync` publication, owned by the migrate role, and `replicate(tbl)`, which each migration calls on a table a stream reads; the streams are generated from the registry (`internal/syncconfig`, `pnpm run gen`), `Grant` as two arms, a new `Members` axis for admin's settings, memberships and enablement, `sync.Entity.Columns` keeping a household's code, an invitation's token and a child's birth year off every replica, the tenant root keyed by its own `id`, tombstones kept, and `Owner` and `Audience` entities withheld until item 17; architecture test 10 holds the committed configuration to the generated one and every table a stream reads to the publication; a membership carries its grants and a child's PIN lock; `POST …/sync/credentials` hands a device or a web session PowerSync's URL and a five-minute EdDSA token that PowerSync verifies through `GET /sync/jwks`; the push (`internal/platform/push`) checks each mutation's entity, grant, offline flag, dependencies and policy, holds an additive series to its invariant, and hands the write to its module's `push.Writer`, keeping each ended answer for 7 days under its household, its sender and its id, a batch over 500 refused `413 batch_too_large` rather than `422`, 60 batches a minute per device or session; the conformance suite runs against the engine through `cmd/conformance-api`, the server's own API with the conformance module and a sign-in of the suite's, and its item-13 scenarios are on ([ADR 0014](adr/0014-powersync-deployment-generated-streams-credentials-and-the-push.md); D-105 PowerSync's failure behaviour; D-106 each mutation's answer kept under its sender; PRD 01 §10, 02 FR-ID7, 03 §2.3–§2.4, 07 FR-NF3, 10 §6 (every outcome but `applied` carries a `code`, as this item's scope now says) and modules/17 Sync amended). The contract loses `getSyncChanges`, `postSyncSnapshot`, their schemas and `Device.sync_cursor`, and gains `postSyncCredentials`, `getSyncJwks`, `SyncCredentials` and `JsonWebKeySet`. Item 17 generates the withheld entities' streams; item 18 subscribes to the generated streams by name; item 16 gates the push and the credentials on the entitlement; item 25 shows D-105's not-receiving state; items 30 and 88 deploy PowerSync with the JWKS reachable; item 89 tests D-105 and drills the slot's loss |
| 2026-09-30 | 14–18 | Renumbered by build order, old → new: 16 → 14 (Files and storage metering), 17 → 15 (Scheduler and notification transports), 18 → 16 (Entitlements and the 402 gate), 14 → 17 (Sync engine II) and 15 → 18 (`@household/sync`). Sync engine II waited for Files and Entitlements from the plan's first commit, since G-B's scenarios need the upload (scenario 12) and the entitlement gate (scenario 14), so its number put it before two items it could not start without. The new order is the stable topological one: no other item moves. Every reference follows the new numbers, in done items and earlier Change log rows as well as the ADRs, the PRD, the design handoff, the contract's descriptions, code comments and the conformance suite's `enabledBy`, since a number names an item and records nothing of its history. Rule 6 keeps every **after** list to lower numbers, and `tooling/src/plan.test.ts` fails a plan that breaks it |
| 2026-09-30 | 16 | Item 16 waits for item 15: its hourly transitions run on item 15's scheduler, and its retention warnings go out through item 15's transports |
| 2026-09-30 | 14, 15 | Item 14 builds the usage sampler and item 15 schedules it nightly, as it does item 8's and item 9's sweeps, since item 14 comes first and has no scheduler to register with |
