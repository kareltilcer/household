// Take over billing (A-29): what the owner an offer was made to reads of it, what accepting and
// declining ask of the server and say afterwards, that billing is said to have moved only once
// the subscription read names its reader as the payer, and what everybody else is told.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../app/paths.ts'
import { accountOf, adam, home, milos, noContent, petr, problem } from '../household/testing.tsx'
import { loadProcessor } from './stripe.ts'
import {
  asOwner,
  at,
  createServer,
  createStandIn,
  intent,
  milosRef,
  money,
  offer,
  open,
  subscription,
  trial,
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
})

// A test that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const address = inHousehold.takeover(home)
const reading = `GET ${at}/subscription`
const accepting = `POST ${at}/transfer/accept`
const declining = `DELETE ${at}/transfer`

/** Miloš, an owner beside Jana, with her offer of billing open to him. */
function offered(more: Parameters<typeof accountOf>[1] = {}): BillingServer {
  const server = asOwner(milos)
  server.me = accountOf(milos, more)
  server.subscription = subscription({ payment_method: null, transfer: offer })
  return server
}

async function read(server: BillingServer = offered()) {
  const opened = open(address, server)
  await screen.findByRole('heading', { level: 1, name: 'Take over billing' })
  return opened
}

const section = (name: string) => screen.findByRole('region', { name })
const valueOf = (region: HTMLElement, label: string) =>
  within(region).getByText(label).nextElementSibling
/** The screen's own place: where the focus goes once the presses have left. */
const view = () => screen.getByRole('heading', { level: 1 }).closest('div')?.nextElementSibling

const with_card =
  'Your own subscription starts when the period already paid for ends, so nobody pays for the same days twice. Until your payment method is confirmed, Jana Tilcerová goes on paying, and nothing lapses in between.'

describe('an offer of billing, as the owner it was made to reads it', () => {
  it('is titled for what it is, and says who offers, until when, what it costs and from when', async () => {
    const server = offered()
    await read(server)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await waitFor(() => {
      expect(document.title).toBe('Take over billing · Household')
    })
    const said = await section('Jana Tilcerová has offered you billing')
    expect(valueOf(said, 'Offered by')).toHaveTextContent('Jana Tilcerová')
    expect(valueOf(said, 'Offered on')).toHaveTextContent('Sep 9, 2026')
    expect(valueOf(said, 'Lapses on')).toHaveTextContent('Sep 23, 2026')
    expect(valueOf(said, 'What you would pay')).toHaveTextContent('EUR 59.88 a year')
    // Their own subscription starts when the paid period ends: nobody pays for a day twice.
    expect(valueOf(said, 'Your subscription starts')).toHaveTextContent('Mar 2, 2027')
    expect(within(said).getByText(with_card)).toBeInTheDocument()
    expect(within(said).getByText(/^5 GB of storage is included\./)).toBeInTheDocument()
    expect(
      within(said).getByText(
        'If you decline, Jana Tilcerová goes on paying and is told. If you do nothing, the offer lapses.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Take over billing',
      'Decline',
    ])
    // Accepting makes a setup at the processor: nothing is asked before the press.
    expect(server.to(accepting)).toHaveLength(0)
    expect(loadProcessor).not.toHaveBeenCalled()
  })

  it('says no card is asked for where the household has no subscription', async () => {
    const server = offered()
    server.subscription = trial({ transfer: offer })
    await read(server)
    const said = await section('Jana Tilcerová has offered you billing')
    expect(valueOf(said, 'What you would pay')).toHaveTextContent('No subscription')
    expect(within(said).queryByText('Your subscription starts')).not.toBeInTheDocument()
    expect(
      within(said).getByText(
        'Tilcerovi has no subscription now, so no card is asked for. You pay for it from the moment you accept, and subscribing is then yours to do.',
      ),
    ).toBeInTheDocument()
    expect(within(said).queryByText(with_card)).not.toBeInTheDocument()
  })
})

