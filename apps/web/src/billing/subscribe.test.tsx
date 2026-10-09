// Subscribe (A-27) and the payment form it draws: what each reader sees, that nothing is asked
// of the server before its member presses, what the press asks and what the processor is handed,
// what paying comes to and how it is said, and every refusal, the processor's and the server's.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../app/paths.ts'
import { accountOf, adam, home, jana, milos, money, petr, problem } from '../household/testing.tsx'
import { loadProcessor } from './stripe.ts'
import {
  asOwner,
  at,
  createServer,
  createStandIn,
  intent,
  open,
  subscription,
  trial,
  type BillingServer,
  type StandIn,
} from './testing.tsx'

vi.mock('./stripe.ts', () => ({ loadProcessor: vi.fn(), leaveFor: vi.fn() }))

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

const address = inHousehold.subscribe(home)
const subscribing = `POST ${at}/subscription`
const reading = `GET ${at}/subscription`

const terms =
  '5 GB of storage is included. Above that, storage is added by itself in whole blocks of 10 GB, at EUR 1.00 a month each, counted from the month’s daily average and billed after the month ends. There are never more than 20 blocks.'

/** A household in its trial, which Jana pays for and has not subscribed. */
function inTrial(me = jana): BillingServer {
  const server = createServer(me)
  server.subscription = trial()
  return server
}

async function read(server: BillingServer = inTrial()) {
  const opened = open(address, server)
  await screen.findByRole('heading', { level: 1, name: 'Subscribe' })
  return opened
}

/** Chooses how often to pay, and presses on to the payment. */
async function toPayment(server: BillingServer, often: RegExp = /a year$/) {
  const opened = await read(server)
  await opened.user.click(await screen.findByRole('radio', { name: often }))
  await opened.user.click(screen.getByRole('button', { name: 'Continue to payment' }))
  return opened
}

/** The place the form stands in, which takes the focus the press gave up. */
const place = () => screen.getByRole('group', { name: 'Payment details' }).closest('[tabindex]')

