// What the tests of the screens before sign-in stand on: the screens routed as the app routes
// them, inside the frame and the guard they are drawn in, with a server the test answers for.
// A browser's session is two cookies the server sets together, of which a script reads one
// (ADR 0009): the server here holds whether it is signed in, and the page's cookies follow it.
//
// The routes around the screens are places of this file's, each drawn as its own address: where
// a screen leads is the test's to say, and what the shell draws there is not.
import type { components } from '@household/api'
import { render, type RenderResult } from '@testing-library/react'
import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
  useLocation,
  type InitialEntry,
  type RouteObject,
} from 'react-router'
import { afterEach, expect } from 'vitest'
import { createWebClient, csrfCookie } from '../api/client.ts'
import { Providers } from '../app/App.tsx'
import { VisitorOnly } from '../app/guards.tsx'
import { paths } from '../app/paths.ts'
import { Public } from '../app/Public.tsx'
import { takeDestination } from '../session/destination.ts'
import { dropChallenge } from './challenge.ts'
import { DeletionCancel } from './DeletionCancel.tsx'
import { Graduate } from './Graduate.tsx'
import { ProviderReturn } from './ProviderReturn.tsx'
import { RecoveryCode } from './RecoveryCode.tsx'
import { Register } from './Register.tsx'
import { ResetRequest } from './ResetRequest.tsx'
import { ResetSet } from './ResetSet.tsx'
import { SecondStep } from './SecondStep.tsx'
import { SignIn } from './SignIn.tsx'
import { VerifyEmail } from './VerifyEmail.tsx'
import { VerifySent } from './VerifySent.tsx'

export type Me = components['schemas']['Me']

export const origin = 'https://household.example'

/** A member, as `GET /me` answers one. */
export const jana: Me = {
  id: '0196f3a0-0000-7000-8000-000000000001',
  display_name: 'Jana',
  email: 'jana@example.test',
  email_verified: true,
  locale: 'en',
}

/** A problem document, as the server writes one. */
export function problem(
  status: number,
  code: string,
  more: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { type: `https://household.example/problems/${code}`, title: code, status, code, ...more },
    { status, headers: { 'Content-Type': 'application/problem+json', ...headers } },
  )
}

/** A `422` naming `field`, a JSON Pointer, with the check it failed. */
export function invalid(field: string, code: string): Response {
  return problem(422, 'validation_failed', { errors: [{ field, code }] })
}

/** An answer with no body: `202`, `204`. */
export function empty(status: 202 | 204): Response {
  return new Response(null, { status })
}

/** An answer the test gives when it chooses to: the request waits for it meanwhile. */
export function pending(): {
  readonly response: Promise<Response>
  readonly answer: (response: Response) => void
} {
  let settle: (response: Response) => void = () => undefined
  const response = new Promise<Response>((resolve) => {
    settle = resolve
  })
  return {
    response,
    answer: (given) => {
      settle(given)
    },
  }
}