describe('accepting an offer', () => {
  /** Accepts, where the household has a subscription: the form is drawn, and is ready. */
  async function accepted(server: BillingServer = offered()) {
    server.on(accepting, () =>
      Response.json({
        subscription: server.subscription,
        confirmation: intent('setup', 'seti_1_secret_2'),
      }),
    )
    const opened = await read(server)
    await opened.user.click(await screen.findByRole('button', { name: 'Take over billing' }))
    const confirm = await screen.findByRole('button', { name: 'Confirm and take over billing' })
    return { ...opened, confirm }
  }

  it('asks for what their payment method is confirmed with, and draws the processor’s form', async () => {
    const server = offered()
    await accepted(server)
    const [sent] = server.to(accepting)
    expect(server.to(accepting)).toHaveLength(1)
    expect(await sent?.text()).toBe('')
    expect(standIn.frames[0]?.confirmed).toMatchObject({ secret: 'seti_1_secret_2', kind: 'setup' })
    // The two presses gave their place to the form, and the focus is where it stands.
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Payment details' }).closest('[tabindex]'),
    ).toHaveFocus()
    // Nothing has moved: the offer is still said, and no toast says otherwise.
    expect(await section('Jana Tilcerová has offered you billing')).toBeInTheDocument()
    expect(screen.queryByText(/^You pay for Tilcerovi now/)).not.toBeInTheDocument()
  })

  it('says billing has moved once the subscription names its reader as the payer, and leads to billing', async () => {
    const server = offered()
    const { user, router, confirm } = await accepted(server)
    await user.click(confirm)
    const waiting = await section('Waiting for the payment processor')
    const status = within(waiting).getByRole('status')
    expect(status).toHaveTextContent(
      'The payment processor is confirming your payment method. Billing moves to you once it has.',
    )
    // The form is put away, its secret with it; billing is said to have moved by nothing yet.
    expect(standIn.frames[0]?.destroyed).toBe(true)
    expect(screen.queryByText(/^You pay for Tilcerovi now/)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(view()).toHaveFocus()
    })

    // The processor tells the server, and the next read names Miloš.
    server.subscription = subscription({ payer: milosRef, payment_method: null })
    expect(
      await screen.findByText('You pay for Tilcerovi now. Whoever paid before is told by email.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.billing(home))
    })
  })

  it('says the processor has not said yet where the reads run out, and who pays meanwhile', async () => {
    const server = offered()
    const { user, router, confirm } = await accepted(server)
    const before = server.to(reading).length
    await user.click(confirm)
    const waiting = await section('Waiting for the payment processor')
    await waitFor(() => {
      expect(within(waiting).getByRole('status')).toHaveTextContent(
        'The payment processor has not said yet that your payment method is confirmed. Until it has, Jana Tilcerová goes on paying. The billing page shows who pays.',
      )
    })
    expect(server.to(reading).length - before).toBeGreaterThanOrEqual(3)
    expect(within(waiting).getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'href',
      inHousehold.billing(home),
    )
    expect(router.state.location.pathname).toBe(address)
    expect(screen.queryByText(/^You pay for Tilcerovi now/)).not.toBeInTheDocument()
  })

  it('says a method that was not accepted moved nothing, and who still pays', async () => {
    const { user, confirm } = await accepted()
    standIn.answer = () => Promise.resolve({ error: { type: 'card_error' } })
    await user.click(confirm)
    const said = await screen.findByRole('alert')
    expect(said).toHaveTextContent(
      /^The payment method was not accepted, and nothing was charged\./,
    )
    expect(said).toHaveTextContent('Billing has not moved, and Jana Tilcerová still pays.')
    expect(screen.queryByRole('region', { name: 'Waiting for the payment processor' })).toBeNull()
  })

  it('puts the form away where they think better of it, and offers the two presses again', async () => {
    const { user } = await accepted()
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(standIn.frames[0]?.destroyed).toBe(true)
    expect(screen.getByRole('button', { name: 'Take over billing' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Decline' }).closest('[tabindex]')).toHaveFocus()
  })

  it('pays from the moment it is accepted where there is no subscription, and asks for no card', async () => {
    const server = offered()
    server.subscription = trial({ transfer: offer })
    server.on(accepting, () => {
      server.subscription = trial({ payer: milosRef })
      return Response.json({ subscription: server.subscription, confirmation: null })
    })
    const { user, router } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Take over billing' }))
    expect(
      await screen.findByText('You pay for Tilcerovi now. Whoever paid before is told by email.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.billing(home))
    })
    expect(standIn.frames).toHaveLength(0)
    expect(loadProcessor).not.toHaveBeenCalled()
  })

  it('draws the block of an unverified address where the press was', async () => {
    const server = offered({ email_verified: false })
    server.on(accepting, () => problem(403, 'account_unverified'))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Take over billing' }))
    // Said politely: the block is drawn first, and its words a moment after.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^Verify your email first/)
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Taking billing over waits for a verified address: it is where the invoices are sent.',
    )
    // In the controls' place: no press that could only be refused again.
    expect(screen.queryByRole('button', { name: 'Take over billing' })).not.toBeInTheDocument()
    expect(server.to(accepting)).toHaveLength(1)
  })

  it('says an offer that is open no longer is not, and reads how billing stands', async () => {
    const server = offered()
    server.on(accepting, () => problem(404, 'not_found'))
    const { user } = await read(server)
    const before = server.to(reading).length
    await user.click(await screen.findByRole('button', { name: 'Take over billing' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The offer is no longer open: it was taken back, or it lapsed. Nothing has changed, and the page shows how billing stands.',
    )
    await waitFor(() => {
      expect(server.to(reading).length).toBeGreaterThan(before)
    })
  })

  it('says the processor cannot be asked, and keeps the press', async () => {
    const server = offered()
    server.on(accepting, () => problem(503, 'billing_unavailable'))
    const { user } = await read(server)
    const press = await screen.findByRole('button', { name: 'Take over billing' })
    await user.click(press)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^The payment processor can’t be asked right now\./,
    )
    expect(press).not.toHaveAttribute('aria-busy')
    expect(press).toHaveFocus()
  })

  it('is asked at once with no connection, says so, and is sent by nothing when one returns', async () => {
    const server = offered()
    server.on(accepting, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    const press = await screen.findByRole('button', { name: 'Take over billing' })
    onlineManager.setOnline(false)
    try {
      await user.click(press)
      expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    } finally {
      onlineManager.setOnline(true)
    }
    expect(server.to(accepting)).toHaveLength(1)
  })

  it('takes no press on the other control while its own write is on its way', async () => {
    const server = offered()
    server.on(accepting, () => new Promise<Response>(() => undefined))
    const { user } = await read(server)
    const accept = await screen.findByRole('button', { name: 'Take over billing' })
    const decline = screen.getByRole('button', { name: 'Decline' })
    await user.click(accept)
    expect(accept).toHaveAttribute('aria-busy', 'true')
    expect(decline).toHaveAttribute('aria-disabled', 'true')
    await user.click(decline)
    expect(server.to(declining)).toHaveLength(0)
  })
})

describe('declining an offer', () => {
  it('tells the payer, leaves the subscription as it is, and says where the focus goes', async () => {
    const server = offered()
    server.on(declining, () => {
      server.subscription = subscription({ payment_method: null })
      return noContent()
    })
    const { user, router } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    expect(
      await screen.findByText('You declined. Jana Tilcerová goes on paying, and is told.'),
    ).toBeInTheDocument()
    expect(server.to(declining)).toHaveLength(1)
    // The offer is gone, and the screen says how it stands now.
    const none = await section('No offer is waiting for you')
    expect(within(none).getByText('Jana Tilcerová pays for the household.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take over billing' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe(address)
    await waitFor(() => {
      expect(view()).toHaveFocus()
    })
  })

  it('says an offer that is open no longer is not, where the server refuses', async () => {
    const server = offered()
    server.on(declining, () => problem(403, 'forbidden'))
    const { user } = await read(server)
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^The offer is no longer open/)
  })

  it('says a decline could not reach the server, and keeps the offer', async () => {
    const server = offered()
    server.on(declining, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    const press = await screen.findByRole('button', { name: 'Decline' })
    await user.click(press)
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    expect(press).not.toHaveAttribute('aria-busy')
    expect(await section('Jana Tilcerová has offered you billing')).toBeInTheDocument()
  })
})

describe('everybody else who opens the address', () => {
  it('tells the payer there is nothing to take over from themself, and of the offer they made', async () => {
    const server = createServer()
    server.subscription = subscription({ transfer: offer })
    await read(server)
    const yours = await section('You pay already')
    expect(
      within(yours).getByText('You pay for Tilcerovi, so there is nothing to take over.'),
    ).toBeInTheDocument()
    expect(
      within(yours).getByText(
        'Billing has been offered to another owner: Miloš Tilcer. It moves once they accept.',
      ),
    ).toBeInTheDocument()
    expect(within(yours).getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'href',
      inHousehold.billing(home),
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('tells an owner no offer is waiting for them, and who pays', async () => {
    const server = asOwner(petr)
    server.subscription = subscription({ payment_method: null, transfer: offer })
    await read(server)
    const none = await section('No offer is waiting for you')
    expect(within(none).getByText('Jana Tilcerová pays for the household.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    ['a member', petr],
    ['a child profile', adam],
  ])('is no part of the app of %s, and asks the server nothing', async (_who, user) => {
    const server = createServer(accountOf(user))
    open(address, server)
    expect(await screen.findByText('This link doesn’t open anything here.')).toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(0)
  })
})

describe('the offer’s read', () => {
  it('draws its shape while it is read', async () => {
    const server = offered()
    server.on(reading, () => new Promise<Response>(() => undefined))
    await read(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('says the offer could not be read and that nothing has changed, and reads it again', async () => {
    const server = offered()
    server.on(reading, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    expect(await screen.findByText('The offer could not be read')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Nothing has changed: whoever pays goes on paying. Check your connection and try again.',
      ),
    ).toBeInTheDocument()
    server.on(reading, () => Response.json(server.subscription))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await section('Jana Tilcerová has offered you billing')).toBeInTheDocument()
  })

  // A read that waits for a connection is no read under way: nothing is kept, and it is said.
  it('says an offer it cannot ask for could not be read, and draws no skeleton', async () => {
    const server = offered()
    let gone = false
    server.on(`GET /households/${home}`, () => {
      if (!gone) onlineManager.setOnline(false)
      gone = true
      return Response.json(server.household)
    })
    await read(server)
    expect(await screen.findByText('The offer could not be read')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(0)
  })
})

// The price a control is named with is written as the page writes it.
describe('an amount in a control’s name', () => {
  it('holds the space that does not break', () => {
    expect(money('Pay EUR 59.88 for a year')).toBe('Pay EUR 59.88 for a year')
    expect(money('Jana pays')).toBe('Jana pays')
  })
})
