// A device's sign-in, as the device holds it (PRD 02 FR-ID3, FR-ID4, ADR 0010): a token pair,
// kept in the device's vault under its member's id, with the installation's own id beside it.
// The access token lasts fifteen minutes and is renewed with the refresh token, which is used
// once and replaced by the pair it buys; the sign-in itself lasts until it is revoked (D-99).
//
// - One renewal at a time. Every request that needs one while it is under way waits for it and
//   is served by it: two renewals side by side would each present the same refresh token, and
//   the second would be a token used twice.
// - A renewal that got no answer changes nothing: the next one presents the token the device
//   still holds, which the server takes for the retry it is (D-98).
// - Only a renewal the server answers `401 refresh_token_invalid` ends a sign-in. The pair is
//   removed and whoever listens is told (`onEnded`): the session, which removes everything else
//   the device kept of its member (forget.ts). One that could not reach the server, or was
//   refused for now, ends nothing.
//
// The vault is laid out for several sign-ins on one device, each under its member, with one of
// them the one in use: a shared tablet signs several profiles in (D-104), which plan item 29
// builds on without moving anything that is kept today.
import { isUuid, newId as mintId, type components } from '@household/api'
import type { Bearer } from '../api/transport.ts'
import type { Vault } from './vault.ts'

export type TokenPair = components['schemas']['TokenPair']

/** What a renewal came to, where the server answered it either way. */
export type Exchange =
  | { readonly kind: 'renewed'; readonly tokens: TokenPair }
  /** `401 refresh_token_invalid`: the token opens no live sign-in. */
  | { readonly kind: 'ended' }

export interface TokenStoreOptions {
  readonly vault: Vault
  /**
   * Asks the server for a new pair with `refresh` (`postAuthToken`). It rejects where the server
   * could not be asked, or answered with anything but a pair or the sign-in's end.
   */
  readonly exchange: (refresh: string) => Promise<Exchange>
  readonly now?: () => number
  readonly newId?: () => string
}

export interface TokenStore extends Bearer {
  /** Reads what the device holds: the member whose sign-in is in use, or null for nobody's. */
  readonly start: () => Promise<string | null>
  /** The member whose sign-in is in use, as last read or set. */
  readonly member: () => string | null
  /** Every member signed in on this device. */
  readonly members: () => readonly string[]
  /** The installation's own id, made once and kept: what a sign-in names its device by. */
  readonly device: () => Promise<string>
  /** Keeps `tokens` as `member`'s sign-in, which is the one in use from then on. */
  readonly keep: (member: string, tokens: TokenPair) => Promise<void>
  /** Removes `member`'s sign-in from the device. The installation's id stays. */
  readonly remove: (member: string) => Promise<void>
  /**
   * Listens for a sign-in that ended: `listener` is told its member once the server has refused
   * to renew it and its pair is removed, until the function this returns is called.
   */
  readonly onEnded: (listener: (member: string) => void) => () => void
}

/** The keys the vault is written under. */
export const vaultKeys = {
  device: 'household.device',
  signIns: 'household.signins',
  signIn: (member: string) => `household.signin.${member.toLowerCase()}`,
} as const

/** How long before an access token lapses it is renewed: a request is not sent on one that would lapse on the way. */
export const renewBefore = 60_000

interface Pair {
  readonly access: string
  readonly refresh: string
  /** When the access token lapses, by this device's clock. */
  readonly expiresAt: number
}

interface Index {
  readonly active: string | null
  readonly members: readonly string[]
}

