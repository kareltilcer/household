import { dehydrate, MutationObserver, onlineManager } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import type { UseStore } from 'idb-keyval'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider, useFormat } from '../i18n/I18nProvider.tsx'
import { clientName, cookieValue, createWebClient, csrfCookie } from './client.ts'
import { ApiProblemError, isRetryable, problemIn, unwrap } from './problem.ts'
import { useProblemText } from './problemText.ts'
import {
  askedNow,
  cacheMaxAge,
  createPersister,
  createQueryClient,
  persistOptions,
} from './query.ts'

const origin = 'https://household.example'

/** A transport that keeps what it was sent and answers each request with `respond`'s response. */
function transport(respond: (request: Request) => Response = () => Response.json({})) {
  const sent: Request[] = []
  return {
    sent,
    fetch: (request: Request) => {
      sent.push(request)
      return Promise.resolve(respond(request))
    },
  }
}

function problem(status: number, code: string, more: Record<string, unknown> = {}): Response {
  return Response.json(
    { type: `https://household.example/problems/${code}`, title: code, status, code, ...more },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )
}

describe('a cookie’s value', () => {
  it('is read from the page’s cookies by its whole name, as it is written there', () => {
    const cookies = `theme=dark; ${csrfCookie}=t0k%3Dn; other__Host-hh_csrf=wrong`
    // Not decoded: the server holds the header to the cookie character for character.
    expect(cookieValue(cookies, csrfCookie)).toBe('t0k%3Dn')
    expect(cookieValue(`${csrfCookie}=50%`, csrfCookie)).toBe('50%')
    expect(cookieValue('', csrfCookie)).toBeUndefined()
    expect(cookieValue('__Host-hh_csrfx=1', csrfCookie)).toBeUndefined()
  })
})

