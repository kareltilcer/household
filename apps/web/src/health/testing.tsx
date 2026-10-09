// What a test of the screens of a household's sync stands on: the household of
// household/testing.tsx and its server, the three screens drawn in it as the router draws them
// for a member, and a replica that is none: what the screens ask of this browser's replica
// (data.ts, bundle.ts), answered from memory. A test moves it as a real one moves: it catches
// up, something is queued, it reports, and tells whoever listens to its status. Imported by
// tests alone.
import type { Held, RecordedOutcome, Replica, ReplicaDigestVerdict } from '@household/sync'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSyncExternalStore } from 'react'
import { Outlet, RouterProvider, createMemoryRouter, useParams } from 'react-router'
import { createWebClient } from '../api/client.ts'
import { Providers } from '../app/App.tsx'
import { Signed } from '../app/guards.tsx'
import { paths } from '../app/paths.ts'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import { useHouseholdQuery } from '../household/households.ts'
import {
  createServer,
  home,
  jana,
  origin,
  tilcerovi,
  type HouseholdServer,
} from '../household/testing.tsx'
import type { Opened } from '../sync/open.ts'
import { SyncFixture, type Sync } from '../sync/ReplicaProvider.tsx'
import { Clients } from './Clients.tsx'
import type { Client, Report } from './data.ts'
import { Diagnostics } from './Diagnostics.tsx'
import { SyncHealth } from './SyncHealth.tsx'

export {
  accountOf,
  adam,
  createServer,
  home,
  jana,
  klara,
  memberOf,
  noContent,
  petr,
  problem,
  readBy,
  tilcerovi,
  invalid,
  type HouseholdServer,
} from '../household/testing.tsx'

/** The id this browser's replica reports under, and those of two other replicas of Jana's. */
export const here = '0190a000-0000-7000-8000-0000000000d1'
export const laptop = '0190a000-0000-7000-8000-0000000000d2'
export const phone = '0190a000-0000-7000-8000-0000000000d3'
/** The device the phone's replica reports from. */
export const phoneDevice = '0190a000-0000-7000-8000-0000000000e3'

export const chromeOnWindows =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
export const firefoxOnLinux =
  'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0'

/** The household as one that takes no writes reads. */
export const readOnly = {
  ...tilcerovi,
  entitlement: { state: 'read_only', can_write: false, can_upload: false },
} as const

/** A replica as it last reported: a browser's, in sync, unless a test says otherwise. */
export function report(more: Partial<Report> = {}): Report {
  return {
    replica_id: here,
    device_id: null,
    label: chromeOnWindows,
    checkpoint: '184402',
    last_report_at: '2026-09-08T16:41:00Z',
    pending_mutations: 0,
    unresolved_conflicts: 0,
    checksum_failures: 0,
    needs_resnapshot: false,
    digest_mismatch_entity_types: [],
    ...more,
  }
}

/** A client of the household's: Jana's browser, at this page's own version, unless a test says otherwise. */
export function client(more: Partial<Client> = {}): Client {
  return {
    replica_id: here,
    member: { user_id: jana.id, label: jana.display_name, is_former_member: false },
    type: 'web',
    platform: null,
    label: chromeOnWindows,
    version: '0.1.0',
    last_seen_at: '2026-09-08T16:41:00Z',
    ...more,
  }
}

/** An answer the replica recorded, with what the member wrote in it: a refused shopping item. */
export function outcome(more: Partial<RecordedOutcome> = {}): RecordedOutcome {
  return {
    id: '0190a000-0000-7000-8000-0000000000f1',
    mutation_id: '0190a000-0000-7000-8000-0000000000f2',
    entity_type: 'shopping.item',
    entity_id: '0190a000-0000-7000-8000-0000000000f3',
    op: 'update',
    outcome: 'rejected',
    code: 'validation_failed',
    message: 'quantity must be positive, got -3 for Ovesné mléko',
    version: 7,
    row: { id: '0190a000-0000-7000-8000-0000000000f3', name: 'Ovesné mléko', quantity: 2 },
    mutation: {
      mutation_id: '0190a000-0000-7000-8000-0000000000f2',
      entity_type: 'shopping.item',
      entity_id: '0190a000-0000-7000-8000-0000000000f3',
      op: 'update',
      base_version: 7,
      client_time: '2026-09-08T16:30:00Z',
      fields: { name: 'Ovesné mléko bez cukru', quantity: -3 },
    },
    answered_at: '2026-09-08T16:31:00Z',
    unresolved: true,
    overridden: [],
    ...more,
  }
}

/** What the screens ask of a replica: the part of it they use, typed as that part. */
type Asked = Pick<Replica, 'id' | 'queued' | 'held' | 'outcomes' | 'report' | 'caughtUp'> & {
  readonly db: Pick<Replica['db'], 'registerListener'>
}

type Listener = Parameters<Replica['db']['registerListener']>[0]
type Status = Replica['db']['currentStatus']

export interface StandInOptions {
  readonly id?: string
  /** Whether it has caught up to begin with: it has, unless a test says it is still connecting. */
  readonly caughtUp?: boolean
  readonly queued?: number
  /** How many mutations it holds to send again. */
  readonly held?: number
  readonly outcomes?: readonly RecordedOutcome[]
  /** What needs the member's attention: its inbox. */
  readonly inbox?: readonly RecordedOutcome[]
  /**
   * What the server answers its report: told once for each, it answers the verdict, null for a
   * report the server did not take, or throws for one that got no answer.
   */
  readonly onReport?: () => ReplicaDigestVerdict | null
  /** Whether its database fails under every question. */
  readonly broken?: boolean
}

