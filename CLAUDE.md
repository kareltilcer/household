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
pnpm run up           # Postgres 17 (logical replication), RustFS (S3) and Mailpit, waiting until healthy
pnpm run db:setup     # create the database roles and PowerSync's storage, then apply the migrations
pnpm run up:sync      # PowerSync, once db:setup has made its role, its publication and its storage
pnpm run up:convert   # build and start the converter sidecar (LibreOffice, poppler): office and PDF previews
pnpm run up:stripe    # Stripe's own mock server, which the test of what billing sends Stripe runs against
pnpm run dev:api      # serve the API on 127.0.0.1:8080 (/api/v1/healthz, /api/v1/readyz)
pnpm run dev:web      # the web app on Vite's dev server, /api proxied to dev:api
pnpm test             # Vitest through turbo, then go test against the compose Postgres
pnpm run lint         # ESLint, the stylesheets' check, golangci-lint, Redocly and Prettier
pnpm typecheck        # tsc in every package
pnpm run gen          # code generation (turbo run gen + the tokens' stylesheet and the vendored icons + go generate + the client registries, which need Postgres)
pnpm run format       # Prettier and gofmt/goimports, rewriting files
pnpm run down         # stop the services; volumes are kept
pnpm --filter @household/sync conformance:up   # the sync conformance stack: PostgreSQL with logical replication, PowerSync
pnpm --filter @household/sync conformance      # the conformance suite against it (packages/sync/conformance)
pnpm --filter @household/sync conformance:web  # @household/sync's web replica in Chromium against it (Playwright)
pnpm --filter @household/web build      # the web build a deployment serves (dist/www)
pnpm --filter @household/web check      # that build held to its bundle budget, the policy and its own id
pnpm --filter @household/web e2e        # builds it again with the dev-only routes (build:e2e), then Playwright against an API it starts itself: axe, the pseudo-locale pass, the policy, the critical paths (needs up, db:setup and up:sync; stop dev:api first)
```

- **`pnpm run up`, never `pnpm up`.** `pnpm up` is pnpm's own `update` command and rewrites
  the lockfile.
- **Go tools are pinned per tool** in `server/tools/<tool>.mod` and run through `go tool
  -modfile=…`: `lint:go` (golangci-lint), `audit:go` (govulncheck) and `secrets`
  (gitleaks). Each has its own modfile, so no tool's dependencies can move another's.
- **Go tests need the database and the object store.** They fail, rather than skip, when
  PostgreSQL or RustFS is not reachable, and run with `-count=1` so that no cached result stands in
  for a run. Set `HOUSEHOLD_TEST_DATABASE_URL` and `HOUSEHOLD_TEST_OBJECT_STORE_URL` to point them
  elsewhere; `testsupport.ObjectStore` gives a test a bucket of its own. The converter's real-sidecar
  test runs only when `HOUSEHOLD_TEST_CONVERTER_URL` names one, as CI's converter job does, and the
  test of what billing's Stripe processor sends only when `HOUSEHOLD_TEST_STRIPE_URL` names Stripe's
  mock, as CI's stripe job does. A package that touches the
  database calls `testsupport.Main` from its `TestMain` and gets its own clone of a
  migrated template (`testsupport.Open`); `testsupport.Serve` checks every response a test
  sees against `openapi.yaml`.
- **The contract is enforced from both ends.** Request bodies and parameters are validated
  against `openapi.yaml` at the edge. Architecture test 6 fails when a route and the
  contract disagree; `server/internal/arch/contract_pending.txt` lists the operations not
  built yet, and the PR that builds one deletes its line. `pnpm run gen` regenerates the Go
  `ProblemCode` enum after a contract change, and a test fails until it has.
- **The sync configuration is generated and committed**: `pnpm run gen` (`go generate`) writes
  PowerSync's streams from the entity registry into `deploy/powersync/sync-config.yaml` and the
  conformance suite's stack, and architecture test 10 fails a committed one that is not what the
  registry generates, a table a stream reads that its migration did not publish with `replicate`,
  and a table the replication role may `SELECT` that no stream needs ([ADR 0014](docs/adr/0014-powersync-deployment-generated-streams-credentials-and-the-push.md)).
  The client registries `@household/sync` builds a replica from (`packages/sync/src/generated/registry.json`
  and the suite's beside its configuration) are generated from the entity registry and the migrated
  schema's column types: `pnpm run gen` writes them through `internal/syncconfig`'s test with `-write`,
  so it needs PostgreSQL up, and that test fails a committed one that is not what they generate. A
  column the server sets is written by a client as `local`, shown by its replica and never sent
  ([ADR 0019](docs/adr/0019-the-sync-client-library.md)).
- **The tokens' stylesheet and the base icons are generated and committed**: `pnpm run gen` writes
  `packages/tokens/tokens.css` from `packages/tokens/src` and `packages/icons/src/lucide.json` from the
  pinned `lucide-static`, and each package's test fails a committed one that is not what they give
  ([ADR 0024](docs/adr/0024-design-tokens-icons-and-the-illustration-kit.md)).
- **Generated, never committed:** `packages/api/src/generated/` (the typed client, from
  `openapi.yaml`) and `packages/i18n/src/generated/` (message keys and arguments, from
  `catalogs/en.json`). turbo writes them before every typecheck, lint and test; after a
  contract or catalog change, `pnpm run gen` refreshes them for an editor. The Go ISO 4217
  table (`internal/platform/money/iso4217_gen.go`) is committed and generated from
  `packages/domain/src/iso4217.json`, and a test fails until it is regenerated.
- CI ([`.github/workflows/`](.github/workflows/)) runs the checks above (typecheck, lint,
  format check and test), plus openapi-spec-validator, govulncheck, pnpm audit, gitleaks
  and CodeQL, and the web app's build, its check and its end-to-end suite. Typecheck, lint and test depend on each package's `gen` in turbo, so CI
  runs every package's `gen` script too; it does not run `go generate`. It also runs the
  sync conformance suite against its own stack, with a short fuzz run; a nightly workflow
  runs a long one ([ADR 0013](docs/adr/0013-conformance-suite-stand-ins-and-the-oracle.md)).

## Layout

| Path | What |
|---|---|
| `server/` | The Go module: `cmd/`, `internal/platform/…`, `internal/modules/<name>` |
| `apps/web`, `apps/mobile` | The two clients. They share the contract, the tokens and the strings, never components (D-36) |
| `packages/*` | `api` (generated client), `i18n`, `tokens`, `icons`, `domain`, `sync`, `test-vectors` |
| `tooling/` | Guards over the workspace itself: strictness, catalog pins, local/CI parity |
| `reference-data/`, `fixtures/` | Sourced reference content, and the seed ported from `design/v1` |
| `deploy/` | What runs beside the server: PowerSync's configuration and its generated streams, and the converter sidecar's image |
| `docs/adr/`, `docs/runbooks/` | Architecture decision records, and operational procedures |

## Conventions that are never negotiated

- **Money** is `amount_minor` (an integer in the currency's minor unit) plus an ISO 4217
  `currency`. Never a float, never `numeric`: in Go types, in SQL, in JSON.
- **Identifiers** are UUIDv7. Clients generate them, and every household-scoped create
  **requires** `id` in its body. A server-minted id online and a client id offline is the
  dual identity D-23 exists to prevent.
- **Instants** are `timestamptz`, RFC 3339 with an explicit offset on the wire. **Calendar
  days** are `date` (`YYYY-MM-DD`) in the household's timezone, which is never assumed. The
  exception is a metering bucket every household shares, which is UTC's: the usage sample's day
  ([D-109](docs/prd/09-decisions.md)) and the day the push counts a household's mutations in
  (`sync_usage`, [D-127](docs/prd/09-decisions.md)).
- **English is the source language** of every identifier, enum value, log message and
  comment. No user-visible string is a literal: it is a translation key, present in all five
  catalogs (`en`, `cs`, `sk`, `de`, `pl`) in `packages/i18n/catalogs/`, and architecture test 7
  (an ESLint rule on `apps/**`) fails a literal. A drafted translation is listed in
  `packages/i18n/review/<locale>.json` with the English it translates. Messages use the ICU
  subset both renderers share ([ADR 0007](docs/adr/0007-shared-packages-client-catalogs-and-vectors.md)).
- **Colour is spent through tokens.** `@household/tokens` holds every colour in both themes, the
  declared contrast pairs, which its test holds to their minimums, and the scales; application code
  names a semantic or a component token, never a raw colour or a ramp's primitive, which ESLint
  (`household/semantic-tokens`) and the stylesheets' check (`pnpm run lint:css`) fail in `apps/**`,
  and spends the type, space, radius and motion scales by name
  ([D-152](docs/prd/09-decisions.md)). A new colour token is in a declared pair or exempt with its
  reason. A glyph or an illustration is a drawing in `@household/icons`, which each client draws
  with its own component; an icon-only control takes its label from the register (`controls`), and
  a status is its colour, its glyph and its word together
  ([ADR 0024](docs/adr/0024-design-tokens-icons-and-the-illustration-kit.md)).
- **The web app** (`apps/web`) is a static build under a strict Content-Security-Policy
  (`build/csp.ts`): nothing inline, every file its own origin's, and a directive widened only in the
  pull request that needs it. A modal is the platform's `<dialog>`, and a library that injects a
  style is not used; what a component draws apart from where it stands, a menu's list or the
  toasts, is drawn inside the open modal (`ui/topLayer.ts`), since the page outside one is inert.
  A component names its words by key (`useTranslate`) and formats through
  `useFormat`: `Intl`, money from whole minor units, an instant in the timezone its caller names. A
  screen spends the twelve states through `ui/states.ts` and `StateFrame`. A page is titled for
  the screen it shows: a screen that draws the page's `<h1>` says the same words to
  `usePageTitle` (`app/title.ts`), as `Screen` and `SettingsPage` do for the screens they frame,
  nothing above a screen sets a title, and the walk of the routes fails one whose title does not
  name its heading ([D-165](docs/prd/09-decisions.md)). What a press came to is said to whoever
  cannot see it: a form that is refused moves the focus to the first field the refusal marked
  (`useRefusedField`, `auth/fields.tsx`), a refusal that is no field's, one of a control that
  saves as it is changed, and a part of a screen that could not be read where no `StateFrame`
  draws it, is a `Banner` with `announce`, and a screen that removes the row a
  dialog was opened from says where the focus goes; a write whose success no control of its
  screen says is said in a toast, and a sentence that says it is a status from the press on, one
  element whose words change where they stand ([D-166](docs/prd/09-decisions.md)); axe
  reads only that a field and its sentence are tied, so the screen's own test holds the focus
  and the announcement. A route is a line of
  `src/app/paths.ts`, which the end-to-end suite walks with axe in both themes and in the
  pseudo-locale, every test failing on a violation of the policy; what a route opens, a dialog, a
  menu or a toast, is opened under the same two in `e2e/overlays.spec.ts` or in the spec of the
  screens that open it. A dev-only page (`src/dev`) writes
  its words as fixtures and is in no build a deployment serves ([D-154](docs/prd/09-decisions.md));
  a test's markup is held to the literal-string lint as the app's is. The bundle budget is
  `build/budget.ts` ([D-153](docs/prd/09-decisions.md),
  [ADR 0025](docs/adr/0025-the-web-foundation-policy-harness-budget-and-build-id.md)).
- **The web app's session, shell and replica**
  ([ADR 0026](docs/adr/0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md)).
  A route names its layout in `paths.ts`: plain, the frame of the screens before sign-in, or the
  shell around an account or a household, which is a member's alone, and each screen is a file
  fetched when its address is opened. A request goes through `useApi()` inside TanStack Query and
  its answer through `unwrap`, which is how the session hears of the three answers that are about
  it: a `401` ends it and removes what the browser kept, the persisted cache and every replica, a
  `403 csrf_failed` signs in again and removes nothing, and a `400 update_required` draws *please
  update* and nothing else ([D-156](docs/prd/09-decisions.md), [D-158](docs/prd/09-decisions.md)).
  A request asked outside a query or a mutation tells the problem hub itself, but for the one a
  sign-out follows at once, whose own refusal is told (`push/worker.ts`), and a write that
  changes what `GET /me` answers reads the account again before it leads anywhere, by its whole
  key (`meKey`, `exact: true`): the account's other reads are filed under it. The session asks
  for the account through its own reading of it (`refetch`) and never of the query client beside
  it: emptying the cache tells no reader, and one left on an entry that went hears nothing of a
  fetch made beside it.
  A write of a screen before sign-in or of a member's own account is asked at once, connection
  or none (`askedNow`, `api/query.ts`, which a test holds every such mutation to): left to the
  query client it would wait unseen and be sent whenever the connection returned
  ([D-164](docs/prd/09-decisions.md)). A read that is paused, asked with the browser offline, is
  drawn as could not be read and never as a skeleton, the session's own among them (`Unread`,
  `app/guards.tsx`), and a read is said to be unread only where nothing is kept of it: what the
  browser kept is drawn, whatever became of asking again.
  What a browser keeps is its member's and for no longer than their session, whether or not a
  page knew them when it ended: a browser with no session keeps no replica, and a page that finds
  another member signed in under it removes what it kept and reloads
  ([D-161](docs/prd/09-decisions.md)). A replica's removal is asked for and not waited on, which
  the first module written offline settles for what it has queued.
  The app holds one language at a time: `apps/web/src` imports `@household/i18n/lazy` and never
  the package's own entry, which holds all five catalogs, and ESLint fails the import
  ([D-159](docs/prd/09-decisions.md)). A file of the app's own whose import failed is not
  imported again, since a browser may answer the second import with the first one's failure: the
  page is loaded again, or the screen says to reload. The shell's module list is derived from the household's own
  answer and lists a module only where `src/modules/registry.ts` has its screens, which the
  module's web item adds ([D-160](docs/prd/09-decisions.md)). The household list names a
  `suspended` household whose every route answers `404` (D-115), so a screen that reads something
  of each of a member's households passes over it or says it cannot be read, and never waits on
  it: where the app opens ([D-162](docs/prd/09-decisions.md)), and before an account is deleted
  ([D-163](docs/prd/09-decisions.md)). A household's replica is one tab's,
  by a Web Lock, asked for only if it is free and waited for where it is held, never read off
  the browser's list of locks, and opened as the session through `sync/sessionFetch.ts`; `@household/sync` is
  imported for its types alone outside `sync/open.ts`, which ESLint holds and which is what keeps
  the library and its SDK out of a page until a replica is opened, and a run-time value a screen
  needs of it is added to `Opened` there. Whether a replica is receiving (D-105) is read off the
  failure the SDK keeps until an attempt succeeds, never off `connecting` or `hasSynced`: a
  replica opened again has synced and has not tried yet, and every retry is connecting. The policy admits three sources beside its own origin: for the replica,
  `'wasm-unsafe-eval'` and the sync service's origin in `connect-src`, and for a picture the
  object store's origin in `img-src`, both origins told to a build (`HOUSEHOLD_WEB_SYNC_ORIGIN`,
  `HOUSEHOLD_WEB_FILES_ORIGIN`). The end-to-end suite starts the API itself on the development
  services, each test a network of its own (`e2e/stack.ts`), and a member's routes are walked
  signed in; what the suite names a person or a household holds no run of four plain letters,
  which the pseudo-locale pass takes for a word nobody translated. Every test starts in a browser
  that kept nothing, with a connection and every service answering: what a screen draws on a
  second visit, offline or with a service away is walked only by a test that reloads, or takes
  the connection or the service away, in a real browser: a unit harness with the cache persisted
  passed where Chromium failed. A test that has a page looked at again dispatches a
  `visibilitychange` that bubbles, as the browser's own does: the query client listens on
  `window`.
- **A household's own screens on the web**
  ([ADR 0027](docs/adr/0027-the-households-web-screens-routes-of-the-apps-own-the-grant-matrix-and-settings-asked-at-once.md)).
  A module's screens are lines of `src/app/paths.ts`, drawn in the household's shell, and never a
  bundle the module routes itself: a screen that is no route is a screen the walk does not check.
  `src/modules/registry.ts` says of a module only where it opens and where it takes a first
  record, which *what brought you here?* offers (`household/Start.tsx`,
  [D-169](docs/prd/09-decisions.md)). Household settings is under `/households/{id}/settings` and
  is listed for every member, whatever they hold on it: `view` on it unlocks the invitations and
  nothing else ([D-167](docs/prd/09-decisions.md)). A screen there is set in
  `HouseholdSettingsPage`, draws a control that changes something only where
  `useStanding().changes`, an owner's in a household that takes writes, and reads through
  `household/data.ts`. Its entities are never written offline, so every write under
  `src/household` spreads `askedNow`, which the test beside the query client holds them to, and
  none is queued ([D-170](docs/prd/09-decisions.md)); a write that was answered reads the household
  again (`useReread`), and so does one refused for where its member now stands, a `403`, a `402`
  or a `404`, which is one list for every screen of the settings (`isStandingRefusal`,
  `household/settings/profile.ts`). A level is never shown by the contract's word for it: `useLevelWords`,
  `GrantMatrix` for an owner to fill in and `GrantSummary` for everybody to read, each saying
  what a level comes to where it draws it; a role's defaults and its ceiling are
  `@household/domain`'s, which `vectors/grants.json` holds to the server's, so a level a role may
  not hold is not offered. An unverified account is refused where it presses and no earlier, with
  `Unverified` in the control's place. Every create sends an id made once for each visit of its
  screen, and a `422` for that id after an answer that never came is read as made, as is a
  ceiling's `403` where what was to be made is found by its id, the server counting before it
  looks at the id. What an
  invitation's link carried is kept in the page's memory across a sign-in and in no storage
  (`household/invitationToken.ts`), and a member in no household is opened at making one
  ([D-168](docs/prd/09-decisions.md)), once their list of households has been read again: a kept
  list that names none is not gone by (`app/Home.tsx`). A focus that a control took with it as
  it left is put back through `refocus` (`account/common.ts`). A write on its way keeps its
  control busy until it is answered: its mutation is not `reset()` while it is pending, and rows
  that share one say for themselves which of them is asked. The page an invitation's link opens
  is begun again for a fragment that arrives while it is drawn, since a link opened in the tab
  already on its page loads nothing; the pages of `auth/` that read a fragment (`useFragment`)
  do not yet. A write that leads to another screen goes there from `mutate`'s own callback,
  which is dropped with its screen, where the mutation's `onSuccess` would lead a member away
  from wherever they had gone meanwhile; it stays busy once it has succeeded, until that
  screen's file has come; and a choice made on a form while its save is on its way is kept and
  held against the answer. A form chooses nothing for its member: what it would confirm and was
  not given is asked, by its select's placeholder, and what follows from it is absent until it
  is chosen ([D-172](docs/prd/09-decisions.md)); and it offers what the server takes, narrowed
  by no rule of its own. A control drawn as one word beside its hidden name (`RowAction`,
  `RowLink`, or by hand) holds that word in its name, together and in order, in all five
  languages, which the catalogs' own test holds each pair to (WCAG 2.5.3).
- **Computed on both sides, tested from one file**: a rule the clients preview and the server
  saves (money, tariffs, allocation) has a vector file in `packages/test-vectors/vectors/`, run
  by the Vitest and the Go runner alike (D-37).
- **The tenant is in the path**: `/api/v1/households/{household_id}/…`. Every tenant table
  has `household_id`, row-level security enabled **and** forced: its migration calls
  `enable_tenant_isolation`, and the PR adds its rows to the isolation fixture
  (`server/internal/arch/testdata/isolation/fixture.sql`). Only the three tables read before a
  household's context exists, `households`, `memberships` and `invitations`, have policies of
  their own instead, which architecture test 2 names
  ([ADR 0005](docs/adr/0005-tenancy-registry-and-row-level-security.md),
  [ADR 0011](docs/adr/0011-households-as-the-platforms-own-module.md)). A foreign key to
  another tenant table carries the household, `(household_id, x_id)`, since PostgreSQL checks
  it past row-level security. A handler reads through `tenant.InTx`, which is read-only, writes
  only through `mutation.Apply`, and asks `grant.Require` for any level above `view`.
- **`404`, not `403`,** for anything the caller may not see: a module they hold `none` on, a
  disabled module, a private item, a conversation they are not in. `403` means "you can see
  it and may not do this to it".
- **Entitlement and fair use are the platform's, never a module's.** A household's state is resolved
  once per request, and the tenant middleware's gate refuses an unsafe request `402` in a state that
  does not write, but for FR-BI1's closed list (`entitlement.Exemptions`), which a test holds to the
  household-scoped unsafe operations that declare no `402`: a new one declares it. A suspended
  household answers `404`. The spine refuses a create past a module's rows, and the files pipeline an
  upload past the objects or in grace ([ADR 0017](docs/adr/0017-entitlements-on-the-households-row-the-gate-and-fair-use.md)).
- **The mutation spine.** Every mutation writes its row and an audit event, and reports a sync
  change for each row it writes, in one transaction, through one service-layer entry point,
  `mutation.Apply`, which commits only what it records; the change is checked against its entity and
  written to no feed (D-121). REST and sync both write through it: a module whose entities a client
  writes offline implements `push.Writer`, and the push (`internal/platform/push`) hands it each
  mutation once it has checked the declaration, the grant and the batch, and locked the row an
  update names: a `strict_version` writer calls `Mutation.Admit`, and an `lww_row` writer keeps the
  loser when `Mutation.Behind` (D-122). An entity's table calls `add_entity_columns` for the base
  columns (`version`, `created_*`, `updated_*`, `deleted_at`), and `replicate` once a generated
  stream reads it; its module declares it through `SyncSource` with its merge policy and access. A
  row a private item or an audience bounds carries `visibility` and `owner_id`, or `readers`, itself,
  rewritten through `sync.RewriteAccess`, which is no edit of it (D-123) and which architecture test
  4 keeps modules from doing any other way (architecture tests 4, 5, 9 and 10;
  [ADR 0006](docs/adr/0006-sync-ready-schema-and-the-mutation-spine.md), [ADR 0014](docs/adr/0014-powersync-deployment-generated-streams-credentials-and-the-push.md),
  [ADR 0018](docs/adr/0018-sync-engine-ii-versions-visibility-audiences-and-the-feed.md)).
  The one other write path is the platform's own, for the global account tables (a user's
  profile, credentials and sessions), which are no household's history: `tenant.AccountTx`,
  which architecture test 4 keeps out of every module ([ADR 0009](docs/adr/0009-accounts-sessions-throttles-and-the-breach-corpus.md)).
  Beside it, the platform keeps its own record of what it answered, no entity's history, through
  `tenant.InWriteTx`, which test 4 also keeps out of modules: the Idempotency-Key middleware's
  keys, and the push's answer to each mutation (`sync_mutations`), kept in the effect's own
  transaction when the mutation took one and in a transaction of its own when it took none
  ([ADR 0014](docs/adr/0014-powersync-deployment-generated-streams-credentials-and-the-push.md)),
  and its count of the mutations a household pushed in a day (`sync_usage`,
  [ADR 0018](docs/adr/0018-sync-engine-ii-versions-visibility-audiences-and-the-feed.md)); and each
  replica's last report of itself (`sync_replicas`), which leaves with its member's membership
  ([ADR 0019](docs/adr/0019-the-sync-client-library.md)).
  The household surface (`internal/platform/household`) is `admin`, a module the platform
  serves itself: it writes through `mutation.Apply` with the actions and entities
  `module.PlatformModule` declares, and holds a household its caller is not yet in, creating
  it or holding its invitation, through `tenant.Assume`, and steps outside it to count the
  households its caller owns through `tenant.Outside`, both of which test 4 keeps out of modules
  too ([ADR 0011](docs/adr/0011-households-as-the-platforms-own-module.md)).
- **Files** go through the pipeline, `internal/platform/files`, and nothing else touches the object
  store: a module's handler `Receive`s the upload (sniffed, capped, programs refused), `Put`s it
  (ceiling checked, written once under `h/{household}/{module}/{entity}/{variant}`), `Record`s it in
  its mutation with the attribution only it knows, and hands out `Link`s, pre-signed for one object
  for minutes. It declares its tables and labels through `module.StorageSource`. The meter role
  reads every household's counting columns, and nothing else (architecture test 11,
  [ADR 0015](docs/adr/0015-files-object-storage-the-meter-and-pictures.md)); a user's picture is the
  account's (D-107). What the platform keeps of the work after a commit is no entity's history
  either, and goes through `tenant.InWriteTx` in the household's context, with no caller: the
  workers' claims on `file_jobs` and the variants they record, and the usage sampler's samples.
- **Billing** is the platform's, `internal/platform/billing`, and asks the payment processor only
  through `billing.Processor`, which Stripe implements; a card never reaches the server (PRD 04 §6).
  A webhook names what to read, and the handler reads it from Stripe under the household's row lock,
  records it through `tenant.InWriteTx` (the platform's record of what the processor said, no
  entity's history), and then settles the household's row from what is recorded, through
  `mutation.Apply` and `household.Bill`: a delivery repeated or out of order settles the same state.
  Storage is billed by the calendar month, UTC's, from `storage.Allowance.Blocks` over the daily
  samples, whose arithmetic `vectors/storage.json` holds both sides to. A test asks `billingtest`'s
  stand-in, never Stripe ([ADR 0020](docs/adr/0020-billing-the-processor-webhooks-the-payer-and-storage-lines.md),
  [runbook](docs/runbooks/billing.md)).
- **Notifications** go through `internal/platform/notify`: a module tells a member something by
  queueing a `notify.Notification` in its mutation's transaction (`Queue`), a catalog key and
  arguments, its category, the module whose view the recipient must hold and, for a private item, its
  owner, and calls `Nudge` once it has committed. Whether it reaches them, by Web Push, Expo or the
  fixed email set, is decided and rendered when it goes out: grant, privacy, their own mutes and their
  quiet hours (FR-NT5, D-111, D-112). The queue, the delivery log and a member's preferences are no
  entity's history and go through `tenant.InWriteTx`, as the expiry sweep's deletions in a household
  do. Two account writes go there too, rather than through `tenant.AccountTx`, to commit with what
  they belong to: what a delivery says of its targets' health, in the transaction that settles it, and
  a graduation's link, in its email's. The platform's jobs run on `internal/platform/scheduler`, which
  one instance leads; a job registers in `app.newScheduler` with its cadence, and a retention is a row
  of `internal/platform/expiry` and of PRD 03 §5's table
  ([ADR 0016](docs/adr/0016-scheduler-and-notification-transports.md)).
- **Export and erasure** are the platform's (`internal/platform/privacy`), and every module's part
  of them is mandatory (D-6, architecture test 3): `module.ExportSource` writes its part of an
  archive for the scope its requester takes, a household's, a member's own or a former member's
  private items, and `module.EraseSource` deletes one member's private data, both in a transaction
  the platform hands it. A household is erased by deleting its own row, which every tenant table
  hangs from: a new tenant table references `households (id) ON DELETE CASCADE`, directly or through
  a table that does, and the erasure test over the isolation fixture fails one that does not.
  Erasure is no entity's history and records no audit event; it goes through `tenant.InWriteTx` and
  `tenant.AccountTx`, and leaves a tombstone, a `users` row emptied or a row of `erasures`
  ([ADR 0021](docs/adr/0021-export-erasure-and-the-tombstones.md)). A household erased has its
  subscriptions ended at the payment processor first, and an erased account's customers there are
  deleted with it (`billing.Service.Close`, `Forget`). The nightly erasure job runs at 02:30 UTC,
  before PowerSync's compaction.
- **Platform staff** (`internal/platform/staff`, PRD 02 §8) read what they see as a role of its own,
  `household_staff`, which holds `SELECT` on the columns that are metadata and nothing else: a
  migration that adds a column staff read grants it to the role and names it in architecture test
  12's list, and the no-content-access test connects as every role the server runs as (D-3, D-143).
  What staff do, they do as the request role in the household's own context, through the spine as the
  service actor `support` (`mutation.AsService`, and `mutation.Note` for an action that changes no
  entity's row, both of which test 4 keeps out of modules), each action carrying a reason and
  written to the platform's log, `platform.audit_log`, append-only and kept seven years, in the
  transaction of its effect (D-145). A caller who is not staff is answered `404`. A fair-use ceiling is
  read through `fairuse.Ceiling` or `tenant.Scope.Limit`, never from its constant alone, and a module
  ships dark behind the flag `module.<id>` (D-146, D-147). The first `platform_admin` is made with
  `household-api staff grant`
  ([ADR 0022](docs/adr/0022-platform-staff-their-role-their-log-flags-and-ceilings.md),
  [runbook](docs/runbooks/platform-staff.md)).
- **Reference data** is sourced JSON under `reference-data/`, one record a file: every field a value
  with its `source`, flagged `drafted` until an expert has checked it, and every text in the five
  languages. `reference.Read` checks it, and `household-api migrate` loads it into versioned global
  tables, never deleting a row ([ADR 0008](docs/adr/0008-reference-data-pipeline.md)). A module's own
  is a set, a directory named for the module with a `sources.json` of its own, declared through
  `module.ReferenceSource`: its `Read` checks what its schemas cannot, and its `Load` writes its
  tables. Garden's, the crop catalog and the climate profiles, is `internal/modules/garden/catalog`,
  where a timing is days from a frost date and never a calendar date
  ([ADR 0023](docs/adr/0023-the-crop-catalogs-source-the-reference-set-hook-and-the-climate-dataset.md)).
- **Errors** are RFC 9457 problem documents. Clients switch on `code` (the `ProblemCode`
  enum), never on `detail`.
- **Concurrency and retries**: `version` travels as an `ETag` and returns in `If-Match`
  (`etag.Set`, `etag.IfMatch`; `problem.Conflict` is the `409` with the current
  representation); unsafe methods accept `Idempotency-Key`, which the platform's middleware
  answers for every module route.
- **Migrations** are goose, one numbered block per module, forward-only and
  expand/contract: an old app in the field must keep working against the new schema.
- **Tests hit real PostgreSQL.** No database mocks: RLS, `SET LOCAL` and the change feed
  cannot be tested against one.
- **TypeScript is strict**: `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride` and `noFallthroughCasesInSwitch`. `any`
  and non-null assertions are lint errors, and lint warnings fail the build. A suppression
  cites the issue that removes it: `// @ts-expect-error #123 …` or
  `// eslint-disable-next-line <rule> -- #123 …`; `@ts-ignore` is banned.

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
