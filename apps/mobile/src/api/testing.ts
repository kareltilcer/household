// The API as a test answers for it: a transport that hands each request to the answer the test
// wrote for its method and path, and keeps what was asked. A request the test wrote no answer
// for fails by name, where one sent to the network would fail by a timeout nobody can read.
import type { ApiClient, ProblemCode } from '@household/api'
import { QueryClient } from '@tanstack/react-query'
import { createMobileClient, type MobileClientOptions } from './client.ts'
import type { Transport } from './transport.ts'

/** Where a test's API is: nowhere. */
export const testApi = 'https://api.household.test/api/v1'

/** A request as it left the client. */
export interface Asked {
  readonly method: string
  /** Its path under the API's base, with its query. */
  readonly path: string
  readonly headers: Headers
  /** Its body, read as JSON, or undefined for none. */
  readonly body: unknown
  /** Whether it was sent with the device's cookies left out. */
  readonly credentials: string
}

type Answer = (asked: Asked) => Response | Promise<Response>

/** An answer in JSON. */
export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** An answer with no body: a `204`. */
export function empty(status = 204): Response {
  return new Response(null, { status })
}

/** A problem document, as the contract writes one. */
export function problem(
  status: number,
  code: ProblemCode,
  more: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `https://household.example/problems/${code}`,
      title: code,
      status,
      code,
      ...more,
    }),
    { status, headers: { 'Content-Type': 'application/problem+json', ...headers } },
  )
}

/** What a request that got no answer rejects with, as a platform's `fetch` does. */
export function unanswered(): Promise<Response> {
  return Promise.reject(new TypeError('Network request failed'))
}

export interface Answering {
  readonly transport: Transport
  /** Every request that left, in the order it did. */
  readonly asked: Asked[]
  /** The requests that left for `route`, `'GET /me'`. */
  readonly sent: (route: string) => Asked[]
}

/**
 * A transport that answers each request with what `routes` gives for its method and path
 * (`'POST /auth/token'`, the path without its query), and rejects one it has no answer for.
 */
export function answering(routes: Readonly<Record<string, Answer>>): Answering {
  const asked: Asked[] = []
  const routeOf = (each: Asked) => `${each.method} ${each.path.replace(/\?.*$/, '')}`
  return {
    asked,
    sent: (route) => asked.filter((each) => routeOf(each) === route),
    transport: async (request) => {
      const text = await request.clone().text()
      const each: Asked = {
        method: request.method,
        path: request.url.slice(testApi.length),
        headers: request.headers,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
        credentials: request.credentials,
      }
      asked.push(each)
      const answer = routes[routeOf(each)]
      if (answer === undefined)
        throw new Error(`a test asked ${routeOf(each)} and wrote no answer for it`)
      return answer(each)
    },
  }
}

/**
 * A query client for a test that writes: nothing is asked twice, and nothing it read or wrote
 * is held by a timer once the test has ended, a write's for five minutes, which would hold
 * whatever ran the test open for as long.
 */
export function testQueries(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  })
}

/** A client over `transport`, which resends nothing: a test says each answer itself. */
export function testClient(
  transport: Transport,
  options: Pick<MobileClientOptions, 'bearer' | 'retry'> = {},
): ApiClient {
  return createMobileClient({
    baseUrl: testApi,
    fetch: transport,
    retry: { delays: [] },
    ...options,
  })
}
