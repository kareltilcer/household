// What an account screen's test stands on: a member signed in to this browser, a server whose
// answers the test names, and the account's routes behind the guard that draws them for a member
// alone (app/guards.tsx). The shell around them is another's to test: here a screen is drawn in
// the page's one landmark and nothing more. Imported by tests alone.
import type { components } from '@household/api'
import { defaultScheduler, notifyManager } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, RouterProvider, createMemoryRouter, type RouteObject } from 'react-router'
import { createWebClient } from '../api/client.ts'
import { Providers } from '../app/App.tsx'
import { Signed } from '../app/guards.tsx'
import { paths } from '../app/paths.ts'
import type { Me } from '../session/SessionProvider.tsx'
import { Account } from './Account.tsx'
import { DeleteAccount } from './DeleteAccount.tsx'
import { Devices } from './Devices.tsx'
import { Notifications } from './Notifications.tsx'
import { SecondStepSetup } from './SecondStepSetup.tsx'
import { Security } from './Security.tsx'

export const origin = 'https://household.example'

export type HouseholdSummary = components['schemas']['HouseholdSummary']
export type Membership = components['schemas']['Membership']

/** A member with a password, a verified address and a timezone of her own. */
export const jana: Me = {
  id: '0190a000-0000-7000-8000-000000000001',
  email: 'jana@tilcerovi.cz',
  email_verified: true,
  display_name: 'Jana Tilcerová',
  avatar_url: null,
  locale: 'en',
  timezone: 'Europe/Prague',
  first_day_of_week: null,
  is_child: false,
  mfa_enabled: false,
  mfa_recovery_codes_left: null,
  credentials: ['password'],
  deletion_scheduled_at: null,
}

export const tilcerovi: HouseholdSummary = {
  id: '0190a000-0000-7000-8000-0000000000a1',
  name: 'Tilcerovi',
  my_role: 'owner',
  member_count: 5,
}

export const chata: HouseholdSummary = {
  id: '0190a000-0000-7000-8000-0000000000a2',
  name: 'Chata Vysočina',
  my_role: 'member',
  member_count: 3,
}

/** A problem document of the contract's, as the server sends one. */
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

/** A `422` naming one field. */
export function invalid(field: string, code = 'invalid'): Response {
  return problem(422, 'validation_failed', { errors: [{ field, code }] })
}

export const noContent = (): Response => new Response(null, { status: 204 })

/**
 * Keeps the query client from telling its screens of anything until what this returns is
 * called. It tells them of a change by a timer, and Chromium runs no timer a press set until
 * it has drawn the frame that answers the press: held back here, that frame lasts for as long
 * as a test needs it to, and a test that reads a switch in it reads what a member is drawn.
 * A test that calls this puts the scheduler back after itself (`defaultScheduler`), whether or
 * not it came to call what was returned.
 */
export function untold(): () => void {
  const waiting: (() => void)[] = []
  notifyManager.setScheduler((tell) => {
    waiting.push(tell)
  })
  return () => {
    notifyManager.setScheduler(defaultScheduler)
    act(() => {
      for (const tell of waiting.splice(0)) tell()
    })
  }
}

type Answer = (request: Request) => Response | Promise<Response>

export interface Server {
  /** The account `GET /me` answers with: a test changes it as the server would. */
  me: Me
  /** Every request sent, in order, each still readable. */
  readonly sent: Request[]
  /** Answers `route`, a method and a path of the API such as `PATCH /me`, from now on. */
  readonly on: (route: string, answer: Answer) => void
  /** The requests sent to `route`, in order. */
  readonly to: (route: string) => Request[]
  /** The body of the last request sent to `route`, read as JSON. */
  readonly body: (route: string) => Promise<unknown>
  readonly fetch: (request: Request) => Promise<Response>
}

function routeOf(request: Request): string {
  return `${request.method} ${new URL(request.url).pathname.replace(/^\/api\/v1/, '')}`
}

/** A server that knows `me`, and answers `404` to whatever a test did not say. */
export function createServer(me: Me = jana): Server {
  const answers = new Map<string, Answer>()
  const sent: Request[] = []
  const server: Server = {
    me,
    sent,
    on: (route, answer) => {
      answers.set(route, answer)
    },
    to: (route) => sent.filter((request) => routeOf(request) === route),
    body: async (route) => {
      const last = server.to(route).at(-1)
      if (last === undefined) throw new Error(`nothing was sent to ${route}`)
      return (await last.clone().json()) as unknown
    },
    fetch: async (request) => {
      sent.push(request.clone())
      const answer = answers.get(routeOf(request))
      return answer === undefined ? problem(404, 'not_found') : answer(request)
    },
  }
  server.on('GET /me', () => Response.json(server.me))
  server.on('GET /households', () => Response.json({ items: [] }))
  server.on('GET /me/invitations', () => Response.json({ items: [] }))
  server.on('GET /auth/oauth', () => Response.json({ providers: [] }))
  return server
}

/** The page's one landmark, which the shell gives a member's screens in the app. */
function Landmark() {
  return (
    <main>
      <Outlet />
    </main>
  )
}

/** What stands at an address a screen sends its member on to: a test reads where it went. */
function Elsewhere() {
  return <main />
}

const table: RouteObject[] = [
  {
    Component: Signed,
    children: [
      {
        Component: Landmark,
        children: [
          { path: paths.account.path, Component: Account },
          { path: paths.accountSecurity.path, Component: Security },
          { path: paths.accountSecondStep.path, Component: SecondStepSetup },
          { path: paths.accountDevices.path, Component: Devices },
          { path: paths.accountNotifications.path, Component: Notifications },
          { path: paths.accountDelete.path, Component: DeleteAccount },
        ],
      },
    ],
  },
  { path: paths.signIn.path, Component: Elsewhere },
  { path: paths.reset.path, Component: Elsewhere },
  { path: paths.deletionCancel.path, Component: Elsewhere },
]

/** Opens `address` as the member `server` knows, signed in to this browser. */
export function open(address: string, server: Server = createServer()) {
  const router = createMemoryRouter(table, { initialEntries: [address] })
  const client = createWebClient({
    origin,
    fetch: server.fetch,
    cookies: () => '__Host-hh_csrf=t',
    // A request that got no answer is said to have got none at once: no test waits out a resend.
    retry: { delays: [] },
  })
  const drawn = render(
    <Providers persist={false} client={client} cookies={() => '__Host-hh_csrf=t'}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { ...drawn, router, server, user: userEvent.setup() }
}
