// What the suite runs against. Until items 13 and 14 land it is the stand-ins
// (server/cmd/conformance-standin and conformance/stack/powersync): a sign-in that names the
// caller, PowerSync credentials signed with a test key, hand-written streams over the items and
// their checks, and a push that writes those two through the real spine. Item 13 adds the engine
// as a target of its own and moves the scenarios onto it; a scenario asks the target for what it
// needs, so the same scenario runs against either.

import { powerSyncUrl, standInUrl } from './env.ts'
import type { EntityType, TableName } from './schema.ts'

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
  /** PowerSync's URL and a token for user in household (item 13's credentials operation). */
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
  /** Runs PowerSync's compact job (item 14), which scenario 6 needs. */
  readonly compact?: () => Promise<void>
  /** Sets household's entitlement (item 18), which scenario 14 needs. */
  readonly setEntitlement?: (household: string, state: 'active' | 'read_only') => Promise<void>
  /**
   * Uploads an attachment's bytes (item 16), which scenario 12 needs, and answers the upload's
   * status.
   */
  readonly uploadAttachment?: (
    credential: string,
    household: string,
    attachment: string,
    bytes: Uint8Array,
    contentType: string,
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

/** The stand-ins (plan item 12). */
export const standIn: Target = {
  name: 'stand-in',
  async signIn(user, via, options) {
    const body = await json(
      await via(`${standInUrl}/standin/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: user, ttl_seconds: options?.ttlSeconds ?? 0 }),
      }),
      'the stand-in sign-in',
    )
    return field(body, 'token', 'the stand-in sign-in')
  },
  async powerSyncCredentials(credential, household, via) {
    const body = await json(
      await via(`${standInUrl}/standin/households/${household}/sync/credentials`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}` },
      }),
      'the stand-in credentials',
    )
    const endpoint = field(body, 'endpoint', 'the stand-in credentials')
    if (endpoint !== powerSyncUrl) {
      throw new Error(
        `the stand-in hands out ${endpoint}, but the suite reaches PowerSync at ${powerSyncUrl}`,
      )
    }
    return { endpoint, token: field(body, 'token', 'the stand-in credentials') }
  },
  pushUrl: (household) => `${standInUrl}/api/v1/households/${household}/sync/mutations`,
  streams: [
    'conformance_items_owner',
    'conformance_items_granted',
    'conformance_item_checks_owner',
    'conformance_item_checks_granted',
  ],
  replicates: new Set<TableName>(['conformance_items', 'conformance_item_checks']),
  writes: new Set<EntityType>(['conformance.item', 'conformance.item_checked']),
  tombstones: 'dropped',
  replay: 'same-key',
}

/** The stand-in's deliberately broken stream, which only the negative control subscribes to. */
export const leakyStream = 'negative_control_leaky_items'
