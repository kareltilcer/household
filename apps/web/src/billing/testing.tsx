// What a billing screen's test stands on: the household Tilcerovi as the server knows it, with a
// subscription, a month's usage and its payer's invoices; the three billing screens at their
// addresses, in the household the address names (household/testing.tsx, `routed`); and a
// stand-in for the payment processor's script, which no test fetches. Imported by tests alone.
//
// The stand-in is a `Processor` as stripe.ts hands one to the app: a test replaces
// `loadProcessor` with one that answers it, says when a frame is ready and what a confirmation
// resolves with, and reads what the app asked of it. What stripe.ts itself asks of Stripe.js is
// its own test's (stripe.test.ts).
import { paths } from '../app/paths.ts'
import type { Subscription, UsageSummary } from '../household/data.ts'
import { defaultsFor } from '../household/grants.ts'
import {
  accountOf,
  createServer as createHouseholdServer,
  Elsewhere,
  home,
  jana,
  memberOf,
  milos,
  openOver,
  problem,
  readBy,
  routed,
  type HouseholdServer,
} from '../household/testing.tsx'
import type { Me } from '../session/SessionProvider.tsx'
import { Billing } from './Billing.tsx'
import type { BillingIntent, Invoice } from './data.ts'
import type { Appearance, Confirmation, Confirmed, PaymentFrame, Processor } from './stripe.ts'
import { Subscribe } from './Subscribe.tsx'
import { Takeover } from './Takeover.tsx'

export const eur = (amount: number) => ({ amount_minor: amount, currency: 'EUR' })

/** Jana, who pays, as a subscription names its payer. */
export const janaPays = { user_id: jana.id, label: jana.display_name, is_former_member: false }
export const milosRef = { user_id: milos, label: 'Miloš Tilcer', is_former_member: false }

/** The household's subscription as its payer reads it: paid by the year, by a card. */
export function subscription(more: Partial<Subscription> = {}): Subscription {
  return {
    household_id: home,
    state: 'active',
    interval: 'year',
    current_period_end: '2027-03-02T09:00:00Z',
    cancel_at_period_end: false,
    payment_pending: false,
    trial_ends_at: null,
    grace_ends_at: null,
    data_retained_until: null,
    payer: janaPays,
    payment_method: { brand: 'visa', last4: '4417', exp_month: 8, exp_year: 2028 },
    base_price: eur(5988),
    plans: [
      { interval: 'year', price: eur(5988) },
      { interval: 'month', price: eur(599) },
    ],
    included_storage_bytes: 5_000_000_000,
    storage_block_bytes: 10_000_000_000,
    price_per_storage_block: eur(100),
    max_storage_blocks: 20,
    transfer: null,
    ...more,
  }
}

/** A household that never subscribed, in its trial: no interval, no price, no method. */
export function trial(more: Partial<Subscription> = {}): Subscription {
  return subscription({
    state: 'trialing',
    interval: null,
    current_period_end: null,
    base_price: null,
    payment_method: null,
    trial_ends_at: '2026-09-30T10:00:00Z',
    ...more,
  })
}

/** The offer of billing Jana made to Miloš. */
export const offer = {
  offered_by: janaPays,
  offered_to: milosRef,
  offered_at: '2026-09-09T17:04:00Z',
  expires_at: '2026-09-23T17:04:00Z',
} as const

/** September's storage: eighteen gigabytes on average, which is two blocks. */
export function usage(more: Partial<UsageSummary> = {}): UsageSummary {
  return {
    period_from: '2026-09-01',
    period_to: '2026-09-30',
    current_bytes: 19_400_000_000,
    mtd_average_bytes: 18_200_000_000,
    projected_average_bytes: 18_900_000_000,
    included_bytes: 25_000_000_000,
    included_bytes_base: 5_000_000_000,
    blocks_now: 2,
    blocks_projected: 2,
    projected_charge: eur(200),
    bytes_to_next_block: 6_100_000_000,
    bytes_to_drop_a_block: 3_900_000_000,
    upload_blocked: false,
    hard_ceiling_bytes: 205_000_000_000,
    ...more,
  }
}

export function invoice(more: Partial<Invoice> = {}): Invoice {
  return {
    id: '0190a000-0000-7000-8000-0000000000d1',
    number: 'HH-0042',
    issued_on: '2026-03-02',
    period_from: '2026-03-02',
    period_to: '2027-03-01',
    status: 'paid',
    total: eur(5988),
    tax: eur(1039),
    lines: [{ kind: 'base', description: 'Household, 1 rok', quantity: null, amount: eur(5988) }],
    pdf_url: null,
    ...more,
  }
}

