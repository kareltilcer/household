// Web Push in this browser (PRD 03 §4 FR-NT1, 06-clients §6, 03-patterns §8), with nothing of
// React's: the shell calls it as a member signs in and out, and the account's screen through a
// hook (usePush.ts). A browser's subscription is bound to the web session that registered it and
// reaches its member while that session lives, so it is registered again at each sign-in and
// removed at each sign-out, and nothing here asks the member anything by itself: the browser's
// question is put by a press alone (`requestPushPermission`), never as a page loads.
//
// The worker that shows a push is the build's own file at the origin's root (build/pushWorker.ts).
// It handles no `fetch` and keeps no cache, so registering it changes nothing of how a page loads.
import type { ApiClient } from '@household/api'
import { pushOpenMessage, pushWorkerFile } from '../../build/pushWorker.ts'
import { ApiProblemError, problemIn, unwrap } from '../api/problem.ts'
import type { ProblemHub } from '../api/problems.ts'
import { isOwnPath } from '../app/paths.ts'

/** What the browser says of notifications from this origin, or that it has no Web Push at all. */
export type PushPermission = 'unsupported' | 'default' | 'denied' | 'granted'

export interface PushState {
  readonly permission: PushPermission
  /** Whether this browser holds a subscription, which the server was told of when it was made. */
  readonly subscribed: boolean
}

const unsupported: PushState = { permission: 'unsupported', subscribed: false }

/**
 * The query that holds this browser's state (usePush.ts): read again by key where something
 * else changes it, as the renewal at a sign-in does (Push.tsx).
 */
export const pushStateKey = ['push', 'state'] as const

/** Whether this browser has what a Web Push needs: service workers, the Push API, notifications. */
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in globalThis &&
    'Notification' in globalThis
  )
}

/**
 * Where the member's own choice to turn notifications off in this browser is kept: without it,
 * the next sign-in would turn them on again, the permission being granted still. It is the
 * browser's, as the permission is, and no account's.
 */
const offKey = 'household.push.off'

function turnedOff(): boolean {
  try {
    return window.localStorage.getItem(offKey) === '1'
  } catch {
    return false
  }
}

function keepTurnedOff(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(offKey, '1')
    else window.localStorage.removeItem(offKey)
  } catch {
    // Kept for this page alone: the next sign-in subscribes a browser that allows it.
  }
}

/**
 * `bytes` in base64url without padding: as the contract carries a subscription's keys, and as a
 * provider's sign-in carries its challenge (auth/provider.ts).
 */
export function base64url(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** The bytes `text` names in base64url, padded or not: the server's VAPID key, as a browser takes it. */
export function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function sameBytes(one: ArrayBuffer | null, other: Uint8Array): boolean {
  if (one === null) return false
  const bytes = new Uint8Array(one)
  return bytes.length === other.length && bytes.every((byte, index) => byte === other[index])
}

/**
 * Registers the worker that shows a push and answers a press on one, and waits until it is
 * active: a browser subscribes only through a worker that is.
 */
export async function registerPushWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(`/${pushWorkerFile}`)
  return navigator.serviceWorker.ready
}

/** This browser's subscription, where it has one: read, with nothing registered or asked. */
async function held(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

/**
 * What this browser says of notifications, and whether it is subscribed. It registers nothing and
 * asks nothing, so it is read as a screen opens.
 */
export async function readPushState(): Promise<PushState> {
  if (!pushSupported()) return unsupported
  const permission = Notification.permission
  if (permission !== 'granted') return { permission, subscribed: false }
  try {
    return { permission, subscribed: (await held()) !== null }
  } catch {
    // A browser that will not say holds no subscription the app can use.
    return { permission, subscribed: false }
  }
}

/**
 * Puts the browser's own question, whether Household may show notifications. Called in the press
 * that asks, before anything is awaited: a browser takes the question only from a member's own
 * gesture, and some take it from nothing that follows a wait. A browser already answered is not
 * asked again, which the browser would refuse to do in any case.
 */
export function requestPushPermission(): Promise<PushPermission> {
  if (!pushSupported()) return Promise.resolve('unsupported')
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission)
  // An older browser answers through a callback and returns nothing: what it then says is read.
  return Promise.resolve(Notification.requestPermission()).then(() => Notification.permission)
}

