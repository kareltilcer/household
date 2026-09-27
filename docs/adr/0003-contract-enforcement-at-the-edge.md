# 0003 — The server validates against the committed contract, and says what failed where

- **Status:** Accepted
- **Date:** 2026-09-27
- **Plan item:** 2
- **Decides for:** PRD 07 §4 (input validation at the edge), §6 (the contract diff); PRD 01 §6
  (RFC 9457 errors), §10 test 6; PL-2 (kin-openapi), PL-7 (`contract_pending`)

## Context

The contract (`docs/api/openapi.yaml`, OpenAPI 3.1, 486 operations) is the source of truth, and
the server is checked against it, never the reverse. Four things had to be settled for that to
be enforced rather than intended:

1. **Where the server gets the document.** It lives in `docs/api/`, outside the Go module in
   `server/`, and `go:embed` cannot reach a parent directory. A copy inside `server/` would drift.
2. **How it validates.** kin-openapi v0.149 loads the document and validates 3.1. For a 3.1
   document it validates each value with a JSON Schema 2020-12 validator that it compiles from
   the schema on every call, so once per request. That path reports a failure as one sentence
   with no location (`jsonschema validation failed … at '/icon': got number, want null or
   string`), and it cannot resolve a component `$ref` from a lone schema. On most of this
   contract's bodies it therefore falls back to kin's built-in validator anyway.
3. **What a 422 says.** `ValidationProblem.errors[]` has `field` and `code`, and nothing said
   what either holds. A client form needs to put each error on its input.
4. **What a 500 and a 405 carry.** `Problem.code` is required and must be a `ProblemCode`, and
   the enum had no member for either.

## Decision

- **`docs/api/` is a Go module** (`github.com/kareltilcer/household/docs/api`, one file,
  `embed.go`) that embeds `openapi.yaml`. `server/go.mod` requires it through
  `replace … => ../docs/api`. The server, its tests and architecture test 6 all read those bytes.
