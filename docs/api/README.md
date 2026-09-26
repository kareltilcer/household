# Household API

[`openapi.yaml`](openapi.yaml) is the **complete HTTP contract** and the source of truth for both
clients. It is not a description of the implementation — the implementation is checked against it.

| | |
|---|---|
| Specification | OpenAPI 3.1.0 |
| Paths | 320 |
| Operations | 486 |
| Schemas | 433 |
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

Redocly runs its `recommended-strict` ruleset ([`redocly.yaml`](../../redocly.yaml)), so every
finding is an error. The findings reviewed and kept on purpose are listed one location at a
time, each with its reason, in [`.redocly.lint-ignore.yaml`](../../.redocly.lint-ignore.yaml);
the same rule still fails anywhere else.

## Generate clients

Both clients consume a generated, typed client — a contract change that breaks a client breaks the
build ([06-clients.md](../prd/06-clients.md) §1).

```bash
npx openapi-typescript docs/api/openapi.yaml -o packages/api/src/schema.d.ts
```

## Read

```bash
npx @redocly/cli preview-docs docs/api/openapi.yaml
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
  can actually send it — and required on `POST …/sync/mutations`.
- **`402` is declared on every household-scoped unsafe method**, because the entitlement gate is
  middleware and can refuse any of them ([04](../prd/04-billing-and-entitlements.md) FR-BI1). The
  exceptions are the operations that must keep working in a non-writing state: billing, export,
  household deletion, leaving, and lifting an Art. 18 restriction. A client that cannot handle `402` on an ordinary write is a client that
  breaks the day a card expires.
- **Errors are RFC 9457** `application/problem+json`, with a body on every error response. Switch
  on `code`, never on `detail`; `code` is the `ProblemCode` enum, so the switch is exhaustive.
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

CI runs the validator, a `$ref` resolution check and a route/contract diff against the
implementation ([07-nonfunctional.md](../prd/07-nonfunctional.md) §6).
