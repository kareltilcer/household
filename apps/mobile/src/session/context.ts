// Who is signed in on this device, as a screen reads it. The provider that knows is
// SessionProvider.tsx; a component test's is fixture.tsx. This file holds what both hand down
// and nothing of the device's, so that reading the session loads no keychain and no
// notifications with it.
import type { components } from '@household/api'
import { createContext, use } from 'react'

export type Me = components['schemas']['Me']
export type TokenPair = components['schemas']['TokenPair']
export type DeviceSignIn = components['schemas']['DeviceSignIn']

export type SessionState =
  /** Not read from the device yet, or asked of the server and not yet answered, with nothing kept. */
  | { readonly status: 'unknown' }
  /** Nobody is signed in. */
  | { readonly status: 'visitor' }
  /** Signed in: the account as it was last read, which with no connection is as it was kept. */
  | { readonly status: 'member'; readonly me: Me }
  /** The device holds a sign-in, the server could not be asked whose, and nothing is kept. */
  | { readonly status: 'unreachable' }

/** What a sign-in the server answered hands the session: the account, and the pair it is signed in with. */
export interface SignedIn {
  readonly user: Me
  readonly tokens: TokenPair
}

/**
 * The device's sign-in as @household/sync takes it (its `Credential`): the token a request of
 * the replica's is sent with, and its renewal.
 */
export interface ReplicaCredential {
  /** A live access token. It throws what `ended` makes where nobody is signed in any more. */
  readonly current: () => Promise<string>
  /**
   * Renews the sign-in, for a request of the replica's the server refused. It throws what
   * `ended` makes where the renewal was refused, and rejects with whatever else it met where the
   * server could not be asked: the replica asks again.
   */
  readonly renew: () => Promise<void>
}

export interface Session {
  readonly state: SessionState
  /**
   * Whether the sign-in this device held was ended from elsewhere, until someone signs in again:
   * the server refused to renew it, and everything the device kept of its member was removed.
   * The answer names no cause (Q18), so neither does this.
   */
  readonly ended: boolean
  /** Whether the member who was here signed out themselves, until someone signs in again. */
  readonly signedOut: boolean
  /**
   * Takes a sign-in the server answered: the screen that made it calls. The pair is kept under
   * its member, and what the device kept of another member, signed in here before, is removed
   * first.
   */
  readonly signedIn: (answer: SignedIn) => Promise<void>
  /**
   * Signs out: the device's push registration is removed, the server ends the sign-in, and only
   * then is what this device kept removed. It rejects, and the member stays signed in with
   * everything kept, where the server could not be told: a sign-in only it ends.
   */
  readonly signOut: () => Promise<void>
  /** Asks again who is signed in, where the server could not be asked. */
  readonly retry: () => void
  /** The oldest version the server serves, once it has refused this build as older. */
  readonly minimumVersion: string | null
  /** This installation as a sign-in names it (`LoginRequest.device`): its id is made once and kept. */
  readonly device: () => Promise<DeviceSignIn>
  /**
   * The sign-in as a replica is given it. `ended` makes what tells the replica its sign-in is
   * gone, the library's own `Revoked`, which whoever opens the replica hands over: this file
   * imports nothing of the library's.
   */
  readonly credential: (ended: () => Error) => ReplicaCredential
}

export const SessionContext = createContext<Session | null>(null)

/** The query that holds the account: read by key wherever the account is changed. */
export const meKey = ['me'] as const

export function useSession(): Session {
  const session = use(SessionContext)
  if (session === null) throw new Error('useSession: no SessionProvider above this component')
  return session
}

/** The signed-in member's account: for a screen drawn only for one (guards.tsx). */
export function useMe(): Me {
  const { state } = useSession()
  if (state.status !== 'member') throw new Error('useMe: nobody is signed in on this screen')
  return state.me
}

/**
 * Whether two ids are one: a UUID is written in either case, and the contract's are compared
 * without it. Never where either is missing.
 */
export function sameId(one: string | null | undefined, other: string | null | undefined): boolean {
  return typeof one === 'string' && typeof other === 'string'
    ? one.toLowerCase() === other.toLowerCase()
    : false
}
