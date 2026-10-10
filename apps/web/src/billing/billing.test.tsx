// Manage billing (A-28, C-55): what each reader sees, how every state of the household is said,
// what each of the payer's writes asks of the server and says afterwards, where the focus goes
// when a control leaves, and what the screen draws while it is read, when it cannot be, and for
// a member the processor sent back.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../app/paths.ts'
import type { Subscription } from '../household/data.ts'
import { defaultsFor } from '../household/grants.ts'
import {
  accountOf,
  adam,
  home,
  jana,
  milos,
  money,
  noContent,
  invalid,
  petr,
  problem,
} from '../household/testing.tsx'
import { leaveFor, loadProcessor } from './stripe.ts'
import {
  asOwner,
  at,
  createServer,
  createStandIn,
  eur,
  intent,
  invoice,
  janaPays,
  milosRef,
  offer,
  open,
  subscription,
  trial,
  usage,
  type BillingServer,
  type StandIn,
} from './testing.tsx'

vi.mock('./stripe.ts', () => ({ loadProcessor: vi.fn(), leaveFor: vi.fn() }))
// The processor's word is waited for a moment, and not for ten seconds.
vi.mock('./cadence.ts', () => ({ confirmationReads: { every: 10, times: 3 } }))

let standIn: StandIn
beforeEach(() => {
  standIn = createStandIn()
  vi.mocked(loadProcessor).mockImplementation(() => Promise.resolve(standIn.processor))
  vi.mocked(leaveFor).mockReturnValue(true)
})

// A test that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const address = inHousehold.billing(home)
const reading = `GET ${at}/subscription`
const household = `GET /households/${home}`

async function read(server: BillingServer = createServer(), opened = address) {
  const drawn = open(opened, server)
  await screen.findByRole('heading', { level: 1, name: 'Billing' })
  return drawn
}

/** The household with Miloš an owner beside Jana, who pays and is signed in. */
function withAnotherOwner(): BillingServer {
  const server = createServer()
  server.members = server.members.map((each) =>
    each.user_id === milos ? { ...each, role: 'owner', grants: defaultsFor('owner') } : each,
  )
  return server
}

/** The household in a state that takes no writes, as every screen of it reads it. */
function takingNoWrites(server: BillingServer, state: Subscription['state']): BillingServer {
  server.household = {
    ...server.household,
    entitlement: { state, can_write: false, can_upload: false },
  }
  return server
}

const section = (name: string) => screen.findByRole('region', { name })
/** The value a label of a section's details stands beside. */
const valueOf = (region: HTMLElement, label: string) =>
  within(region).getByText(label).nextElementSibling

/** A section's own place: where the focus goes once a control of it that held it has left. */
const placeOf = (region: HTMLElement) => region.querySelector('[tabindex="-1"]')

