# 0007 — The client is generated on every build, the server reads the clients' catalogs, and one vector format holds both sides

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan item:** 6
- **Decides for:** [06-clients](../prd/06-clients.md) §1 and §8; [03-platform-strands](../prd/03-platform-strands.md) §9; D-29, D-37, D-57, D-94; PL-7, PL-9

## Context

Plan item 6 fills four packages the rest of the plan builds on. Several choices it makes outlive the PR:

- **Where the typed client comes from.** 06 §1 says `@household/api` is generated from `openapi.yaml` on every build, so that a contract change that breaks a client breaks the build.
- **How the server reads the catalogs.** 03 §9 says the server renders push bodies, emails and audit summaries from the same catalogs as the clients, in the recipient's language. The Go binary cannot import a TypeScript package, and `go:embed` cannot reach outside its module.
- **What ICU MessageFormat means.** Two renderers read one catalog: FormatJS in the clients and a Go one on the server. They must agree on quoting, on `#`, on plural categories and on how numbers print.
- **What a test vector is.** D-37 makes shared vector files the mechanism that keeps two implementations of one rule honest. Item 6 defines the format; items 55 and 61 fill it.
- **Where the ISO 4217 exponents live.** Both sides need them, and neither may assume 2 ([09-finance](../prd/modules/09-finance.md), "Money, once").

## Decision

**The client is generated, never committed.**
- `packages/api/scripts/gen.ts` runs openapi-typescript over `docs/api/openapi.yaml` into `src/generated/`, which is git-ignored. It also writes the contract's `ProblemCode` members as a runtime list.
- turbo runs it before every typecheck, lint and test. `turbo.json` names the contract as an input of `@household/api#gen`, so a contract change re-runs every task that depends on it instead of replaying a cached pass.
- The client is openapi-fetch with two middlewares:
  - **`Idempotency-Key`**: every unsafe request that has no key gets a new UUIDv7.
  - **`If-Match`**: a bare version is quoted into an entity-tag, and any other malformed value throws.
- A wrapping `fetch` resends a request only when its response was lost (`fetch` rejected and the caller did not abort). It resends only a request that is safe to repeat: a safe method, or one carrying a key. The resend is a copy taken before the first attempt, key included.
- Problems are typed by `code`:
  - `version_conflict` carries `current` and `current_version`;
  - `entitlement_*` carries `state` and `remedy`;
  - `validation_failed` carries `errors`.
- A code this build does not know reads as *unreadable* (`code: undefined`), so an app in the field survives a newer server. So does a known code missing the members it promises.

**The catalogs are one set of files, which both sides read.**
- `packages/i18n/catalogs/<locale>.json` is a flat object of sorted keys, English the source.
- `packages/i18n` is also a small Go module (`go.mod`, `catalogs.go`) that embeds those files. `server/go.mod` requires it through a `replace` directive, as it does `docs/api`. There is no second copy.
- The TypeScript side types keys and arguments from `src/generated/messages.ts`, which `gen` writes from `en.json`.
- `defineCatalogs` fails the type check on a catalog that lacks one of English's keys or has one English lacks.
- `review/<locale>.json` records each drafted translation with the English it translates (PL-9). A test fails when that English changes, so a stale draft cannot hide.

**One subset of ICU MessageFormat, rendered alike on both sides.**
- The subset is:
  - text with apostrophe quoting;
  - `{arg}`;
  - `{arg, number}` without a style;
  - `plural` and `selectordinal`, with an offset, `=N`, the CLDR keywords and `#`;
  - `select`.
- Every plural and select has `other`. Dates, times, number styles and skeletons, and tags are outside it.
- `@household/i18n`'s `parseMessage` refuses anything outside the subset. The server's `internal/platform/i18n` parses exactly the subset, as FormatJS parses with tags ignored.
- The Go renderer takes plural rules from `golang.org/x/text/feature/plural`. Its decimal symbols come from CLDR for the five languages, including Polish's minimum grouping of two.
- Numbers round half away from zero to three places, as ICU's default decimal format does. Plural operands are read after that rounding.
- `vectors/i18n.json` holds the two renderers to the same output. It covers Czech, Slovak and Polish plurals, quoting, offsets, grouping, each refusal code, and the edges of FormatJS's grammar: where a name, a style or an offset ends. It was verified against Node 24's ICU 78.
- The pseudo-locale `en-XA` is derived from English when it is asked for: accented, bracketed and padded about 40 %.

