// Where the conformance stack is, as conformance/stack/docker-compose.yml and
// server/cmd/conformance-api publish it by default. Each can be moved with the variable named
// beside it, which CI and a developer with other ports set.

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

/**
 * The API the suite runs against (server/cmd/conformance-api): the server's own, with the
 * conformance module registered, which PowerSync's configuration fetches its keys from at
 * host.docker.internal:8091.
 */
export const apiUrl = env('CONFORMANCE_API_URL', 'http://127.0.0.1:8091')

/**
 * Where the API the suite starts listens: its URL's host by default. PowerSync, in a container,
 * reaches it at the host's address on its docker network, which a Linux host's loopback is not, so
 * CI has it listen on every interface.
 */
export const apiListen = env('CONFORMANCE_API_ADDR', new URL(apiUrl).host)

/** PowerSync, as a client reaches it: the address its credentials name must match it. */
export const powerSyncUrl = env('CONFORMANCE_POWERSYNC_URL', `http://127.0.0.1:${powerSyncPort}`)

/** Whether the suite may start the API itself when none answers at apiUrl. */
export const startApi = env('CONFORMANCE_START_API', 'true') === 'true'

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
