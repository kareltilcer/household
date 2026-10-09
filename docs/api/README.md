# Household API

[`openapi.yaml`](openapi.yaml) is the **complete HTTP contract** and the source of truth for both
clients. It is not a description of the implementation — the implementation is checked against it.

| | |
|---|---|
| Specification | OpenAPI 3.1.0 |
| Paths | 342 |
| Operations | 511 |
| Schemas | 462 |
| `operationId` | Present and unique on every operation |

## Validate

CI runs both validators on every pull request. Locally:

```bash
python -m pip install -r docs/api/requirements.txt
python -c "import yaml;from openapi_spec_validator import validate;validate(yaml.safe_load(open('docs/api/openapi.yaml',encoding='utf-8')));print('valid')"
```

And Redocly, pinned in the workspace:

```bash
pnpm run lint:api
```

`lint:api` runs Redocly's `recommended-strict` ruleset, so every finding is an error. The
findings reviewed and kept on purpose are listed one location at a time, each with its reason,
in [`.redocly.lint-ignore.yaml`](../../.redocly.lint-ignore.yaml); the same rule still fails
anywhere else. A bare `redocly lint` reads [`redocly.yaml`](../../redocly.yaml), which says why
it names the lenient `recommended` set instead.

## Generate clients

Both clients consume a generated, typed client — a contract change that breaks a client breaks the
build ([06-clients.md](../prd/06-clients.md) §1). `@household/api`'s `gen` script writes it into
`packages/api/src/generated/` with openapi-typescript. turbo runs it before every typecheck, lint
and test, with `openapi.yaml` as its input, so nothing generated needs committing. To refresh it
for an editor:

```bash
pnpm run gen
```

The findings kept in `.redocly.lint-ignore.yaml`, a file openapi-typescript does not read, are
judged by `pnpm run lint:api`; the generator runs silently past them.

## Read

Render the reference to a single HTML file (`dist/` is git-ignored) and open it in a browser:

```bash
pnpm exec redocly build-docs docs/api/openapi.yaml --output=dist/api-docs.html
```

## Conventions worth knowing before reading

- **The tenant is in the path.** `/api/v1/households/{household_id}/…` for everything a household
  owns. Never a header, never ambient session state.
- **`404`, not `403`, for anything the caller may not see** — a module they have `none` on, a
  private item they do not own, a conversation they are not in. `403` is reserved for *"you can see
  it, you may not do this to it"*.
- **Money is `{ amount_minor, currency }`** — an integer plus ISO 4217. There is no floating-point
  monetary value anywhere in the document.
- **Clients generate `UUIDv7` ids**, and `id` is **required** in the request body of every
  household-scoped create — not optional, not server-assigned when omitted. An offline create needs a
  stable identity immediately, and an entity that gets a server id online and a client id offline is
  the dual identity [D-23](../prd/09-decisions.md) exists to prevent. Architecture test 9
  ([01-architecture.md](../prd/01-architecture.md) §10) fails the build on a create schema that does
  not require it. The one exception is `POST /push/subscriptions`, which is user-scoped rather than a
  household row.
- **`ETag` + `If-Match`** for optimistic concurrency. A representation carrying a `version`
  returns it as an entity-tag; send that back in `If-Match`. `409` returns the current
  representation.
- **`Idempotency-Key`** on unsafe methods — declared on every one of them, so a generated client
  can actually send it — and required on `POST …/sync/mutations`. A key is the caller's own and
  is kept 7 days; a repeat gets the first request's `2xx` response, and a request refused before
  it took effect stores nothing, so a repeat runs it again. A request made before signing in
  (`/auth/register`, `/auth/login` and the other routes a signed-out person reaches) has no caller
  to hold a key, and keeps none, nor does `POST /auth/password`, whose body carries passwords that
  a key's fingerprint would hash fast (D-97), nor the second step's operations that take the
  password. A response carrying recovery codes is never kept: a repeat of it answers `409`. A repeat of a request that ended the session it was
  made with (signing out, signing out everywhere, revoking the current session) answers `401`,
  since that session makes no further request.