- **Validation uses kin-openapi's built-in validator** for every request and response. The
  contract package hands kin a shallow copy of the document that reports itself as 3.0.3, which
  is the switch kin uses to choose. The built-in validator implements every 3.1 construct the
  contract uses: type arrays with `null` (427 uses), `const` (9), a numeric `exclusiveMinimum`
  (1), `{ type: 'null' }` branches of a `oneOf` (141). `contract_test.go` pins each against a real
  operation, so a kin upgrade that changes this fails there. Its check of a `date` and a
  `date-time` is a regular expression that takes 2026-02-31, which PostgreSQL refuses, so the
  contract package has it parse each as well, holding it to the calendar (and refusing a leap
  second, which Go's parser does not take). `email` and `uri` stay annotations, as JSON Schema
  2020-12 leaves `format` by default: the handler that takes one checks it.
- **The edge validates the operation chi routed to**, found with the router's own `Find`, so a
  body is never checked against a different operation's schema. It validates parameters, headers
  and JSON bodies; it neither authenticates (items 8, 9) nor writes defaults into the request,
  since a `PATCH` that grew defaulted members would overwrite what the client never sent.
  kin-openapi is handed each operation without its security requirements: to check one, it reads
  the whole body into memory first, whatever its media type, which would buffer every upload and
  every body sent to an operation that takes none, uncapped. A JSON body is capped
  (`HOUSEHOLD_MAX_BODY_BYTES`, 1 MiB) and answers `413` above it; a body on an operation that
  takes none answers `422`, whether it comes with a `Content-Length` or chunked; a body in a
  media type the operation does not declare answers `415`, media types compared without regard
  to case or to the whitespace around their parameters; a multipart upload is left to its
  handler to stream, under its own cap and deadline. A JSON body that is not a JSON text, with
  anything after its first value or bytes that are not UTF-8, answers `422 malformed`:
  kin-openapi's own decoder reads only the first value, so the contract package registers a
  strict one for `application/json`. So does a string escaping U+0000, which a `text` or
  `jsonb` column refuses, or half a surrogate pair, which Go would read as U+FFFD. A query
  string pair that `net/url` cannot parse, which it would drop without a word, answers `422
  malformed`: a dropped cursor would otherwise be answered with page one. So does a query,
  path or declared header value that decodes to U+0000 or to bytes that are not UTF-8, which a
  `text` column refuses in a parameter as surely as in a body. The contract says
  that any operation can answer the `422` refusals, and any operation that takes a body the
  `413` and `415`, declared or not.
- **Every request body must arrive within `HOUSEHOLD_BODY_TIMEOUT`** (60 s) or the connection
  is closed, since the server itself bounds only the reading of headers. The deadline is set
  for every request with a body before it is routed (`httpx.BodyDeadline`), not only for the
  JSON bodies the edge reads: net/http reads the body a handler leaves unread before it
  answers, so a request that declared a body and never sent it would otherwise hold its
  connection through a `404`, a `405` or any refusal. Once a body has been read to its end,
  net/http clears the deadline itself, as it starts reading the connection to notice the client
  leaving, so a handler that runs longer keeps its context; a request without a body gets no
  deadline, since that read starts at once and a deadline reaching it would cancel the
  request's context mid-handler. A handler that streams an upload extends the deadline through
  `http.ResponseController`.
- **A `readOnly` member the client sends is validated against its schema and left to the
  handler to ignore**, not refused. JSON Schema allows either; refusing breaks the GET-modify-PUT
  round trip (`putMeConsents` takes the `Consents` a GET returns, `updated_at` and all), and
  kin-openapi reports the refusal with no location a client could place.
- **`errors[].field` is an RFC 6901 JSON Pointer into the body** (`/items/0/amount_minor`, `""`
  for the whole body), **or `<in>:<name>` for a parameter** (`query:limit`,
  `header:If-Match`). A pointer is empty or starts with `/`, so the two forms cannot collide.
  **`errors[].code` is the failed JSON Schema keyword in snake_case** (`required`, `max_length`,
  `one_of`), `malformed` for a value that does not parse (an empty `?limit=` included), or
  `invalid` for a refusal no keyword names, such as a body on an operation that takes none; a
  `null` the type does not admit is `type`, although kin-openapi's built-in validator names it
  `nullable`, a 3.0 keyword the 3.1 contract never uses. An `allOf` failure is reported as the
  failures inside it, each at its own pointer, since `allOf` is how a Create composes its
  Update with a required list.
- **`ProblemCode` gains `method_not_allowed` and `internal`**, the two codes any operation can
  answer with and none declares. The Go enum is generated from the contract (`pnpm run gen`),
  and a test fails when the generated file is stale, since CI does not run `go generate`.
- **A problem's `type` is `urn:household:problem:<code>`**, `title` is the HTTP reason phrase,
  and no `detail` is sent: the contract calls `detail` translated, and the server has no
  translated strings yet (PRD 03 §9). Clients switch on `code`.
- **Routes and the contract are diffed in both directions** (architecture test 6), with
  `server/internal/arch/contract_pending.txt` naming the operations not built yet. The router
  also refuses to build with a route the contract does not declare, so the server never serves
  one even outside CI.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Commit a copy of `openapi.yaml` inside `server/`, with a drift test | Every contract change lands twice, 680 KB each time, and a reviewer reads both diffs |
| Read `openapi.yaml` from disk at run time | The binary then depends on a file beside it; a deploy that ships the wrong one validates against the wrong contract |
| Refuse a `readOnly` member with a located `422` | kin-openapi's refusal is a bare error with no path, so locating it means a second walk of the body against the schema; and a client echoing an unchanged `updated_at` has not tried to modify anything |
| A server-wide `ReadTimeout` against slow bodies | It bounds the whole request, so an upload (item 16) could not take the minutes it needs without every handler that reads a body extending it |
| The body deadline set only by the edge, for the JSON bodies it reads | Every other body is then read by net/http with no deadline at all, before it answers a `404`, a `405`, a `415` or a body on an operation that takes none |
| kin-openapi's JSON Schema 2020-12 path, as it chooses for 3.1 | A schema compiled per request, errors with no location, and a silent fallback to the built-in validator on every body that uses a `$ref` |
| libopenapi-validator (pb33f) | Also validates 3.1, but PL-2 chose kin-openapi and kin's built-in validator covers every construct the contract uses; changing library would be a decision without a failing requirement behind it |
| Validate with a second router (kin's `gorillamux`) matched against the document | Two routers can disagree on which template a path matches; a body would then be checked against an operation other than the one that serves it |
| `errors[].field` as a dotted path (`items.0.amount_minor`) | Ambiguous for keys containing dots; JSON Pointer is the RFC 9457 examples' own choice |
| Map a 500 and a 405 to an existing code, or send no `code` | `code` is required and enumerated; `not_found` for a 405 would tell a client the resource is gone |
| An English `detail` on every problem | The one user-visible literal the product forbids; a client that showed it would show English to a Czech member |

## Consequences

- A contract change that adds, removes or renames a `ProblemCode` needs `pnpm run gen` in the
  same PR, or the problem package's test fails.
- Every PR that builds an operation deletes its line from `contract_pending.txt`; at general
  availability the file is empty (item 96).
- Revisit if the contract adopts a 3.1 keyword the built-in validator does not implement
  (`prefixItems`, `unevaluatedProperties`, `dependentRequired`): the pinning test will not
  catch a keyword it does not exercise, so the PR that introduces one extends that test first.
- Revisit `type` URNs when the problem codes get a documentation page to point at.
