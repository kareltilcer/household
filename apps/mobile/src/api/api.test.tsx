// The app's way to the API: what a refusal is carried as, what is asked again and what is not,
// what the device keeps of what was read, and what a request made for the replica says of the
// app. The web's `api.test.ts` is its twin; the transport has a test of its own.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs, createTranslator } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import {
  MutationObserver,
  onlineManager,
  QueryObserver,
  type QueryClient,
} from '@tanstack/react-query'
import { act, screen } from '@testing-library/react-native'
import { createFormatters } from '../i18n/format.ts'
import { ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { sourcesIn } from '../test/sources.ts'
import { Text } from '../ui/Text.tsx'
import { clientName, namedFetch, setting } from './client.ts'
import { createKeep, keepKey, writeEvery } from './keep.ts'
import { ApiProblemError, isRetryable, problemIn, retryAt, unwrap } from './problem.ts'
import { createProblemHub, type Problem } from './problems.ts'
import { useProblemText } from './problemText.ts'
import { askedNow, cacheMaxAge, createQueryClient, useOnline, watchConnection } from './query.ts'
import { answering, empty, json, problem, testApi, testClient, unanswered } from './testing.ts'

/** A client the test puts away: a read nobody observes is held by a timer for a day. */
const clients: QueryClient[] = []
function queryClient(options: Parameters<typeof createQueryClient>[0] = {}): QueryClient {
  const client = createQueryClient(options)
  clients.push(client)
  return client
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  onlineManager.setOnline(true)
  jest.useRealTimers()
})

describe('what a request answered', () => {
  it('is its data', async () => {
    const api = answering({ 'GET /me': () => json(200, { id: ids.member }) })
    expect(unwrap(await testClient(api.transport).GET('/me'))).toEqual({ id: ids.member })
  })

  it('is nothing, for an answer with no body', async () => {
    const api = answering({ 'POST /auth/logout': () => empty() })
    const answer = await testClient(api.transport).POST('/auth/logout')
    expect(() => {
      unwrap(answer)
    }).not.toThrow()
    expect(answer.data).toBeUndefined()
  })

  it('is thrown as the problem it stated, typed by its code', async () => {
    const api = answering({
      'GET /me': () => problem(400, 'update_required', { minimum_version: '1.6.0' }),
    })
    const answer = await testClient(api.transport).GET('/me')
    let thrown: unknown
    try {
      unwrap(answer)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ApiProblemError)
    expect(problemIn(thrown)).toMatchObject({ code: 'update_required', minimum_version: '1.6.0' })
    expect(thrown).toMatchObject({ status: 400, message: '400 update_required' })
  })

  it('carries when to ask again, where the answer said', async () => {
    const api = answering({
      'GET /me': () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }),
    })
    const before = Date.now()
    let thrown: unknown
    try {
      unwrap(await testClient(api.transport).GET('/me'))
    } catch (error) {
      thrown = error
    }
    const at = thrown instanceof ApiProblemError ? thrown.retryAt : undefined
    expect(at?.getTime()).toBeGreaterThanOrEqual(before + 30_000)
    expect(at?.getTime()).toBeLessThan(before + 40_000)
  })

  it('reads a time to ask again in seconds or as a date, and nothing else', () => {
    const at = (value: string | undefined) =>
      retryAt(
        new Response(null, value === undefined ? {} : { headers: { 'Retry-After': value } }),
        () => 1000,
      )
    expect(at('5')).toEqual(new Date(6000))
    expect(at('Wed, 21 Oct 2026 07:28:00 GMT')).toEqual(new Date('2026-10-21T07:28:00Z'))
    expect(at('soon')).toBeUndefined()
    expect(at(undefined)).toBeUndefined()
  })

  it('may be asked again only where asking again could help', () => {
    const stated = (status: number, code: Problem['code']) =>
      new ApiProblemError({ type: '', title: '', status, code } as Problem)
    expect(isRetryable(new TypeError('Network request failed'))).toBe(true)
    expect(isRetryable(stated(503, 'internal'))).toBe(true)
    expect(isRetryable(stated(409, 'idempotency_in_progress'))).toBe(true)
    expect(isRetryable(stated(429, 'rate_limited'))).toBe(false)
    expect(isRetryable(stated(404, 'not_found'))).toBe(false)
    expect(problemIn(new TypeError('Network request failed'))).toBeUndefined()
  })
})