export interface StandIn {
  /** It, as the app holds an open replica. */
  readonly opened: Opened
  /** How many times it was asked to report. */
  readonly reports: () => number
  /** Moves it, and tells whoever listens to its status, as PowerSync does. */
  readonly move: (to: { caughtUp?: boolean; queued?: number }) => void
}

const matched: ReplicaDigestVerdict = { matched: true, resnapshot_required: false, entries: [] }

export function standIn({
  id = here,
  caughtUp = true,
  queued = 0,
  held = 0,
  outcomes = [],
  inbox = [],
  onReport = () => matched,
  broken = false,
}: StandInOptions = {}): StandIn {
  const state = { caughtUp, queued, reports: 0 }
  const listeners = new Set<Listener>()
  const asked = <T,>(answer: () => T): Promise<T> =>
    broken ? Promise.reject(new Error('the database is closed')) : Promise.resolve(answer())
  const replica: Asked = {
    id: () => asked(() => id),
    queued: () => asked(() => state.queued),
    held: () => asked(() => Array.from({ length: held }, (): Held => heldMutation)),
    outcomes: () => asked(() => [...outcomes]),
    report: () => {
      state.reports += 1
      // As the library: a replica with a write queued reports nothing.
      if (state.queued > 0) return Promise.resolve(null)
      try {
        return Promise.resolve(onReport())
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
    get caughtUp() {
      return state.caughtUp
    },
    db: {
      registerListener: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
  }
  return {
    opened: {
      // The part the screens use is all there is of it.
      replica: replica as Replica,
      needsConnection: () => false,
      watchInbox: (listener) => {
        listener(inbox)
        return () => undefined
      },
    },
    reports: () => state.reports,
    move: (to) => {
      Object.assign(state, to)
      // What the screens do on a status is ask the replica again: the status itself is not read.
      for (const listener of listeners) listener.statusChanged?.({} as Status)
    },
  }
}

/** A mutation held to send again, with what the member wrote in it. */
const heldMutation: Held = {
  reason: 'entitlement',
  mutation: {
    mutation_id: '0190a000-0000-7000-8000-0000000000f8',
    entity_type: 'shopping.item',
    entity_id: '0190a000-0000-7000-8000-0000000000f9',
    op: 'create',
    client_time: '2026-09-08T16:20:00Z',
    fields: { name: 'Kvasnice' },
  },
}

/** How sync stands in a test, which the test may change while its screen is drawn. */
export interface SyncStore {
  readonly get: () => Sync
  readonly set: (next: Partial<Sync>) => void
  readonly subscribe: (notify: () => void) => () => void
}

/** A tab that holds `stand`'s replica, online and receiving, unless `more` says otherwise. */
export function syncOver(stand: StandIn = standIn(), more: Partial<Sync> = {}): SyncStore {
  return syncOf({
    replica: { phase: 'open', ...stand.opened },
    online: true,
    receiving: true,
    ...more,
  })
}

/** A tab with no replica of its own: another tab keeps it, or this browser keeps none. */
export function syncWithout(phase: 'opening' | 'elsewhere' | 'unavailable'): SyncStore {
  return syncOf({ replica: { phase }, online: true, receiving: null })
}

function syncOf(initial: Sync): SyncStore {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      value = { ...value, ...next }
      for (const listener of listeners) listener()
    },
    subscribe: (notify) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
  }
}

/** What stands at an address a screen leads on to: a test reads where it went. */
function Elsewhere() {
  return <main />
}

const rest = (path: string) => path.slice(paths.household.path.length + 1)

export interface OpenOptions {
  /** How sync stands: a tab that holds an in-sync replica, unless a test says otherwise. */
  readonly sync?: SyncStore
  /** What the link that led here handed on, as the router's `state`. */
  readonly state?: unknown
}

/**
 * Opens `address` in a browser `server`'s member is signed in to, in the household the address
 * names and over `sync`.
 */
export function open(
  address: string,
  server: HouseholdServer = createServer(),
  { sync = syncOver(), state }: OpenOptions = {},
) {
  /** The household the address names, as its member reads it, around its screens. */
  function InHousehold() {
    const { householdId = '' } = useParams()
    const household = useHouseholdQuery(householdId)
    const value = useSyncExternalStore(sync.subscribe, sync.get)
    if (household.data === undefined) return <main />
    return (
      <HouseholdContext value={household.data}>
        <SyncFixture value={value}>
          <main>
            <Outlet />
          </main>
        </SyncFixture>
      </HouseholdContext>
    )
  }
  const router = createMemoryRouter(
    [
      {
        Component: Signed,
        children: [
          {
            path: paths.household.path,
            Component: InHousehold,
            children: [
              { index: true, Component: Elsewhere },
              { path: rest(paths.sync.path), Component: Elsewhere },
              { path: rest(paths.settingsSync.path), Component: SyncHealth },
              { path: rest(paths.settingsDiagnostics.path), Component: Diagnostics },
              { path: rest(paths.settingsClients.path), Component: Clients },
            ],
          },
        ],
      },
      { path: paths.home.path, Component: Elsewhere },
      { path: paths.signIn.path, Component: Elsewhere },
    ],
    { initialEntries: [{ pathname: address, state }] },
  )
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
  return { ...drawn, router, server, sync, user: userEvent.setup() }
}

/** The path of the household's sync state, its reset and its clients on the server. */
export const routes = {
  state: `/households/${home}/sync/state`,
  reset: `/households/${home}/sync/reset`,
  clients: `/households/${home}/clients`,
  devices: '/me/devices',
  diagnostics: '/me/diagnostics',
} as const
