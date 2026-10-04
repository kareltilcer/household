// Where the suite's stack listens and how its database is reached, shared by `conformance:up` and
// the suite's global setup. The ports move with the variables docker-compose.yml reads.

import { resolve } from 'node:path'
import { pgPort } from '../harness/env.ts'
import { webOrigin } from '../web/origin.ts'

export const stackDir = import.meta.dirname
export const composeFile = resolve(stackDir, 'docker-compose.yml')
export const serverDir = resolve(stackDir, '../../../../server')

function url(role: string, password: string, database = 'household'): string {
  return `postgres://${role}:${password}@127.0.0.1:${pgPort}/${database}?sslmode=disable`
}

/**
 * Whether url answers with a 2xx: how `conformance:up` and the suite's setup wait for a service.
 * The body is read to its end, so that each poll lets its connection go.
 */
export async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    await response.arrayBuffer()
    return response.ok
  } catch {
    return false
  }
}

/**
 * The environment `household-api` and `conformance-api` run with against the stack's database: one
 * connection string per role, as .env.example gives them for the development one, PowerSync's
 * replication role and its bucket storage among them, as powersync/powersync.yaml names them; and the
 * origin the browser smoke test's page is served from, which an unsafe request may come from.
 */
export const serverEnv: Readonly<Record<string, string>> = {
  HOUSEHOLD_ENV: 'development',
  HOUSEHOLD_DATABASE_URL: url('household_app', 'household_app'),
  HOUSEHOLD_MIGRATE_DATABASE_URL: url('household_migrate', 'household_migrate'),
  HOUSEHOLD_METER_DATABASE_URL: url('household_meter', 'household_meter'),
  HOUSEHOLD_STAFF_DATABASE_URL: url('household_staff', 'household_staff'),
  HOUSEHOLD_ADMIN_DATABASE_URL: url('postgres', 'postgres'),
  HOUSEHOLD_REPLICATION_DATABASE_URL: url('household_powersync', 'household_powersync'),
  HOUSEHOLD_POWERSYNC_STORAGE_URL: url(
    'household_powersync_storage',
    'household_powersync_storage',
    'powersync_storage',
  ),
  HOUSEHOLD_ALLOWED_ORIGINS: webOrigin,
}
