// How a request leaves a device: signed with the device's sign-in, renewed where the server says
// the token has lapsed, with no cookie, and through whichever `fetch` the build installed.
//
// The second half runs the client over both of a device's `fetch`es as they are written, React
// Native's (whatwg-fetch over XMLHttpRequest) and Expo's (`expo/fetch`, which Expo's runtime
// installs in its place), with React Native's own `Request`, `Response` and `Headers` as the
// globals, as on a device, and only the native half of each stood in for. It fails where the
// client asks of a `fetch` what that one does not do: read a `Request`, its body, its signal,
// and a `clone()` of either the request or the answer.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { clientName } from './client.ts'
import { ApiProblemError } from './problem.ts'
import { answering, empty, json, problem, testApi, testClient, unanswered } from './testing.ts'
import { bearing, platform, type Bearer, type Transport } from './transport.ts'

function bearer(token: string | undefined, renewed?: string): jest.Mocked<Bearer> {
  return {
    current: jest.fn<Bearer['current']>().mockResolvedValue(token),
    renew: jest.fn<Bearer['renew']>().mockResolvedValue(renewed),
  }
}

describe('a request', () => {
  it('names the app, and leaves with no cookie', async () => {
    const api = answering({ 'GET /me': () => json(200, {}) })
    await testClient(api.transport).GET('/me')
    const [asked] = api.asked
    expect(asked?.headers.get('Household-Client')).toBe(clientName())
    expect(asked?.credentials).toBe('omit')
    // A device names no origin: the server checks none of a request that carries no cookie.
    expect(asked?.headers.get('Origin')).toBeNull()
    expect(asked?.headers.get('Authorization')).toBeNull()
  })

  it('is signed with the device’s sign-in', async () => {
    const api = answering({ 'GET /me': () => json(200, {}) })
    await testClient(api.transport, { bearer: bearer('access-a') }).GET('/me')
    expect(api.asked[0]?.headers.get('Authorization')).toBe('Bearer access-a')
  })

  it('is sent unsigned where nobody is signed in', async () => {
    const api = answering({ 'POST /auth/login': () => problem(401, 'invalid_credentials') })
    const signIn = bearer(undefined)
    const answer = await testClient(api.transport, { bearer: signIn }).POST('/auth/login', {
      body: { email: 'eva@dum.test', password: 'a password', client_type: 'mobile' },
    })
    expect(answer.response.status).toBe(401)
    expect(api.asked[0]?.headers.get('Authorization')).toBeNull()
    expect(signIn.renew).not.toHaveBeenCalled()
  })
})

describe('a request the server refuses the token of', () => {
  it('is sent once more with the sign-in renewed: the same request, with the key it left with', async () => {
    let refused = false
    const api = answering({
      'POST /push/subscriptions': () => {
        if (refused) return json(201, { id: 'a device' })
        refused = true
        return problem(401, 'unauthenticated')
      },
    })
    const signIn = bearer('access-a', 'access-b')
    const body = { transport: 'expo', endpoint: 'ExponentPushToken[abc]' } as const
    const answer = await testClient(api.transport, { bearer: signIn }).POST('/push/subscriptions', {
      body,
    })
    expect(answer.response.status).toBe(201)
    expect(signIn.renew).toHaveBeenCalledTimes(1)
    expect(signIn.renew).toHaveBeenCalledWith('access-a')
    const [first, second] = api.asked
    expect(first?.headers.get('Authorization')).toBe('Bearer access-a')
    expect(second?.headers.get('Authorization')).toBe('Bearer access-b')
    expect(second?.body).toEqual(body)
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'))
    expect(first?.headers.get('Idempotency-Key')).not.toBeNull()
  })

  it('is answered with the refusal where it is refused again: asked twice, and no more', async () => {
    const api = answering({ 'GET /me': () => problem(401, 'unauthenticated') })
    const signIn = bearer('access-a', 'access-b')
    const answer = await testClient(api.transport, { bearer: signIn }).GET('/me')
    expect(answer.response.status).toBe(401)
    expect(api.asked).toHaveLength(2)
    expect(signIn.renew).toHaveBeenCalledTimes(1)
  })

  it('is answered with the refusal where the sign-in has ended, and sent no second time', async () => {
    const api = answering({ 'GET /me': () => problem(401, 'unauthenticated') })
    const signIn = bearer('access-a', undefined)
    const answer = await testClient(api.transport, { bearer: signIn }).GET('/me')
    expect(answer.response.status).toBe(401)
    expect(answer.error).toMatchObject({ code: 'unauthenticated' })
    expect(api.asked).toHaveLength(1)
  })

  it('is answered with the refusal where the renewal was answered with another problem', async () => {
    const api = answering({ 'GET /me': () => problem(401, 'unauthenticated') })
    const signIn = bearer('access-a')
    signIn.renew.mockRejectedValue(
      new ApiProblemError({ status: 429, code: 'rate_limited', type: '', title: '' }),
    )
    const answer = await testClient(api.transport, { bearer: signIn }).GET('/me')
    expect(answer.response.status).toBe(401)
    expect(api.asked).toHaveLength(1)
  })

  it('has no answer where the renewal got none: the server could not be reached', async () => {
    const api = answering({ 'GET /me': () => problem(401, 'unauthenticated') })
    const signIn = bearer('access-a')
    signIn.renew.mockRejectedValue(new TypeError('Network request failed'))
    await expect(testClient(api.transport, { bearer: signIn }).GET('/me')).rejects.toThrow(
      'Network request failed',
    )
  })

  // A sign-in that failed, a second step whose challenge is gone: a `401` that is about what
  // was sent and not about the token it was sent with.
  it('renews nothing where the refusal is not of the token', async () => {
    const api = answering({ 'POST /auth/login': () => problem(401, 'invalid_credentials') })
    const signIn = bearer('access-a', 'access-b')
    const answer = await testClient(api.transport, { bearer: signIn }).POST('/auth/login', {
      body: { email: 'eva@dum.test', password: 'a password', client_type: 'mobile' },
    })
    expect(answer.error).toMatchObject({ code: 'invalid_credentials' })
    expect(signIn.renew).not.toHaveBeenCalled()
    expect(api.asked).toHaveLength(1)
  })
})

