// @household/api as the web app uses it (plan item 24). A browser's session is its
// `__Host-hh_session` cookie, which the browser sends to its own origin and no script can read, so
// the client holds no credential: it asks the API same-origin, names itself, and proves an unsafe
// request is the app's own by sending back the readable `__Host-hh_csrf` cookie's value in
// `X-CSRF-Token` (ADR 0009). An error is the contract's problem document, typed by its code and
// thrown as an ApiProblemError, which the query client and a screen switch on (problem.ts).
import { createApiClient, type ApiClient, type ApiClientOptions } from '@household/api'
import { version } from '../../package.json'

/** Where the API is served: this origin's own `/api/v1`, in production and behind the dev proxy. */
export const apiPath = '/api/v1'

/** The cookie the server sets beside the session's, readable so that a script can send it back. */
export const csrfCookie = '__Host-hh_csrf'

/** The app as `Household-Client` names it, which the server holds to its minimum version (ADR 0010). */
export const clientName = `web/${version}`

/** The value of the cookie `name` in a `document.cookie` string, or undefined when it has none. */
export function cookieValue(cookies: string, name: string): string | undefined {
  for (const pair of cookies.split(';')) {
    const separator = pair.indexOf('=')
    if (separator >= 0 && pair.slice(0, separator).trim() === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim())
    }
  }
  return undefined
}

/** What a client takes through `use`: openapi-fetch's own, which this package does not import. */
type Middleware = Parameters<ApiClient['use']>[number]

/** Methods that change state, which the server checks the token on (RFC 9110 §9.2.1). */
const unsafe = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Sends the CSRF cookie's value with every unsafe request. Read as each request leaves, since a
 * sign-in in another tab replaces it. A request made with no cookie carries no header, and the
 * server answers a signed-in one `403 csrf_failed`.
 */
export function csrfMiddleware(cookies: () => string): Middleware {
  return {
    onRequest({ request }) {
      if (!unsafe.has(request.method)) return undefined
      const token = cookieValue(cookies(), csrfCookie)
      if (token === undefined || token === '') return undefined
      const headers = new Headers(request.headers)
      headers.set('X-CSRF-Token', token)
      return new Request(request, { headers })
    },
  }
}

export interface WebClientOptions extends Pick<ApiClientOptions, 'fetch' | 'retry'> {
  /** The origin the API is on. Defaults to the page's own. */
  readonly origin?: string
  /** Reads the page's cookies. Defaults to `document.cookie`. */
  readonly cookies?: () => string
}

/** The client every screen of the web app asks the API through. */
export function createWebClient(options: WebClientOptions = {}): ApiClient {
  const base = options.fetch ?? ((request: Request) => globalThis.fetch(request))
  const client = createApiClient({
    baseUrl: new URL(apiPath, options.origin ?? window.location.origin).href,
    // Same-origin, said outright: the session cookie goes to the app's own origin and nowhere
    // else, whatever a caller's Request was made with.
    fetch: (request) => base(new Request(request, { credentials: 'same-origin' })),
    headers: { 'Household-Client': clientName },
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  })
  client.use(csrfMiddleware(options.cookies ?? (() => document.cookie)))
  return client
}
