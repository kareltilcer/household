// Push on this device (PRD 03 §4 FR-NT1, 06-clients §6, 03-patterns §8), with nothing of
// React's: the session calls it as a member signs in and out, and a screen through a hook
// (usePush.ts). A device's token reaches its member while their sign-in lives, so it is
// registered again at each sign-in and each start, and removed at each sign-out, and nothing
// here asks the member anything by itself: the system's question is put by a press alone
// (`requestPushPermission`), never as the app starts and never at sign-in.
//
// The token is Expo's (the contract's `expo` transport), asked for with the project the build
// belongs to. A build that was told none cannot ask for one: its state is `unsupported`, which
// its screen says as *not set up in this build*, and nothing is asked of anybody.
import type { ApiClient } from '@household/api'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { buildSettings, setting } from '../api/client.ts'
import { ApiProblemError, problemIn, unwrap } from '../api/problem.ts'
import type { ProblemHub } from '../api/problems.ts'
import { isOwnPath } from '../app/paths.ts'
import { onForget } from '../session/forget.ts'
import * as device from './device.ts'

/** What the system says of notifications from this app, or that this build cannot register for any. */
export type PushPermission = 'unsupported' | 'default' | 'denied' | 'granted'

export interface PushState {
  readonly permission: PushPermission
  /** Whether this device's token is registered for its member, which the server was told of. */
  readonly subscribed: boolean
}

const unsupported: PushState = { permission: 'unsupported', subscribed: false }

/**
 * The query that holds this device's state for a member (usePush.ts): read again by key where
 * something else changes it, as the renewal at a sign-in does (Push.tsx).
 */
export function pushStateKey(member: string) {
  return ['push', 'state', member.toLowerCase()] as const
}

/** The EAS project this build belongs to, which a push token is asked for: undefined for none. */
export function pushProject(extra: unknown = buildSettings()): string | undefined {
  return setting(extra, 'eas', 'projectId')
}

/**
 * Where the token registered for `member` is kept: what `subscribed` is read from, and what is
 * removed at the server before a sign-out with no word from Expo's service, which a device with
 * a poor connection may not reach.
 */
function tokenKey(member: string): string {
  return `household.push.token.${member.toLowerCase()}`
}

/**
 * Where a member's own choice to turn notifications off on this device is kept: without it,
 * the next sign-in would turn them on again, the permission being granted still. It is the
 * device's, as the permission is, kept for each member a shared tablet signs in, and it
 * outlives their sign-in.
 */
function offKey(member: string): string {
  return `household.push.off.${member.toLowerCase()}`
}

async function kept(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key)
  } catch {
    return null
  }
}

async function keep(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key)
    else await AsyncStorage.setItem(key, value)
  } catch {
    // Kept for this run alone: the next start registers a device that allows it.
  }
}

// A sign-in that ended took the server's registration with it: the device forgets it had one.
onForget((member) => keep(tokenKey(member), null))

/**
 * What this device says of notifications, and whether it is registered for `member`. It
 * registers nothing and asks nothing, so it is read as a screen opens. `project` is the build's
 * (`pushProject`), which every caller hands over: undefined is a build that cannot register.
 */
export async function readPushState(
  member: string,
  project: string | undefined,
): Promise<PushState> {
  if (project === undefined) return unsupported
  const permission = await device.permission()
  if (permission !== 'granted') return { permission, subscribed: false }
  return { permission, subscribed: (await kept(tokenKey(member))) !== null }
}

/**
 * Puts the system's own question. Called in the press that asks, and by nothing else. A build
 * that cannot register is asked nothing: a permission it could do nothing with. `channel` is
 * the name Android's settings show the app's notifications under.
 */
export function requestPushPermission(
  channel: string,
  project: string | undefined,
): Promise<PushPermission> {
  if (project === undefined) return Promise.resolve('unsupported')
  return device.requestPermission(channel)
}