- **`402` is declared on every household-scoped unsafe method**, because the entitlement gate is
  middleware and can refuse any of them ([04](../prd/04-billing-and-entitlements.md) FR-BI1). The
  exceptions are the operations that must keep working in a non-writing state: billing, export,
  household deletion, leaving, setting and lifting an Art. 18 restriction, and a replica's
  credentials (D-117), exactly the gate's closed list (`entitlement.Exemptions`), which a test
  holds to the operations that declare no `402`. A client that cannot handle `402` on an ordinary
  write is a client that breaks the day a card expires.
- **Errors are RFC 9457** `application/problem+json`, with a body on every error response. Switch
  on `code`, never on `detail`; `code` is the `ProblemCode` enum, so the switch is exhaustive.
  Any operation can also answer `405 method_not_allowed`, `500 internal`, and
  `422 validation_failed` for a request the document does not admit, and one that takes a body
  `413 payload_too_large` or `415 unsupported_media_type`, one that accepts
  `Idempotency-Key` `409 idempotency_in_progress`, any unsafe one `403 csrf_failed`, for a
  browser's request from another origin or a session's without its CSRF token, and
  `403 fair_use_ceiling` (`FairUseProblem`), for a create past a fair-use ceiling (D-116), and any at all
  `400 update_required`, for a client older than the oldest the server serves, whether or not it
  declares them. A
  `422 validation_failed` names each failure in `errors[]`: `field` is a JSON Pointer into the
  body (`/name`) or `<in>:<name>` for a parameter (`query:limit`), and `code` is the check that
  failed (`required`, `max_length`, `malformed`, …), or `invalid` for a refusal no JSON Schema
  keyword names, such as a body sent to an operation that takes none.
- **The sync endpoints are the offline path**; the per-module REST endpoints are the online path.
  Both write through the same service layer.

## Editing

The document is assembled from parts during authoring but committed as a **single bundled file**,
so it works with every tool without a resolution step. Edit `openapi.yaml` directly.

Three authoring hazards this document has already been bitten by, worth remembering:

1. **YAML 1.1 booleans.** `on`, `off`, `yes` and `no` as bare scalars become booleans. No field is
   named `on` here for exactly this reason — dates are `occurred_on`, `settled_on`, `read_on`,
   `filled_on`, `for_date` — and `'off'` enum members are quoted.
2. **Commas in flow-mapping scalars.** `{ description: a, b }` parses `b` as a second key. Quote any
   inline description containing a comma.
3. **Never wrap a flow mapping onto a second line.** A closing `}` left on its own line is
   *deficient indentation* to Redocly's parser, which then fails the whole document before linting
   — while PyYAML and `openapi-spec-validator` accept it, so the other validator below stays green
   and hides the break. Keep every `{ ... }` on one line.

CI runs both validators, openapi-spec-validator and Redocly, and each of them resolves every
`$ref`.

## How the server holds itself to it

This directory is also a small Go module (`go.mod`, `embed.go`) that embeds `openapi.yaml`, and
the server requires it through a `replace` directive. The server reads the committed document
itself, never a copy, in three places:

- **At the edge**, every request routed to an operation is validated against it before the
  handler runs: parameters, headers and JSON bodies (`server/internal/platform/contract`).
- **In the tests**, `testsupport.Serve` validates every response a test sees: a declared status,
  a body the declared schema accepts, and a valid `Problem` on every error.
- **Architecture test 6** ([01-architecture.md](../prd/01-architecture.md) §10,
  [07-nonfunctional.md](../prd/07-nonfunctional.md) §6) diffs the server's routes against the
  document. `server/internal/arch/contract_pending.txt` lists the operations not built yet; the
  test fails on a route the document does not declare, a route built while still pending, a
  pending entry the document does not declare, and an operation neither built nor pending.

The Go `ProblemCode` enum is generated from this document: after changing it, run
`pnpm run gen`. A test fails until the generated file matches.
