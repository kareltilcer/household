// What a test of the data and privacy screens stands on: the household's fixture and its server
// (household/testing.tsx), with the three screens of this directory routed where the app routes
// them, a household's inside the household its address names and the privacy centre in the
// account's landmark, and the export jobs a server answers them with. Imported by tests alone.
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useParams,
  type RouteObject,
} from 'react-router'
import { origin, type Server } from '../account/testing.tsx'
import { createWebClient } from '../api/client.ts'
import { Providers } from '../app/App.tsx'
import { Signed } from '../app/guards.tsx'
import { paths } from '../app/paths.ts'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import { useHouseholdQuery } from '../household/households.ts'
import { Profile } from '../household/settings/Profile.tsx'
import { home } from '../household/testing.tsx'
import { Data } from './Data.tsx'
import { Exports } from './Exports.tsx'
import type { ExportJob } from './exports.ts'
import { Privacy } from './Privacy.tsx'

/** An id of an export, by its last digit. */
export const exportId = (last: number) => `0190a000-0000-7000-8000-0000000000e${String(last)}`

/** An export of the household that waits to be made, asked for on the ninth of September. */
export function job(more: Partial<ExportJob> = {}): ExportJob {
  return {
    id: exportId(1),
    scope: 'household',
    household_id: home,
    status: 'queued',
    requested_at: '2026-09-09T17:02:00Z',
    ready_at: null,
    expires_at: null,
    download_url: null,
    size_bytes: null,
    contents: [],
    ...more,
  }
}

/** Where the object store answers an archive's link from: no origin of the app's. */
export const archive = 'https://files.household.example/exports/archive.zip?signature=1'

/** The same export once it is made: its size, what is in it, and a link good for minutes. */
export function ready(more: Partial<ExportJob> = {}): ExportJob {
  return job({
    status: 'ready',
    ready_at: '2026-09-09T17:20:00Z',
    expires_at: '2026-09-16T17:20:00Z',
    download_url: archive,
    size_bytes: 1_600_000_000,
    contents: ['garden.json', 'files/', 'calendar.ics', 'activity-log.csv', 'manifest.json'],
    ...more,
  })
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

/** What stands at an address a screen leads on to: a test reads where it went. */
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
          { path: rest(paths.settings.path), Component: Profile },
          { path: rest(paths.settingsMembers.path), Component: Elsewhere },
          { path: rest(paths.settingsData.path), Component: Data },
          { path: rest(paths.settingsExports.path), Component: Exports },
        ],
      },
      {
        Component: Landmark,
        children: [
          { path: paths.accountPrivacy.path, Component: Privacy },
          { path: paths.account.path, Component: Elsewhere },
          { path: paths.accountDelete.path, Component: Elsewhere },
        ],
      },
    ],
  },
  { path: paths.signIn.path, Component: Elsewhere },
]

/** Opens `address` in a browser `server`'s member is signed in to. */
export function open<Known extends Server>(address: string, server: Known) {
  const router = createMemoryRouter(table, { initialEntries: [address] })
  const cookies = () => '__Host-hh_csrf=t'
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
