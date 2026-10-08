// What a household screen's test stands on: a member signed in to this browser, a household the
// server knows with its five members, and the household's routes drawn in the household the
// address names, behind the guard that draws them for a member alone. The shell around them, its
// sidebar and its replica, is another's to test (shell/household.test.tsx): here a screen is
// drawn in the page's one landmark, inside the household as its member reads it. Imported by
// tests alone.
//
// The household is the prototype's (design/v1 fixtures.js): Jana owns it and pays for it, Petr
// and Miloš each hold one module to set up, Klára holds three and nothing of the household's
// settings, and Adam is a child profile.
import type { components } from '@household/api'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useParams,
  type RouteObject,
} from 'react-router'
import {
  createServer as createAccountServer,
  jana,
  origin,
  type Server,
} from '../account/testing.tsx'
import { createWebClient } from '../api/client.ts'
import { Providers } from '../app/App.tsx'
import { Signed } from '../app/guards.tsx'
import { paths } from '../app/paths.ts'
import type { Me } from '../session/SessionProvider.tsx'
import { Create } from './Create.tsx'
import type { Country, Invitation as SentInvitation, Membership, ModuleState } from './data.ts'
import { defaultsFor, levelsOf, type Levels } from './grants.ts'
import { HouseholdContext } from './HouseholdContext.tsx'
import { moduleKeys, useHouseholdQuery, type Household } from './households.ts'
import { Invitation } from './Invitation.tsx'
import { Leave } from './Leave.tsx'
import { Invitations } from './settings/Invitations.tsx'
import { Invite } from './settings/Invite.tsx'
import { Member } from './settings/Member.tsx'
import { Members } from './settings/Members.tsx'
import { Modules } from './settings/Modules.tsx'
import { Profile } from './settings/Profile.tsx'
import { Start } from './Start.tsx'

export { invalid, jana, noContent, origin, problem, type Server } from '../account/testing.tsx'

export type AccessLevel = components['schemas']['AccessLevel']

/** The household's id, and its members'. */
export const home = '0190a000-0000-7000-8000-0000000000a1'
export const petr = '0190a000-0000-7000-8000-000000000002'
export const adam = '0190a000-0000-7000-8000-000000000003'
export const klara = '0190a000-0000-7000-8000-000000000004'
export const milos = '0190a000-0000-7000-8000-000000000005'

/** `held` on the modules it names, and `none` on every other. */
export function holding(held: Partial<Record<string, AccessLevel>>): Levels {
  return levelsOf(held as Record<string, AccessLevel>)
}

/** The household as its owner reads it: every module on, hers to set up, its code among it. */
export const tilcerovi: Household = {
  id: home,
  name: 'Tilcerovi',
  country: 'CZ',
  timezone: 'Europe/Prague',
  base_currency: 'CZK',
  locale: 'cs',
  units: 'metric',
  first_day_of_week: 1,
  version: 4,
  join_code: 'K7M24PQX',
  created_at: '2026-03-02T09:00:00Z',
  deletion_scheduled_at: null,
  entitlement: { state: 'active', can_write: true, can_upload: true },
  my_role: 'owner',
  my_grants: defaultsFor('owner'),
}

/** The household as `member` reads it: their role and what they hold, and no code unless they own it. */
export function readBy(member: Membership, household: Household = tilcerovi): Household {
  const { join_code: code, ...rest } = household
  return {
    ...rest,
    ...(member.role === 'owner' && code !== undefined ? { join_code: code } : {}),
    my_role: member.role ?? 'member',
    my_grants: member.grants ?? {},
  }
}

function member(
  id: string,
  name: string,
  more: Partial<Membership> & Pick<Membership, 'role' | 'grants'>,
): Membership {
  return {
    user_id: id,
    household_id: home,
    display_name: name,
    email: null,
    avatar_url: null,
    is_billing_payer: false,
    joined_at: '2026-03-02T09:00:00Z',
    last_active_at: '2026-09-08T18:20:00Z',
    version: 1,
    child: null,
    ...more,
  }
}

