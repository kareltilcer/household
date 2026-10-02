// What the suite runs against: the engine (plan items 13 and 17, ADR 0014, ADR 0018). The server's
// own API with the conformance module registered (server/cmd/conformance-api), its push writing every
// entity of the module, across the five merge policies, its credentials handing out PowerSync tokens
// signed with the API's keys, and PowerSync on the streams generated from the entity registry, its
// compaction run on demand. Item 12's stand-ins, a hand-written configuration and a push of their
// own, were replaced by it; a scenario asks the target for what it needs, so a later item's engine is
// a target the same scenarios run against.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { composeFile } from '../stack/stack.ts'
import { adminDatabaseUrl, apiUrl, powerSyncUrl } from './env.ts'
import { tables, type EntityType, type TableName } from './schema.ts'

export interface PowerSyncCredentials {
  readonly endpoint: string
  readonly token: string
}

export interface Target {
  readonly name: string
  /** Signs user in and returns the credential the push is sent with. */
  signIn(
    user: string,
    via: typeof fetch,
    options?: { readonly ttlSeconds?: number },
  ): Promise<string>
  /** PowerSync's URL and a token for user in household (the credentials operation). */
  powerSyncCredentials(
    credential: string,
    household: string,
    via: typeof fetch,
  ): Promise<PowerSyncCredentials>
  /** Where household's mutations are pushed. */
  pushUrl(household: string): string
  /** The streams a client subscribes to, each with {household_id}. */
  readonly streams: readonly string[]
  /** The tables its streams replicate: the tables a replica is compared on. */
  readonly replicates: ReadonlySet<TableName>
  /** The entities its push writes. */
  readonly writes: ReadonlySet<EntityType>
  /** Whether a soft-deleted row stays in a replica (item 13) or leaves it. */
  readonly tombstones: 'dropped' | 'kept'
  /**
   * How a batch delivered twice is answered alike: under its own Idempotency-Key only, or under a
   * fresh one as well, by per-mutation idempotency (FR-SY5, item 13).
   */
  readonly replay: 'same-key' | 'fresh-key'
  /** Runs PowerSync's compaction (item 17), which scenario 6 needs. */
  readonly compact?: () => Promise<void>
  /** Sets household's entitlement (item 16), which scenario 14 needs. */
  readonly setEntitlement?: (household: string, state: 'active' | 'read_only') => Promise<void>
  /**
   * Uploads an attachment's bytes (item 14), named fileName, which scenario 12 needs, and answers the
   * upload's status.
   */
  readonly uploadAttachment?: (
    credential: string,
    household: string,
    attachment: string,
    file: { readonly bytes: Uint8Array; readonly contentType: string; readonly fileName: string },
  ) => Promise<number>
}

/** A capability a target may lack, which a scenario that needs it waits for. */
export type Capability = 'compact' | 'setEntitlement' | 'uploadAttachment'

/** A refusal of the API credential a request carried, which signing in again answers. */
export class Unauthorized extends Error {}

async function json(response: Response, what: string): Promise<unknown> {
  if (response.status === 401) throw new Unauthorized(`${what}: 401 ${await response.text()}`)
  if (!response.ok) throw new Error(`${what}: ${String(response.status)} ${await response.text()}`)
  return response.json()
}

function field(body: unknown, name: string, what: string): string {
  const value = (body as Record<string, unknown> | null)?.[name]
  if (typeof value !== 'string') throw new Error(`${what} answered no ${name}`)
  return value
}

/** A stream of the generated configuration, with the entity and the table its rows come from. */
interface Generated {
  readonly stream: string
  readonly entity: string
  readonly table: string
}

/**
 * The streams the suite's clients subscribe to, as server/internal/syncconfig generated them beside
 * the configuration PowerSync runs (stack/powersync/streams.json): every stream but the negative
 * control's.
 */
const generated = JSON.parse(
  readFileSync(new URL('../stack/powersync/streams.json', import.meta.url), 'utf8'),
) as readonly Generated[]

