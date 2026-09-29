# The sync conformance suite

PRD 10 §4's falsifier (plan item 12, [ADR 0013](../../../docs/adr/0013-conformance-suite-stand-ins-and-the-oracle.md)):
PowerSync clients, each on its own SQLite file, driven through scripted partitions, lost answers,
duplicate delivery, skewed clocks and access changes against the real stack, with PRD 10 §4's six
invariants judged after every scenario and every seeded fuzz schedule.

## Running it

Needs Docker, pnpm and Go, as the repository does.

```bash
pnpm --filter @household/sync conformance:up     # PostgreSQL with logical replication, PowerSync, prepared
pnpm --filter @household/sync conformance        # the self-tests, the switched-on scenarios, a short fuzz run
pnpm --filter @household/sync conformance:down   # remove the stack
```

`conformance:up` can be run again on a stack that is up. The suite builds and starts the stand-in API
itself unless one already answers (`CONFORMANCE_START_STANDIN=false` to require one).

| Variable | Default | What |
|---|---|---|
| `CONFORMANCE_FUZZ_RUNS` | 3 | Seeded schedules in a fuzz run |
| `CONFORMANCE_FUZZ_STEPS` | 30 | Steps in each |
| `CONFORMANCE_FUZZ_SEED` | 1 | The first seed; a failing one is named in the report |
| `CONFORMANCE_SCENARIOS` | | `all` runs every scenario the target can, switched on or not |
| `HOUSEHOLD_CONFORMANCE_PG_PORT`, `HOUSEHOLD_CONFORMANCE_POWERSYNC_PORT` | 5442, 8090 | The stack's ports |
| `CONFORMANCE_ADMIN_DATABASE_URL`, `CONFORMANCE_STANDIN_URL`, `CONFORMANCE_POWERSYNC_URL` | the stack's | Where the suite reaches each |

A long fuzz run, as the nightly workflow runs it:

```bash
CONFORMANCE_FUZZ_RUNS=150 CONFORMANCE_FUZZ_STEPS=150 pnpm --filter @household/sync conformance:fuzz
```

## What is where

| Path | What |
|---|---|
| `stack/` | The compose file, PowerSync's configuration and the stand-in streams, and `conformance:up` |
| `harness/` | Clients, the suite's connector, the network, the seeded generator, the invariants, the fuzzer; `*.test.ts` beside them are its unit tests, run by `pnpm test` |
| `scenarios/` | The 18 scenarios and the access-loss cases, and `enabled`: the ones switched on |
| `suite/` | What `conformance` runs: the harness's self-tests and negative controls, the scenarios, the fuzzer |
| `../../../server/internal/conformance` | The conformance module the scenarios write, and the stand-in API (`cmd/conformance-standin`) |

## Until the engine exists

The suite runs against stand-ins of its own (`harness/target.ts`): a sign-in that names the caller,
PowerSync tokens signed with a test key, hand-written streams over the conformance module's items and
checks, and a push that writes those through the real mutation spine. The scenarios are skipped until
the item that builds their engine switches them on:

| Item | Switches on |
|---|---|
| 13 | 1, 3, 4, 5, 8, 9, 10, 13, 15, 17, with the engine as a target |
| 14 | 2, 6, 7, 11, 12, 13-rotation, 16, 18, and the five `loss-*` cases |
| 18 | 14, and `no-loss-lapse` |
