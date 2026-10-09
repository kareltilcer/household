// What the storage screen's test stands on: the household of the household screens' own tests
// (household/testing.tsx), Tilcerovi with its five members, a server that answers the picture,
// the month and the plan as the prototype's worked fixture has them (design/v1 household.js), and
// the screen drawn at its own address, in the household the address names, behind the guard that
// draws it for a member alone (`routed`). Imported by tests alone.
//
// The figures agree with each other as the server's would: 19.4 GB stored against 25 GB, the base
// and the two blocks an average of 18.2 GB needs; the modules' lines and the members' each come
// to the total; and a block is a thousand million bytes times ten.
import { paths } from '../app/paths.ts'
import type { Subscription, UsageSummary } from '../household/data.ts'
import {
  adam,
  createServer as createHouseholdServer,
  home,
  jana,
  klara,
  milos,
  openOver,
  petr,
  problem,
  routed,
  type HouseholdServer,
} from '../household/testing.tsx'
import type { Me } from '../session/SessionProvider.tsx'
import type { StorageReport } from './data.ts'
import { Storage } from './Storage.tsx'

/** A gigabyte as storage is sold, and tenths of one: the fixture's figures are written in them. */
export const gb = 1_000_000_000
const tenths = (count: number) => count * (gb / 10)

/** The three requests the screen makes of the household. */
export const routes = {
  picture: `GET /households/${home}/storage`,
  usage: `GET /households/${home}/billing/usage`,
  plan: `GET /households/${home}/billing/subscription`,
} as const

