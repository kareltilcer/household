// A member and a household of theirs, as the API answers them: what a test that opens the app's
// own table as a member answers its server with. The server is each test's own, since what it
// answers is what the test is about; who is asking, and what a household looks like, are not.
import { csrfCookie } from '../api/names.ts'
import type { Household } from '../household/households.ts'
import type { Me } from '../session/SessionProvider.tsx'

/** The cookies of a browser that holds a session: the readable one is all a page reads of it. */
export const signedIn = (): string => `${csrfCookie}=t`

/** The member, as `GET /me` answers them. */
export const me: Me = {
  id: '01900000-0000-7000-8000-00000000d0e5',
  email: 'jana@example.test',
  email_verified: true,
  display_name: 'Jana',
  locale: 'en',
}

/** The household the member is in, whatever else a test puts them in. */
export const home = '01900000-0000-7000-8000-0000000000a1'

/** A household as its own address answers an owner of it, in its trial. */
export function household(id: string, name: string): Household {
  return {
    id,
    name,
    country: 'CZ',
    timezone: 'Europe/Prague',
    base_currency: 'CZK',
    locale: 'cs',
    my_role: 'owner',
    my_grants: { dashboard: 'view', admin: 'manage', shopping: 'contribute' },
    entitlement: { state: 'trialing', can_write: true },
  }
}

/** What the server answers for an address that is none of the member's, or that it has not. */
export function notFound(): Response {
  return Response.json(
    { type: 'about:blank', title: 'not found', status: 404, code: 'not_found' },
    { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
  )
}
