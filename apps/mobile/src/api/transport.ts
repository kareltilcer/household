// How a request leaves a device, under @household/api (ADR 0010). A device's sign-in is a token
// pair and nothing else: every request carries the access token, which lasts fifteen minutes,
// and none carries a cookie or an origin, so the server checks no CSRF token of it.
//
// The `fetch` it is sent by is the platform's own, whichever the build installed. On a device
// that is Expo's (`expo/fetch`, which Expo's runtime puts in React Native's place) around React
// Native's `Request`, `Response` and `Headers` (whatwg-fetch): both it and React Native's read a
// `Request` whole, its body included, and what @household/api asks of one, `clone()` and
// `signal`, is the class's own whichever sends it. Both send the device's cookies unless they
// are told not to, so every request says so. transport.test.ts runs this file over each of
// them, with only their native half stood in for.
import { readProblem } from '@household/api'
import { ApiProblemError } from './problem.ts'

/** What @household/api sends a request by: its `fetch` option. */
export type Transport = (request: Request) => Promise<Response>

/**
 * The platform's `fetch` as the API is asked through it: with no cookie sent and none kept. A
 * request made with nothing said is `same-origin`, which a device has no meaning for and both
 * of its `fetch`es read as "send them".
 */
export function platform(fetch: Transport = (request) => globalThis.fetch(request)): Transport {
  return (request) => fetch(new Request(request, { credentials: 'omit' }))
}

/** The device's sign-in, as a request is signed with it (session/tokens.ts). */
export interface Bearer {
  /**
   * The access token to send: renewed first where it is about to lapse, and undefined where
   * nobody is signed in.
   */
  readonly current: () => Promise<string | undefined>
  /**
   * Renews the sign-in for a request the server refused `used` on, and answers with the token to
   * send it again with: the one already renewed meanwhile, where another request asked first.
   * Undefined where the sign-in has ended. It rejects where the server could not be asked, or
   * answered with anything else.
   */
  readonly renew: (used: string) => Promise<string | undefined>
}

function signed(request: Request, token: string): Request {
  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return new Request(request, { headers })
}

/**
 * Whether `response`, a `401`, refuses the token it was sent with. An expired access token and
 * one whose sign-in was revoked are answered alike, `unauthenticated` (openapi.yaml,
 * Authentication); a sign-in that failed or a second step whose challenge is gone is its
 * screen's to answer, and renews nothing. Read from a copy: the answer is its caller's.
 */
async function refusesToken(response: Response): Promise<boolean> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)
  return readProblem(response.status, body).code === 'unauthenticated'
}

/**
 * `base`, with every request signed by `bearer`. A request the server refuses the token of is
 * sent once more, with the sign-in renewed: the token lapsed on the way, or the device's clock
 * is not the server's. Refused again, or with a sign-in that could not be renewed, the refusal
 * is the caller's answer. Only a renewal the server refuses ends a sign-in, and that is the
 * token store's to say (session/tokens.ts): this file ends nothing.
 */
export function bearing(base: Transport, bearer: Bearer): Transport {
  return async (request) => {
    const token = await bearer.current()
    if (token === undefined) return base(request)
    // A body is read once, and a request refused for its token is sent a second time.
    const again = request.clone()
    const first = await base(signed(request, token))
    if (first.status !== 401 || !(await refusesToken(first))) return first
    let renewed: string | undefined
    try {
      renewed = await bearer.renew(token)
    } catch (error) {
      // The renewal was answered, with something that is no pair and no end: the request's own
      // refusal stands. One that got no answer leaves the request with none either, which
      // @household/api resends as it resends any other.
      if (error instanceof ApiProblemError) return first
      throw error
    }
    return renewed === undefined ? first : base(signed(again, renewed))
  }
}