describe('the transport by itself', () => {
  it('says to send no cookie, whatever the request was made with', async () => {
    const sent: Request[] = []
    const send = platform((request) => {
      sent.push(request)
      return Promise.resolve(empty())
    })
    await send(new Request(`${testApi}/me`, { credentials: 'include' }))
    expect(sent[0]?.credentials).toBe('omit')
  })

  it('reads the refusal from a copy: the answer is its caller’s to read', async () => {
    const base: Transport = () => Promise.resolve(problem(401, 'invalid_credentials'))
    const answer = await bearing(base, bearer('access-a'))(new Request(`${testApi}/me`))
    expect(await answer.json()).toMatchObject({ code: 'invalid_credentials' })
  })
})

// ---------------------------------------------------------------------------------------------
// The same client over each of a device's `fetch`es.

/** What a `fetch`'s native half was started with. */
interface Started {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string | null
  /** Whether the device's cookies went with it. */
  readonly cookies: boolean
  aborted: boolean
}

/**
 * What the native half answers with: an answer, `null` for a request that gets none, and
 * `'waiting'` for one that is still on its way when its caller gives it up.
 */
type Native = (started: Started) => { status: number; body: string } | null | 'waiting'

/** The fetch API as a module of it exports it. */
interface FetchApi {
  readonly fetch: (request: Request) => Promise<Response>
  readonly Request: typeof Request
  readonly Response: typeof Response
  readonly Headers: typeof Headers
}

/** What the native half of `expo/fetch` is told and answers by, as a test sets it. */
const mockExpo: { native: Native; started: Started[] } = { native: () => null, started: [] }

// The native half of `expo/fetch`: a request, and the response it fills.
jest.mock('expo/src/winter/fetch/ExpoFetchModule', () => {
  class NativeResponse {
    // What the native side holds, which the class Expo builds on this one reads through the
    // accessors below, as it reads the real one's.
    answered: { status: number; url: string } = { status: 0, url: '' }
    content = ''
    get _rawHeaders(): [string, string][] {
      return [['content-type', 'application/json']]
    }
    get status() {
      return this.answered.status
    }
    get statusText() {
      return ''
    }
    get url() {
      return this.answered.url
    }
    get redirected() {
      return false
    }
    get bodyUsed() {
      return false
    }
    addListener() {
      return { remove: () => undefined }
    }
    removeListener() {
      return undefined
    }
    removeAllListeners() {
      return undefined
    }
    startStreaming() {
      return Promise.resolve(new TextEncoder().encode(this.content))
    }
    cancelStreaming() {
      return undefined
    }
    text() {
      return Promise.resolve(this.content)
    }
    arrayBuffer() {
      return Promise.resolve(new TextEncoder().encode(this.content).buffer)
    }
  }
  class NativeRequest {
    private readonly response: NativeResponse
    private sent: { aborted: boolean } | undefined
    private fail: (error: Error) => void = () => undefined
    constructor(response: NativeResponse) {
      this.response = response
    }
    start(
      url: string,
      init: { method?: string; headers?: [string, string][]; credentials?: string },
      body: Uint8Array | null,
    ) {
      const sent = {
        method: init.method ?? 'GET',
        url,
        headers: Object.fromEntries(
          (init.headers ?? []).map(([name, value]) => [name.toLowerCase(), value]),
        ),
        body: body === null ? null : new TextDecoder().decode(body),
        cookies: init.credentials !== 'omit',
        aborted: false,
      }
      this.sent = sent
      mockExpo.started.push(sent)
      return new Promise<void>((resolve, reject) => {
        this.fail = reject
        const answer = mockExpo.native(sent)
        if (answer === 'waiting') return
        if (answer === null) {
          reject(new Error('The network connection was lost.'))
          return
        }
        this.response.answered = { status: answer.status, url }
        this.response.content = answer.body
        resolve()
      })
    }
    cancel() {
      if (this.sent !== undefined) this.sent.aborted = true
      this.fail(new Error('cancelled'))
    }
  }
  return { ExpoFetchModule: { NativeRequest, NativeResponse } }
})