/** The five members, in the order they joined, as an owner reads them. */
export const members: readonly Membership[] = [
  member(jana.id, jana.display_name, {
    role: 'owner',
    grants: defaultsFor('owner'),
    email: jana.email ?? null,
    is_billing_payer: true,
  }),
  member(petr, 'Petr Tilcer', {
    role: 'member',
    email: 'petr@tilcerovi.cz',
    grants: holding({
      dashboard: 'view',
      utilities: 'manage',
      shopping: 'contribute',
      admin: 'view',
    }),
  }),
  member(adam, 'Adam', {
    role: 'child',
    grants: holding({
      dashboard: 'view',
      chores: 'contribute',
      tasks: 'contribute',
      shopping: 'contribute',
      calendar: 'view',
      chat: 'view',
      notes: 'view',
    }),
    child: { year_of_birth: 2014, pin_locked: false, dashboard_locked: true },
  }),
  member(klara, 'Klára Nováková', {
    role: 'member',
    email: 'klara@example.cz',
    grants: holding({ dashboard: 'view', shopping: 'contribute', chat: 'view' }),
  }),
  member(milos, 'Miloš Tilcer', {
    role: 'member',
    email: 'milos@tilcerovi.cz',
    grants: holding({ dashboard: 'view', garden: 'manage', documents: 'view', admin: 'view' }),
  }),
]

/** The member of `members` with the id `user`. */
export function memberOf(user: string, among: readonly Membership[] = members): Membership {
  const found = among.find((each) => each.user_id === user)
  if (found === undefined) throw new Error(`${user} is no member of the fixture`)
  return found
}

/** An account for a member of the fixture who is not Jana. */
export function accountOf(user: string, more: Partial<Me> = {}): Me {
  const who = memberOf(user)
  return {
    ...jana,
    id: user,
    display_name: who.display_name ?? '',
    email: who.email ?? null,
    is_child: who.role === 'child',
    credentials: who.role === 'child' ? ['child_pin'] : ['password'],
    ...more,
  }
}

/** Every module, on: what a household starts with. */
export function moduleStates(
  off: readonly string[] = [],
  grants: Readonly<Record<string, AccessLevel>> = defaultsFor('owner'),
): ModuleState[] {
  return moduleKeys.map((module) => ({
    module,
    enabled: !off.includes(module),
    my_level: off.includes(module) ? 'none' : (grants[module] ?? 'none'),
    needs_setup: false,
    entity_count: null,
  }))
}

/** An invitation the household sent: Jana's, to an address, as a member, with a member's defaults. */
export function invitation(more: Partial<SentInvitation> = {}): SentInvitation {
  return {
    id: '0190a000-0000-7000-8000-0000000000c1',
    kind: 'email',
    email: 'babicka@example.cz',
    role: 'member',
    grants: defaultsFor('member'),
    url: null,
    invited_by: { user_id: jana.id, label: jana.display_name, is_former_member: false },
    created_at: '2099-01-01T10:00:00Z',
    expires_at: '2099-01-15T10:00:00Z',
    status: 'pending',
    max_uses: 1,
    uses: 0,
    ...more,
  }
}

function text(en: string, cs: string) {
  return { en, cs, sk: cs, de: en, pl: en }
}

/** Three of the countries Household has a profile of. */
export const countries: readonly Country[] = [
  {
    code: 'CZ',
    version: 1,
    name: text('Czechia', 'Česko'),
    currency: 'CZK',
    vat_standard_percent: '21',
    default_units: 'metric',
    first_day_of_week: 1,
    holiday_set: 'CZ',
    inspection_label: 'STK',
    document_type_set: 'CZ',
  },
  {
    code: 'DE',
    version: 1,
    name: text('Germany', 'Německo'),
    currency: 'EUR',
    vat_standard_percent: '19',
    default_units: 'metric',
    first_day_of_week: 1,
    holiday_set: 'DE',
    inspection_label: 'HU/AU',
    document_type_set: 'DE',
  },
  {
    code: 'GB',
    version: 1,
    name: text('United Kingdom', 'Spojené království'),
    currency: 'GBP',
    vat_standard_percent: '20',
    default_units: 'metric',
    first_day_of_week: 1,
    holiday_set: 'GB',
    inspection_label: 'MOT',
    document_type_set: 'GB',
  },
]

export interface HouseholdServer extends Server {
  /** The household its own address answers with: a test changes it as the server would. */
  household: Household
  /** Its members, as `GET …/members` lists them. */
  members: Membership[]
  /** Its invitations, as `GET …/invitations` lists them. */
  invitations: SentInvitation[]
  /** The modules it has off. */
  off: string[]
}