describe('the web client', () => {
  const signedIn = () => `${csrfCookie}=csrf-token`

  it('asks the page’s own origin, names itself, and sends the browser’s own cookies', async () => {
    const { sent, fetch } = transport()
    const client = createWebClient({ origin, fetch, cookies: signedIn })
    await client.GET('/healthz')
    const [request] = sent
    expect(request?.url).toBe(`${origin}/api/v1/healthz`)
    // A page no build made names the version alone, and a build's page its id after it.
    expect(request?.headers.get('Household-Client')).toBe(clientName(undefined))
    expect(clientName(undefined)).toMatch(/^web\/\d+\.\d+\.\d+$/)
    expect(clientName('008f0f94379a5b41')).toBe(`${clientName(undefined)}+008f0f94379a5b41`)
    expect(request?.credentials).toBe('same-origin')
    // A session is a cookie no script can read: the client carries no credential of its own.
    expect(request?.headers.has('Authorization')).toBe(false)
  })

  it('sends the CSRF cookie’s value with an unsafe request, and with no safe one', async () => {
    const { sent, fetch } = transport()
    const client = createWebClient({ origin, fetch, cookies: signedIn })
    await client.GET('/healthz')
    await client.POST('/auth/logout')
    expect(sent.map((request) => request.headers.get('X-CSRF-Token'))).toEqual([null, 'csrf-token'])
    // And the key that makes the request safe to resend, which @household/api adds.
    expect(sent[1]?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reads the cookie as each request leaves, since another tab may have signed in', async () => {
    const { sent, fetch } = transport()
    let cookies = ''
    const client = createWebClient({ origin, fetch, cookies: () => cookies })
    await client.POST('/auth/logout')
    cookies = `${csrfCookie}=second`
    await client.POST('/auth/logout')
    expect(sent.map((request) => request.headers.get('X-CSRF-Token'))).toEqual([null, 'second'])
  })

  it('resends a request whose response was lost with the token it left with', async () => {
    const sent: Request[] = []
    const client = createWebClient({
      origin,
      cookies: signedIn,
      retry: { delays: [0], sleep: () => Promise.resolve() },
      fetch: (request) => {
        sent.push(request)
        return sent.length === 1
          ? Promise.reject(new TypeError('network'))
          : Promise.resolve(new Response(null, { status: 204 }))
      },
    })
    await client.POST('/auth/logout')
    expect(sent).toHaveLength(2)
    expect(sent[1]?.headers.get('X-CSRF-Token')).toBe('csrf-token')
    expect(sent[1]?.headers.get('Idempotency-Key')).toBe(sent[0]?.headers.get('Idempotency-Key'))
  })
})

describe('what a request answered', () => {
  it('is its data', async () => {
    const { fetch } = transport(() => Response.json({ status: 'ok' }))
    const client = createWebClient({ origin, fetch, cookies: () => '' })
    expect(unwrap(await client.GET('/healthz'))).toEqual({ status: 'ok' })
  })

  it('is a problem thrown, typed by its code', async () => {
    const { fetch } = transport(() => problem(403, 'csrf_failed'))
    const client = createWebClient({ origin, fetch, cookies: () => '' })
    const result = await client.POST('/auth/logout')
    expect(() => {
      unwrap(result)
    }).toThrow(ApiProblemError)
    try {
      unwrap(result)
    } catch (error) {
      expect(problemIn(error)).toMatchObject({ status: 403, code: 'csrf_failed' })
      expect(error).toMatchObject({ status: 403, message: '403 csrf_failed' })
    }
  })

  it('is unreadable, and still thrown, when it is no problem document of this contract', async () => {
    const { fetch } = transport(() => new Response('<html>Bad gateway</html>', { status: 502 }))
    const client = createWebClient({ origin, fetch, cookies: () => '' })
    const result = await client.GET('/healthz')
    try {
      unwrap(result)
      expect.unreachable()
    } catch (error) {
      expect(problemIn(error)).toMatchObject({ code: undefined, status: 502 })
    }
  })
})

function thrown(status: number, code: string, retryAt?: Date): ApiProblemError {
  return new ApiProblemError(
    {
      type: `https://household.example/problems/${code}`,
      title: code,
      status,
      code,
    } as ApiProblemError['problem'],
    retryAt,
  )
}

describe('asking again', () => {
  it('may help when nothing answered, or the server failed, or the first attempt still runs', () => {
    expect(isRetryable(new TypeError('network'))).toBe(true)
    expect(isRetryable(thrown(500, 'internal'))).toBe(true)
    expect(isRetryable(thrown(502, 'storage_unavailable'))).toBe(true)
    expect(isRetryable(thrown(409, 'idempotency_in_progress'))).toBe(true)
  })

  it('does not help with what the server stated', () => {
    for (const [status, code] of [
      [400, 'update_required'],
      [401, 'unauthenticated'],
      [402, 'entitlement_read_only'],
      [403, 'csrf_failed'],
      [404, 'not_found'],
      [409, 'version_conflict'],
      [422, 'validation_failed'],
      // Until its Retry-After has passed: asked again at once, it is refused and counted again.
      [429, 'rate_limited'],
    ] as const) {
      expect(isRetryable(thrown(status, code)), code).toBe(false)
    }
  })
})

describe('a refusal for now', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** What a screen says of an error, and the formatters it says it through, in `zone`. */
  const saying = (zone: string) =>
    renderHook(() => ({ say: useProblemText(zone), format: useFormat() }), {
      wrapper: ({ children }: { readonly children: ReactNode }) =>
        createElement(I18nProvider, { locale: 'en', children }),
    }).result.current

  // Half past eleven at night in Prague, on the ninth of September.
  const now = new Date('2026-09-09T21:30:00Z')
  const prague = 'Europe/Prague'

  it('is said with the time it clears, where that is today in the zone it is said in', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const at = new Date('2026-09-09T21:50:00Z')
    const { say, format } = saying(prague)
    expect(say(thrown(429, 'rate_limited', at))).toBe(
      `Too many attempts. Try again at ${format.time(at, prague)}.`,
    )
  })

  // A limit counted by the day clears most of a day later: the fifth export of a day, a
  // household's deletion asked for a sixth time. *Try again at 14:32* would read as today's.
  it('is said with the day too, where the time is on another day there', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    // An hour on is past midnight in Prague, and still the ninth where the day is UTC's.
    const at = new Date('2026-09-09T22:30:00Z')
    const there = saying(prague)
    expect(there.format.dayOf(at, prague)).not.toBe(there.format.dayOf(now, prague))
    expect(there.say(thrown(429, 'rate_limited', at))).toBe(
      `Too many attempts. Try again at ${there.format.time(at, prague)} on ${there.format.dayOf(at, prague)}.`,
    )
    const utc = saying('UTC')
    expect(utc.say(thrown(429, 'rate_limited', at))).toBe(
      `Too many attempts. Try again at ${utc.format.time(at, 'UTC')}.`,
    )
    // And most of a day on, wherever it is said.
    const tomorrow = new Date('2026-09-10T19:00:00Z')
    expect(utc.say(thrown(429, 'rate_limited', tomorrow))).toBe(
      `Too many attempts. Try again at ${utc.format.time(tomorrow, 'UTC')} on ${utc.format.dayOf(tomorrow, 'UTC')}.`,
    )
  })

  it('names no time where the answer named none', () => {
    expect(saying(prague).say(thrown(429, 'rate_limited'))).toBe(
      'Too many attempts. Try again in a little while.',
    )
  })
})

