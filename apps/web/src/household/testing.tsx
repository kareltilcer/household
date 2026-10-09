// What a household screen's test stands on: a member signed in to this browser, a household the
// server knows with its five members, and the household's routes drawn in the household the
// address names, behind the guard that draws them for a member alone. The shell around them, its
// sidebar and its replica, is another's to test (shell/household.test.tsx): here a screen is
// drawn in the page's one landmark, inside the household as its member reads it. The tests of
// the settings' other sections (billing/, storage/, privacy/, health/) stand on the same: each
// routes its own screens through `routed` and opens them with `openOver`, and keeps beside its
// screens only what a server answers them with. Imported by tests alone.
//
// The household is the prototype's (design/v1 fixtures.js): Jana owns it and pays for it, Petr
// and Miloš each hold one module to set up, Klára holds three and nothing of the household's
// settings, and Adam is a child profile.
import type { components } from '@household/api'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
  parsePath,
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
import { paths, type RoutePath } from '../app/paths.ts'
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
    supervisory_authority: {
      name: text('Office for Personal Data Protection', 'Úřad pro ochranu osobních údajů'),
      url: 'https://uoou.gov.cz/poradna/chci-podat-stiznost-na-spravce-nebo-zpracovatele',
    },
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
    supervisory_authority: {
      name: text(
        'The Federal Commissioner for Data Protection and Freedom of Information',
        'Der Bundesbeauftragte für den Datenschutz und die Informationsfreiheit',
      ),
      url: 'https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html',
    },
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
    supervisory_authority: {
      name: text('Information Commission', 'Information Commission'),
      url: 'https://ico.org.uk/make-a-complaint/',
    },
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

/**
 * `text` as the page writes an amount in it: `Intl` sets a space that does not break between a
 * currency's code and its figure. A query by a control's name matches its name as it is written.
 */
export const money = (text: string) => text.replace(/\b([A-Z]{3}) (?=\d)/g, '$1 ')

/** The household the address names, as its member reads it, around its screens. */
export function InHousehold() {
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
export function Landmark() {
  return (
    <main>
      <Outlet />
    </main>
  )
}

/** What stands at an address a screen sends its member on to: a test reads where it went. */
export function Elsewhere() {
  return <main />
}

/** A screen at its route: what a test draws there, the screen itself or `Elsewhere`. */
export type Routed = readonly [route: RoutePath, screen: ComponentType]

/** The screens a test routes, by what the app draws each in (app/routes.tsx). */
export interface Screens {
  /** In the household the address names, for a member of it. */
  readonly household?: readonly Routed[]
  /** In the account's landmark, for a member alone. */
  readonly account?: readonly Routed[]
  /** In the page's landmark, for anybody: what a link in an email opens. */
  readonly anybody?: readonly Routed[]
  /**
   * What draws the household around its screens: `InHousehold`, or a test's own around it, for
   * screens that stand on more than the household (health/testing.tsx).
   */
  readonly around?: ComponentType
}

/**
 * The routes of a test: `screens` where the app draws them, behind the guard that draws a
 * member's for a member alone, with nothing but a landmark at the household's own address and
 * at the addresses a visitor is sent to.
 */
export function routed({
  household = [],
  account = [],
  anybody = [],
  around = InHousehold,
}: Screens): RouteObject[] {
  const inLandmark = (screens: readonly Routed[]): RouteObject[] =>
    screens.length === 0
      ? []
      : [
          {
            Component: Landmark,
            children: screens.map(([route, Component]) => ({ path: route.path, Component })),
          },
        ]
  return [
    {
      Component: Signed,
      children: [
        {
          path: paths.household.path,
          Component: around,
          children: [
            { index: true, Component: Elsewhere },
            ...household.map(([route, Component]) => ({
              // As its table writes it: from the household's own path.
              path: route.path.slice(paths.household.path.length + 1),
              Component,
            })),
          ],
        },
        ...inLandmark(account),
      ],
    },
    ...inLandmark(anybody),
    { path: paths.home.path, Component: Elsewhere },
    { path: paths.signIn.path, Component: Elsewhere },
    { path: paths.register.path, Component: Elsewhere },
  ]
}

/** The household's own screens (plan item 26), each where the app routes it. */
const table = routed({
  household: [
    [paths.start, Start],
    [paths.leave, Leave],
    [paths.settings, Profile],
    [paths.settingsMembers, Members],
    [paths.settingsMember, Member],
    [paths.settingsInvitations, Invitations],
    [paths.settingsInvite, Invite],
    [paths.settingsModules, Modules],
  ],
  account: [
    [paths.householdNew, Create],
    [paths.account, Elsewhere],
  ],
  anybody: [[paths.invitation, Invitation]],
})

export interface OpenOptions {
  /** `false` opens the address as a visitor's: no session, and nothing asked of whose it is. */
  readonly signedIn?: boolean
  /** What the link that led here handed on, as the router's `state`. */
  readonly state?: unknown
}

/**
 * Opens `address` over the routes `table`, in a browser `server`'s member is signed in to: what
 * the test of a screen that is no route of this file's stands on, with a table of its own
 * (`routed`).
 */
export function openOver<Known extends Server>(
  table: RouteObject[],
  address: string,
  server: Known,
  { signedIn = true, state }: OpenOptions = {},
) {
  const router = createMemoryRouter(table, {
    initialEntries: [state === undefined ? address : { ...parsePath(address), state }],
  })
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

/**
 * Opens `address` in a browser `server`'s member is signed in to. `signedIn: false` opens it as
 * a visitor's: no session, and nothing asked of whose it is.
 */
export function open(
  address: string,
  server: HouseholdServer = createServer(),
  options: OpenOptions = {},
) {
  return openOver(table, address, server, options)
}