describe('billing, as its payer reads it', () => {
  it('is titled for what it shows, and says how the household stands and what it pays', async () => {
    await read()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await waitFor(() => {
      expect(document.title).toBe('Billing · Household')
    })
    const standing = await section('Subscription')
    // The state in a word: the contract's own name for it is drawn nowhere.
    expect(within(standing).getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('active')).not.toBeInTheDocument()
    expect(valueOf(standing, 'Plan')).toHaveTextContent('EUR 59.88 a year')
    // The period's end, in the member's own zone.
    expect(valueOf(standing, 'Next charge')).toHaveTextContent('Mar 2, 2027')
    expect(valueOf(standing, 'Paid by')).toHaveTextContent('Jana Tilcerová (you)')
    expect(within(standing).queryByText('Trial ends')).not.toBeInTheDocument()
    expect(within(standing).queryByRole('link')).not.toBeInTheDocument()
  })

  it('reads the summary of the payment method, and nothing more of it', async () => {
    await read()
    const method = await section('Payment method')
    expect(within(method).getByText('Visa ending in 4417, expires 08/2028')).toBeInTheDocument()
    expect(screen.queryByText(/visa/)).not.toBeInTheDocument()
  })

  it.each([
    [
      { brand: 'sepa_debit', last4: '3000', exp_month: null, exp_year: null },
      'SEPA Direct Debit, account ending in 3000',
    ],
    [{ brand: 'sepa_debit', last4: null, exp_month: null, exp_year: null }, 'SEPA Direct Debit'],
    [
      { brand: 'mastercard', last4: '0005', exp_month: null, exp_year: null },
      'Mastercard ending in 0005',
    ],
    [
      { brand: 'girocard', last4: '1234', exp_month: 1, exp_year: 2030 },
      'Card ending in 1234, expires 01/2030',
    ],
    [{ brand: 'amex', last4: null, exp_month: null, exp_year: null }, 'American Express'],
  ])('says a method by what there is of it: %o', async (method, said) => {
    const server = createServer()
    server.subscription = subscription({ payment_method: method })
    await read(server)
    expect(within(await section('Payment method')).getByText(said)).toBeInTheDocument()
  })

  it('reads this month’s storage as it will be billed, with the way to what takes the room', async () => {
    await read()
    const month = await section('This month’s storage')
    await within(month).findByText('Month')
    expect(valueOf(month, 'Month')).toHaveTextContent('Sep 1, 2026 to Sep 30, 2026')
    expect(valueOf(month, 'Stored now')).toHaveTextContent('19.4 GB')
    expect(valueOf(month, 'Average so far this month')).toHaveTextContent('18.2 GB')
    expect(valueOf(month, 'Average the month is heading for')).toHaveTextContent('18.9 GB')
    expect(valueOf(month, 'Included in the plan')).toHaveTextContent('5 GB')
    expect(valueOf(month, 'Extra storage')).toHaveTextContent('2 blocks of 10 GB')
    expect(valueOf(month, 'Projected charge for storage')).toHaveTextContent('EUR 2.00')
    expect(within(month).getByRole('link', { name: 'Storage' })).toHaveAttribute(
      'href',
      inHousehold.storage(home),
    )
  })

  it('says a month with no extra storage has none', async () => {
    const server = createServer()
    server.usage = usage({ blocks_projected: 0, projected_charge: eur(0) })
    await read(server)
    const month = await section('This month’s storage')
    await within(month).findByText('Month')
    expect(valueOf(month, 'Extra storage')).toHaveTextContent('None')
  })

  it('says this month’s storage could not be read, beside everything else, and reads it again', async () => {
    const server = createServer()
    server.on(`GET ${at}/usage`, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    const month = await section('This month’s storage')
    expect(
      await within(month).findByText(
        'This month’s storage could not be read. Nothing about the subscription has changed. Try again.',
      ),
    ).toBeInTheDocument()
    expect(await section('Subscription')).toBeInTheDocument()
    server.on(`GET ${at}/usage`, () => Response.json(server.usage))
    await user.click(within(month).getByRole('button', { name: 'Try again' }))
    expect(await within(month).findByText('Stored now')).toBeInTheDocument()
  })
})

describe('how the household stands', () => {
  it('says of a trial when it ends, and leads its payer to subscribing', async () => {
    const server = createServer()
    server.subscription = trial()
    await read(server)
    const standing = await section('Subscription')
    expect(within(standing).getByText('Trial')).toBeInTheDocument()
    expect(valueOf(standing, 'Plan')).toHaveTextContent('No subscription')
    expect(valueOf(standing, 'Trial ends')).toHaveTextContent('Sep 30, 2026')
    expect(within(standing).queryByText('Next charge')).not.toBeInTheDocument()
    expect(within(standing).getByRole('link', { name: 'Subscribe' })).toHaveAttribute(
      'href',
      inHousehold.subscribe(home),
    )
    // Nothing to cancel, to change or to replace where there is no subscription.
    expect(
      screen.queryByRole('button', { name: 'Cancel the subscription' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Pay / })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Payment method' })).not.toBeInTheDocument()
  })

  it.each<[Partial<Subscription>, string, string]>([
    [
      { state: 'past_due' },
      'Payment failed',
      'The last payment did not go through. The payment processor tries it again, and nothing is restricted meanwhile. A new payment method is tried as soon as it is confirmed.',
    ],
    [
      { state: 'grace', grace_ends_at: '2026-10-14T10:00:00Z' },
      'Uploads paused',
      // Of a trial that ran out as of a subscription that ended: the answer does not tell them apart.
      'The trial or the subscription has ended. Uploading files is paused, and everything else works until Oct 14, 2026, when the household becomes read-only. Subscribing brings everything back.',
    ],
    [
      { state: 'read_only', data_retained_until: '2027-11-13T10:00:00Z' },
      'Read-only',
      'Nothing can be added or changed. Everything can still be read and exported, and is kept until Nov 13, 2027. Subscribing brings writing back and clears that date.',
    ],
    [
      { state: 'canceled', data_retained_until: '2027-11-13T10:00:00Z' },
      'Cancelled',
      'The subscription was cancelled and the period paid for has ended. Nothing can be added or changed; everything can still be read and exported, and is kept until Nov 13, 2027. Subscribing again brings writing back and clears that date.',
    ],
    [
      { state: 'restricted' },
      'Restricted',
      'An owner has restricted the household, so nothing can be changed until an owner lifts it. The subscription is not affected. Lifting it is under Data.',
    ],
  ])('says what %o means, in a word and a sentence', async (more, word, sentence) => {
    const server = createServer()
    server.subscription = trial({ trial_ends_at: null, ...more })
    server.household = {
      ...server.household,
      entitlement: { state: more.state ?? 'active', can_write: true, can_upload: true },
    }
    await read(server)
    const standing = await section('Subscription')
    expect(within(standing).getByText(word)).toBeInTheDocument()
    expect(within(standing).getByText(sentence)).toBeInTheDocument()
    // No date the server did not give: a failed payment has none.
    if (more.state === 'past_due') expect(standing).not.toHaveTextContent(/\d{4}/)
  })

  // The next charge of a subscription whose payment failed is the processor's retry, which no
  // answer dates: the period's end is no day it is charged on, and is not said to be.
  it('names no next charge while a payment is being retried', async () => {
    const server = createServer()
    server.subscription = subscription({ state: 'past_due' })
    await read(server)
    const standing = await section('Subscription')
    expect(within(standing).getByText('Payment failed')).toBeInTheDocument()
    expect(within(standing).queryByText('Next charge')).not.toBeInTheDocument()
    expect(standing).not.toHaveTextContent('Mar 2, 2027')
  })

  // A lapse outranks a restriction, which stands under it all the same (D-114): subscribing
  // again does not lift it, and that is said beside what subscribing brings back.
  it('says under a lapse that a restriction stays until an owner lifts it, with the way there', async () => {
    const server = createServer()
    server.subscription = trial({ state: 'read_only', trial_ends_at: null })
    takingNoWrites(server, 'read_only')
    server.household = {
      ...server.household,
      entitlement: {
        ...server.household.entitlement,
        restriction: {
          restricted_by: janaPays,
          restricted_at: '2026-09-01T08:00:00Z',
          reason: null,
        },
      },
    }
    await read(server)
    const standing = await section('Subscription')
    expect(
      within(standing).getByText(
        'An owner has restricted the household, so nothing can be changed until an owner lifts it. The subscription is not affected. Lifting it is under Data.',
      ),
    ).toBeInTheDocument()
    expect(within(standing).getByRole('link', { name: 'Data' })).toHaveAttribute(
      'href',
      inHousehold.data(home),
    )
  })

  // The household's own deletion comes before the day a lapse keeps its data until, and a
  // payment does not take it back: that day is not said, nor that subscribing clears it.
  it('names no day its data is kept until where the household’s deletion is scheduled', async () => {
    const server = createServer()
    server.subscription = trial({
      state: 'read_only',
      trial_ends_at: null,
      data_retained_until: '2027-11-13T10:00:00Z',
    })
    takingNoWrites(server, 'read_only')
    server.household = { ...server.household, deletion_scheduled_at: '2026-10-09T08:00:00Z' }
    await read(server)
    const standing = await section('Subscription')
    expect(
      within(standing).getByText(
        'Nothing can be added or changed. Everything can still be read and exported. Subscribing brings writing back.',
      ),
    ).toBeInTheDocument()
    expect(standing).not.toHaveTextContent('Nov 13, 2027')
  })

  it('leads from a restriction to where it is lifted', async () => {
    const server = createServer()
    server.subscription = subscription({ state: 'restricted' })
    takingNoWrites(server, 'restricted')
    await read(server)
    expect(
      within(await section('Subscription')).getByRole('link', { name: 'Data' }),
    ).toHaveAttribute('href', inHousehold.data(home))
  })

  it('says a payment is on its way, and offers no subscribing meanwhile', async () => {
    const server = createServer()
    server.subscription = trial({ payment_pending: true })
    await read(server)
    const standing = await section('Subscription')
    expect(
      within(standing).getByText(
        'A payment for a subscription is on its way. A bank debit takes some days to clear, and until the payment processor says how it went the household stays as it is.',
      ),
    ).toBeInTheDocument()
    expect(within(standing).queryByRole('link', { name: 'Subscribe' })).not.toBeInTheDocument()
  })

  // Everything under billing is outside the gate (FR-BI1): the strip says so, and the controls stay.
  it('still works in a household that takes no writes, and says that it does', async () => {
    const server = createServer()
    server.subscription = trial({
      state: 'read_only',
      trial_ends_at: null,
      data_retained_until: '2027-11-13T10:00:00Z',
    })
    takingNoWrites(server, 'read_only')
    await read(server)
    expect(
      await screen.findByText(
        'The household takes no changes now, and this page still works: subscribing, paying, cancelling and handing billing over are never held back.',
      ),
    ).toBeInTheDocument()
    expect(
      within(await section('Subscription')).getByRole('link', { name: 'Subscribe' }),
    ).toBeInTheDocument()
  })

  it('reads the household again where the subscription says another state than it does', async () => {
    const server = createServer()
    server.subscription = subscription({ state: 'past_due' })
    await read(server)
    await section('Subscription')
    await waitFor(() => {
      expect(server.to(household).length).toBeGreaterThan(1)
    })
  })
})

describe('changing how often the payer pays', () => {
  const changing = `PATCH ${at}/subscription`

  it('asks first, saying what it would cost and that it is prorated now, and then changes it', async () => {
    const server = createServer()
    server.on(changing, () => {
      server.subscription = subscription({ interval: 'month', base_price: eur(599) })
      return Response.json(server.subscription)
    })
    const { user } = await read(server)
    const opener = await screen.findByRole('button', { name: 'Pay monthly instead' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Pay monthly from now on?' })
    expect(dialog).toHaveAccessibleDescription(
      money(
        'You would pay EUR 5.99 a month. The change takes effect now: the payment processor sets what you have already paid against the new price, and charges or credits the difference.',
      ),
    )
    // The safe choice first.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Keep paying yearly', 'Pay monthly instead'])
    expect(server.to(changing)).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Pay monthly instead' }))
    expect(await screen.findByText('You pay monthly now.')).toBeInTheDocument()
    expect(await server.body(changing)).toEqual({ interval: 'month' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const standing = await section('Subscription')
    await waitFor(() => {
      expect(valueOf(standing, 'Plan')).toHaveTextContent('EUR 5.99 a month')
    })
    // The control stays, for the other way now, and the question gives the focus back to it.
    expect(screen.getByRole('button', { name: 'Pay yearly instead' })).toBe(opener)
  })

  it('asks nothing of the server where the payer thinks better of it', async () => {
    const server = createServer()
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Pay monthly instead' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep paying yearly' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(changing)).toHaveLength(0)
  })

  it('says the subscription has ended since, on the page, and reads it again', async () => {
    const server = createServer()
    server.on(changing, () => problem(409, 'not_subscribed'))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Pay monthly instead' }))
    const before = server.to(reading).length
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Pay monthly instead' }),
    )
    // Said in a toast: what is read again takes the payer's controls away, or the whole screen,
    // and a banner among them would go before it was read.
    expect(
      await screen.findByText(
        'The household has no subscription to change: it ended, or has not begun. Nothing was changed, and the page shows how it stands.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The question's ground has moved: it closes.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(reading).length).toBeGreaterThan(before)
    })
  })

  // A `503` is also what the server answers once the processor has taken the change and could
  // not then be read: nothing is said of what was charged or changed, and billing is read again.
  it('says the processor cannot be asked in the question, which stays open, and reads how billing stands', async () => {
    const server = createServer()
    server.on(changing, () => problem(503, 'billing_unavailable'))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Pay monthly instead' }))
    const dialog = screen.getByRole('dialog')
    const before = server.to(reading).length
    await user.click(within(dialog).getByRole('button', { name: 'Pay monthly instead' }))
    const said = await within(dialog).findByRole('alert')
    expect(said).toHaveTextContent(
      /^The payment processor can’t be asked right now\. The page shows how billing stands\. Try again in a little while\.$/,
    )
    expect(said).not.toHaveTextContent(/charged|nothing was changed/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(reading).length).toBeGreaterThan(before)
    })
  })
})

describe('cancelling, and taking a cancellation back', () => {
  const cancelling = `POST ${at}/cancel`
  const resuming = `POST ${at}/resume`

  it('names the household, says what is kept and until when, and cancels at the period’s end', async () => {
    const server = createServer()
    server.on(cancelling, () => {
      server.subscription = subscription({ cancel_at_period_end: true })
      return Response.json(server.subscription)
    })
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Cancel the subscription' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel the subscription for Tilcerovi?' })
    expect(dialog).toHaveAccessibleDescription(
      'Tilcerovi stays exactly as it is until Mar 2, 2027, and until then you can take the cancellation back. After that it becomes read-only: everything can still be read and exported, nothing can be added or changed, and it is kept until a date this page will show.',
    )
    // The safe choice first, then the one that names what it cancels.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Keep the subscription', 'Cancel the subscription for Tilcerovi'])
    expect(server.to(cancelling)).toHaveLength(0)

    await user.click(
      within(dialog).getByRole('button', { name: 'Cancel the subscription for Tilcerovi' }),
    )
    expect(
      await screen.findByText(
        'The subscription for Tilcerovi ends on Mar 2, 2027. Nothing changes until then.',
      ),
    ).toBeInTheDocument()
    const [sent] = server.to(cancelling)
    expect(await sent?.text()).toBe('')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // It stands cancelled, and says until when and that it can be taken back.
    const standing = await section('Subscription')
    expect(
      await within(standing).findByText(
        'The subscription is cancelled and ends on Mar 2, 2027. Nothing changes until then, and until then the cancellation can be taken back. After it the household becomes read-only.',
      ),
    ).toBeInTheDocument()
    expect(valueOf(standing, 'Ends on')).toHaveTextContent('Mar 2, 2027')
    expect(within(standing).queryByText('Next charge')).not.toBeInTheDocument()
    // *Cancel* gave its place to *Resume*, and the focus is on the section's own place.
    expect(
      screen.queryByRole('button', { name: 'Cancel the subscription' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume the subscription' })).toBeInTheDocument()
    await waitFor(() => {
      expect(placeOf(standing)).toHaveFocus()
    })
  })

  it('takes a cancellation back while the period runs', async () => {
    const server = createServer()
    server.subscription = subscription({ cancel_at_period_end: true })
    server.on(resuming, () => {
      server.subscription = subscription()
      return Response.json(server.subscription)
    })
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Resume the subscription' }))
    expect(
      await screen.findByText(
        'The cancellation was taken back. The subscription for Tilcerovi carries on.',
      ),
    ).toBeInTheDocument()
    expect(server.to(resuming)).toHaveLength(1)
    expect(await screen.findByRole('button', { name: 'Cancel the subscription' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Resume the subscription' }),
    ).not.toBeInTheDocument()
    const standing = await section('Subscription')
    await waitFor(() => {
      expect(placeOf(standing)).toHaveFocus()
    })
  })

  it('says a subscription that has ended cannot be resumed, and reads how it stands', async () => {
    const server = createServer()
    server.subscription = subscription({ cancel_at_period_end: true })
    server.on(resuming, () => problem(409, 'not_subscribed'))
    const { user } = await read(server)
    const before = server.to(reading).length
    await user.click(await screen.findByRole('button', { name: 'Resume the subscription' }))
    expect(
      await screen.findByText(/^The household has no subscription to change/),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(reading).length).toBeGreaterThan(before)
    })
  })

  it('says who pays now where the payer pays no longer, and closes the question', async () => {
    const server = createServer()
    server.on(cancelling, () => problem(403, 'forbidden'))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Cancel the subscription' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Cancel the subscription for Tilcerovi',
      }),
    )
    expect(
      await screen.findByText(
        'Only whoever pays for the household can do that, and that is not you now. Nothing was changed. The page shows who pays.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is asked at once with no connection, says so, and is sent by nothing when one returns', async () => {
    const server = createServer()
    server.on(cancelling, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Cancel the subscription' }))
    const dialog = screen.getByRole('dialog')
    onlineManager.setOnline(false)
    try {
      await user.click(
        within(dialog).getByRole('button', { name: 'Cancel the subscription for Tilcerovi' }),
      )
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        /^We couldn’t reach Household\./,
      )
    } finally {
      onlineManager.setOnline(true)
    }
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(server.to(cancelling)).toHaveLength(1)
  })
})

describe('replacing the payment method', () => {
  const beginning = `POST ${at}/payment-method`

  async function replacing(server: BillingServer) {
    server.on(beginning, () => Response.json(intent('setup', 'seti_1_secret_2')))
    const opened = await read(server)
    const method = await section('Payment method')
    await opened.user.click(
      within(method).getByRole('button', { name: 'Replace the payment method' }),
    )
    const save = await within(method).findByRole('button', { name: 'Save the payment method' })
    return { ...opened, method, save }
  }

  it('asks for a setup once pressed, and draws the processor’s form where the control stood', async () => {
    const server = createServer()
    expect(server.to(beginning)).toHaveLength(0)
    const { method } = await replacing(server)
    const [sent] = server.to(beginning)
    expect(server.to(beginning)).toHaveLength(1)
    expect(await sent?.text()).toBe('')
    expect(standIn.frames[0]?.confirmed).toMatchObject({ secret: 'seti_1_secret_2', kind: 'setup' })
    expect(
      within(method).queryByRole('button', { name: 'Replace the payment method' }),
    ).not.toBeInTheDocument()
    // The control gave its place to the form: the focus is where the form stands.
    expect(
      within(method).getByRole('group', { name: 'Payment details' }).closest('[tabindex]'),
    ).toHaveFocus()
    // No payment is being retried: nothing says one is.
    expect(within(method).queryByText(/tried with the new method/)).not.toBeInTheDocument()
  })

  it('says the new method is in use once the subscription read says so, and not before', async () => {
    const server = createServer()
    const { user, method, save } = await replacing(server)
    const before = server.to(reading).length
    await user.click(save)
    // A status from the press on, whose words change where they stand.
    const status = within(method).getByRole('status')
    await waitFor(() => {
      expect(status).toHaveTextContent(
        'The payment processor is confirming the new payment method.',
      )
    })
    expect(within(method).getByText('Visa ending in 4417, expires 08/2028')).toBeInTheDocument()
    // The form is put away, its secret with it, and the focus is on the section's own place.
    expect(within(method).queryByRole('group', { name: 'Payment details' })).not.toBeInTheDocument()
    expect(standIn.frames[0]?.destroyed).toBe(true)
    expect(status.closest('[tabindex]')).toHaveFocus()

    // The processor tells the server, and the next read says the new card.
    server.subscription = subscription({
      payment_method: { brand: 'mastercard', last4: '0005', exp_month: 1, exp_year: 2030 },
    })
    await waitFor(() => {
      expect(status).toHaveTextContent('The new payment method is in use.')
    })
    expect(
      within(method).getByText('Mastercard ending in 0005, expires 01/2030'),
    ).toBeInTheDocument()
    expect(server.to(reading).length).toBeGreaterThan(before)
    expect(within(method).getByRole('button', { name: 'Replace the payment method' })).toBeVisible()
  })

  it('says the processor has not said yet where the reads run out, and reads no longer', async () => {
    const server = createServer()
    const { user, method, save } = await replacing(server)
    const before = server.to(reading).length
    await user.click(save)
    const status = within(method).getByRole('status')
    await waitFor(() => {
      expect(status).toHaveTextContent(
        'The payment processor has not said yet that the new method is in use. This page shows it once it has, and nothing more needs doing.',
      )
    })
    // Once at the press and three times after it, and then no more.
    const asked = server.to(reading).length
    expect(asked - before).toBeGreaterThanOrEqual(3)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(server.to(reading)).toHaveLength(asked)
  })

  it('says a payment being retried is tried with the new method, and that it went through', async () => {
    const server = createServer()
    server.subscription = subscription({ state: 'past_due' })
    const { user, method, save } = await replacing(server)
    expect(
      within(method).getByText(
        'The payment that did not go through is tried with the new method as soon as it is confirmed.',
      ),
    ).toBeInTheDocument()
    await user.click(save)
    // The same card, and the payment went through: the state says so.
    server.subscription = subscription()
    await waitFor(() => {
      expect(within(method).getByRole('status')).toHaveTextContent(
        'The new payment method is in use.',
      )
    })
  })

  it('says a method that was not accepted leaves the subscription charged as it was', async () => {
    const server = createServer()
    const { user, method, save } = await replacing(server)
    standIn.answer = () => Promise.resolve({ error: { type: 'card_error' } })
    await user.click(save)
    const said = await within(method).findByRole('alert')
    expect(said).toHaveTextContent(
      /^The payment method was not accepted, and nothing was charged\./,
    )
    expect(said).toHaveTextContent('The subscription is still charged to the method it had.')
    expect(within(method).getByRole('status')).toBeEmptyDOMElement()
  })

  it('puts the form away where the payer thinks better of it, and keeps nothing of it', async () => {
    const server = createServer()
    const { user, method } = await replacing(server)
    await user.click(within(method).getByRole('button', { name: 'Not now' }))
    expect(within(method).queryByRole('group', { name: 'Payment details' })).not.toBeInTheDocument()
    expect(standIn.frames[0]?.destroyed).toBe(true)
    expect(within(method).getByRole('button', { name: 'Replace the payment method' })).toBeVisible()
    expect(within(method).getByRole('status').closest('[tabindex]')).toHaveFocus()
    expect(within(method).getByRole('status')).toBeEmptyDOMElement()
  })

  it('says the processor cannot be asked where the press is refused, and draws no form', async () => {
    const server = createServer()
    server.on(beginning, () => problem(503, 'billing_unavailable'))
    const { user } = await read(server)
    const method = await section('Payment method')
    const press = within(method).getByRole('button', { name: 'Replace the payment method' })
    await user.click(press)
    expect(await within(method).findByRole('alert')).toHaveTextContent(
      /^The payment processor can’t be asked right now\./,
    )
    expect(press).not.toHaveAttribute('aria-busy')
    expect(standIn.frames).toHaveLength(0)
  })
})

describe('the invoices', () => {
  const storage = invoice({
    id: '0190a000-0000-7000-8000-0000000000d2',
    number: null,
    issued_on: '2026-10-01',
    period_from: '2026-09-01',
    period_to: '2026-09-30',
    status: 'open',
    total: eur(200),
    tax: eur(0),
    lines: [
      {
        kind: 'storage_blocks',
        description: 'Úložiště navíc, 2026-09: 2 bloky po 10 GB',
        quantity: '2',
        amount: eur(200),
      },
    ],
  })

  async function rowOf(name: string): Promise<HTMLElement> {
    const row = (await screen.findByText(name)).closest('li')
    if (row === null) throw new Error(`${name} is on no row`)
    return row
  }

  it('teaches a payer who has none what one will hold', async () => {
    await read()
    const invoices = await section('Invoices')
    expect(
      await within(invoices).findByText(
        'No invoices yet. Each one is listed here once it is issued, with every line it is made of.',
      ),
    ).toBeInTheDocument()
  })

  it('says of each its number, its days, how it stands, its lines and its total with the tax in it', async () => {
    const server = createServer()
    server.invoices = [storage, invoice()]
    await read(server)
    const yearly = await rowOf('Invoice HH-0042')
    expect(within(yearly).getByText('Paid')).toBeInTheDocument()
    // The days are UTC's, shown as they are written.
    expect(
      within(yearly).getByText('Issued Mar 2, 2026, for Mar 2, 2026 to Mar 1, 2027'),
    ).toBeInTheDocument()
    const [line, total] = within(yearly).getAllByRole('listitem')
    expect(line).toHaveTextContent('Subscription')
    expect(line).toHaveTextContent('Household, 1 rok')
    expect(line).toHaveTextContent('EUR 59.88')
    expect(total).toHaveTextContent('Total')
    expect(total).toHaveTextContent('Includes EUR 10.39 tax')
    expect(total).toHaveTextContent('EUR 59.88')

    // One with no number is called by its day, and one with no tax says nothing of tax.
    const month = await rowOf('Invoice of Oct 1, 2026')
    expect(within(month).getByText('Awaiting payment')).toBeInTheDocument()
    expect(within(month).getByText('Extra storage')).toBeInTheDocument()
    expect(month).not.toHaveTextContent(/tax/)
    // Neither the contract's word for a status nor for a line is drawn.
    expect(screen.queryByText(/^(open|paid|base|storage_blocks)$/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download the invoice of Oct 1, 2026' }),
    ).toBeInTheDocument()
  })

  it('draws what the processor wrote of an invoice as data, which the pseudo-locale tells from a word', async () => {
    // The pseudo-locale's pass takes a run of plain letters for a word nobody translated: a
    // number and a line's description are the processor's, and are accented as data is.
    window.localStorage.setItem('household.locale', 'en-XA')
    const server = createServer()
    server.invoices = [invoice()]
    open(address, server)
    // The invoice's row, found by its number's figures, which are as they were written.
    const row = await waitFor(() => {
      const drawn = [...document.querySelectorAll('main li')].find((each) =>
        each.textContent.includes('-0042'),
      )
      if (drawn === undefined) throw new Error('no invoice is drawn yet')
      return drawn
    })
    expect(row.textContent).not.toContain('Household, 1 rok')
    expect(row.textContent).not.toContain('HH-0042')
    expect(row.textContent).not.toMatch(/[A-Za-z]{4,}/)
  })

  it('reads one invoice when its file is asked for, and leaves for the processor’s link', async () => {
    const server = createServer()
    server.invoices = [invoice()]
    const one = `GET ${at}/invoices/${invoice().id}`
    server.on(one, () =>
      Response.json(invoice({ pdf_url: 'https://pay.stripe.com/invoice/acct_1/pdf' })),
    )
    const { user } = await read(server)
    const download = await screen.findByRole('button', { name: 'Download invoice HH-0042' })
    // The link is read as it is asked for, and not before.
    expect(server.to(one)).toHaveLength(0)
    await user.click(download)
    await waitFor(() => {
      expect(leaveFor).toHaveBeenCalledExactlyOnceWith('https://pay.stripe.com/invoice/acct_1/pdf')
    })
    expect(server.to(one)).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says the file cannot be asked for while the processor gives no link', async () => {
    const server = createServer()
    server.invoices = [invoice()]
    server.on(`GET ${at}/invoices/${invoice().id}`, () => Response.json(invoice()))
    const { user } = await read(server)
    const download = await screen.findByRole('button', { name: 'Download invoice HH-0042' })
    await user.click(download)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The payment processor could not be asked for the file just now. Try again in a little while.',
    )
    expect(leaveFor).not.toHaveBeenCalled()
    expect(download).not.toHaveAttribute('aria-busy')
    expect(download).toHaveFocus()
  })

  it('says the same of a link that is no address to follow', async () => {
    vi.mocked(leaveFor).mockReturnValue(false)
    const server = createServer()
    server.invoices = [invoice()]
    server.on(`GET ${at}/invoices/${invoice().id}`, () =>
      Response.json(invoice({ pdf_url: 'http://pay.example/invoice.pdf' })),
    )
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Download invoice HH-0042' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^The payment processor could not be asked for the file just now\./,
    )
  })

  it('is asked for a file at once with no connection, and says so', async () => {
    const server = createServer()
    server.invoices = [invoice()]
    const one = `GET ${at}/invoices/${invoice().id}`
    server.on(one, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    const download = await screen.findByRole('button', { name: 'Download invoice HH-0042' })
    onlineManager.setOnline(false)
    try {
      await user.click(download)
      expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    } finally {
      onlineManager.setOnline(true)
    }
    expect(server.to(one)).toHaveLength(1)
  })

  it('reads the earlier ones when asked, from where the list left off', async () => {
    const server = createServer()
    const asked: (string | null)[] = []
    server.on(`GET ${at}/invoices`, (request) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      asked.push(cursor)
      return cursor === null
        ? Response.json({ items: [storage], meta: { has_more: true, next_cursor: 'c2' } })
        : Response.json({ items: [invoice()], meta: { has_more: false, next_cursor: null } })
    })
    const { user } = await read(server)
    await rowOf('Invoice of Oct 1, 2026')
    expect(screen.queryByText('Invoice HH-0042')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show earlier invoices' }))
    expect(await rowOf('Invoice HH-0042')).toBeInTheDocument()
    expect(asked).toEqual([null, 'c2'])
    expect(screen.queryByRole('button', { name: 'Show earlier invoices' })).not.toBeInTheDocument()
  })

  it('says its payer’s invoices could not be read, and reads them again', async () => {
    const server = createServer()
    server.on(`GET ${at}/invoices`, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    const invoices = await section('Invoices')
    expect(
      await within(invoices).findByText(
        'The invoices could not be read. Nothing about them has changed. Try again.',
      ),
    ).toBeInTheDocument()
    server.invoices = [invoice()]
    server.on(`GET ${at}/invoices`, () =>
      Response.json({ items: server.invoices, meta: { has_more: false } }),
    )
    await user.click(within(invoices).getByRole('button', { name: 'Try again' }))
    expect(await rowOf('Invoice HH-0042')).toBeInTheDocument()
  })
})

describe('handing billing over', () => {
  const offering = `POST ${at}/transfer`
  const withdrawing = `DELETE ${at}/transfer`

  it('says billing moves only between owners where there is no other, and leads to making one', async () => {
    await read()
    const handover = await section('Hand billing over')
    expect(
      await within(handover).findByText(
        'Billing moves only between owners, and nobody else owns Tilcerovi. Make somebody an owner first.',
      ),
    ).toBeInTheDocument()
    expect(within(handover).getByRole('link', { name: 'Make somebody an owner' })).toHaveAttribute(
      'href',
      inHousehold.members(home),
    )
    expect(within(handover).queryByRole('button')).not.toBeInTheDocument()
  })

  // Making an owner is a write the gate refuses (FR-BI1): no way that could only be refused.
  it('says making an owner waits for a household that takes writes, and leads nowhere', async () => {
    const server = takingNoWrites(createServer(), 'read_only')
    server.subscription = trial({ state: 'read_only', trial_ends_at: null })
    await read(server)
    const handover = await section('Hand billing over')
    expect(
      await within(handover).findByText(
        'Making somebody an owner is not possible until the household takes changes again.',
      ),
    ).toBeInTheDocument()
    expect(within(handover).queryByRole('link')).not.toBeInTheDocument()
  })

  it('offers billing to an owner its payer chose, and says the two steps before it does', async () => {
    const server = withAnotherOwner()
    server.on(offering, () => {
      server.subscription = subscription({ transfer: offer })
      return new Response(null, { status: 202 })
    })
    const { user } = await read(server)
    const handover = await section('Hand billing over')
    await user.click(
      await within(handover).findByRole('button', { name: 'Hand billing to another owner' }),
    )
    const sheet = screen.getByRole('dialog', { name: 'Hand billing to another owner' })
    expect(sheet).toHaveAccessibleDescription(
      'Two steps: you offer, and they accept and confirm a payment method of their own. You go on paying until they have. The offer lapses fourteen days after it is made, and you can take it back.',
    )
    // Nobody is chosen for the payer: the owners are offered, and none is taken.
    const to = within(sheet).getByRole('combobox', { name: 'To' })
    expect(to).toHaveValue('')
    expect(
      within(to)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose an owner', 'Miloš Tilcer'])
    // A card is asked for where there is a subscription to charge: nothing says otherwise.
    expect(within(sheet).queryByText(/asked for no card/)).not.toBeInTheDocument()

    // Pressed with nobody chosen, it is not sent: the field says so and takes the focus.
    await user.click(within(sheet).getByRole('button', { name: 'Offer billing' }))
    expect(within(sheet).getByText('Choose who billing is offered to.')).toBeInTheDocument()
    expect(to).toHaveFocus()
    expect(server.to(offering)).toHaveLength(0)

    await user.selectOptions(to, milos)
    await user.click(within(sheet).getByRole('button', { name: 'Offer billing to Miloš Tilcer' }))
    expect(
      await screen.findByText(
        'Billing was offered to Miloš Tilcer, who is told by email. You go on paying until they accept.',
      ),
    ).toBeInTheDocument()
    expect(await server.body(offering)).toEqual({ user_id: milos })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The offer stands open, with the day it lapses on as the server gave it.
    expect(
      await within(handover).findByText(
        'You offered billing to another owner on Sep 9, 2026: Miloš Tilcer. You go on paying until they accept. The offer lapses on Sep 23, 2026.',
      ),
    ).toBeInTheDocument()
    // The control the panel was opened from is gone: the focus is on the screen's own place.
    expect(
      within(handover).queryByRole('button', { name: 'Hand billing to another owner' }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(placeOf(handover)).toHaveFocus()
    })
  })

  it('says no card is asked for where the household has no subscription', async () => {
    const server = withAnotherOwner()
    server.subscription = trial()
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Hand billing to another owner' }))
    expect(
      within(screen.getByRole('dialog')).getByText(
        'The household has no subscription now, so they are asked for no card: they pay for it from the moment they accept.',
      ),
    ).toBeInTheDocument()
  })

  it('says beside the field that somebody cannot be offered billing, and reads the owners again', async () => {
    const server = withAnotherOwner()
    server.on(offering, () => invalid('/user_id'))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Hand billing to another owner' }))
    const sheet = screen.getByRole('dialog')
    const to = within(sheet).getByRole('combobox', { name: 'To' })
    await user.selectOptions(to, milos)
    const before = server.to(`GET /households/${home}/members`).length
    await user.click(within(sheet).getByRole('button', { name: 'Offer billing to Miloš Tilcer' }))
    expect(
      await within(sheet).findByText(
        'Billing can’t be offered to them: they are no longer an owner here, or their account is being deleted. Choose another owner.',
      ),
    ).toBeInTheDocument()
    expect(to).toHaveAccessibleDescription(/^Billing can’t be offered to them/)
    await waitFor(() => {
      expect(to).toHaveFocus()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(`GET /households/${home}/members`).length).toBeGreaterThan(before)
    })
  })

  it('closes the panel and says who pays where its member pays no longer', async () => {
    const server = withAnotherOwner()
    server.on(offering, () => problem(403, 'forbidden'))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Hand billing to another owner' }))
    const sheet = screen.getByRole('dialog')
    await user.selectOptions(within(sheet).getByRole('combobox', { name: 'To' }), milos)
    await user.click(within(sheet).getByRole('button', { name: 'Offer billing to Miloš Tilcer' }))
    expect(
      await screen.findByText(/^Only whoever pays for the household can do that/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says an offer could not reach the server, in the panel, which stays open', async () => {
    const server = withAnotherOwner()
    server.on(offering, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Hand billing to another owner' }))
    const sheet = screen.getByRole('dialog')
    await user.selectOptions(within(sheet).getByRole('combobox', { name: 'To' }), milos)
    onlineManager.setOnline(false)
    try {
      await user.click(within(sheet).getByRole('button', { name: 'Offer billing to Miloš Tilcer' }))
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(
        /^We couldn’t reach Household\./,
      )
    } finally {
      onlineManager.setOnline(true)
    }
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(server.to(offering)).toHaveLength(1)
  })

  it('takes an offer back, says so, and puts the focus where the screen says', async () => {
    const server = withAnotherOwner()
    server.subscription = subscription({ transfer: offer })
    server.on(withdrawing, () => {
      server.subscription = subscription()
      return noContent()
    })
    const { user } = await read(server)
    const handover = await section('Hand billing over')
    // No second offer while one is open.
    expect(
      within(handover).queryByRole('button', { name: 'Hand billing to another owner' }),
    ).not.toBeInTheDocument()
    await user.click(within(handover).getByRole('button', { name: 'Take the offer back' }))
    expect(
      await screen.findByText('The offer was taken back: Miloš Tilcer. You go on paying.'),
    ).toBeInTheDocument()
    expect(server.to(withdrawing)).toHaveLength(1)
    expect(
      await within(handover).findByRole('button', { name: 'Hand billing to another owner' }),
    ).toBeVisible()
    await waitFor(() => {
      expect(placeOf(handover)).toHaveFocus()
    })
  })

  // The server answers the same where no offer was open any more, one the other owner accepted
  // meanwhile among them: who pays is read, and nothing is said that the read does not say.
  it('does not say its member goes on paying where the offer was accepted before it was taken back', async () => {
    const server = withAnotherOwner()
    server.subscription = subscription({ transfer: offer })
    server.on(withdrawing, () => {
      // Accepted a moment before: billing has moved, and there was no offer to take back.
      server.subscription = subscription({ payer: milosRef, payment_method: null })
      return noContent()
    })
    const { user } = await read(server)
    const handover = await section('Hand billing over')
    await user.click(within(handover).getByRole('button', { name: 'Take the offer back' }))
    expect(
      await screen.findByText('No offer of billing is open now. The page shows who pays.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/You go on paying/)).not.toBeInTheDocument()
    expect(await screen.findByText(/^Miloš Tilcer pays for the household\./)).toBeInTheDocument()
  })

  // No frame draws this part's read: it is said as it arrives, to whoever cannot see it.
  it('says, as it arrives, that who else owns the household could not be read', async () => {
    const server = createServer()
    server.on(`GET /households/${home}/members`, () => Promise.reject(new TypeError('offline')))
    await read(server)
    const handover = await section('Hand billing over')
    expect(await within(handover).findByRole('alert')).toHaveTextContent(
      'Who else owns the household could not be read, so billing can’t be offered just now. Try again.',
    )
  })

  // What changes under a member who is reading moves nothing: the focus is theirs.
  it('leaves the focus alone where the offer goes while nobody pressed anything', async () => {
    const server = withAnotherOwner()
    server.subscription = subscription({ transfer: offer })
    await read(server)
    const handover = await section('Hand billing over')
    await within(handover).findByRole('button', { name: 'Take the offer back' })
    // Miloš declines, elsewhere, and the page is looked at again.
    server.subscription = subscription()
    act(() => {
      focusManager.setFocused(true)
    })
    expect(
      await within(handover).findByRole('button', { name: 'Hand billing to another owner' }),
    ).toBeVisible()
    expect(document.body).toHaveFocus()
  })

  it('says an offer could not be taken back where the server refuses, and keeps the control', async () => {
    const server = withAnotherOwner()
    server.subscription = subscription({ transfer: offer })
    server.on(withdrawing, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    const handover = await section('Hand billing over')
    const press = within(handover).getByRole('button', { name: 'Take the offer back' })
    await user.click(press)
    expect(await within(handover).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(press).not.toHaveAttribute('aria-busy')
    expect(press).toHaveFocus()
  })
})

describe('billing, as an owner who does not pay reads it', () => {
  it('reads the state, the plan, the month and who pays, and has no control', async () => {
    const server = asOwner(milos)
    await read(server)
    const standing = await section('Subscription')
    expect(within(standing).getByText('Active')).toBeInTheDocument()
    expect(valueOf(standing, 'Plan')).toHaveTextContent('EUR 59.88 a year')
    expect(valueOf(standing, 'Paid by')).toHaveTextContent(/^Jana Tilcerová$/)
    expect(await section('This month’s storage')).toBeInTheDocument()
    const whose = await section('Who pays')
    expect(
      within(whose).getByText(
        'Jana Tilcerová pays for the household. The payment method and the invoices are theirs alone to read, and offering billing to another owner is theirs to do.',
      ),
    ).toBeInTheDocument()
    // Absent, and not disabled: nothing of the payer's is drawn.
    await waitFor(() => {
      expect(server.to(`GET ${at}/invoices`)).toHaveLength(1)
    })
    expect(screen.queryByRole('region', { name: 'Payment method' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Invoices' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Hand billing over' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is told whose it is to subscribe, where the household has no subscription', async () => {
    const server = asOwner(milos)
    server.subscription = trial()
    await read(server)
    const standing = await section('Subscription')
    expect(
      within(standing).getByText(
        'Jana Tilcerová pays for the household, so subscribing is theirs to do.',
      ),
    ).toBeInTheDocument()
    expect(within(standing).queryByRole('link', { name: 'Subscribe' })).not.toBeInTheDocument()
  })

  it('is told of an offer made to them, with the way to it', async () => {
    const server = asOwner(milos)
    server.subscription = subscription({ payment_method: null, transfer: offer })
    await read(server)
    const whose = await section('Who pays')
    expect(within(whose).getByText('Jana Tilcerová has offered you billing')).toBeInTheDocument()
    expect(within(whose).getByText('The offer lapses on Sep 23, 2026.')).toBeInTheDocument()
    expect(within(whose).getByRole('link', { name: 'See the offer' })).toHaveAttribute(
      'href',
      inHousehold.takeover(home),
    )
    // It was so when the screen opened: read in its place.
    expect(within(whose).queryByRole('status')).not.toBeInTheDocument()
  })

  it('is told of an offer made to another owner, and offered nothing', async () => {
    const server = asOwner(petr)
    server.subscription = subscription({ payment_method: null, transfer: offer })
    await read(server)
    const whose = await section('Who pays')
    expect(
      within(whose).getByText(
        'Billing has been offered to another owner: Miloš Tilcer. It moves once they accept.',
      ),
    ).toBeInTheDocument()
    expect(within(whose).queryByRole('link')).not.toBeInTheDocument()
  })

  it('still reads the invoices they paid before they handed billing on', async () => {
    const server = asOwner(milos)
    server.invoices = [invoice()]
    server.on(`GET ${at}/invoices`, () =>
      Response.json({ items: server.invoices, meta: { has_more: false } }),
    )
    await read(server)
    expect(within(await section('Invoices')).getByText('Invoice HH-0042')).toBeInTheDocument()
  })
})

describe('billing, for everybody else', () => {
  it.each([
    ['a member', petr],
    ['a child profile', adam],
  ])('is no part of the app of %s, and asks the server nothing', async (_who, user) => {
    const server = createServer(accountOf(user))
    open(address, server)
    expect(await screen.findByText('This link doesn’t open anything here.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Billing' })).not.toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(0)
    expect(server.to(`GET ${at}/invoices`)).toHaveLength(0)
    expect(server.to(`GET ${at}/usage`)).toHaveLength(0)
  })

  it('reads the household again where billing answers that its reader owns it no longer', async () => {
    const server = createServer()
    server.on(reading, () => problem(404, 'not_found'))
    await read(server)
    await waitFor(() => {
      expect(server.to(household).length).toBeGreaterThan(1)
    })
  })
})

describe('billing’s read', () => {
  it('draws its shape while it is read', async () => {
    const server = createServer()
    server.on(reading, () => new Promise<Response>(() => undefined))
    await read(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Subscription' })).not.toBeInTheDocument()
  })

  it('says billing could not be read and that nothing was charged, and reads it again', async () => {
    const server = createServer()
    server.on(reading, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    expect(await screen.findByText('Billing could not be read')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The subscription is as it was: opening this page charges nothing. Check your connection and try again.',
      ),
    ).toBeInTheDocument()
    server.on(reading, () => Response.json(server.subscription))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await section('Subscription')).toBeInTheDocument()
  })

  // A read that waits for a connection is no read under way: nothing is kept, and it is said.
  it('says a subscription it cannot ask for could not be read, and draws no skeleton', async () => {
    const server = createServer()
    let gone = false
    server.on(household, () => {
      if (!gone) onlineManager.setOnline(false)
      gone = true
      return Response.json(server.household)
    })
    await read(server)
    expect(await screen.findByText('Billing could not be read')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(0)
  })

  it('goes on drawing what it read when the connection goes', async () => {
    const server = createServer()
    await read(server)
    await section('Subscription')
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    onlineManager.setOnline(false)
    window.dispatchEvent(new Event('offline'))
    const standing = await section('Subscription')
    expect(within(standing).getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Billing could not be read')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel the subscription' })).toBeInTheDocument()
  })
})

describe('a member the processor sent back', () => {
  const back = `${address}?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_2&redirect_status=succeeded`

  it('has what the address carried taken out of it, and believes nothing of it', async () => {
    const server = createServer()
    server.subscription = trial()
    const { router } = await read(server, back)
    // The secret is in no address to copy and in no entry to go back to.
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(router.state.location.pathname).toBe(address)
    // The address said the payment went through: the page says what the server says.
    const standing = await section('Subscription')
    expect(within(standing).getByText('Trial')).toBeInTheDocument()
    expect(
      screen.getByText(
        'You are back from confirming with your bank. This page shows the subscription as the payment processor reports it, which can take a moment after a payment is confirmed.',
      ),
    ).toBeInTheDocument()
  })

  it('reads the subscription again for a while, and draws what the processor then says', async () => {
    const server = createServer()
    server.subscription = trial()
    await read(server, back)
    const standing = await section('Subscription')
    expect(within(standing).getByText('Trial')).toBeInTheDocument()
    // The processor tells the server, a moment after the member is back.
    server.subscription = subscription()
    expect(await within(standing).findByText('Active')).toBeInTheDocument()
    // And no longer than a while: the reads stop.
    await waitFor(() => {
      expect(server.to(reading).length).toBeGreaterThanOrEqual(4)
    })
    const asked = server.to(reading).length
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(server.to(reading).length).toBeLessThanOrEqual(asked + 1)
  })

  it('says nothing of a return to a member who opened the address themself', async () => {
    await read()
    await section('Subscription')
    expect(screen.queryByText(/^You are back from confirming/)).not.toBeInTheDocument()
  })
})

// Kept for the fixtures' own sake: who the offer is between.
describe('the offer the tests stand on', () => {
  it('is Jana’s, to Miloš', () => {
    expect(offer.offered_by).toBe(janaPays)
    expect(offer.offered_to).toBe(milosRef)
    expect(janaPays.user_id).toBe(jana.id)
  })
})