describe('the query client', () => {
  it('asks again only for a stated problem that may yet clear, twice at most, and never resends a mutation', () => {
    const client = createQueryClient()
    const { retry } = client.getDefaultOptions().queries ?? {}
    if (typeof retry !== 'function') throw new Error('the queries’ retry is a function')
    expect(retry(0, thrown(500, 'internal'))).toBe(true)
    expect(retry(1, thrown(409, 'idempotency_in_progress'))).toBe(true)
    expect(retry(2, thrown(500, 'internal'))).toBe(false)
    expect(retry(0, thrown(404, 'not_found'))).toBe(false)
    // A request with no answer was resent by the transport already, and is not multiplied
    // here; and an error that is no answer at all, a bug, is not asked again either.
    expect(retry(0, new TypeError('network'))).toBe(false)
    expect(client.getDefaultOptions().mutations?.retry).toBe(false)
    expect(client.getDefaultOptions().queries?.gcTime).toBe(cacheMaxAge)
  })

  it('tells the app of every problem a query or a mutation met, and of nothing else', async () => {
    const onProblem = vi.fn<(problem: { readonly code?: string | undefined }) => void>()
    const client = createQueryClient({ onProblem })
    const failing = (error: Error) => () => Promise.reject(error)
    await client
      .query({
        queryKey: ['a'],
        queryFn: failing(thrown(400, 'update_required')),
        retry: false,
      })
      .catch(() => undefined)
    await client
      .query({ queryKey: ['b'], queryFn: failing(new TypeError('network')), retry: false })
      .catch(() => undefined)
    await client
      .getMutationCache()
      .build(client, { mutationFn: failing(thrown(403, 'csrf_failed')) })
      .execute(undefined)
      .catch(() => undefined)
    expect(onProblem.mock.calls.map(([met]) => met.code)).toEqual([
      'update_required',
      'csrf_failed',
    ])
  })
})

/** An IndexedDB object store, as far as idb-keyval asks one: a map, with requests that settle. */
function memoryStore(): { readonly kept: Map<IDBValidKey, unknown>; readonly store: UseStore } {
  const kept = new Map<IDBValidKey, unknown>()
  const settled = <T>(result: T) => {
    const request = {
      result,
      onsuccess: null as (() => void) | null,
      oncomplete: null as (() => void) | null,
    }
    queueMicrotask(() => {
      request.onsuccess?.()
      request.oncomplete?.()
    })
    return request
  }
  const objectStore = {
    get: (key: IDBValidKey) => settled(kept.get(key)),
    put: (value: unknown, key: IDBValidKey) => {
      kept.set(key, value)
      return settled(undefined)
    },
    delete: (key: IDBValidKey) => {
      kept.delete(key)
      return settled(undefined)
    },
    get transaction() {
      return settled(undefined)
    },
  }
  return {
    kept,
    store: (_mode, callback) => Promise.resolve(callback(objectStore as unknown as IDBObjectStore)),
  }
}

