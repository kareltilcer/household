import { Revoked } from '@household/sync'
import { describe, expect, it } from 'vitest'
import { clientName, createWebClient } from '../api/client.ts'
import { csrfCookie } from '../api/names.ts'
import { createProblemHub, type Problem } from '../api/problems.ts'
import { sessionCredential, sessionFetch } from './sessionFetch.ts'

const origin = 'https://household.example'
const push = `${origin}/api/v1/households/h1/sync/mutations`

function problem(status: number, code: string, more: Record<string, unknown> = {}): Response {
  return Response.json(
    { type: `https://household.example/problems/${code}`, title: code, status, code, ...more },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )
}

/** The session's `fetch` over a transport the test answers, and what the hub was told. */
function session(respond: (request: Request) => Response, cookies = `${csrfCookie}=the-token`) {
  const sent: Request[] = []
  const told: Problem[] = []
  const problems = createProblemHub()
  problems.subscribe((heard) => told.push(heard))
  const fetch = sessionFetch({
    cookies: () => cookies,
    problems,
    fetch: (request) => {
      sent.push(request)
      return Promise.resolve(respond(request))
    },
  })
  return { fetch, sent, told, problems }
}

describe('the replica’s way in for a web session', () => {
  // The library sends each request as a device does: with a bearer and the credential it holds.
  const asDevice = { method: 'POST', headers: { authorization: 'Bearer session' }, body: '{}' }

  it('leaves the bearer out: a request that carries one is authenticated by it alone', async () => {
    const at = session(() => Response.json({}))
    await at.fetch(push, asDevice)
    const [request] = at.sent
    expect(request?.headers.has('Authorization')).toBe(false)
    // And carries what the app's own client does: its name, the cookies, the token.
    expect(request?.headers.get('Household-Client')).toBe(clientName())
    expect(request?.credentials).toBe('same-origin')
    expect(request?.headers.get('X-CSRF-Token')).toBe('the-token')
    expect(await request?.text()).toBe('{}')
  })

  it('sends the token with an unsafe request, and with no safe one', async () => {
    const at = session(() => Response.json({}))
    await at.fetch(`${origin}/api/v1/households/h1/sync/state`, {
      headers: { authorization: 'Bearer session' },
    })
    expect(at.sent[0]?.headers.has('X-CSRF-Token')).toBe(false)
    expect(at.sent[0]?.headers.has('Authorization')).toBe(false)
  })

  it('sends no token from a browser that holds none, which the server then refuses', async () => {
    const at = session(() => problem(403, 'csrf_failed'), '')
    const response = await at.fetch(push, asDevice)
    expect(at.sent[0]?.headers.has('X-CSRF-Token')).toBe(false)
    expect(response.status).toBe(403)
  })

  it('tells the app of an answer that is about the session, and hands the answer on unread', async () => {
    const refused = session(() => problem(403, 'csrf_failed'))
    const response = await refused.fetch(push, asDevice)
    expect(refused.told.map((heard) => heard.code)).toEqual(['csrf_failed'])
    // The library reads the answer itself, whatever it is.
    expect(await response.json()).toMatchObject({ code: 'csrf_failed' })

    const old = session(() => problem(400, 'update_required', { minimum_version: '2.0.0' }))
    await old.fetch(push, asDevice)
    expect(old.told).toMatchObject([{ code: 'update_required', minimum_version: '2.0.0' }])
  })

  it('tells the app nothing of an answer that is about what the replica sent', async () => {
    for (const respond of [
      () => problem(403, 'forbidden'),
      () => problem(400, 'validation_failed', { errors: [] }),
      () => problem(402, 'entitlement_read_only', { state: 'read_only', remedy: 'subscribe' }),
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
      () => Response.json({ results: [] }),
    ]) {
      const at = session(respond)
      await at.fetch(push, asDevice)
      expect(at.told).toEqual([])
    }
  })
})

describe('a web session’s credential', () => {
  function credential(respond: () => Response) {
    const told: Problem[] = []
    const problems = createProblemHub()
    problems.subscribe((heard) => told.push(heard))
    const asked: string[] = []
    const api = createWebClient({
      origin,
      cookies: () => '',
      retry: { delays: [], sleep: () => Promise.resolve() },
      fetch: (request) => {
        asked.push(`${request.method} ${new URL(request.url).pathname}`)
        return Promise.resolve(respond())
      },
    })
    const ended = () => new Revoked('the web session has ended')
    return { credential: sessionCredential(api, problems, ended), told, asked }
  }

  it('has nothing to renew: asked to, it asks whether the session still stands', async () => {
    const stands = credential(() => Response.json({ id: 'u1' }))
    await expect(stands.credential.renew()).resolves.toBeUndefined()
    expect(stands.asked).toEqual(['GET /api/v1/me'])
    expect(stands.told).toEqual([])
  })

  it('says the sign-in has ended where the session has, and tells the app as any request would', async () => {
    const ended = credential(() => problem(401, 'unauthenticated'))
    await expect(ended.credential.renew()).rejects.toBeInstanceOf(Revoked)
    expect(ended.told.map((heard) => heard.code)).toEqual(['unauthenticated'])
  })

  it('takes no other answer for an ending: one refused request is no proof a session is gone', async () => {
    for (const respond of [
      () => problem(500, 'internal'),
      () => problem(429, 'rate_limited'),
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
    ]) {
      const unsure = credential(respond)
      await expect(unsure.credential.renew()).resolves.toBeUndefined()
      expect(unsure.told).toEqual([])
    }
  })

  it('sends nothing of itself: the session is the browser’s cookie', async () => {
    const { credential: held, asked } = credential(() => Response.json({}))
    // A fixed word, which the session's `fetch` takes out with the header it would ride in.
    expect(await held.current()).toBe('session')
    expect(asked).toEqual([])
  })
})
