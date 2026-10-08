// @household/api as the web app uses it (plan item 24). A browser's session is its
// `__Host-hh_session` cookie, which the browser sends to its own origin and no script can read, so
// the client holds no credential: it asks the API same-origin, names itself, and proves an unsafe
// request is the app's own by sending back the readable `__Host-hh_csrf` cookie's value in
// `X-CSRF-Token` (ADR 0009). An error is the contract's problem document, typed by its code and
// thrown as an ApiProblemError, which the query client and a screen switch on (problem.ts).
import {
  createApiClient,
  isUnsafeMethod,
  type ApiClient,
  type ApiClientOptions,
} from '@household/api'
import { version } from '../../package.json'
import { apiPath, csrfCookie } from './names.ts'
import { ownBuild } from '../update/build.ts'

export { apiPath, csrfCookie }

/**
 * The app as `Household-Client` names it, which the server holds to its minimum version
 * (ADR 0010): `web/` and this package's own version, with the build's id after it as SemVer's
 * build metadata, which the server reads past and a log tells one build from another by. The
 * version is raised by the pull request after which a deployment must refuse the builds before
 * it, and by no other: a deployment's web minimum is then a version every older build is under
 * (ADR 0026). A page no build made, the development server's, names the version alone.
 */
export function clientName(build: string | undefined = ownBuild()): string {
  return build === undefined ? `web/${version}` : `web/${version}+${build}`
}

/**
 * The value of the cookie `name` in a `document.cookie` string, or undefined when it has none: as
 * it is written there, and not decoded. The server sets the token as it is and holds the header
 * to the cookie it was sent beside, character for character.
 */
export function cookieValue(cookies: string, name: string): string | undefined {
  for (const pair of cookies.split(';')) {
    const separator = pair.indexOf('=')
    if (separator >= 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim()
    }
  }
  return undefined
}

/** What a client takes through `use`: openapi-fetch's own, which this package does not import. */
type Middleware = Parameters<ApiClient['use']>[number]

/**
 * Sends the CSRF cookie's value with every unsafe request, a method that changes state, which
 * the server checks the token on: the methods @household/api gives an `Idempotency-Key`, by its
 * own list of them. Read as each request leaves, since a sign-in in another tab replaces it. A
 * request made with no cookie carries no header, and the server answers a signed-in one
 * `403 csrf_failed`.
 */
export function csrfMiddleware(cookies: () => string): Middleware {
  return {
    onRequest({ request }) {
      if (!isUnsafeMethod(request.method)) return undefined
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
    headers: { 'Household-Client': clientName() },
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  })
  client.use(csrfMiddleware(options.cookies ?? (() => document.cookie)))
  return client
}