describe('subscribing', () => {
  it('is titled for what it is, and says what storage adds beside the base fee', async () => {
    await read()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await waitFor(() => {
      expect(document.title).toBe('Subscribe · Household')
    })
    expect(
      screen.getByText('One price for the whole of Tilcerovi, however many people are in it.'),
    ).toBeInTheDocument()
    // An invoice is never the first time anybody learns the number (04 §8).
    expect(await screen.findByText(terms)).toBeInTheDocument()
    // The paid period starts at once, on a trial too (D-131).
    expect(
      screen.getByText(
        'The paid period starts when the payment goes through. What is left of the trial is not carried over.',
      ),
    ).toBeInTheDocument()
  })

  it('chooses nothing for its member, the year first, and offers no press until they have chosen', async () => {
    const server = inTrial()
    const { user } = await read(server)
    const choices = await screen.findAllByRole('radio')
    expect(choices.map((choice) => choice.closest('label')?.textContent)).toEqual([
      money('EUR 59.88 a year'),
      money('EUR 5.99 a month'),
    ])
    for (const choice of choices) expect(choice).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: money('EUR 59.88 a year') }))
    // A year's price by the month, where the currency divides it evenly.
    expect(screen.getByText('That comes to EUR 4.99 a month.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: money('EUR 5.99 a month') }))
    expect(screen.queryByText(/^That comes to/)).not.toBeInTheDocument()
    // Asking makes a customer and an unpaid subscription at the processor: not before a press.
    expect(server.to(subscribing)).toHaveLength(0)
    expect(loadProcessor).not.toHaveBeenCalled()
  })

  it('says nothing of a month where a year does not divide into twelve', async () => {
    const server = inTrial()
    server.subscription = trial({
      plans: [
        { interval: 'year', price: { amount_minor: 5990, currency: 'EUR' } },
        { interval: 'month', price: { amount_minor: 599, currency: 'EUR' } },
      ],
    })
    const { user } = await read(server)
    await user.click(await screen.findByRole('radio', { name: money('EUR 59.90 a year') }))
    expect(screen.queryByText(/^That comes to/)).not.toBeInTheDocument()
  })

  it('asks for the payment once pressed, and hands its secret to the processor’s form', async () => {
    const server = inTrial()
    server.on(subscribing, () => Response.json(intent('payment', 'pi_1_secret_2')))
    await toPayment(server)

    const pay = await screen.findByRole('button', { name: money('Pay EUR 59.88 for a year') })
    expect(server.to(subscribing)).toHaveLength(1)
    expect(await server.body(subscribing)).toEqual({ interval: 'year' })
    // The key is the server's, and the form speaks the app's language.
    expect(loadProcessor).toHaveBeenCalledExactlyOnceWith('pk_test_standin', 'en')
    expect(standIn.frames).toHaveLength(1)
    expect(standIn.frames[0]?.confirmed).toMatchObject({ secret: 'pi_1_secret_2', kind: 'payment' })
    expect(standIn.frames[0]?.node).toBeInstanceOf(HTMLDivElement)
    // The press gave its place to the form: the focus is where the form stands.
    expect(place()).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument()
    expect(pay).not.toHaveAttribute('aria-busy')
    // Card details never reach Household, and the form says so.
    expect(
      screen.getByText(
        'What you enter here goes straight to the payment processor, Stripe. Card details never reach Household.',
      ),
    ).toBeInTheDocument()
  })

  it('pays, asks the server again, and leads to billing once it says the household is subscribed', async () => {
    const server = inTrial()
    let asked = 0
    server.on(subscribing, () => {
      asked += 1
      if (asked === 1) return Response.json(intent('payment'))
      // The server read the processor itself, and settled the household.
      server.subscription = subscription()
      return problem(409, 'already_subscribed')
    })
    const { user, router } = await toPayment(server)
    const read = server.to(reading).length
    await user.click(await screen.findByRole('button', { name: money('Pay EUR 59.88 for a year') }))

    expect(
      await screen.findByText('Tilcerovi is subscribed. The payment went through.'),
    ).toBeInTheDocument()
    // The processor was told where to send a member it takes away: billing's own address.
    expect(standIn.frames[0]?.returnsTo).toEqual([
      new URL(inHousehold.billing(home), window.location.origin).href,
    ])
    expect(server.to(subscribing)).toHaveLength(2)
    expect(await server.body(subscribing)).toEqual({ interval: 'year' })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.billing(home))
    })
    await waitFor(() => {
      expect(server.to(reading).length).toBeGreaterThan(read)
    })
  })

  it('says a payment is on its way where the server answers a secret again, and keeps none of it', async () => {
    const server = inTrial()
    server.on(subscribing, () => Response.json(intent('payment')))
    const { user, router } = await toPayment(server, /a month$/)
    await user.click(await screen.findByRole('button', { name: money('Pay EUR 5.99 for a month') }))
    expect(
      await screen.findByText(
        'The payment was sent to the payment processor. Tilcerovi is subscribed once the processor says it went through, and billing shows how it stands.',
      ),
    ).toBeInTheDocument()
    expect(server.to(subscribing)).toHaveLength(2)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.billing(home))
    })
    // The second secret was for no form.
    expect(standIn.frames).toHaveLength(1)
  })

  it('says the same where asking again could not reach the server: the processor has the payment', async () => {
    const server = inTrial()
    let asked = 0
    server.on(subscribing, () => {
      asked += 1
      return asked === 1
        ? Response.json(intent('payment'))
        : Promise.reject(new TypeError('offline'))
    })
    const { user, router } = await toPayment(server)
    await user.click(await screen.findByRole('button', { name: money('Pay EUR 59.88 for a year') }))
    expect(
      await screen.findByText(/^The payment was sent to the payment processor\./),
    ).toBeVisible()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.billing(home))
    })
  })

  it('takes a household found subscribed at the first press for no error, and leads to billing', async () => {
    const server = inTrial()
    server.on(subscribing, () => problem(409, 'already_subscribed'))
    const { router } = await toPayment(server)
    expect(
      await screen.findByText(
        'Tilcerovi has a subscription already, or a payment for one is on its way. Billing shows how it stands.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.billing(home))
    })
    expect(standIn.frames).toHaveLength(0)
  })

  it('puts the form away, its secret with it, when the way of paying is changed under it', async () => {
    const server = inTrial()
    let asked = 0
    server.on(subscribing, () => {
      asked += 1
      return Response.json(intent('payment', `secret_${String(asked)}`))
    })
    const { user } = await toPayment(server)
    await screen.findByRole('button', { name: money('Pay EUR 59.88 for a year') })

    await user.click(screen.getByRole('radio', { name: money('EUR 5.99 a month') }))
    expect(standIn.frames[0]?.destroyed).toBe(true)
    expect(screen.queryByRole('group', { name: 'Payment details' })).not.toBeInTheDocument()
    // The press is there again, for the way now chosen.
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))
    expect(
      await screen.findByRole('button', { name: money('Pay EUR 5.99 for a month') }),
    ).toBeVisible()
    expect(await server.body(subscribing)).toEqual({ interval: 'month' })
    expect(standIn.frames[1]?.confirmed).toMatchObject({ secret: 'secret_2' })
  })

  it('drops an answer for a way of paying that was changed while it was on its way', async () => {
    const server = inTrial()
    let answer: (response: Response) => void = () => undefined
    server.on(
      subscribing,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    const { user } = await toPayment(server)
    const press = screen.getByRole('button', { name: 'Continue to payment' })
    expect(press).toHaveAttribute('aria-busy', 'true')
    await user.click(screen.getByRole('radio', { name: money('EUR 5.99 a month') }))
    await act(async () => {
      answer(Response.json(intent('payment')))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue to payment' })).not.toHaveAttribute(
        'aria-busy',
      )
    })
    // What came was for a subscription nobody wants: no form is drawn for it.
    expect(standIn.frames).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Payment details' })).not.toBeInTheDocument()
  })

  it('says a household that takes no writes takes them again once it is paid for', async () => {
    const server = inTrial()
    server.subscription = trial({
      state: 'read_only',
      trial_ends_at: null,
      data_retained_until: '2027-10-09T10:00:00Z',
    })
    await read(server)
    expect(
      await screen.findByText(
        'The paid period starts when the payment goes through. Tilcerovi then takes changes again, and the date it would have been deleted on is cleared.',
      ),
    ).toBeInTheDocument()
  })
})