/** A request the app made: its method, its path under the API's own, and its JSON body. */
export interface Sent {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

type Respond = (sent: Sent) => Response | Promise<Response>

export interface Backend {
  /** Every request the app made, in order. */
  readonly sent: Sent[]
  /** The requests made to `route`, written `POST /auth/login`. */
  readonly to: (route: string) => Sent[]
  /** Answers `route` with `respond` from now on. */
  readonly on: (route: string, respond: Respond) => void
  /** The browser holds a session from now on, `me`'s: the cookies are set, and `GET /me` answers. */
  readonly signIn: (me?: Me) => void
  /** The session is ended on the server alone: the cookies stay, and `GET /me` answers `401`. */
  readonly end: () => void
  readonly fetch: (request: Request) => Promise<Response>
  readonly cookies: () => string
}

/** Requests no test answered for, which fail the test that made them. */
const unanswered: string[] = []

/** The routers that listen to the document's own history, until the test that made one ends. */
const listening: { readonly dispose: () => void }[] = []

afterEach(() => {
  // A challenge is held in the page's memory, which the tests of one file share, and so is the
  // address held for a visitor, beside the storage a test's end clears.
  dropChallenge()
  takeDestination()
  for (const router of listening.splice(0)) router.dispose()
  window.history.replaceState(null, '', '/')
  const made = unanswered.splice(0)
  expect(made, 'requests the test did not answer for').toEqual([])
})

/** A server that answers what a test tells it to, and for nothing else. */
export function serve(): Backend {
  const sent: Sent[] = []
  const answers = new Map<string, Respond>()
  let cookie = false
  let me: Me | undefined
  const backend: Backend = {
    sent,
    to: (route) => sent.filter((request) => `${request.method} ${request.path}` === route),
    on: (route, respond) => {
      answers.set(route, respond)
    },
    signIn: (member = jana) => {
      cookie = true
      me = member
    },
    end: () => {
      me = undefined
    },
    cookies: () => (cookie ? `${csrfCookie}=token` : ''),
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      const body: unknown =
        request.method === 'GET'
          ? undefined
          : await request
              .clone()
              .json()
              .catch(() => undefined)
      const made: Sent = { method: request.method, path: pathname.replace(/^\/api\/v1/, ''), body }
      sent.push(made)
      const route = `${made.method} ${made.path}`
      const respond = answers.get(route)
      if (respond === undefined) {
        unanswered.push(route)
        return problem(500, 'internal')
      }
      return respond(made)
    },
  }
  backend.on('GET /me', () =>
    me === undefined ? problem(401, 'unauthenticated') : Response.json(me),
  )
  // A server configured for no provider, until a test says otherwise.
  backend.on('GET /auth/oauth', () => Response.json({ providers: [] }))
  return backend
}

/** A place a screen leads to that is not a screen of these: it is drawn as its own address. */
function Place() {
  const { pathname, search, hash } = useLocation()
  return (
    <main>
      <h1>{`${pathname}${search}${hash}`}</h1>
    </main>
  )
}

const table: RouteObject[] = [
  {
    Component: Public,
    children: [
      { path: paths.providerReturn.path, Component: ProviderReturn },
      { path: paths.verifySent.path, Component: VerifySent },
      { path: paths.verifyEmail.path, Component: VerifyEmail },
      { path: paths.reset.path, Component: ResetRequest },
      { path: paths.resetSet.path, Component: ResetSet },
      { path: paths.graduate.path, Component: Graduate },
      { path: paths.deletionCancel.path, Component: DeletionCancel },
      {
        Component: VisitorOnly,
        children: [
          { path: paths.signIn.path, Component: SignIn },
          { path: paths.secondStep.path, Component: SecondStep },
          { path: paths.recoveryCode.path, Component: RecoveryCode },
          { path: paths.register.path, Component: Register },
        ],
      },
    ],
  },
  { path: '*', Component: Place },
]

export interface Opened extends RenderResult {
  readonly router: ReturnType<typeof createMemoryRouter>
  readonly backend: Backend
  /** The address the page is at: its path, its query and its fragment. */
  readonly address: () => string
}

export interface Opening {
  /** The server. Left out, one that answers for the session and the providers, and nothing else. */
  readonly backend?: Backend
  /** Draws the page under React's strict mode, as the app is drawn in development. */
  readonly strict?: boolean
}

/** Opens the app at `address`, as a browser that follows a link or types an address would. */
export function open(address: InitialEntry, opening: Opening = {}): Opened {
  return draw(createMemoryRouter(table, { initialEntries: [address] }), opening)
}

/**
 * Opens the app at `address` in the document's own history, which the app's router keeps in a
 * browser: what the address bar holds, and how many entries Back has to go through, are then
 * the test's to read from `window`.
 */
export function openInBrowser(address: string, opening: Opening = {}): Opened {
  window.history.replaceState(null, '', address)
  const router = createBrowserRouter(table)
  listening.push(router)
  return draw(router, opening)
}

function draw(
  router: ReturnType<typeof createMemoryRouter>,
  { backend = serve(), strict = false }: Opening,
): Opened {
  const client = createWebClient({ origin, fetch: backend.fetch, cookies: backend.cookies })
  const view = render(
    <Providers persist={false} client={client} cookies={backend.cookies}>
      <RouterProvider router={router} />
    </Providers>,
    { reactStrictMode: strict },
  )
  return {
    ...view,
    router,
    backend,
    address: () => {
      const { pathname, search, hash } = router.state.location
      return `${pathname}${search}${hash}`
    },
  }
}
