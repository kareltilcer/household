// Where the suite's stack listens and how its database is reached, shared by `conformance:up` and
// the suite's global setup. The ports move with the variables docker-compose.yml reads.

import { resolve } from 'node:path'

export const stackDir = import.meta.dirname
export const composeFile = resolve(stackDir, 'docker-compose.yml')
export const serverDir = resolve(stackDir, '../../../../server')

const pgPort = process.env['HOUSEHOLD_CONFORMANCE_PG_PORT'] ?? '5442'

function url(role: string, password: string): string {
  return `postgres://${role}:${password}@127.0.0.1:${pgPort}/household?sslmode=disable`
}

/**
 * The environment `household-api` and `conformance-standin` run with against the stack's
 * database: one connection string per role, as .env.example gives them for the development one.
 */
export const serverEnv: Readonly<Record<string, string>> = {
  HOUSEHOLD_ENV: 'development',
  HOUSEHOLD_DATABASE_URL: url('household_app', 'household_app'),
  HOUSEHOLD_MIGRATE_DATABASE_URL: url('household_migrate', 'household_migrate'),
  HOUSEHOLD_METER_DATABASE_URL: url('household_meter', 'household_meter'),
  HOUSEHOLD_ADMIN_DATABASE_URL: url('postgres', 'postgres'),
  CONFORMANCE_REPLICATION_URL: `postgres://conformance_powersync:conformance_powersync@127.0.0.1:${pgPort}/household`,
  CONFORMANCE_STORAGE_URL: `postgres://conformance_powersync_storage:conformance_powersync_storage@127.0.0.1:${pgPort}/powersync_storage`,
}