/** XMLHttpRequest as whatwg-fetch drives it: opened, given its headers, sent, answered. */
function xhrOver(native: Native, started: Started[]) {
  return class Xhr {
    onload: () => void = () => undefined
    onerror: () => void = () => undefined
    onabort: () => void = () => undefined
    ontimeout: () => void = () => undefined
    onreadystatechange: () => void = () => undefined
    // React Native's own default: a request that says nothing is sent with the cookies.
    withCredentials = true
    readyState = 0
    status = 0
    statusText = ''
    responseURL = ''
    responseText = ''
    private method = ''
    private url = ''
    private readonly headers: Record<string, string> = {}
    private sent: Started | undefined
    open(method: string, url: string) {
      this.method = method
      this.url = url
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
    }
    getAllResponseHeaders() {
      return 'content-type: application/json\r\n'
    }
    send(body: string | null) {
      const sent: Started = {
        method: this.method,
        url: this.url,
        headers: this.headers,
        body,
        cookies: this.withCredentials,
        aborted: false,
      }
      this.sent = sent
      started.push(sent)
      const answer = native(sent)
      if (answer === 'waiting') return
      this.readyState = 4
      this.onreadystatechange()
      if (answer === null) {
        this.onerror()
        return
      }
      this.status = answer.status
      this.responseURL = this.url
      this.responseText = answer.body
      this.onload()
    }
    abort() {
      if (this.sent !== undefined) this.sent.aborted = true
      this.readyState = 4
      this.onreadystatechange()
      this.onabort()
    }
  }
}

/**
 * React Native's own fetch API, loaded as a device loads it: its module asks whatwg-fetch,
 * which installs itself where there is no `fetch` yet, and hands on what it finds installed.
 * The globals are put back as they were: a test installs what it needs of this itself.
 */
function reactNative(): FetchApi {
  const own = {
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
  }
  Object.assign(globalThis, { fetch: undefined })
  let loaded: FetchApi | undefined
  jest.isolateModules(() => {
    loaded = jest.requireActual<FetchApi>('react-native/Libraries/Network/fetch')
  })
  Object.assign(globalThis, own)
  if (loaded === undefined) throw new Error('React Native’s fetch was not loaded')
  return loaded
}

const native = reactNative()

interface Platform {
  readonly name: string
  /** The platform's `fetch`, over a native half that answers by `answer`. */
  readonly install: (answer: Native, started: Started[]) => FetchApi['fetch']
}

const platforms: Platform[] = [
  {
    name: 'React Native’s (whatwg-fetch over XMLHttpRequest)',
    install: (answer, started) => {
      Object.assign(globalThis, { XMLHttpRequest: xhrOver(answer, started) })
      return native.fetch
    },
  },
  {
    name: 'Expo’s (expo/fetch)',
    install: (answer, started) => {
      mockExpo.native = answer
      mockExpo.started = started
      return jest.requireActual<Pick<FetchApi, 'fetch'>>('expo/fetch').fetch
    },
  },
]

function refusal(code: string) {
  return {
    status: 401,
    body: JSON.stringify({ type: 'about:blank', title: code, status: 401, code }),
  }
}

