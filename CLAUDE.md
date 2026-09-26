# Household — working conventions

Household is a multi-tenant, offline-first household-management platform: a Go modular
monolith on PostgreSQL 17, an Expo app and a React web app, built from a written
specification. Read this before planning or changing anything.

## Where the truth lives

**PRD > `openapi.yaml` > `docs/design` > `design/v1`.** When two disagree, follow the higher
one, say so in the PR, and amend the lower one if it lives in this repository (`design/v1`
is left as it is).

| Source | What it settles |
|---|---|
| [`docs/prd/`](docs/prd/README.md) | Behaviour, decisions (`D-n`), requirements (`FR-xx`) |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | The HTTP contract. The implementation is checked against it, never the reverse |
| [`docs/design/`](docs/design/README.md) | The design handoff: foundations, components, patterns, screens |
| [`design/v1/`](design/v1/) | A clickable ES5 prototype: behavioural reference, fixtures and worked numbers. Not code to ship |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | The build order, one numbered item per pull request |
| `../ws-tilcer-home` | The predecessor, `home`. Port its logic and tests, never its schema |

## Commands

Needs Docker, pnpm and Go. Everything else is pinned in the repository, Node included: pnpm
downloads the version `devEngines.runtime` names and runs every script on it.

```bash
pnpm install          # workspace dependencies
pnpm run up           # Postgres 17, RustFS (S3) and Mailpit, waiting until healthy
pnpm test             # Vitest through turbo, then go test against the compose Postgres
pnpm run lint         # ESLint, golangci-lint, Redocly and Prettier
pnpm typecheck        # tsc in every package
pnpm run gen          # code generation (turbo gen + go generate)
pnpm run format       # Prettier and gofmt/goimports, rewriting files
pnpm run down         # stop the services; volumes are kept
```

- **`pnpm run up`, never `pnpm up`.** `pnpm up` is pnpm's own `update` command and rewrites
  the lockfile.
- **Go tools are pinned per tool** in `server/tools/<tool>.mod` and run through `go tool
  -modfile=…`: `lint:go` (golangci-lint), `audit:go` (govulncheck) and `secrets`
  (gitleaks). Each has its own modfile, so no tool's dependencies can move another's.
- **Go tests need the database.** They fail, rather than skip, when PostgreSQL is not
  reachable. Set `HOUSEHOLD_TEST_DATABASE_URL` to point them elsewhere.
- CI ([`.github/workflows/`](.github/workflows/)) runs all of the above, plus
  openapi-spec-validator, pnpm audit and CodeQL.

## Layout

| Path | What |
|---|---|
| `server/` | The Go module: `cmd/`, `internal/platform/…`, `internal/modules/<name>` |
| `apps/web`, `apps/mobile` | The two clients. They share the contract, the tokens and the strings, never components (D-36) |
| `packages/*` | `api` (generated client), `i18n`, `tokens`, `icons`, `domain`, `sync`, `test-vectors` |
| `tooling/` | Guards over the workspace itself: strictness, catalog pins, local/CI parity |
| `reference-data/`, `fixtures/` | Sourced reference content, and the seed ported from `design/v1` |
| `docs/adr/`, `docs/runbooks/` | Architecture decision records, and operational procedures |

## Conventions that are never negotiated

- **Money** is `amount_minor` (an integer in the currency's minor unit) plus an ISO 4217
  `currency`. Never a float, never `numeric`: in Go types, in SQL, in JSON.
- **Identifiers** are UUIDv7. Clients generate them, and every household-scoped create
  **requires** `id` in its body. A server-minted id online and a client id offline is the
  dual identity D-23 exists to prevent.
- **Instants** are `timestamptz`, RFC 3339 with an explicit offset on the wire. **Calendar
  days** are `date` (`YYYY-MM-DD`) in the household's timezone, which is never assumed.
- **English is the source language** of every identifier, enum value, log message and
  comment. No user-visible string is a literal: it is a translation key, present in all five
  catalogs (`en`, `cs`, `sk`, `de`, `pl`).
- **The tenant is in the path**: `/api/v1/households/{household_id}/…`. Every tenant table
  has `household_id`, row-level security enabled **and** forced.
- **`404`, not `403`,** for anything the caller may not see: a module they hold `none` on, a
  disabled module, a private item, a conversation they are not in. `403` means "you can see
  it and may not do this to it".
- **The mutation spine.** Every mutation writes its row, an audit event and a sync change
  in one transaction, through one service-layer entry point. REST and sync both write
  through it.
- **Errors** are RFC 9457 problem documents. Clients switch on `code` (the `ProblemCode`
  enum), never on `detail`.
- **Concurrency and retries**: `version` travels as an `ETag` and returns in `If-Match`
  (`409` carries the current representation); unsafe methods accept `Idempotency-Key`.
- **Migrations** are goose, one numbered block per module, forward-only and
  expand/contract: an old app in the field must keep working against the new schema.
- **Tests hit real PostgreSQL.** No database mocks: RLS, `SET LOCAL` and the change feed
  cannot be tested against one.
- **TypeScript is strict**: `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride` and `noFallthroughCasesInSwitch`. `any`
  and non-null assertions are lint errors, and lint warnings fail the build.

## Working from the plan

1. **Start an item** only when every item in its *after* list is `done`. Read the item, the
   plan's conventions, its **Inputs**, and any row in *Decisions to settle* that names it.
2. **Branch** `feat/NN-<slug>`; **PR title** `[NN] <item title>`. The PR template carries the
   Definition of done.
3. **The item's own PR** sets its status to `done` and fills in its **PR** line.
4. **Plan decisions (PL-n)** and `planned` items may be rewritten when the build shows them
   wrong. Rewrite in the PR that found it and add a line to the plan's Change log. `done`
   items are history.
5. **A product decision or a behaviour change** updates the PRD in the same PR, with a
   `D-n` entry that names the alternative it rejected. Record a technical choice that
   outlives its PR in [`docs/adr/`](docs/adr/README.md).
6. **Any change to `openapi.yaml` is deliberate**, and the PR says why. Mind the three
   authoring hazards in [`docs/api/README.md`](docs/api/README.md): YAML 1.1 booleans, commas
   in flow-mapping scalars, and flow mappings wrapped across lines.