/** What the server answers a press that begins a payment or a setup with. */
export function intent(kind: BillingIntent['intent'], secret = 'secret_1'): BillingIntent {
  return { client_secret: secret, intent: kind, publishable_key: 'pk_test_standin' }
}

export interface BillingServer extends HouseholdServer {
  /** The subscription `GET …/billing/subscription` answers with: a test changes it as the server would. */
  subscription: Subscription
  usage: UsageSummary
  /** The invoices its reader paid, the newest first. */
  invoices: Invoice[]
}

export const at = `/households/${home}/billing`

/** A server that knows the household's billing as well: what an owner's screens read. */
export function createServer(me: Me = jana): BillingServer {
  const server: BillingServer = Object.assign(createHouseholdServer(me), {
    subscription: subscription(),
    usage: usage(),
    invoices: [] as Invoice[],
  })
  server.on(`GET ${at}/subscription`, () => Response.json(server.subscription))
  server.on(`GET ${at}/usage`, () => Response.json(server.usage))
  server.on(`GET ${at}/invoices`, () =>
    Response.json({ items: server.invoices, meta: { has_more: false, next_cursor: null } }),
  )
  return server
}

/**
 * The household as another of its owners reads its billing: `user` is made an owner beside
 * Jana, who pays. They read no payment method, and no invoice is theirs.
 */
export function asOwner(user: string): BillingServer {
  const server = createServer(accountOf(user))
  server.members = server.members.map((each) =>
    each.user_id === user ? { ...each, role: 'owner', grants: defaultsFor('owner') } : each,
  )
  server.household = readBy(memberOf(user, server.members))
  server.subscription = subscription({ payment_method: null })
  server.on(`GET ${at}/invoices`, () => problem(403, 'forbidden'))
  return server
}

/** One frame the stand-in handed the app, as a test reads it and drives it. */
export interface StandInFrame {
  /** What it was made to confirm, and with which look. */
  readonly confirmed: Confirmed
  /** Where the app mounted it, once it had. */
  node: HTMLElement | null
  /** Tells the app it is drawn and takes input. */
  ready: () => void
  /** Tells the app it could not be drawn. */
  failed: () => void
  /** Every look it was given after the first. */
  readonly restyled: Appearance[]
  /** Every address a confirmation was asked to send its member back to. */
  readonly returnsTo: string[]
  destroyed: boolean
}

export interface StandIn {
  readonly processor: Processor
  /** Every frame the app asked for, in order. */
  readonly frames: StandInFrame[]
  /** What the next confirmations resolve with: nothing wrong, unless a test says. */
  answer: () => Promise<Confirmation>
  /**
   * Whether a frame says it is ready as soon as it is mounted, as the processor's does once it
   * has drawn itself. A test that holds it says so itself.
   */
  readies: boolean
}

/** A stand-in for the payment processor's script, as stripe.ts hands one to the app. */
export function createStandIn(): StandIn {
  const standIn: StandIn = {
    frames: [],
    answer: () => Promise.resolve({}),
    readies: true,
    processor: {
      frame: (confirmed) => {
        const frame: StandInFrame = {
          confirmed,
          node: null,
          ready: () => undefined,
          failed: () => undefined,
          restyled: [],
          returnsTo: [],
          destroyed: false,
        }
        standIn.frames.push(frame)
        const drawn: PaymentFrame = {
          mount: (node, { onReady, onLoadError }) => {
            frame.node = node
            frame.ready = onReady
            frame.failed = onLoadError
            if (standIn.readies) queueMicrotask(onReady)
          },
          restyle: (appearance) => {
            frame.restyled.push(appearance)
          },
          confirm: (returnTo) => {
            frame.returnsTo.push(returnTo)
            return standIn.answer()
          },
          destroy: () => {
            frame.destroyed = true
          },
        }
        return drawn
      },
    },
  }
  return standIn
}

const table = routed({
  household: [
    [paths.settingsBilling, Billing],
    [paths.settingsSubscribe, Subscribe],
    [paths.settingsTakeover, Takeover],
    [paths.settingsMembers, Elsewhere],
    [paths.settingsStorage, Elsewhere],
    [paths.settingsData, Elsewhere],
  ],
})

/** Opens `address` in a browser `server`'s member is signed in to. */
export function open(address: string, server: BillingServer = createServer()) {
  return openOver(table, address, server)
}