describe('the problem hub', () => {
  it('tells every listener, until it stops listening', () => {
    const hub = createProblemHub()
    const heard = jest.fn()
    const stop = hub.subscribe(heard)
    const refusal = {
      type: '',
      title: '',
      status: 400,
      code: 'update_required',
      minimum_version: '2.0.0',
    } as const
    hub.report(refusal)
    stop()
    hub.report(refusal)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledWith(refusal)
  })
})

describe('the query client', () => {
  /** Reads through `client` and answers with how often the server was asked. */
  async function asked(answer: () => Promise<Response> | Response) {
    const api = answering({ 'GET /me': answer })
    const heard: Problem[] = []
    const client = queryClient({ onProblem: (each) => heard.push(each) })
    client.mount()
    const reading = new QueryObserver(client, {
      queryKey: ['me'],
      queryFn: async () => unwrap(await testClient(api.transport).GET('/me')),
      retryDelay: 0,
    })
    const stop = reading.subscribe(() => undefined)
    await client
      .getQueryCache()
      .find({ queryKey: ['me'] })
      ?.promise?.catch(() => undefined)
    for (let turn = 0; turn < 50 && reading.getCurrentResult().isFetching; turn += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5)
      })
    }
    const result = reading.getCurrentResult()
    stop()
    client.unmount()
    return { times: api.asked.length, heard, result }
  }

  it('asks again where the server failed, twice and no more, and tells the hub once', async () => {
    const { times, heard, result } = await asked(() => problem(503, 'internal'))
    expect(times).toBe(3)
    expect(result.isError).toBe(true)
    expect(heard.map((each) => each.code)).toEqual(['internal'])
  })

  it('does not ask again what the server refused', async () => {
    expect((await asked(() => problem(404, 'not_found'))).times).toBe(1)
  })

  // A retry before the time `Retry-After` names is refused and counted against the limit.
  it('does not ask again what the server refused for now', async () => {
    expect((await asked(() => problem(429, 'rate_limited'))).times).toBe(1)
  })

  // The transport has resent it already: asked again from here it would be nine requests.
  it('does not ask again a request that got no answer', async () => {
    const { times, heard } = await asked(unanswered)
    expect(times).toBe(1)
    expect(heard).toEqual([])
  })

  it('tells the hub of a problem a write met, and does not send the write again', async () => {
    const heard: Problem[] = []
    const client = queryClient({ onProblem: (each) => heard.push(each) })
    const sent = jest.fn(() =>
      Promise.reject(new ApiProblemError({ type: '', title: '', status: 503, code: 'internal' })),
    )
    const write = new MutationObserver(client, { ...askedNow, mutationFn: sent })
    await write.mutate().catch(() => undefined)
    expect(sent).toHaveBeenCalledTimes(1)
    expect(heard.map((each) => each.code)).toEqual(['internal'])
  })

  it('holds a read nobody observes for as long as the device keeps one', () => {
    expect(queryClient().getDefaultOptions().queries?.gcTime).toBe(cacheMaxAge)
    expect(cacheMaxAge).toBe(24 * 60 * 60 * 1000)
  })
})

