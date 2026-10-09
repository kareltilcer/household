// What a test of the screens of a household's sync stands on: the household of
// household/testing.tsx and its server, the three screens drawn in it as the router draws them
// for a member, and a replica that is none, the one the sync UI's own tests stand on
// (dev/sync/standIn.ts). A test moves it as a real one moves: it catches up, something is
// queued, it reports, and tells whoever listens to its status. Imported by tests alone.
import type { RecordedOutcome, Registry } from '@household/sync'
import { useSyncExternalStore } from 'react'
import { paths } from '../app/paths.ts'
import {
  standIn as replicaStandIn,
  type StandIn,
  type StandInOptions,
} from '../dev/sync/standIn.ts'
import {
  createServer,
  Elsewhere,
  home,
  InHousehold,
  jana,
  openOver,
  routed,
  tilcerovi,
  type HouseholdServer,
} from '../household/testing.tsx'
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

/** A registry that names nothing: the screens of a household's sync ask a replica for no row. */
const nothing: Registry = { description: '', streams: [], entities: {}, tables: {} }

/**
 * A replica that is none (dev/sync/standIn.ts), which reports as this browser's: what the
 * screens ask of this browser's replica (data.ts, bundle.ts), answered from memory.
 */
export function standIn(options: Omit<StandInOptions, 'registry'> = {}): StandIn {
  return replicaStandIn({ registry: nothing, id: here, ...options })
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
  /** The household around its screens, and how sync stands in it. */
  function InSync() {
    const value = useSyncExternalStore(sync.subscribe, sync.get)
    return (
      <SyncFixture value={value}>
        <InHousehold />
      </SyncFixture>
    )
  }
  const table = routed({
    household: [
      [paths.sync, Elsewhere],
      [paths.settingsSync, SyncHealth],
      [paths.settingsDiagnostics, Diagnostics],
      [paths.settingsClients, Clients],
    ],
    around: InSync,
  })
  return { ...openOver(table, address, server, { state }), sync }
}

/** The path of the household's sync state, its reset and its clients on the server. */
export const routes = {
  state: `/households/${home}/sync/state`,
  reset: `/households/${home}/sync/reset`,
  clients: `/households/${home}/clients`,
  devices: '/me/devices',
  diagnostics: '/me/diagnostics',
} as const