/**
 * A server that knows the household and whoever is signed in to it: Jana, its owner, unless a
 * test names another of its members, who then reads it as they would.
 */
export function createServer(me: Me = jana): HouseholdServer {
  const who = members.find((each) => each.user_id === me.id)
  const server: HouseholdServer = Object.assign(createAccountServer(me), {
    household: who === undefined ? tilcerovi : readBy(who),
    members: [...members],
    invitations: [] as SentInvitation[],
    off: [] as string[],
  })
  const at = `/households/${home}`
  server.on('GET /households', () =>
    Response.json({
      items: [
        {
          id: home,
          name: server.household.name,
          my_role: server.household.my_role,
          member_count: server.members.length,
          entitlement: server.household.entitlement,
        },
      ],
    }),
  )
  server.on(`GET ${at}`, () =>
    Response.json(server.household, {
      headers: { ETag: `"${String(server.household.version ?? 0)}"` },
    }),
  )
  server.on(`GET ${at}/members`, () => Response.json({ items: server.members }))
  for (const each of members) {
    server.on(`GET ${at}/members/${String(each.user_id)}`, () => {
      const found = server.members.find((one) => one.user_id === each.user_id)
      return found === undefined
        ? Response.json(
            { type: 'about:blank', title: 'not_found', status: 404, code: 'not_found' },
            { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
          )
        : Response.json(found, { headers: { ETag: `"${String(found.version ?? 0)}"` } })
    })
  }
  server.on(`GET ${at}/invitations`, () => Response.json({ items: server.invitations }))
  server.on(`GET ${at}/modules`, () =>
    Response.json({ items: moduleStates(server.off, server.household.my_grants) }),
  )
  server.on('GET /reference/countries', () => Response.json({ version: 1, items: countries }))
  return server
}

/** The household the address names, as its member reads it, around its screens. */
function InHousehold() {
  const { householdId = '' } = useParams()
  const household = useHouseholdQuery(householdId)
  if (household.data === undefined) return <main />
  return (
    <HouseholdContext value={household.data}>
      <main>
        <Outlet />
      </main>
    </HouseholdContext>
  )
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

const rest = (path: string) => path.slice(paths.household.path.length + 1)

const table: RouteObject[] = [
  {
    Component: Signed,
    children: [
      {
        path: paths.household.path,
        Component: InHousehold,
        children: [
          { index: true, Component: Elsewhere },
          { path: rest(paths.start.path), Component: Start },
          { path: rest(paths.leave.path), Component: Leave },
          { path: rest(paths.settings.path), Component: Profile },
          { path: rest(paths.settingsMembers.path), Component: Members },
          { path: rest(paths.settingsMember.path), Component: Member },
          { path: rest(paths.settingsInvitations.path), Component: Invitations },
          { path: rest(paths.settingsInvite.path), Component: Invite },
          { path: rest(paths.settingsModules.path), Component: Modules },
        ],
      },
      {
        Component: Landmark,
        children: [
          { path: paths.householdNew.path, Component: Create },
          { path: paths.account.path, Component: Elsewhere },
        ],
      },
    ],
  },
  { Component: Landmark, children: [{ path: paths.invitation.path, Component: Invitation }] },
  { path: paths.home.path, Component: Elsewhere },
  { path: paths.signIn.path, Component: Elsewhere },
  { path: paths.register.path, Component: Elsewhere },
]

/**
 * Opens `address` in a browser `server`'s member is signed in to. `signedIn: false` opens it as
 * a visitor's: no session, and nothing asked of whose it is.
 */
export function open(
  address: string,
  server: HouseholdServer = createServer(),
  { signedIn = true }: { readonly signedIn?: boolean } = {},
) {
  const router = createMemoryRouter(table, { initialEntries: [address] })
  const cookies = () => (signedIn ? '__Host-hh_csrf=t' : '')
  const client = createWebClient({
    origin,
    fetch: server.fetch,
    cookies,
    // A request that got no answer is said to have got none at once: no test waits out a resend.
    retry: { delays: [] },
  })
  const drawn = render(
    <Providers persist={false} client={client} cookies={cookies}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { ...drawn, router, server, user: userEvent.setup() }
}
