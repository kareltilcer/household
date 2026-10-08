// The session's way in for the replica (ADR 0019, ADR 0026). @household/sync sends each of its
// requests, the credentials, the push, its report, a file, with `Authorization: Bearer` and the
// credential it is given, which is a device's token. A web session is a cookie no script can read
// and a CSRF token one can, so the web app gives the replica this `fetch` in place of the
// platform's: it leaves the bearer out, since a request that carries one is authenticated by it
// alone and the cookie is not read (openapi.yaml, Authentication), and sends what the app's own
// client sends: the app's name, the browser's cookies, and the token with an unsafe request.
//
// A session has nothing to renew. What a `401` means for one is the credential's to say
// (`sessionCredential`): the session ended, and the replica is discarded (FR-ID7).
import { isUnsafeMethod, readProblem, type ApiClient } from '@household/api'
import type { Credential } from '@household/sync'
import { clientName, cookieValue, csrfCookie } from '../api/client.ts'
import type { ProblemHub } from '../api/problems.ts'

export interface SessionFetchOptions {
  /** Reads the page's cookies. Defaults to `document.cookie`. */
  readonly cookies?: () => string
  /** The transport. Defaults to the platform's. */
  readonly fetch?: (request: Request) => Promise<Response>
  /** Where a problem that is about the session, and not about what the replica sent, is told. */
  readonly problems: ProblemHub
}

/** The answers that are about the session whoever asked: the app answers them once, for all. */
const aboutTheSession = new Set<number>([400, 403])

/** A `fetch` for @household/sync that carries the web session in place of a bearer token. */
export function sessionFetch({
  cookies = () => document.cookie,
  fetch = (request) => globalThis.fetch(request),
  problems,
}: SessionFetchOptions): typeof globalThis.fetch {
  return async (input, init) => {
    const asked = new Request(input, init)
    const headers = new Headers(asked.headers)
    headers.delete('Authorization')
    headers.set('Household-Client', clientName())
    if (isUnsafeMethod(asked.method)) {
      const token = cookieValue(cookies(), csrfCookie)
      if (token !== undefined && token !== '') headers.set('X-CSRF-Token', token)
    }
    const response = await fetch(new Request(asked, { headers, credentials: 'same-origin' }))
    if (aboutTheSession.has(response.status)) {
      // Read from a copy: the answer is the library's to read, whatever it is.
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => undefined)
      const problem = readProblem(response.status, body)
      if (problem.code === 'csrf_failed' || problem.code === 'update_required') {
        problems.report(problem)
      }
    }
    return response
  }
}

/**
 * The credential a replica of a web session is given. Nothing of it is sent: `sessionFetch`
 * leaves the bearer out. Its renewal is what a `401` asks for, and a session cannot be renewed,
 * so it asks whether the session still stands: where it does not, the app is told, as by any
 * other request, and the replica is told its sign-in has ended, at which it discards itself
 * (FR-ID7). Any other answer leaves the replica to ask again: one refused request is no proof
 * that a session has gone.
 *
 * `ended` makes what tells the replica so, the library's `Revoked`: whoever opens the replica
 * hands it over (open.ts), and this file imports the library for its types alone, as every file
 * but that one does.
 */
export function sessionCredential(
  api: ApiClient,
  problems: ProblemHub,
  ended: () => Error,
): Credential {
  return {
    current: () => Promise.resolve('session'),
    renew: async () => {
      const { response, error } = await api.GET('/me')
      if (response.status !== 401) return
      problems.report(readProblem(response.status, error))
      throw ended()
    },
  }
}