/**
 * Subscribes this browser, which allows notifications already, and tells the server: the
 * server's key, the browser's subscription under it, and the subscription's endpoint and keys
 * registered for this session. A subscription made under another key, one the server has since
 * replaced, is made again. A subscription the server could not be told of is not kept where this
 * call made it, so that a browser reads as subscribed only once the server has heard of it.
 */
export async function subscribePush(api: ApiClient): Promise<PushState> {
  const key = bytesOf(unwrap(await api.GET('/push/vapid-key')).key)
  const registration = await registerPushWorker()
  let subscription = await registration.pushManager.getSubscription()
  if (subscription !== null && !sameBytes(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe()
    subscription = null
  }
  const made = subscription === null
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  })
  try {
    const p256dh = subscription.getKey('p256dh')
    const auth = subscription.getKey('auth')
    if (p256dh === null || auth === null) throw new Error('push: the subscription has no keys')
    unwrap(
      await api.POST('/push/subscriptions', {
        body: {
          transport: 'web_push',
          endpoint: subscription.endpoint,
          keys: { p256dh: base64url(p256dh), auth: base64url(auth) },
        },
      }),
    )
  } catch (error) {
    // One the server refused outright it will refuse again: an endpoint at a push service it
    // does not send to. That one goes whoever made it.
    const refused = error instanceof ApiProblemError && error.status === 422
    if (made || refused) await subscription.unsubscribe().catch(() => undefined)
    throw error
  }
  keepTurnedOff(false)
  return { permission: 'granted', subscribed: true }
}

/**
 * Turns notifications off in this browser, by its member's own choice: the server forgets the
 * subscription, then the browser does, and the choice is kept, so that the next sign-in leaves
 * it off. Where the server cannot be told it rejects, and nothing is changed.
 */
export async function unsubscribePush(api: ApiClient): Promise<PushState> {
  if (!pushSupported()) return unsupported
  const subscription = await held()
  if (subscription !== null) {
    unwrap(
      await api.DELETE('/push/subscriptions', {
        params: { query: { endpoint: subscription.endpoint } },
      }),
    )
    await subscription.unsubscribe()
  }
  keepTurnedOff(true)
  return readPushState()
}

/**
 * For a browser that allows notifications already: registers its subscription with the server
 * again, asking nothing. Called once a member is signed in, since a subscription reaches its
 * member only while the session that registered it lives. A browser with no Push, one that was
 * never asked or refused, and one whose member turned notifications off here are left as they
 * are. It never rejects: a browser that could not be registered is tried at the next sign-in.
 * It asks the server outside any query or mutation, so what it is refused with is told to
 * `problems` here: a refusal that is about the session is answered as it is wherever it is met.
 */
export async function renewPush(api: ApiClient, problems: ProblemHub): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted' || turnedOff()) return
    await subscribePush(api)
  } catch (error) {
    // Left as it was.
    const problem = problemIn(error)
    if (problem !== undefined) problems.report(problem)
  }
}

/**
 * Removes this browser's subscription, for a sign-out: called before the session ends, so that
 * the server can still be told, and the next person to sign in here is sent nothing that was the
 * last one's. The member's own choice is not touched. It never rejects: the server ends a
 * subscription with its session whether or not it heard. What it is refused with is told to
 * nobody: the sign-out follows at once and is told its own refusal, and a session the server
 * ended already is then the sign-out done, where told of this one first it would be drawn as a
 * session that expired under its member.
 */
export async function forgetPush(api: ApiClient): Promise<void> {
  try {
    if (!pushSupported()) return
    const subscription = await held()
    if (subscription === null) return
    try {
      unwrap(
        await api.DELETE('/push/subscriptions', {
          params: { query: { endpoint: subscription.endpoint } },
        }),
      )
    } catch {
      // The session's end removes it at the server.
    }
    await subscription.unsubscribe()
  } catch {
    // A browser that will not let go of it keeps a subscription no session answers for.
  }
}

/**
 * The address a message from the worker asks the page to open, or null for any other message:
 * what the worker posts when a notification is pressed (`pushOpenMessage`), holding a path of
 * the app's own origin. Anything else, another origin's address among it, opens nothing.
 */
export function pushTarget(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const message: Partial<Record<string, unknown>> = { ...data }
  if (message.type !== pushOpenMessage || typeof message.url !== 'string') return null
  return isOwnPath(message.url) ? message.url : null
}