describe('a write that must not wait', () => {
  // D-164: a sign-in completed or a device registered when a connection returns, minutes after
  // the press and with nobody at the screen, is not what was asked for.
  it('is sent at once, though the query client is told there is no connection', async () => {
    const client = queryClient()
    const sent = jest.fn(() => Promise.resolve('an answer'))
    client.mount()
    onlineManager.setOnline(false)
    const write = new MutationObserver(client, { ...askedNow, mutationFn: sent })
    await write.mutate()
    expect(sent).toHaveBeenCalledTimes(1)
    expect(write.getCurrentResult().isPaused).toBe(false)
    client.unmount()
  })

  it('would wait unseen, left to the query client', async () => {
    const client = queryClient()
    const sent = jest.fn(() => Promise.resolve('an answer'))
    client.mount()
    onlineManager.setOnline(false)
    const write = new MutationObserver(client, { mutationFn: sent })
    void write.mutate()
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
    expect(sent).not.toHaveBeenCalled()
    expect(write.getCurrentResult().isPaused).toBe(true)
    client.unmount()
  })
})

describe('what the device keeps of what was read', () => {
  const key = keepKey(ids.member)

  it('is named for its member, whichever case their id is written in', () => {
    expect(keepKey(ids.member.toUpperCase())).toBe(`household.queries.${ids.member}`)
    expect(keepKey(ids.member)).not.toBe(keepKey(ids.otherMember))
  })

  it('is written as the reads change, and read back by the next start', async () => {
    const client = queryClient()
    const keep = createKeep(ids.member)
    const stop = keep.watch(client)
    client.setQueryData(['households'], [{ id: ids.household }])
    await keep.flush()
    stop()
    const next = queryClient()
    await createKeep(ids.member).restore(next)
    expect(next.getQueryData(['households'])).toEqual([{ id: ids.household }])
  })

  it('is written at most once a second: a burst of changes is one write of the last state', async () => {
    jest.useFakeTimers()
    // The store's stand-in is a mock already: its calls are counted, and it is left as it is.
    const written = jest.mocked(AsyncStorage.setItem)
    written.mockClear()
    const client = queryClient()
    const keep = createKeep(ids.member)
    const stop = keep.watch(client)
    client.setQueryData(['me'], { id: 'one' })
    client.setQueryData(['me'], { id: 'two' })
    client.setQueryData(['me'], { id: 'three' })
    await jest.advanceTimersByTimeAsync(writeEvery - 1)
    expect(written).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(written).toHaveBeenCalledTimes(1)
    expect(written.mock.calls[0]?.[1]).toContain('three')
    // And nothing more until something is read again.
    await jest.advanceTimersByTimeAsync(writeEvery * 3)
    expect(written).toHaveBeenCalledTimes(1)
    stop()
  })

  it('holds what was read and no write, and nothing a read asked to be left out', async () => {
    const client = queryClient()
    client.mount()
    onlineManager.setOnline(false)
    const keep = createKeep(ids.member)
    const stop = keep.watch(client)
    // A write that waits for a connection, with everything it was to send.
    void new MutationObserver(client, { mutationFn: () => Promise.resolve() }).mutate({
      password: 'a password',
    } as never)
    client.setQueryData(['households'], [])
    const link = new QueryObserver(client, {
      queryKey: ['link'],
      queryFn: () => 'a link good for minutes',
      meta: { persist: false },
      networkMode: 'always',
    })
    const unsubscribe = link.subscribe(() => undefined)
    await link.refetch()
    await keep.flush()
    unsubscribe()
    stop()
    client.unmount()
    const stored = (await AsyncStorage.getItem(key)) ?? ''
    expect(stored).toContain('households')
    expect(stored).not.toContain('a password')
    expect(stored).not.toContain('a link good for minutes')
    expect(JSON.parse(stored)).toMatchObject({ build: clientName(), state: { mutations: [] } })
  })

  it('is removed with its member: the write that was waiting is dropped, and every one after it', async () => {
    jest.useFakeTimers()
    const client = queryClient()
    const keep = createKeep(ids.member)
    const stop = keep.watch(client)
    client.setQueryData(['me'], { id: 'one' })
    await keep.flush()
    expect(await AsyncStorage.getItem(key)).not.toBeNull()
    client.setQueryData(['me'], { id: 'two' })
    await keep.remove()
    // Emptying what is in memory stirs the watcher, as a sign-out does.
    client.clear()
    client.setQueryData(['me'], { id: 'three' })
    await jest.advanceTimersByTimeAsync(writeEvery * 2)
    expect(await AsyncStorage.getItem(key)).toBeNull()
    stop()
  })

  it('reads back nothing another build wrote, nothing older than a day, and nothing that is no cache', async () => {
    const client = queryClient()
    const kept = createKeep(ids.member, { build: 'mobile/0.0.9', now: () => 1000 })
    const stop = kept.watch(client)
    client.setQueryData(['households'], [{ id: ids.household }])
    await kept.flush()
    stop()

    const newer = queryClient()
    await createKeep(ids.member, { build: 'mobile/0.1.0', now: () => 2000 }).restore(newer)
    expect(newer.getQueryData(['households'])).toBeUndefined()

    const later = queryClient()
    await createKeep(ids.member, {
      build: 'mobile/0.0.9',
      now: () => 1000 + cacheMaxAge + 1,
    }).restore(later)
    expect(later.getQueryData(['households'])).toBeUndefined()

    const inTime = queryClient()
    await createKeep(ids.member, { build: 'mobile/0.0.9', now: () => 1000 + cacheMaxAge }).restore(
      inTime,
    )
    expect(inTime.getQueryData(['households'])).toEqual([{ id: ids.household }])

    await AsyncStorage.setItem(key, '{"not": "a cache"')
    const broken = queryClient()
    await expect(createKeep(ids.member).restore(broken)).resolves.toBeUndefined()
    expect(broken.getQueryCache().getAll()).toEqual([])
  })

  it('is one member’s: another reads back nothing of it', async () => {
    const client = queryClient()
    const keep = createKeep(ids.member)
    const stop = keep.watch(client)
    client.setQueryData(['me'], { id: ids.member })
    await keep.flush()
    stop()
    const other = queryClient()
    await createKeep(ids.otherMember).restore(other)
    expect(other.getQueryData(['me'])).toBeUndefined()
  })

  it('keeps nothing on a device that will not store, and the app goes on', async () => {
    const refuse = () => Promise.reject(new Error('the store is full'))
    // Once each: the stand-in is the same one for every test of this file.
    const set = jest.mocked(AsyncStorage.setItem).mockImplementationOnce(refuse)
    const get = jest.mocked(AsyncStorage.getItem).mockImplementationOnce(refuse)
    const remove = jest.mocked(AsyncStorage.removeItem).mockImplementationOnce(refuse)
    set.mockClear()
    get.mockClear()
    remove.mockClear()
    const client = queryClient()
    const keep = createKeep(ids.member)
    const stop = keep.watch(client)
    client.setQueryData(['me'], { id: ids.member })
    await expect(keep.flush()).resolves.toBeUndefined()
    await expect(keep.restore(client)).resolves.toBeUndefined()
    await expect(keep.remove()).resolves.toBeUndefined()
    stop()
    // Each was asked, and refused.
    expect([set, get, remove].map((each) => each.mock.calls.length)).toEqual([1, 1, 1])
  })
})