export interface Registration {
  readonly api: ApiClient
  /** The member the device is registered for: whoever is signed in. */
  readonly member: string
  /** The installation's id, which the sign-in named its device by (session/tokens.ts). */
  readonly device: string
  /** The name Android's settings show the app's notifications under. */
  readonly channel: string
  /** The EAS project the build belongs to (`pushProject`), or undefined for none. */
  readonly project: string | undefined
}

/**
 * Registers this device, which allows notifications already, for its member: Expo's token for
 * the installation, told to the server with the device it is signed in on. A device reads as
 * subscribed only once the server has heard of it.
 */
export async function subscribePush({
  api,
  member,
  device: installation,
  channel,
  project,
}: Registration): Promise<PushState> {
  if (project === undefined) return unsupported
  await device.ensureChannel(channel)
  const token = await device.expoToken(project)
  unwrap(
    await api.POST('/push/subscriptions', {
      body: { transport: 'expo', endpoint: token, device_id: installation },
    }),
  )
  await keep(tokenKey(member), token)
  await keep(offKey(member), null)
  return { permission: 'granted', subscribed: true }
}

/**
 * Turns notifications off on this device, by its member's own choice: the server forgets the
 * token, and the choice is kept, so that the next sign-in leaves it off. Where the server cannot
 * be told it rejects, and nothing is changed.
 */
export async function unsubscribePush(
  api: ApiClient,
  member: string,
  project: string | undefined,
): Promise<PushState> {
  const token = await kept(tokenKey(member))
  if (token !== null) {
    unwrap(await api.DELETE('/push/subscriptions', { params: { query: { endpoint: token } } }))
    await keep(tokenKey(member), null)
  }
  await keep(offKey(member), '1')
  return readPushState(member, project)
}

/**
 * For a device that allows notifications already: registers its token with the server again,
 * asking nothing. Called once a member is signed in, at a sign-in and at each start: a token
 * reaches its member only while their sign-in lives, and Expo may have given the installation
 * another since. A build that cannot register, a device that was never asked or refused, and one
 * whose member turned notifications off here are left as they are. It never rejects: a device
 * that could not be registered is tried at the next start. It asks the server outside any query
 * or mutation, so what it is refused with is told to `problems` here.
 */
export async function renewPush(registration: Registration, problems: ProblemHub): Promise<void> {
  const { member, project } = registration
  try {
    if (project === undefined || (await device.permission()) !== 'granted') return
    if ((await kept(offKey(member))) !== null) return
    await subscribePush(registration)
  } catch (error) {
    // Left as it was. A token the server refused outright it will refuse again: forgotten.
    if (error instanceof ApiProblemError && error.status === 422) {
      await keep(tokenKey(member), null)
    }
    const problem = problemIn(error)
    if (problem !== undefined) problems.report(problem)
  }
}

/**
 * Removes this device's registration, for a sign-out: called before the sign-in ends, so that
 * the server can still be told, and the next person to sign in here is sent nothing that was the
 * last one's. The member's own choice is not touched. It never rejects: the server ends a
 * registration with its sign-in whether or not it heard. What it is refused with is told to
 * nobody: the sign-out follows at once and is told its own refusal.
 */
export async function forgetPush(api: ApiClient, member: string): Promise<void> {
  try {
    const token = await kept(tokenKey(member))
    if (token === null) return
    try {
      unwrap(await api.DELETE('/push/subscriptions', { params: { query: { endpoint: token } } }))
    } catch {
      // The sign-in's end removes it at the server.
    }
    await keep(tokenKey(member), null)
  } catch {
    // A device that will not let go of it keeps a token no sign-in answers for.
  }
}

/**
 * The address a pressed notification asks the app to open, or null: the `url` the server put in
 * its `data` (notify's `Link`), which is a path of the app's own. Anything else, another
 * origin's address among it, opens nothing.
 */
export function pushTarget(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const { url }: Partial<Record<string, unknown>> = { ...data }
  return typeof url === 'string' && isOwnPath(url) ? url : null
}
