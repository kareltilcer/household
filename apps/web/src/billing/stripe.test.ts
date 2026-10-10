// What the app asks of Stripe.js, call by call (stripe.ts): the loader stands in for the
// script, which no test fetches, and answers an object that records what it is called with. The
// end-to-end suite's stand-in for Stripe.js is written from the same calls.
import type { Stripe } from '@stripe/stripe-js'
import { loadStripe } from '@stripe/stripe-js/pure'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { leaveFor, loadProcessor } from './stripe.ts'

vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: vi.fn() }))

const appearance = { theme: 'stripe', variables: { fontSizeBase: '18px' } } as const
/** Where the processor is told to send a member it takes away. */
const back = 'https://household.example/back'

/** Stripe.js, as far as the app calls it: every method records what it was called with. */
function script() {
  const element = { on: vi.fn(), mount: vi.fn(), destroy: vi.fn() }
  const elements = { create: vi.fn(() => element), update: vi.fn(() => Promise.resolve()) }
  const stripe = {
    elements: vi.fn(() => elements),
    confirmPayment: vi.fn(() => Promise.resolve({ paymentIntent: { id: 'pi_1' } })),
    confirmSetup: vi.fn(() => Promise.resolve({ setupIntent: { id: 'seti_1' } })),
  }
  return { stripe, elements, element }
}

/** Has the loader answer `stripe`: the stand-in is no `Stripe` but for what the app calls. */
function loads(stripe: unknown): void {
  vi.mocked(loadStripe).mockResolvedValue(stripe as Stripe)
}

// Each test asks with a key of its own: Stripe.js is made once for each key and language.
let asked = 0
let key = ''
beforeEach(() => {
  asked += 1
  key = `pk_test_${String(asked)}`
})

describe('Stripe.js, as the app loads it', () => {
  it('is made with the key the server answered and the app’s language, once for each', async () => {
    const { stripe } = script()
    loads(stripe)
    const first = await loadProcessor(key, 'cs')
    expect(loadStripe).toHaveBeenCalledExactlyOnceWith(key, { locale: 'cs' })
    expect(await loadProcessor(key, 'cs')).toBe(first)
    expect(loadStripe).toHaveBeenCalledTimes(1)
    await loadProcessor(key, 'de')
    expect(loadStripe).toHaveBeenLastCalledWith(key, { locale: 'de' })
    expect(loadStripe).toHaveBeenCalledTimes(2)
  })

  it('is asked for again once the script could not be fetched', async () => {
    vi.mocked(loadStripe).mockRejectedValue(new Error('Failed to load Stripe.js'))
    await expect(loadProcessor(key, 'en')).rejects.toThrow('Failed to load Stripe.js')
    loads(script().stripe)
    await expect(loadProcessor(key, 'en')).resolves.toBeDefined()
    expect(loadStripe).toHaveBeenCalledTimes(2)
  })

  it('is refused where there is no page to load it into', async () => {
    vi.mocked(loadStripe).mockResolvedValue(null)
    await expect(loadProcessor(key, 'en')).rejects.toThrow('needs a page')
  })
})

describe('a payment form', () => {
  it('is a Payment Element made for the secret, with the page’s look and no loader of its own', async () => {
    const { stripe, elements, element } = script()
    loads(stripe)
    const processor = await loadProcessor(key, 'en')
    const frame = processor.frame({ secret: 'pi_1_secret_2', kind: 'payment', appearance })
    expect(stripe.elements).toHaveBeenCalledExactlyOnceWith({
      clientSecret: 'pi_1_secret_2',
      appearance,
      loader: 'never',
    })
    expect(elements.create).toHaveBeenCalledExactlyOnceWith('payment')
    // Nothing is drawn until the page says where.
    expect(element.mount).not.toHaveBeenCalled()

    const node = document.createElement('div')
    const onReady = vi.fn()
    const onLoadError = vi.fn()
    frame.mount(node, { onReady, onLoadError })
    expect(element.on.mock.calls).toEqual([
      ['ready', onReady],
      ['loaderror', onLoadError],
    ])
    expect(element.mount).toHaveBeenCalledExactlyOnceWith(node)
  })

  it('confirms a payment with what was typed, and leaves the page only where the method needs it', async () => {
    const { stripe, elements } = script()
    loads(stripe)
    const frame = (await loadProcessor(key, 'en')).frame({
      secret: 'pi_1_secret_2',
      kind: 'payment',
      appearance,
    })
    await expect(frame.confirm(back)).resolves.toEqual({})
    expect(stripe.confirmPayment).toHaveBeenCalledExactlyOnceWith({
      elements,
      confirmParams: { return_url: back },
      redirect: 'if_required',
    })
    expect(stripe.confirmSetup).not.toHaveBeenCalled()
  })

  it('confirms a method that is set up for later charges as a setup', async () => {
    const { stripe, elements } = script()
    loads(stripe)
    const frame = (await loadProcessor(key, 'en')).frame({
      secret: 'seti_1_secret_2',
      kind: 'setup',
      appearance,
    })
    await expect(frame.confirm(back)).resolves.toEqual({})
    expect(stripe.confirmSetup).toHaveBeenCalledExactlyOnceWith({
      elements,
      confirmParams: { return_url: back },
      redirect: 'if_required',
    })
    expect(stripe.confirmPayment).not.toHaveBeenCalled()
  })

  it('hands on the kind of a refusal, and nothing of the processor’s own sentence', async () => {
    const { stripe } = script()
    stripe.confirmPayment.mockResolvedValue({
      error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' },
    } as never)
    loads(stripe)
    const frame = (await loadProcessor(key, 'en')).frame({
      secret: 'pi_1_secret_2',
      kind: 'payment',
      appearance,
    })
    await expect(frame.confirm(back)).resolves.toEqual({
      error: { type: 'card_error' },
    })
  })

  it('takes another look, keeps the one it has where that fails, and is taken away', async () => {
    const { stripe, elements, element } = script()
    loads(stripe)
    const frame = (await loadProcessor(key, 'en')).frame({
      secret: 'pi_1_secret_2',
      kind: 'payment',
      appearance,
    })
    const night = { theme: 'night' } as const
    frame.restyle(night)
    expect(elements.update).toHaveBeenCalledExactlyOnceWith({ appearance: night })
    elements.update.mockRejectedValue(new Error('no'))
    expect(() => {
      frame.restyle(night)
    }).not.toThrow()
    frame.destroy()
    expect(element.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('leaving for a file at the processor’s', () => {
  it('follows an address over TLS', () => {
    const go = vi.fn()
    expect(leaveFor('https://pay.stripe.com/invoice/acct_1/pdf?s=ap', go)).toBe(true)
    expect(go).toHaveBeenCalledExactlyOnceWith('https://pay.stripe.com/invoice/acct_1/pdf?s=ap')
  })

  it('follows nothing else, whatever answered with it', () => {
    const go = vi.fn()
    for (const address of [
      'http://pay.stripe.com/invoice.pdf',
      'javascript:alert(1)',
      'data:text/html,x',
      '/households',
      '',
    ]) {
      expect(leaveFor(address, go), address).toBe(false)
    }
    expect(go).not.toHaveBeenCalled()
  })
})
