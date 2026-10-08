// Stand-ins for the parts of a browser Web Push asks for and jsdom has none of: service workers,
// the Push API and notifications. A test says what the browser would say, the permission and
// whether it is subscribed, and reads back what was asked of it. Imported by tests alone.
import { vi } from 'vitest'
import { base64url } from './worker.ts'

/** The server's VAPID key in these tests: an uncompressed P-256 point's length, in base64url. */
export const serverKey = base64url(new Uint8Array(65).fill(4).buffer)

export interface Browser {
  /** What the browser answers the question with, when it is put. */
  readonly answer?: NotificationPermission
  /** What it says before anything is asked. */
  readonly permission?: NotificationPermission
  /** The key its subscription was made under, where it holds one already. */
  readonly subscribedUnder?: Uint8Array | null
  /** Whether subscribing fails, as in a browser with no push service. */
  readonly refuses?: boolean
}

export interface FakeSubscription {
  readonly endpoint: string
  readonly options: { readonly applicationServerKey: ArrayBuffer | null }
  readonly getKey: (name: string) => ArrayBuffer
  readonly unsubscribe: () => Promise<boolean>
}

export interface PushStandIns {
  readonly notification: {
    permission: NotificationPermission
    readonly requestPermission: ReturnType<typeof vi.fn<() => Promise<NotificationPermission>>>
  }
  readonly register: ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>
  readonly subscribe: ReturnType<
    typeof vi.fn<(options: PushSubscriptionOptionsInit) => Promise<FakeSubscription>>
  >
  /** How many times a subscription of this browser's was given up. */
  readonly unsubscribed: () => number
  /** The subscription the browser holds now. */
  readonly subscription: () => FakeSubscription | null
  /** Posts `data` to the page as the worker would. */
  readonly post: (data: unknown) => void
  /** Takes the stand-ins away again. */
  readonly remove: () => void
}

export const endpoint = 'https://push.example/send/abc'

/** The bytes a stand-in subscription gives as its keys, by the key's name. */
export function keyBytes(name: string): ArrayBuffer {
  return new TextEncoder().encode(`${name}-of-the-browser`).buffer
}

/** Gives this page a browser that has Web Push, and says of it what `browser` says. */
export function pushStandIns(browser: Browser = {}): PushStandIns {
  let held: FakeSubscription | null = null
  let unsubscribed = 0
  const make = (key: ArrayBuffer | null): FakeSubscription => {
    const subscription: FakeSubscription = {
      endpoint,
      options: { applicationServerKey: key },
      getKey: keyBytes,
      unsubscribe: () => {
        unsubscribed += 1
        if (held === subscription) held = null
        return Promise.resolve(true)
      },
    }
    return subscription
  }
  if (browser.subscribedUnder !== undefined) {
    held = make(browser.subscribedUnder === null ? null : copy(browser.subscribedUnder))
  }
  const subscribe = vi.fn((options: PushSubscriptionOptionsInit) => {
    if (browser.refuses === true) return Promise.reject(new DOMException('no push service'))
    const key = options.applicationServerKey
    held = make(key instanceof Uint8Array ? copy(key) : null)
    return Promise.resolve(held)
  })
  const registration = {
    pushManager: { getSubscription: () => Promise.resolve(held), subscribe },
  }
  let registered = browser.subscribedUnder !== undefined
  const register = vi.fn<(url: string) => Promise<unknown>>(() => {
    registered = true
    return Promise.resolve(registration)
  })
  const listeners = new Set<(event: MessageEvent<unknown>) => void>()
  const workers = {
    register,
    ready: Promise.resolve(registration),
    getRegistration: () => Promise.resolve(registered ? registration : undefined),
    addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => {
      listeners.delete(listener)
    },
  }
  Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: workers })
  // Looked for by name alone: whether the browser has the Push API at all.
  vi.stubGlobal('PushManager', {})
  const notification: PushStandIns['notification'] = {
    permission: browser.permission ?? 'default',
    requestPermission: vi.fn(() => {
      notification.permission = browser.answer ?? 'granted'
      return Promise.resolve(notification.permission)
    }),
  }
  vi.stubGlobal('Notification', notification)
  return {
    notification,
    register,
    subscribe,
    unsubscribed: () => unsubscribed,
    subscription: () => held,
    post: (data) => {
      for (const listener of [...listeners]) listener(new MessageEvent('message', { data }))
    },
    // The two globals are taken away with every other stubbed one, when the test is done.
    remove: () => {
      Reflect.deleteProperty(window.navigator, 'serviceWorker')
    },
  }
}

function copy(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