describe('a request the replica makes', () => {
  // The library sends the bearer it was given and nothing that names the app (D-178).
  it('names the app, keeps the bearer it was given, and leaves with no cookie', async () => {
    const api = answering({
      [`POST /households/${ids.household}/sync/digest`]: () => json(200, { matched: true }),
    })
    const fetch = namedFetch({ problems: createProblemHub(), fetch: api.transport })
    const answer = await fetch(`${testApi}/households/${ids.household}/sync/digest`, {
      method: 'POST',
      headers: { authorization: 'Bearer access-a', 'content-type': 'application/json' },
      body: JSON.stringify({ replica_id: 'a replica' }),
    })
    expect(await answer.json()).toEqual({ matched: true })
    const [asked] = api.asked
    expect(asked?.headers.get('Household-Client')).toBe(clientName())
    expect(asked?.headers.get('Authorization')).toBe('Bearer access-a')
    expect(asked?.body).toEqual({ replica_id: 'a replica' })
    expect(asked?.credentials).toBe('omit')
  })

  it('tells the app that the build is too old to be served, and hands the answer on unread', async () => {
    const api = answering({
      [`POST /households/${ids.household}/sync/credentials`]: () =>
        problem(400, 'update_required', { minimum_version: '1.6.0' }),
    })
    const hub = createProblemHub()
    const heard = jest.fn()
    hub.subscribe(heard)
    const fetch = namedFetch({ problems: hub, fetch: api.transport })
    const answer = await fetch(`${testApi}/households/${ids.household}/sync/credentials`, {
      method: 'POST',
    })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard.mock.calls[0]?.[0]).toMatchObject({
      code: 'update_required',
      minimum_version: '1.6.0',
    })
    // The library reads it as it reads any answer.
    expect(await answer.json()).toMatchObject({ code: 'update_required' })
  })

  it('tells the app of nothing else: a refusal of what the replica sent is the replica’s', async () => {
    const api = answering({
      [`POST /households/${ids.household}/sync/mutations`]: () => problem(400, 'not_applicable'),
      [`POST /households/${ids.household}/sync/digest`]: () => problem(401, 'unauthenticated'),
    })
    const hub = createProblemHub()
    const heard = jest.fn()
    hub.subscribe(heard)
    const fetch = namedFetch({ problems: hub, fetch: api.transport })
    await fetch(`${testApi}/households/${ids.household}/sync/mutations`, { method: 'POST' })
    await fetch(`${testApi}/households/${ids.household}/sync/digest`, { method: 'POST' })
    expect(heard).not.toHaveBeenCalled()
  })
})