const persisted = (buster: string): PersistedClient => ({
  buster,
  timestamp: 0,
  clientState: { queries: [], mutations: [] },
})

describe('the cache kept in this browser', () => {
  it('is written once for a burst of changes, as its last state, and read back', async () => {
    vi.useFakeTimers()
    try {
      const { kept, store } = memoryStore()
      const persister = createPersister(store)
      await persister.persistClient(persisted('first'))
      await persister.persistClient(persisted('second'))
      expect(kept.size).toBe(0)
      await vi.advanceTimersByTimeAsync(1000)
      expect([...kept.values()]).toEqual([persisted('second')])
      expect(await persister.restoreClient()).toEqual(persisted('second'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('is written at once when asked, and removed with what was waiting', async () => {
    const { kept, store } = memoryStore()
    const persister = createPersister(store)
    await persister.persistClient(persisted('kept'))
    await persister.flush()
    expect(kept.size).toBe(1)
    await persister.persistClient(persisted('waiting'))
    await persister.removeClient()
    await persister.flush()
    expect(kept.size).toBe(0)
  })

  it('keeps nothing, and breaks nothing, in a browser that refuses storage', async () => {
    const refused: UseStore = () => Promise.reject(new DOMException('denied', 'SecurityError'))
    const persister = createPersister(refused)
    await persister.persistClient(persisted('lost'))
    await expect(persister.flush()).resolves.toBeUndefined()
    await expect(persister.restoreClient()).resolves.toBeUndefined()
    await expect(persister.removeClient()).resolves.toBeUndefined()
  })

  it('is for a day and for one build: a newer build drops what an older one kept', () => {
    const persister = createPersister(memoryStore().store)
    expect(persistOptions(persister, 'build-a')).toMatchObject({
      persister,
      maxAge: 24 * 60 * 60 * 1000,
      buster: 'build-a',
    })
    expect(persistOptions(persister, undefined).buster).toBe('')
  })

  it('holds every answer but a failed one, and one whose query says it is not to be kept', async () => {
    const client = createQueryClient()
    const answer = () => Promise.resolve('an answer')
    await client.query({ queryKey: ['readings'], queryFn: answer })
    // What nobody reads again, or what is of no use later: a search as it is typed, a link to
    // a file that is good for minutes.
    await client.query({ queryKey: ['search', 'ce'], queryFn: answer, meta: { persist: false } })
    await client
      .query({ queryKey: ['failed'], queryFn: () => Promise.reject(new Error('refused')) })
      .catch(() => undefined)
    const { dehydrateOptions } = persistOptions(createPersister(memoryStore().store), 'build-a')
    expect(dehydrate(client, dehydrateOptions).queries.map((query) => query.queryKey)).toEqual([
      ['readings'],
    ])
    // Kept out of what is stored, and not out of the cache the screen reads from.
    expect(client.getQueryData(['search', 'ce'])).toBe('an answer')
  })

  it('holds no write: one that waits for a connection is stored nowhere, with what it was to send', async () => {
    const client = createQueryClient()
    const sent = vi.fn((credentials: { readonly password: string }) => Promise.resolve(credentials))
    // As the app's provider mounts it: a client that hears the connection come and go.
    client.mount()
    onlineManager.setOnline(false)
    try {
      const signIn = new MutationObserver(client, { mutationFn: sent })
      void signIn.mutate({ password: 'correct horse battery staple' })
      await vi.waitFor(() => {
        expect(signIn.getCurrentResult().isPaused).toBe(true)
      })
      // TanStack's own rule would store it, variables and all, for a page that could not send it.
      expect(dehydrate(client).mutations).toHaveLength(1)
      const { dehydrateOptions } = persistOptions(createPersister(memoryStore().store), 'build-a')
      expect(dehydrate(client, dehydrateOptions).mutations).toEqual([])
      // It waits in the page, and is sent once there is a connection again.
      onlineManager.setOnline(true)
      await vi.waitFor(() => {
        expect(sent).toHaveBeenCalledTimes(1)
      })
    } finally {
      onlineManager.setOnline(true)
      client.unmount()
    }
  })
})

/**
 * The screens before sign-in, those of a member's own account and a household's own, its
 * billing, its storage, its data with the privacy centre, and its sync health among them, each
 * file as it is written.
 */
const screens = import.meta.glob<string>(
  [
    '../auth/*.{ts,tsx}',
    '../account/*.{ts,tsx}',
    '../household/**/*.{ts,tsx}',
    '../billing/*.{ts,tsx}',
    '../storage/*.{ts,tsx}',
    '../privacy/*.{ts,tsx}',
    '../health/*.{ts,tsx}',
    '!../**/*.test.{ts,tsx}',
  ],
  { query: '?raw', import: 'default', eager: true },
)

describe('a write that must not wait', () => {
  it('is sent at once, though the browser says it has no connection', async () => {
    const client = createQueryClient()
    const sent = vi.fn(() => Promise.resolve('an answer'))
    client.mount()
    onlineManager.setOnline(false)
    try {
      const write = new MutationObserver(client, { ...askedNow, mutationFn: sent })
      await write.mutate()
      expect(sent).toHaveBeenCalledTimes(1)
      expect(write.getCurrentResult().isPaused).toBe(false)
    } finally {
      onlineManager.setOnline(true)
      client.unmount()
    }
  })

  // A sign-in completed, a password set or an account deleted when a connection returns,
  // minutes after the press and with nobody at the screen, is not what was asked for (D-164).
  // Nor is a household made or left, a member removed, a level changed, an invitation sent or a
  // module turned off: household settings is changed on the server or not at all (D-170). Nor
  // a subscription begun, changed or handed over, an export asked for, changes stopped, a
  // household's deletion scheduled, a consent given, a copy asked to download itself again or a
  // diagnostic bundle sent: none of them is a part of a replica, and none waits on the device.
  it('is every write of the screens before sign-in, of a member’s own account and of a household’s own screens', () => {
    const writes = Object.entries(screens).flatMap(([path, source]) =>
      [...source.matchAll(/useMutation\(\{\s*(\S+)/g)].map(([, first = '']) => ({ path, first })),
    )
    // The sources were read at all: every directory that writes is among them.
    const directories = new Set(writes.map(({ path }) => path.split('/')[1]))
    expect([...directories].sort()).toEqual([
      'account',
      'auth',
      'billing',
      'health',
      'household',
      'privacy',
    ])
    expect(writes.length).toBeGreaterThan(60)
    expect(writes.filter(({ first }) => first !== '...askedNow,')).toEqual([])
    // And no mutation is written any other way than the one that is read here: each naming of
    // `useMutation` is its import or a write that was read.
    const sources = Object.values(screens)
    const named = sources.flatMap((source) => [...source.matchAll(/useMutation\b/g)])
    const imported = sources.filter((source) => /import \{[^}]*\buseMutation\b/.test(source))
    expect(named.length - imported.length).toBe(writes.length)
  })
})

describe('the account, read again after a write', () => {
  // Where the account is signed in and what it is notified of are filed under its key. Named by
  // the key's beginning they are named too, and one edit from being asked for where this browser
  // kept them and the page has no screen to ask with (ADR 0026).
  it('is named by its whole key on every screen that reads it again', () => {
    const readings = Object.entries(screens).flatMap(([path, source]) =>
      [...source.matchAll(/(?:invalidate|refetch)Queries\(\{ queryKey: meKey([^}]*)\}/g)].map(
        ([, rest = '']) => ({ path, rest: rest.trim() }),
      ),
    )
    // The sources were read at all: every screen that changes how an account signs in is here.
    expect(readings.length).toBeGreaterThanOrEqual(5)
    expect(readings.filter(({ rest }) => rest !== ', exact: true')).toEqual([])
  })
})
