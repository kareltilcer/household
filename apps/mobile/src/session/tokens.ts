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
// - A request is answered by its own sign-in alone. One that left under a member's token and
//   was refused after another member's became the one in use is given no token of theirs to be
//   sent again with: it would be the first member's request, made as the second.
// - A pair the keystore would not take is held in memory and written again as a token is next
//   asked for: a keychain shut while the device is locked takes it once it is not, and until
//   it has, the app closed would start again on a refresh token that is used up.
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
  /**
   * Reads what the device holds: the member whose sign-in is in use, or null for nobody's. It
   * rejects where the vault would not say what it holds: nobody is signed in for this run, and
   * what the vault held it holds still.
   */
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
   * The access tokens the sign-in in use has been signed with in this run: a request refused on
   * one of them was its own. Emptied when another member's becomes the one in use.
   */
  const own = new Set<string>()
  /** Whether the pair in memory is one the vault would not take. */
  let unkept = false
  /** The pair's writes, one after another: an earlier one never lands over a later one. */
  let writing: Promise<void> = Promise.resolve()

  /**
   * Keeps `value`, where the device will keep it. One that will not goes on with what it holds
   * in memory: the sign-in works for as long as the app runs.
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

  /**
   * Writes the pair in use, as it is held when its turn comes. Where the vault will not take
   * it, it is written again as a token is next asked for (`current`).
   */
  const storePair = () => {
    writing = writing.then(async () => {
      const member = index.active
      const held = pair
      if (member === null || held === null) return
      try {
        await vault.set(
          vaultKeys.signIn(member),
          JSON.stringify({
            access: held.access,
            refresh: held.refresh,
            expires_at: held.expiresAt,
          }),
        )
        unkept = false
      } catch {
        unkept = true
      }
    })
    return writing
  }

  const drop = async (member: string) => {
    const id = member.toLowerCase()
    index = {
      active: index.active === id ? null : index.active,
      members: index.members.filter((each) => each !== id),
    }
    if (index.active === null) {
      pair = null
      unkept = false
      own.clear()
    }
    // A write of the pair that is on its way lands first, and not over its removal.
    await writing
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
    own.add(pair.access)
    await storePair()
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
      try {
        index = readIndex(await vault.get(vaultKeys.signIns))
        pair =
          index.active === null ? null : readPair(await vault.get(vaultKeys.signIn(index.active)))
      } catch (error) {
        // A vault that will not say what it holds, a keychain that is shut for now, holds what
        // it held: nothing of it is removed on its silence.
        index = { active: null, members: [] }
        pair = null
        throw error
      }
      // A member the device names and holds no pair for, as after a keystore was reset, is
      // signed in to nothing.
      if (index.active !== null && pair === null) await drop(index.active)
      if (pair !== null) own.add(pair.access)
      return index.active
    },
    member: () => index.active,
    members: () => index.members,
    device: () => {
      installation ??= (async () => {
        // A vault that will not say names no installation: one is made, as on a device new to it.
        const kept = await vault.get(vaultKeys.device).catch(() => null)
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
      // Another member's tokens are no part of this sign-in.
      if (index.active !== id) own.clear()
      own.add(pair.access)
      index = { active: id, members: [...index.members.filter((each) => each !== id), id] }
      await storePair()
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
      if (unkept) void storePair()
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
      // A request another sign-in sent, the one in use until a moment ago: nothing of this one's
      // answers for it, and its own refusal stands.
      if (!own.has(used)) return Promise.resolve(undefined)
      // Renewed already, by a request that was refused a moment sooner: that pair is the answer.
      if (pair !== null && pair.access !== used) return Promise.resolve(pair.access)
      return renewOnce()
    },
  }
}