/** `count` daily samples from `first`, a UTC day, each holding what `bytes` says of its place. */
export function samples(
  first: string,
  count: number,
  bytes: (index: number) => number,
): StorageReport['trend'] {
  const start = Date.parse(`${first}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    bytes: bytes(index),
  }))
}

/** The picture as an owner reads it: every module that keeps files has a line. */
export const report: StorageReport = {
  total_bytes: tenths(194),
  included_bytes: 25 * gb,
  object_count: 2412,
  by_module: [
    { module: 'documents', bytes: tenths(61), derived_bytes: tenths(6), object_count: 812 },
    { module: 'chat', bytes: tenths(54), derived_bytes: tenths(7), object_count: 1104 },
    { module: 'garden', bytes: tenths(42), derived_bytes: tenths(4), object_count: 391 },
    { module: 'utilities', bytes: tenths(11), derived_bytes: tenths(1), object_count: 64 },
    { module: 'finance', bytes: tenths(4), derived_bytes: 0, object_count: 23 },
    { module: 'notes', bytes: tenths(2), derived_bytes: 0, object_count: 12 },
    { module: 'shopping', bytes: tenths(2), derived_bytes: 0, object_count: 6 },
  ],
  by_member: [
    {
      user: { user_id: jana.id, label: jana.display_name, is_former_member: false },
      bytes: tenths(84),
    },
    { user: { user_id: milos, label: 'Miloš Tilcer', is_former_member: false }, bytes: tenths(59) },
    { user: { user_id: petr, label: 'Petr Tilcer', is_former_member: false }, bytes: tenths(31) },
    { user: { user_id: adam, label: 'Adam', is_former_member: false }, bytes: tenths(12) },
    {
      user: { user_id: klara, label: 'Klára Nováková', is_former_member: false },
      bytes: tenths(8),
    },
  ],
  largest: [
    {
      module: 'chat',
      entity_id: '0190a000-0000-7000-8000-0000000000e1',
      label: 'Chata, střecha 2025-08.mp4',
      bytes: 900_000_000,
      recoverable_bytes: 950_000_000,
    },
    {
      module: 'documents',
      entity_id: '0190a000-0000-7000-8000-0000000000e2',
      label: 'Pojistka, soupis majetku.pdf',
      bytes: 400_000_000,
      recoverable_bytes: 600_000_000,
    },
    {
      module: 'garden',
      entity_id: '0190a000-0000-7000-8000-0000000000e3',
      label: '',
      bytes: 300_000_000,
      recoverable_bytes: 300_000_000,
    },
  ],
  // Ninety days to the ninth of September: from 15 GB, a tenth of one more every other day.
  trend: samples('2026-06-12', 90, (index) => tenths(150 + Math.floor(index / 2))),
}

/** A household that stores nothing and never did: what every household is until a module keeps files. */
export const nothing: StorageReport = {
  total_bytes: 0,
  included_bytes: 5 * gb,
  object_count: 0,
  by_module: [],
  by_member: [],
  largest: [],
  trend: [],
}

/** September as it will be billed: an average of 18.2 GB, which two blocks cover. */
export const usage: UsageSummary = {
  period_from: '2026-09-01',
  period_to: '2026-09-30',
  current_bytes: tenths(194),
  mtd_average_bytes: tenths(182),
  projected_average_bytes: tenths(189),
  included_bytes: 25 * gb,
  included_bytes_base: 5 * gb,
  blocks_now: 2,
  blocks_projected: 2,
  projected_charge: { amount_minor: 200, currency: 'EUR' },
  bytes_to_next_block: tenths(68),
  bytes_to_drop_a_block: tenths(32),
  upload_blocked: false,
  hard_ceiling_bytes: 205 * gb,
}

/** The month of a household that stores nothing. */
export const unused: UsageSummary = {
  ...usage,
  current_bytes: 0,
  mtd_average_bytes: 0,
  projected_average_bytes: 0,
  included_bytes: 5 * gb,
  blocks_now: 0,
  blocks_projected: 0,
  projected_charge: { amount_minor: 0, currency: 'EUR' },
  bytes_to_next_block: 5 * gb,
  bytes_to_drop_a_block: null,
}

/** The subscription as an owner reads it: paid by the year, by Jana. */
export const plan: Subscription = {
  household_id: home,
  state: 'active',
  interval: 'year',
  current_period_end: '2027-03-02T09:00:00Z',
  cancel_at_period_end: false,
  payment_pending: false,
  trial_ends_at: null,
  grace_ends_at: null,
  data_retained_until: null,
  payer: { user_id: jana.id, label: jana.display_name, is_former_member: false },
  payment_method: null,
  base_price: { amount_minor: 5988, currency: 'EUR' },
  plans: [
    { interval: 'year', price: { amount_minor: 5988, currency: 'EUR' } },
    { interval: 'month', price: { amount_minor: 599, currency: 'EUR' } },
  ],
  included_storage_bytes: 5 * gb,
  storage_block_bytes: 10 * gb,
  price_per_storage_block: { amount_minor: 100, currency: 'EUR' },
  max_storage_blocks: 20,
  transfer: null,
}

export interface StorageServer extends HouseholdServer {
  /** The picture `getStorage` answers with: a test changes it as the server would. */
  report: StorageReport
  /** The month `getBillingUsage` answers an owner with. */
  usage: UsageSummary
  /** The subscription `getBillingSubscription` answers an owner with. */
  plan: Subscription
}

/**
 * A server that knows the household and what it stores, and answers whoever is signed in as the
 * API would: the picture to a member who holds something on household settings, the month and
 * the plan to an owner, and `404` to anybody else (household/testing.tsx's own answer to what
 * nobody named).
 */
export function createServer(me: Me = jana): StorageServer {
  const server: StorageServer = Object.assign(createHouseholdServer(me), { report, usage, plan })
  const holds = () => (server.household.my_grants?.admin ?? 'none') !== 'none'
  const owns = () => server.household.my_role === 'owner'
  const gone = () => problem(404, 'not_found')
  server.on(routes.picture, () => (holds() ? Response.json(server.report) : gone()))
  server.on(routes.usage, () => (owns() ? Response.json(server.usage) : gone()))
  server.on(routes.plan, () => (owns() ? Response.json(server.plan) : gone()))
  return server
}

const table = routed({ household: [[paths.settingsStorage, Storage]] })

/** Opens `address` in a browser `server`'s member is signed in to. */
export function open(address: string, server: StorageServer = createServer()) {
  return openOver(table, address, server)
}