describe('a press that the server refuses', () => {
  it('draws the block of an unverified address where the press was, and asks again for nothing', async () => {
    const server = inTrial({ ...jana, email_verified: false })
    server.on(subscribing, () => problem(403, 'account_unverified'))
    await toPayment(server)
    // Said politely: the block is drawn first, and its words a moment after.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^Verify your email first/)
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Subscribing waits for a verified address: it is where the invoices are sent.',
    )
    // In the control's place: no press that could only be refused again.
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument()
    expect(server.to(subscribing)).toHaveLength(1)
  })

  it('says who pays now where its member pays no longer, and reads the household again', async () => {
    const server = inTrial()
    server.on(subscribing, () => problem(403, 'forbidden'))
    const { user } = await read(server)
    await user.click(await screen.findByRole('radio', { name: money('EUR 59.88 a year') }))
    const before = server.to(reading).length
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only whoever pays for the household can do that, and that is not you now. Nothing was changed. The page shows who pays.',
    )
    await waitFor(() => {
      expect(server.to(reading).length).toBeGreaterThan(before)
    })
  })

  it('says the processor cannot be asked, that nothing was charged, and keeps the press', async () => {
    const server = inTrial()
    server.on(subscribing, () => problem(503, 'billing_unavailable'))
    await toPayment(server)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The payment processor can’t be asked right now. Nothing was charged and nothing was changed. Try again in a little while.',
    )
    const press = screen.getByRole('button', { name: 'Continue to payment' })
    expect(press).not.toHaveAttribute('aria-busy')
    expect(press).toHaveFocus()
  })

  it('is asked at once with no connection, says so, and is sent by nothing when one returns', async () => {
    const server = inTrial()
    server.on(subscribing, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    await user.click(await screen.findByRole('radio', { name: money('EUR 59.88 a year') }))
    onlineManager.setOnline(false)
    try {
      await user.click(screen.getByRole('button', { name: 'Continue to payment' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    } finally {
      onlineManager.setOnline(true)
    }
    expect(server.to(subscribing)).toHaveLength(1)
  })
})

describe('the payment form', () => {
  async function drawn(kind = 'card_error') {
    const server = inTrial()
    server.on(subscribing, () => Response.json(intent('payment')))
    const opened = await toPayment(server)
    const pay = await screen.findByRole('button', { name: money('Pay EUR 59.88 for a year') })
    standIn.answer = () => Promise.resolve({ error: { type: kind } })
    return { ...opened, pay }
  }

  it('offers no press until the processor’s frame takes input, and draws its shape meanwhile', async () => {
    standIn.readies = false
    const server = inTrial()
    server.on(subscribing, () => Response.json(intent('payment')))
    await toPayment(server)
    const form = await screen.findByRole('group', { name: 'Payment details' })
    expect(within(form).getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    await waitFor(() => {
      expect(standIn.frames).toHaveLength(1)
    })
    expect(screen.queryByRole('button', { name: /^Pay / })).not.toBeInTheDocument()
    act(() => {
      standIn.frames[0]?.ready()
    })
    expect(
      screen.getByRole('button', { name: money('Pay EUR 59.88 for a year') }),
    ).toBeInTheDocument()
    expect(within(form).queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })

  it('says a method that was not accepted charged nothing, in the app’s words, and asks the server nothing', async () => {
    const { user, pay, server } = await drawn('card_error')
    await user.click(pay)
    const said = await screen.findByRole('alert')
    expect(said).toHaveTextContent(
      'The payment method was not accepted, and nothing was charged. Check the details, or use another method.',
    )
    expect(said).toHaveTextContent('Tilcerovi is as it was.')
    // The press is there to be pressed again, and holds the focus it had.
    expect(pay).not.toHaveAttribute('aria-busy')
    expect(pay).toHaveFocus()
    expect(server.to(subscribing)).toHaveLength(1)
  })

  it('says the form marks what is missing where it is not filled in', async () => {
    const { user, pay } = await drawn('validation_error')
    await user.click(pay)
    const said = await screen.findByRole('alert')
    expect(said).toHaveTextContent(
      /^The payment form is not complete yet\. It marks what is missing\.$/,
    )
  })

  it('says of any other refusal, and of the script’s own failure, that nothing was charged', async () => {
    const { user, pay } = await drawn('api_connection_error')
    await user.click(pay)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That could not be confirmed with the payment processor, and nothing was charged. Try again.',
    )
    standIn.answer = () => Promise.reject(new Error('the script threw'))
    await user.click(pay)
    await waitFor(() => {
      expect(standIn.frames[0]?.returnsTo).toHaveLength(2)
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That could not be confirmed with the payment processor, and nothing was charged. Try again.',
    )
  })

  it('is asked at once with no connection, and is confirmed by nothing later', async () => {
    const { user, pay } = await drawn('api_connection_error')
    onlineManager.setOnline(false)
    try {
      await user.click(pay)
      expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was charged/)
    } finally {
      onlineManager.setOnline(true)
    }
    expect(standIn.frames[0]?.returnsTo).toHaveLength(1)
  })

  it('says the form could not be loaded where the script did not come, and loads it again', async () => {
    vi.mocked(loadProcessor).mockImplementationOnce(() =>
      Promise.reject(new Error('Failed to load Stripe.js')),
    )
    const server = inTrial()
    server.on(subscribing, () => Response.json(intent('payment')))
    const { user } = await toPayment(server)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The payment form could not be loaded, so nothing was sent and nothing was charged. Check your connection and try again.',
    )
    expect(screen.queryByRole('button', { name: /^Pay / })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('button', { name: money('Pay EUR 59.88 for a year') }),
    ).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The same secret: the server was not asked for another.
    expect(server.to(subscribing)).toHaveLength(1)
  })

  it('says the same where the frame itself could not be drawn', async () => {
    standIn.readies = false
    const server = inTrial()
    server.on(subscribing, () => Response.json(intent('payment')))
    await toPayment(server)
    await waitFor(() => {
      expect(standIn.frames).toHaveLength(1)
    })
    act(() => {
      standIn.frames[0]?.failed()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^The payment form could not be loaded/,
    )
  })

  it('takes the page’s look again when the display modes change under it', async () => {
    await drawn()
    expect(standIn.frames[0]?.restyled).toEqual([])
    document.documentElement.setAttribute('data-theme', 'dark')
    await waitFor(() => {
      expect(standIn.frames[0]?.restyled).toHaveLength(1)
    })
  })

  it('is taken out of the page with its screen', async () => {
    const { unmount } = await drawn()
    expect(standIn.frames[0]?.destroyed).toBe(false)
    unmount()
    expect(standIn.frames[0]?.destroyed).toBe(true)
  })
})

describe('who subscribes', () => {
  it('tells an owner who does not pay what the plan costs, and whose it is to subscribe', async () => {
    const server = asOwner(milos)
    server.subscription = trial()
    await read(server)
    expect(await screen.findByText('EUR 59.88 a year')).toBeInTheDocument()
    expect(screen.getByText('That comes to EUR 4.99 a month.')).toBeInTheDocument()
    expect(screen.getByText('EUR 5.99 a month')).toBeInTheDocument()
    expect(screen.getByText(terms)).toBeInTheDocument()
    expect(
      screen.getByText('Jana Tilcerová pays for the household, so subscribing is theirs to do.'),
    ).toBeInTheDocument()
    // Nothing to choose and nothing to press.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const whose = screen.getByRole('region', { name: 'Who pays' })
    expect(within(whose).getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'href',
      inHousehold.billing(home),
    )
  })

  it('tells a household that is subscribed that it is, and leads to billing', async () => {
    const server = createServer()
    await read(server)
    const already = await screen.findByRole('region', { name: 'Already subscribed' })
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(within(already).getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'href',
      inHousehold.billing(home),
    )
  })

  it('tells a household whose payment is on its way that it is', async () => {
    const server = inTrial()
    server.subscription = trial({ payment_pending: true })
    await read(server)
    expect(
      await screen.findByRole('heading', { level: 2, name: 'A payment is on its way' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'A payment for a subscription is on its way. A bank debit takes some days to clear, and until the payment processor says how it went the household stays as it is.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it.each([
    ['a member', petr],
    ['a child profile', adam],
  ])('is no part of the app of %s, and asks the server nothing', async (_who, user) => {
    const server = createServer(accountOf(user))
    open(address, server)
    expect(await screen.findByText('This link doesn’t open anything here.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Subscribe' })).not.toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(0)
  })
})

describe('the plan’s read', () => {
  it('draws the plan’s shape while it is read', async () => {
    const server = inTrial()
    server.on(reading, () => new Promise<Response>(() => undefined))
    await read(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('says the plan could not be read and that nothing was charged, and reads it again', async () => {
    const server = inTrial()
    server.on(reading, () => Promise.reject(new TypeError('offline')))
    const { user } = await read(server)
    expect(await screen.findByText('The plan could not be read')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Nothing was charged and nothing has changed. Check your connection and try again.',
      ),
    ).toBeInTheDocument()
    server.on(reading, () => Response.json(server.subscription))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('radio', { name: money('EUR 59.88 a year') }),
    ).toBeInTheDocument()
  })

  // A read that waits for a connection is no read under way: nothing is kept, and it is said.
  it('says a plan it cannot ask for could not be read, and draws no skeleton', async () => {
    const server = inTrial()
    let gone = false
    server.on(`GET /households/${home}`, () => {
      if (!gone) onlineManager.setOnline(false)
      gone = true
      return Response.json(server.household)
    })
    await read(server)
    expect(await screen.findByText('The plan could not be read')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(0)
  })
})