function parse(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function readPair(text: string | null): Pair | null {
  const value = parse(text)
  if (typeof value !== 'object' || value === null) return null
  const { access, refresh, expires_at: expiresAt } = value as Partial<Record<string, unknown>>
  if (typeof access !== 'string' || typeof refresh !== 'string' || typeof expiresAt !== 'number') {
    return null
  }
  return { access, refresh, expiresAt }
}

function readIndex(text: string | null): Index {
  const value = parse(text)
  if (typeof value !== 'object' || value === null) return { active: null, members: [] }
  const { active, members } = value as Partial<Record<string, unknown>>
  const known = Array.isArray(members)
    ? members.filter((member): member is string => typeof member === 'string')
    : []
  return {
    active: typeof active === 'string' && known.includes(active) ? active : null,
    members: known,
  }
}

export function createTokenStore({
  vault,
  exchange,
  now = Date.now,
  newId = mintId,
}: TokenStoreOptions): TokenStore {
  let index: Index = { active: null, members: [] }
  let pair: Pair | null = null
  let installation: Promise<string> | undefined
  let renewing: Promise<string | undefined> | null = null
  const listeners = new Set<(member: string) => void>()

  /**
   * Keeps `value`, where the device will keep it. One that will not goes on with what it holds
   * in memory: the sign-in works until the app is closed, and nothing here can make a keystore
   * that refuses hold it for longer.
   */
  const store = async (key: string, value: string) => {
    try {
      await vault.set(key, value)
    } catch {
      // Held in memory alone.
    }
  }

  const storeIndex = () =>
    store(vaultKeys.signIns, JSON.stringify({ active: index.active, members: index.members }))

  const storePair = (member: string, held: Pair) =>
    store(
      vaultKeys.signIn(member),
      JSON.stringify({ access: held.access, refresh: held.refresh, expires_at: held.expiresAt }),
    )

  const drop = async (member: string) => {
    const id = member.toLowerCase()
    index = {
      active: index.active === id ? null : index.active,
      members: index.members.filter((each) => each !== id),
    }
    if (index.active === null) pair = null
    await vault.remove(vaultKeys.signIn(id))
    await storeIndex()
  }

  const renew = async (): Promise<string | undefined> => {
    const member = index.active
    const held = pair
    if (member === null || held === null) return undefined
    const answer = await exchange(held.refresh)
    // Whoever is signed in now. Its member may have signed out while the server was asked, or
    // another signed in: what was asked for is then nobody's to keep.
    if (index.active !== member || pair?.refresh !== held.refresh) {
      return index.active === member ? pair?.access : undefined
    }
    if (answer.kind === 'ended') {
      await drop(member)
      for (const listener of [...listeners]) listener(member)
      return undefined
    }
    // Held before it is written: the token it replaces is used up either way.
    pair = {
      access: answer.tokens.access_token,
      refresh: answer.tokens.refresh_token,
      expiresAt: now() + answer.tokens.expires_in * 1000,
    }
    await storePair(member, pair)
    return pair.access
  }

  const renewOnce = () => {
    renewing ??= renew().finally(() => {
      renewing = null
    })
    return renewing
  }

  return {
    start: async () => {
      index = readIndex(await vault.get(vaultKeys.signIns))
      pair =
        index.active === null ? null : readPair(await vault.get(vaultKeys.signIn(index.active)))
      // A member the device names and holds no pair for, as after a keystore was reset, is
      // signed in to nothing.
      if (index.active !== null && pair === null) await drop(index.active)
      return index.active
    },
    member: () => index.active,
    members: () => index.members,
    device: () => {
      installation ??= (async () => {
        const kept = await vault.get(vaultKeys.device)
        if (kept !== null && isUuid(kept)) return kept
        const made = newId()
        await store(vaultKeys.device, made)
        return made
      })()
      return installation
    },
    keep: async (member, tokens) => {
      const id = member.toLowerCase()
      pair = {
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        expiresAt: now() + tokens.expires_in * 1000,
      }
      index = { active: id, members: [...index.members.filter((each) => each !== id), id] }
      await storePair(id, pair)
      await storeIndex()
    },
    remove: drop,
    onEnded: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    current: async () => {
      if (pair === null) return undefined
      if (pair.expiresAt - now() > renewBefore) return pair.access
      const held = pair.access
      try {
        return await renewOnce()
      } catch {
        // The server could not be asked for a new one: the one held is sent as it is, and the
        // server says whether it still stands.
        return held
      }
    },
    renew: (used) => {
      // Renewed already, by a request that was refused a moment sooner: that pair is the answer.
      if (pair !== null && pair.access !== used) return Promise.resolve(pair.access)
      return renewOnce()
    },
  }
}
