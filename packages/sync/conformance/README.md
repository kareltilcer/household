# The sync conformance suite

PRD 10 §4's falsifier (plan items 12 and 13, [ADR 0013](../../../docs/adr/0013-conformance-suite-stand-ins-and-the-oracle.md),
[ADR 0014](../../../docs/adr/0014-powersync-deployment-generated-streams-credentials-and-the-push.md)):
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

`conformance:up` can be run again on a stack that is up, and starts PowerSync afresh on the configuration
and streams in `stack/powersync`; after a migration changes, `conformance:down` first, since the
stack's database is made once. The suite builds and starts the API it runs against itself, unless one
already answers (`CONFORMANCE_START_API=false` to require one). PowerSync, in its container, fetches
the keys it verifies a client's token with from that API at `host.docker.internal:8091`: on Linux,
where the container does not reach the host's loopback, the API listens where it does
(`CONFORMANCE_API_ADDR=0.0.0.0:8091`, as CI sets it).

| Variable | Default | What |
|---|---|---|
| `CONFORMANCE_FUZZ_RUNS` | 3 | Seeded schedules in a fuzz run |
| `CONFORMANCE_FUZZ_STEPS` | 30 | Steps in each |
| `CONFORMANCE_FUZZ_SEED` | 1 | The first seed; a failing one is named in the report |
| `CONFORMANCE_SCENARIOS` | | `all` runs every scenario the target can, switched on or not |
| `HOUSEHOLD_CONFORMANCE_PG_PORT`, `HOUSEHOLD_CONFORMANCE_POWERSYNC_PORT` | 5442, 8090 | The stack's ports |
| `CONFORMANCE_ADMIN_DATABASE_URL`, `CONFORMANCE_API_URL`, `CONFORMANCE_POWERSYNC_URL` | the stack's | Where the suite reaches each |
| `CONFORMANCE_API_ADDR` | the API URL's host | Where the API the suite starts listens |

A long fuzz run, as the nightly workflow runs it:

```bash
CONFORMANCE_FUZZ_RUNS=150 CONFORMANCE_FUZZ_STEPS=150 pnpm --filter @household/sync conformance:fuzz
```

## What is where

| Path | What |
|---|---|
| `stack/` | The compose file, PowerSync's configuration with its generated streams and their manifest, and `conformance:up` |
| `harness/` | Clients, the suite's connector, the network, the seeded generator, the invariants, the fuzzer; `*.test.ts` beside them are its unit tests, run by `pnpm test` |
| `scenarios/` | The 18 scenarios and the access-loss cases, and `enabled`: the ones switched on |
| `suite/` | What `conformance` runs: the harness's self-tests and negative controls, the scenarios, the fuzzer |
| `../../../server/internal/conformance` | The conformance module the scenarios write, its writer, and the suite's sign-in; `cmd/conformance-api` serves them with the server's API |

## The engine

The suite runs against the engine (`harness/target.ts`): the server's own API with the conformance
module registered, its push and its credentials, and PowerSync on the streams generated from the
entity registry (`pnpm run gen` writes `stack/powersync/sync-config.yaml` and `streams.json`), beside
one stream broken on purpose for the negative control. A client subscribes to every generated stream,
admin's included, and its replica is compared on every table the schema declares. The suite signs its
members in through a sign-in of its own, which signs a new device of theirs in. A scenario is skipped
until the item that builds its engine switches it on:

| Item | Switches on |
|---|---|
| 13 | 1, 3, 4, 5, 8, 9, 10, 13, 15, 17 |
| 14 | 2, 6, 7, 11, 12, 13-rotation, 16, 18, and the five `loss-*` cases |
| 18 | 14, and `no-loss-lapse` |