describe.each(platforms)('over a device’s own fetch, $name', ({ install }) => {
  const own = {
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
  }

  beforeEach(() => {
    // The classes a device has: React Native installs whatwg-fetch's, whichever `fetch` sends.
    Object.assign(globalThis, {
      Request: native.Request,
      Response: native.Response,
      Headers: native.Headers,
    })
  })

  afterEach(() => {
    Object.assign(globalThis, own, { XMLHttpRequest: undefined })
  })

  /** The client over the platform's `fetch`, its native half answering by `answer`. */
  function over(answer: (started: Started[]) => ReturnType<Native>, signIn?: Bearer) {
    const started: Started[] = []
    const fetch = install(() => answer(started), started)
    const client = testClient(fetch, {
      ...(signIn === undefined ? {} : { bearer: signIn }),
      retry: { delays: [0], sleep: () => Promise.resolve() },
    })
    return { client, started }
  }

  const registration = { transport: 'expo', endpoint: 'ExponentPushToken[abc]' } as const
  const registered = { status: 201, body: JSON.stringify({ id: 'a device' }) }

  it('are React Native’s own classes that the client builds a request of', () => {
    // Not Node's, which Jest runs on: what follows is said of the classes a device has.
    expect(globalThis.Request).toBe(native.Request)
    expect(new Request(`${testApi}/me`)).toHaveProperty('_bodyInit')
  })

  it('sends a request whole: where to, how, signed, named, its body, and no cookie', async () => {
    const { client, started } = over(() => registered, bearer('access-a'))
    const answer = await client.POST('/push/subscriptions', { body: registration })
    expect(answer.response.status).toBe(201)
    expect(answer.data).toEqual({ id: 'a device' })
    expect(started).toHaveLength(1)
    const [sent] = started
    expect(sent?.method).toBe('POST')
    expect(sent?.url).toBe(`${testApi}/push/subscriptions`)
    expect(sent?.body).toBe(JSON.stringify(registration))
    expect(sent?.cookies).toBe(false)
    expect(sent?.headers).toMatchObject({
      authorization: 'Bearer access-a',
      'household-client': clientName(),
      'content-type': 'application/json',
    })
    expect(sent?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(sent?.headers.origin).toBeUndefined()
  })

  it('reads a refusal from a copy of the answer, renews, and sends the request again whole', async () => {
    const { client, started } = over(
      (sent) => (sent.length === 1 ? refusal('unauthenticated') : registered),
      bearer('access-a', 'access-b'),
    )
    const answer = await client.POST('/push/subscriptions', { body: registration })
    expect(answer.data).toEqual({ id: 'a device' })
    expect(started.map((sent) => sent.headers.authorization)).toEqual([
      'Bearer access-a',
      'Bearer access-b',
    ])
    expect(started[1]?.body).toBe(JSON.stringify(registration))
    expect(started[1]?.headers['idempotency-key']).toBe(started[0]?.headers['idempotency-key'])
  })

  it('hands a refusal that is not of the token on to its caller, still to be read', async () => {
    const { client, started } = over(() => refusal('invalid_credentials'), bearer('access-a'))
    const answer = await client.GET('/me')
    expect(answer.error).toMatchObject({ code: 'invalid_credentials' })
    expect(started).toHaveLength(1)
  })

  // @household/api resends a request whose answer was lost from a copy of it, key and all.
  it('resends a request whose answer was lost, from a copy, with the key it left with', async () => {
    const { client, started } = over((sent) => (sent.length === 1 ? null : registered))
    const answer = await client.POST('/push/subscriptions', { body: registration })
    expect(answer.response.status).toBe(201)
    expect(started).toHaveLength(2)
    expect(started[1]?.body).toBe(JSON.stringify(registration))
    expect(started[1]?.headers['idempotency-key']).toBe(started[0]?.headers['idempotency-key'])
  })

  it('says a request got no answer where it got none, having sent it again', async () => {
    const { client, started } = over(() => null)
    await expect(client.GET('/me')).rejects.toBeDefined()
    expect(started).toHaveLength(2)
  })

  it('stops a request its caller gave up, and resends nothing of it', async () => {
    const { client, started } = over(() => 'waiting')
    const gaveUp = new AbortController()
    const asking = client.GET('/me', { signal: gaveUp.signal })
    const settled = asking.then(
      () => 'answered',
      () => 'given up',
    )
    // Once it has left: the transport is asked some turns after the client is.
    while (started.length === 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    }
    gaveUp.abort()
    expect(await settled).toBe('given up')
    expect(started).toHaveLength(1)
    expect(started[0]?.aborted).toBe(true)
  })
})

describe('what a test answers with', () => {
  it('is a request that got no answer, as a platform’s fetch rejects one', async () => {
    const api = answering({ 'GET /me': unanswered })
    await expect(testClient(api.transport).GET('/me')).rejects.toThrow('Network request failed')
  })
})
