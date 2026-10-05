import { describe, expect, it } from 'vitest'
import { createApiClient } from './client.ts'
import { entityTag, isUnsafeMethod, retryingFetch, versionOf } from './concurrency.ts'
import { isUuid } from './ids.ts'

const household = '0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a90'
const list = '0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a91'

interface Sent {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  readonly body: string
}

/** A transport that records what it was sent and answers with `answers`, in turn. */
function transport(...answers: (Response | Error)[]) {
  const sent: Sent[] = []
  const fetch = async (request: Request): Promise<Response> => {
    sent.push({
      method: request.method,
      url: request.url,
      headers: new Headers(request.headers),
      body: await request.text(),
    })
    const answer = answers.shift() ?? new Response(null, { status: 204 })
    if (answer instanceof Error) throw answer
    return answer
  }
  return { sent, fetch }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const noWait = { delays: [0, 0], sleep: () => Promise.resolve() }

describe('an unsafe request', () => {
  it('carries a new UUIDv7 Idempotency-Key when the caller set none', async () => {
    const { sent, fetch } = transport(json(201, {}))
    const api = createApiClient({ baseUrl: 'https://h.test/api/v1', fetch, retry: noWait })
    await api.POST('/households/{household_id}/shopping/lists', {
      params: { path: { household_id: household } },
      body: { id: list, name: 'Lidl' },
    })
    const key = sent[0]?.headers.get('Idempotency-Key')
    expect(isUuid(key)).toBe(true)
    expect(key?.[14]).toBe('7')
  })

  it("keeps the caller's key", async () => {
    const { sent, fetch } = transport(json(201, {}))
    const api = createApiClient({ baseUrl: 'https://h.test/api/v1', fetch, retry: noWait })
    await api.POST('/households/{household_id}/shopping/lists', {
      params: { path: { household_id: household }, header: { 'Idempotency-Key': 'first-try' } },
      body: { id: list, name: 'Lidl' },
    })
    expect(sent[0]?.headers.get('Idempotency-Key')).toBe('first-try')
  })

  it('is resent with the same key and body when its response is lost', async () => {
    const { sent, fetch } = transport(new TypeError('network'), json(201, { id: list }))
    const api = createApiClient({ baseUrl: 'https://h.test/api/v1', fetch, retry: noWait })
    const result = await api.POST('/households/{household_id}/shopping/lists', {
      params: { path: { household_id: household } },
      body: { id: list, name: 'Lidl' },
    })
    expect(result.response.status).toBe(201)
    expect(sent).toHaveLength(2)
    const [first, second] = sent
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'))
    expect(second?.body).toBe(first?.body)
    expect(JSON.parse(second?.body ?? '')).toEqual({ id: list, name: 'Lidl' })
  })

  it('fails once every retry has failed', async () => {
    const { sent, fetch } = transport(
      new TypeError('network'),
      new TypeError('network'),
      new TypeError('network'),
    )
    const api = createApiClient({ baseUrl: 'https://h.test/api/v1', fetch, retry: noWait })
    await expect(
      api.POST('/households/{household_id}/shopping/lists', {
        params: { path: { household_id: household } },
        body: { id: list, name: 'Lidl' },
      }),
    ).rejects.toThrow('network')
    expect(sent).toHaveLength(3)
  })

  it('is not resent after the caller aborts it', async () => {
    const abort = new AbortController()
    const { sent, fetch } = transport(new TypeError('network'), json(201, {}))
    const api = createApiClient({
      baseUrl: 'https://h.test/api/v1',
      fetch,
      retry: {
        delays: [0],
        sleep: () => {
          abort.abort()
          return Promise.resolve()
        },
      },
    })
    // The caller is told of its own abort, as fetch tells it, not of the lost response.
    await expect(
      api.POST('/households/{household_id}/shopping/lists', {
        params: { path: { household_id: household } },
        body: { id: list, name: 'Lidl' },
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(sent).toHaveLength(1)
  })

  it('stops waiting to be resent when the caller aborts', async () => {
    const abort = new AbortController()
    let attempts = 0
    const lost = () => {
      attempts++
      setTimeout(() => {
        abort.abort()
      }, 10)
      return Promise.reject(new TypeError('network'))
    }
    // The default wait, a minute long: the test times out unless the abort cuts it short.
    const request = new Request('https://h.test/a', { signal: abort.signal })
    await expect(retryingFetch(lost, { delays: [60_000] })(request)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(attempts).toBe(1)
  })

  it('is returned as it is when the server answers, whatever the status', async () => {
    const inProgress = {
      type: 'urn:household:problem:idempotency_in_progress',
      title: 'Conflict',
      status: 409,
      code: 'idempotency_in_progress',
    }
    const { sent, fetch } = transport(json(409, inProgress))
    const api = createApiClient({ baseUrl: 'https://h.test/api/v1', fetch, retry: noWait })
    const result = await api.POST('/households/{household_id}/shopping/lists', {
      params: { path: { household_id: household } },
      body: { id: list, name: 'Lidl' },
    })
    expect(result.response.status).toBe(409)
    expect(result.error).toEqual(inProgress)
    expect(sent).toHaveLength(1)
  })
})

describe('the transport', () => {
  it('resends a safe request, which needs no key', async () => {
    const { sent, fetch } = transport(new TypeError('network'), json(200, { items: [] }))
    const result = await retryingFetch(fetch, noWait)(new Request('https://h.test/a'))
    expect(result.status).toBe(200)
    expect(sent.map((s) => s.headers.get('Idempotency-Key'))).toEqual([null, null])
  })

  it('does not resend an unsafe request without a key', async () => {
    const { sent, fetch } = transport(new TypeError('network'), json(201, {}))
    const post = new Request('https://h.test/a', { method: 'POST', body: '{}' })
    await expect(retryingFetch(fetch, noWait)(post)).rejects.toThrow('network')
    expect(sent).toHaveLength(1)
  })
})

describe('a safe request', () => {
  it('is told from an unsafe one by its method, which a client’s own middleware asks too', () => {
    // One list: the web client sends its CSRF token with exactly the methods that carry a key.
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].every(isUnsafeMethod)).toBe(true)
    expect(['GET', 'HEAD', 'OPTIONS'].some(isUnsafeMethod)).toBe(false)
  })

  it('carries no Idempotency-Key', async () => {
    const { sent, fetch } = transport(json(200, { items: [] }))
    const api = createApiClient({ baseUrl: 'https://h.test/api/v1', fetch, retry: noWait })
    await api.GET('/households/{household_id}/shopping/lists', {
      params: { path: { household_id: household } },
    })
    expect(sent[0]?.headers.has('Idempotency-Key')).toBe(false)
  })
})

describe('If-Match', () => {
  async function patch(ifMatch: string) {
    const { sent, fetch } = transport(json(200, {}, { ETag: '"8"' }))
    const api = createApiClient({ baseUrl: 'https://h.test/api/v1', fetch, retry: noWait })
    const result = await api.PATCH('/households/{household_id}/shopping/lists/{list_id}', {
      params: { path: { household_id: household, list_id: list }, header: { 'If-Match': ifMatch } },
      body: { name: 'Albert' },
    })
    return { sent, result }
  }

  it('is sent as the entity-tag of the version the client read', async () => {
    const { sent, result } = await patch(entityTag(7))
    expect(sent[0]?.headers.get('If-Match')).toBe('"7"')
    expect(versionOf(result.response.headers.get('ETag'))).toBe(8)
  })

  it('quotes a bare version, which is no entity-tag', async () => {
    const { sent } = await patch('7')
    expect(sent[0]?.headers.get('If-Match')).toBe('"7"')
  })

  // A proxy that compresses a response may weaken its ETag, and If-Match compares strongly:
  // the server would answer a weak tag with 409 on every edit.
  it('makes a weak tag of a version strong', async () => {
    const { sent } = await patch('W/"7"')
    expect(sent[0]?.headers.get('If-Match')).toBe('"7"')
  })

  it.each(['seven', '""'])('refuses %s, which is neither', async (value) => {
    await expect(patch(value)).rejects.toThrow(TypeError)
  })
})

describe('an entity-tag', () => {
  it('names a version in decimal, quoted', () => {
    expect(entityTag(0)).toBe('"0"')
    expect(entityTag(42)).toBe('"42"')
    expect(() => entityTag(-1)).toThrow(RangeError)
    expect(() => entityTag(1.5)).toThrow(RangeError)
  })

  it('is read back, weak or strong', () => {
    expect(versionOf('"42"')).toBe(42)
    expect(versionOf('W/"42"')).toBe(42)
    expect(versionOf(null)).toBeUndefined()
    expect(versionOf('42')).toBeUndefined()
    expect(versionOf('"abc"')).toBeUndefined()
    expect(versionOf('"01"')).toBeUndefined()
  })
})
