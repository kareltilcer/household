// Where the conformance stack is, as conformance/stack/docker-compose.yml and
// server/cmd/conformance-standin publish it by default. Each can be moved with the variable
// named beside it, which CI and a developer with other ports set.

function env(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

/** The host ports docker-compose.yml publishes the stack's PostgreSQL and PowerSync on. */
export const pgPort = env('HOUSEHOLD_CONFORMANCE_PG_PORT', '5442')
const powerSyncPort = env('HOUSEHOLD_CONFORMANCE_POWERSYNC_PORT', '8090')

/** The stack's PostgreSQL, as its administrator: the suite seeds and reads the truth as it. */
export const adminDatabaseUrl = env(
  'CONFORMANCE_ADMIN_DATABASE_URL',
  `postgres://postgres:postgres@127.0.0.1:${pgPort}/household`,
)

/** The stand-in API (server/cmd/conformance-standin). */
export const standInUrl = env('CONFORMANCE_STANDIN_URL', 'http://127.0.0.1:8091')

/** PowerSync, as a client reaches it: the address its credentials name must match it. */
export const powerSyncUrl = env('CONFORMANCE_POWERSYNC_URL', `http://127.0.0.1:${powerSyncPort}`)

/** Whether the suite may start the stand-in itself when none answers at standInUrl. */
export const startStandIn = env('CONFORMANCE_START_STANDIN', 'true') === 'true'

function integer(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} is not a whole number: ${raw}`)
  return n
}

/**
 * The fuzz run: how many seeded schedules, from which seed, and how many steps each. A short run
 * on each change is the default; the nightly workflow asks for a long one.
 */
export const fuzz = {
  runs: integer('CONFORMANCE_FUZZ_RUNS', 3),
  seed: integer('CONFORMANCE_FUZZ_SEED', 1),
  steps: integer('CONFORMANCE_FUZZ_STEPS', 30),
}