describe('what the query client is told of the device’s connection', () => {
  const says = (isConnected: boolean | null) => ({ isConnected }) as NetInfoState

  // A second listener would be a second rule for believing the device, and a bar that says
  // there is no connection over a read that was sent.
  it('is heard by one file of the app, and read from the query client by every other', () => {
    const hearing = sourcesIn(['app', 'src'])
      .filter(({ source }) => source.includes("'@react-native-community/netinfo'"))
      .map(({ path }) => path)
    expect(hearing).toEqual(['src/api/query.ts'])
  })

  it('is what the device says, believed only where it says it has none', () => {
    const stop = jest.fn()
    jest.mocked(NetInfo.addEventListener).mockReturnValueOnce(stop)
    const stopWatching = watchConnection()
    const tell = jest.mocked(NetInfo.addEventListener).mock.calls.at(-1)?.[0]
    tell?.(says(false))
    expect(onlineManager.isOnline()).toBe(false)
    tell?.(says(true))
    expect(onlineManager.isOnline()).toBe(true)
    tell?.(says(false))
    // A device that does not know is taken to have one: a request that fails says so itself.
    tell?.(says(null))
    expect(onlineManager.isOnline()).toBe(true)
    tell?.(says(false))
    // And it is wrong in one direction alone: connected, with no way to the internet, is
    // connected.
    tell?.({ isConnected: true, isInternetReachable: false } as NetInfoState)
    expect(onlineManager.isOnline()).toBe(true)
    tell?.(says(false))
    stopWatching()
    expect(stop).toHaveBeenCalledTimes(1)
    // Told nothing from then on, it takes it that there is a connection.
    expect(onlineManager.isOnline()).toBe(true)
  })

  // The offline bar and a read that waits for a connection are told by one word.
  it('is what a screen reads as the device’s word, at each change', async () => {
    let tell: (state: NetInfoState) => void = () => undefined
    jest.mocked(NetInfo.addEventListener).mockImplementationOnce((listener) => {
      tell = listener
      return () => undefined
    })
    function Online() {
      return <Text testID="online">{String(useOnline())}</Text>
    }
    const stopWatching = watchConnection()
    await render(<Online />)
    // Taken to have one until the device says otherwise: nothing is drawn for a state nobody
    // reported.
    expect(screen.getByTestId('online')).toHaveTextContent('true', { exact: true })
    await act(() => {
      tell(says(false))
    })
    expect(screen.getByTestId('online')).toHaveTextContent('false', { exact: true })
    await act(() => {
      tell(says(null))
    })
    expect(screen.getByTestId('online')).toHaveTextContent('true', { exact: true })
    stopWatching()
  })

  // What `askedNow` is for, with the device's own word for it.
  it('holds back a read asked with none, and sends it when one returns', async () => {
    let tell: (state: NetInfoState) => void = () => undefined
    jest.mocked(NetInfo.addEventListener).mockImplementationOnce((listener) => {
      tell = listener
      return () => undefined
    })
    const stopWatching = watchConnection()
    tell(says(false))
    const client = queryClient()
    client.mount()
    const asked = jest.fn(() => Promise.resolve('an answer'))
    const reading = new QueryObserver(client, { queryKey: ['read'], queryFn: asked })
    const stop = reading.subscribe(() => undefined)
    expect(asked).not.toHaveBeenCalled()
    expect(reading.getCurrentResult()).toMatchObject({ fetchStatus: 'paused', data: undefined })
    tell(says(true))
    await client.getQueryCache().find({ queryKey: ['read'] })?.promise
    expect(asked).toHaveBeenCalledTimes(1)
    stop()
    client.unmount()
    stopWatching()
  })
})

