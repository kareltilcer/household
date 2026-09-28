# @household/test-vectors

Shared test vectors: JSON files of inputs and expected outputs that the Vitest and Go suites both run, so two implementations of one rule cannot drift (D-37, [ADR 0007](../../docs/adr/0007-shared-packages-client-catalogs-and-vectors.md)).

| File | Rule | Run by |
|---|---|---|
| [`vectors/money.json`](vectors/money.json) | Money in minor units: ISO 4217 exponents, half-up once, D-57's split | `packages/domain/src/money.test.ts`, `server/internal/platform/money` |
| [`vectors/i18n.json`](vectors/i18n.json) | The catalogs' ICU MessageFormat subset, and choosing a member's language | `packages/i18n/src/message.test.ts`, `server/internal/platform/i18n` |

## The format

```json
{
  "description": "What the file holds and who runs it",
  "sources": ["Where each expectation comes from: a PRD section, a D-n, a design/v1 check"],
  "groups": {
    "split": [
      { "name": "€10 three ways", "input": { "…": "…" }, "output": [["jana", 334]] },
      { "name": "no participants", "input": { "…": "…" }, "error": "no_participants" }
    ]
  }
}
```

- A **group** is one function under test. Its cases share an input shape.
- A **case** has a unique `name` in its group, an `input`, and exactly one of these:
  - `output`, which the implementation must return, compared as JSON;
  - `error`, the code of the refusal it must raise. The code is a string both implementations use, never a message.
- **Integers stay exact.** The Go runner compares numbers as written.
- Nothing else is allowed. Both runners refuse unknown fields, duplicate names, a case with both `output` and `error` or neither, and an empty group.

## Running one

**TypeScript.** Import the file and give `runVectors` one subject per group. The subjects' input types come from the file, and a group with no subject fails the type check:

```ts
import { vectors } from '@household/test-vectors'
import { runVectors } from '@household/test-vectors/vitest'

runVectors(vectors.money, { split: ({ total, participants, order, weights }) => /* … */ }, codeOf)
```

**Go.** Give `vectors.Run` the same groups. The file's groups and the subjects must be the same set, and `vectors.Decode` refuses a field the input type does not have:

```go
vectors.Run(t, "money", map[string]vectors.Subject{"split": func(in json.RawMessage) (any, error) { /* … */ }}, code)
```

A new file is added to `vectors` in `src/index.ts`, and to this table.