**One vector format with two runners.**
- A file in `packages/test-vectors/vectors/` holds a description, its sources, and cases by group.
- A case is `{ name, input, output }`, or `{ name, input, error }` where `error` is a code both implementations share.
- The Vitest runner (`@household/test-vectors/vitest`) takes one subject per group, typed from the file. A group left without a subject fails the type check.
- The Go runner (`internal/platform/vectors`) requires the file's groups and its subjects to be the same set. It decodes inputs strictly and compares outputs as JSON, with numbers compared as written.
- The Go runner reads the files from the checkout (`internal/platform/repo`). It is for tests only.

**Money has one exponent table.**
- `packages/domain/src/iso4217.json` is ISO 4217 List One as SIX Group published it on 2026-09-17, with every code that has a numeric minor unit.
- The server's `iso4217_gen.go` is generated from it by `go generate`. A test renders it again and fails on drift, as the `ProblemCode` enum does.
- Arithmetic is exact: `bigint` on one side, `math/big` on the other. Decimal factors and rates are strings, as the contract carries them.
- Amounts are bounded to ±(2⁵³−1) on both sides, the largest a JavaScript client holds exactly.
- The split floors each part and gives the units left over one each in household order (D-57). Ties round away from zero, and a negative total splits as its positive total negated (D-94).

**Architecture test 7 is an ESLint rule.** `household/no-literal-strings` applies to `apps/**`, tests included. It reports a string that contains a letter wherever the UI shows it:
- JSX text;
- a string, template or conditional branch in a JSX child;
- a text-rendering prop: `title`, `alt`, `aria-label`, `placeholder`, `accessibilityLabel`, or a name such as `text` or one ending in `Label`, `Title`, `Text`, `Message` and similar, but not an enumerated one such as `enterKeyHint`;
- such a property of an object passed to a prop, as a navigator's `options={{ title }}`;
- the message of `alert`, `confirm` or `prompt`, and the title, message, button texts and default value of React Native's `Alert.alert` and `Alert.prompt`.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Committing the generated client | A PR that changes the contract and forgets to regenerate would pass review, and the build would compile the clients against the old contract. That is the drift 06 §1 exists to prevent |
| Copying the catalogs into `server/` with `go generate`, with a drift test | Every UI PR would edit two copies of every string. The nested module has one copy |
| A third-party Go MessageFormat library | The vectors would still have to hold its quoting, `#` and rounding to FormatJS's. The subset the catalogs need is small enough to own outright, and owning it keeps the two sides' refusals the same |
| Full ICU on the server (dates, currency and number skeletons) | It needs CLDR date and currency data for five languages in Go, and nothing server-rendered needs it yet. Plan item 17 adds what its messages need to both renderers and to the vectors |
| Largest-remainder assignment of the units left over in a split | FR-FI12 assigns them one each in the household's stable order. Largest remainder would move the extra unit between members as the weights change |
| Reading the ISO table from `packages/domain` at run time, or embedding it through another nested module | The binary must not read the checkout, and a Go module for one JSON file is overhead. Generation with a drift test is the pattern `ProblemCode` already uses |
| Retrying `409 idempotency_in_progress` in the transport | It can last up to five minutes (D-92). Whether to wait is the caller's decision, and the sync connector (item 15) makes it differently from a form |

## Consequences

**What gets easier:**
- A contract change that breaks a client fails the build.
- A catalog missing a key, a translation using an argument English does not have, or a stale draft fails a test.
- A rule computed on both sides gets a vector file and two small subjects. Items 55 and 61 follow the money file.

**What gets harder:**
- Message authors are held to the subset. A date or an amount of money is passed pre-formatted until the renderers support it.
- **A sixth language** (03 §9's 1.x list) needs:
  - a catalog and a review ledger;
  - an entry in both `locales` lists;
  - its CLDR decimal symbols in the Go renderer. Spanish, for one, has a minimum grouping of two.
- `x/text`'s plural data is CLDR 32. The five languages' rules have not changed since, and the vectors pass against Node's ICU 78. A future CLDR change to them would show as a vector failure, not a silent disagreement.
- React Native's Hermes has no `crypto.getRandomValues`, which `newId` needs. The mobile app installs a polyfill (plan item 28).
- The translator selects plurals through the engine's `Intl.PluralRules`, which Hermes has not provided. Plan item 28 polyfills it where the engine still lacks it and runs the i18n vectors' plural cases on the device, since the vectors otherwise run only on Node's ICU.

**Revisit this when** a server-rendered message needs a date or an amount of money, or when a language outside the five ships.