function isTable(name: string): name is TableName {
  return tables.some((t) => t.table === name)
}

/**
 * The subscription states setEntitlement writes onto a household's row, as the hourly transitions
 * and Stripe's webhooks will (item 16, item 19): a lapse into read_only starts its countdown to
 * deletion, twelve months and thirty days (D-119), and a resumed subscription clears every clock.
 * It writes as the database's administrator, as the suite's access changes do (admin.ts): the API
 * reads the state anew on every request (PRD 04 §3).
 */
const entitlements = {
  read_only: `UPDATE households SET billing_state = 'read_only', lapsed_at = now(),
    retained_until = now() + interval '1 year' + interval '720 hours', retention_warnings = 0 WHERE id = $1`,
  active: `UPDATE households SET billing_state = 'active', dunning_ends_at = NULL, grace_ends_at = NULL,
    lapsed_at = NULL, retained_until = NULL, retention_warnings = 0 WHERE id = $1`,
} as const

/** The engine (plan items 13 and 17). */
export const engine: Target = {
  name: 'engine',
  async signIn(user, via, options) {
    const body = await json(
      await via(`${apiUrl}/conformance/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: user, ttl_seconds: options?.ttlSeconds ?? 0 }),
      }),
      'the conformance sign-in',
    )
    return field(body, 'token', 'the conformance sign-in')
  },
  async powerSyncCredentials(credential, household, via) {
    const body = await json(
      await via(`${apiUrl}/api/v1/households/${household}/sync/credentials`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}` },
      }),
      'the sync credentials',
    )
    const endpoint = field(body, 'endpoint', 'the sync credentials')
    if (endpoint !== powerSyncUrl) {
      throw new Error(
        `the API hands out ${endpoint}, but the suite reaches PowerSync at ${powerSyncUrl}`,
      )
    }
    return { endpoint, token: field(body, 'token', 'the sync credentials') }
  },
  pushUrl: (household) => `${apiUrl}/api/v1/households/${household}/sync/mutations`,
  streams: generated.map((g) => g.stream),
  replicates: new Set(generated.map((g) => g.table).filter(isTable)),
  writes: new Set<EntityType>(
    tables.flatMap((t) => (t.entity?.startsWith('conformance.') === true ? [t.entity] : [])),
  ),
  tombstones: 'kept',
  replay: 'fresh-key',
  // PowerSync's own command, in the stack's service, as the deployment's nightly schedule runs it
  // (deploy/powersync/compact.sh): it supersedes the operations of a bucket a later one replaced.
  compact() {
    execFileSync(
      'docker',
      [
        'compose',
        '--file',
        composeFile,
        'exec',
        '-T',
        'powersync',
        'node',
        'service/lib/entry.js',
        'compact',
      ],
      { stdio: 'ignore' },
    )
    return Promise.resolve()
  },
  // The conformance API's own route (server/internal/conformance/upload.go), through item 14's
  // pipeline: the contract names no operation of the conformance module's.
  async uploadAttachment(credential, household, attachment, file) {
    const form = new FormData()
    form.append('file', new Blob([file.bytes], { type: file.contentType }), file.fileName)
    const response = await fetch(
      `${apiUrl}/conformance/households/${household}/attachments/${attachment}/content`,
      { method: 'POST', headers: { authorization: `Bearer ${credential}` }, body: form },
    )
    await response.arrayBuffer()
    return response.status
  },
  async setEntitlement(household, state) {
    const client = new pg.Client({ connectionString: adminDatabaseUrl })
    await client.connect()
    try {
      const { rowCount } = await client.query(entitlements[state], [household])
      if (rowCount !== 1) throw new Error(`no household ${household} to set ${state}`)
    } finally {
      await client.end()
    }
  },
}

/** The configuration's deliberately broken stream, which only the negative control subscribes to. */
export const leakyStream = 'negative_control_leaky_items'