describe('a setting of the build', () => {
  it('is a word it was given, by its name or inside a group, and nothing else', () => {
    const extra = { variant: 'staging', eas: { projectId: 'a project' }, apiUrl: '', count: 3 }
    expect(setting(extra, 'variant')).toBe('staging')
    expect(setting(extra, 'eas', 'projectId')).toBe('a project')
    expect(setting(extra, 'apiUrl')).toBeUndefined()
    expect(setting(extra, 'count')).toBeUndefined()
    expect(setting(extra, 'eas', 'owner')).toBeUndefined()
    expect(setting(undefined, 'variant')).toBeUndefined()
    expect(setting('a word', 'length')).toBeUndefined()
  })
})

describe('what a failure is said to be, where its screen has no sentence of its own', () => {
  const zone = 'Europe/Prague'
  const t = createTranslator('en')
  const format = createFormatters('en')

  function Said({ error }: { readonly error: unknown }) {
    const say = useProblemText(zone)
    return <Text testID="said">{say(error)}</Text>
  }

  async function said(error: unknown): Promise<string> {
    const view = await render(<Said error={error} />)
    const text = screen.getByTestId('said').props.children as string
    await view.unmount()
    return text
  }

  const limited = (at?: Date) =>
    new ApiProblemError({ type: '', title: '', status: 429, code: 'rate_limited' }, at)

  it('is that the server could not be reached, for a request that got no answer', async () => {
    expect(await said(new TypeError('Network request failed'))).toBe(
      catalogs.en['ui.problem.unreachable'],
    )
  })

  it('is the server’s own failure, for anything else it stated', async () => {
    expect(
      await said(new ApiProblemError({ type: '', title: '', status: 500, code: 'internal' })),
    ).toBe(catalogs.en['ui.problem.server'])
  })

  it('is a wait, with its time where the answer gave one, and its day where that is not today', async () => {
    expect(await said(limited())).toBe(catalogs.en['ui.problem.rate_limited'])
    const soon = new Date(Date.now() + 60_000)
    const today = format.dayOf(new Date(), zone)
    // A minute from now is today, but for the last minute of a day.
    if (format.dayOf(soon, zone) === today) {
      expect(await said(limited(soon))).toBe(
        t('ui.problem.rate_limited_until', { time: format.time(soon, zone) }),
      )
    }
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    expect(await said(limited(later))).toBe(
      t('ui.problem.rate_limited_until_day', {
        time: format.time(later, zone),
        day: format.dayOf(later, zone),
      }),
    )
  })
})
