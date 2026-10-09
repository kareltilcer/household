// The payment processor's own script, Stripe.js, and the little of it the app calls (PRD 04 §6,
// D-131, PL-4). Card details are typed into the processor's form, in the processor's frame, and
// go from there to the processor: no part of them is this page's to read, and none reaches
// Household.
//
// Stripe.js is loaded from Stripe and is never bundled, which is the processor's own rule: the
// loader here (`@stripe/stripe-js/pure`) adds its `<script>` to the page when a payment form is
// first drawn, and no page that draws none fetches it. The policy admits it for that
// (build/csp.ts). No `@stripe/react-stripe-js`: one component mounts the element into a node it
// owns and takes it away (PaymentForm.tsx).
//
// Everything the app calls of Stripe.js is called in this file, with the options written out:
// `Stripe(key, { locale })`, `stripe.elements`, `elements.create('payment')`, the element's
// `on`, `mount` and `destroy`, `elements.update`, and `stripe.confirmPayment` or
// `stripe.confirmSetup`. The app is handed a `Processor`, which is those and no more, and of a
// confirmation's answer only the kind of its refusal: the processor's own sentence, and the
// payment or the setup it describes, go no further than here. This module is the seam: a
// screen's test replaces `loadProcessor`, this file's own test replaces the loader, and the
// end-to-end suite's stand-in for Stripe.js is written from the calls made here.
import type { Appearance, Stripe, StripeElementLocale } from '@stripe/stripe-js'
import { loadStripe } from '@stripe/stripe-js/pure'

export type { Appearance }

/** The languages the app is shown in, all of which the payment form speaks. */
export type FormLocale = Extract<StripeElementLocale, 'en' | 'cs' | 'sk' | 'de' | 'pl'>

/**
 * What a confirmation resolves with. With no `error` the processor took it: a payment went
 * through, or is on its way, or a method was saved. An `error` is read by its `type` alone:
 * `validation_error` where the form is not filled in, which the form marks itself,
 * `card_error` where the method was not accepted, and anything else.
 */
export interface Confirmation {
  readonly error?: { readonly type: string }
}

/** What a form confirms, as the server answered it (`BillingIntent`). */
export interface Confirmed {
  /** The secret of the payment or the setup: handed to the processor's script, and kept nowhere. */
  readonly secret: string
  /** A `payment` is charged as it is confirmed; a `setup` saves a method for later charges. */
  readonly kind: 'payment' | 'setup'
  /** How the form looks: the page's own tokens, as values (appearance.ts). */
  readonly appearance: Appearance
}

/** One payment form: the processor's Payment Element, in a frame of its own. */
export interface PaymentFrame {
  /**
   * Draws it inside `node`, which the page owns. `onReady` is told once it is drawn and takes
   * input, and `onLoadError` where it could not be.
   */
  readonly mount: (
    node: HTMLElement,
    heard: { readonly onReady: () => void; readonly onLoadError: () => void },
  ) => void
  /** Gives it another look, where the theme changed under it. */
  readonly restyle: (appearance: Appearance) => void
  /**
   * Confirms what it was made for with what was typed into it. The page is left only where the
   * method itself needs it, a bank's own page, which sends its customer back to `returnTo`.
   */
  readonly confirm: (returnTo: string) => Promise<Confirmation>
  /** Takes it out of the page, its frame and its listeners with it. */
  readonly destroy: () => void
}

export interface Processor {
  /** A payment form for `confirmed`: nothing is drawn until it is mounted. */
  readonly frame: (confirmed: Confirmed) => PaymentFrame
}

/** Stripe.js as the app calls it. */
function processorOver(stripe: Stripe): Processor {
  return {
    frame: ({ secret, kind, appearance }) => {
      const elements = stripe.elements({
        clientSecret: secret,
        appearance,
        // The page draws its own skeleton until the element says it is ready.
        loader: 'never',
      })
      const element = elements.create('payment')
      return {
        mount: (node, { onReady, onLoadError }) => {
          element.on('ready', onReady)
          element.on('loaderror', onLoadError)
          element.mount(node)
        },
        restyle: (next) => {
          // Where it could not be given the new look, it keeps the one it has.
          elements.update({ appearance: next }).catch(() => undefined)
        },
        confirm: async (returnTo) => {
          const options = {
            elements,
            confirmParams: { return_url: returnTo },
            redirect: 'if_required',
          } as const
          const { error } =
            kind === 'payment'
              ? await stripe.confirmPayment(options)
              : await stripe.confirmSetup(options)
          return error === undefined ? {} : { error: { type: error.type } }
        },
        destroy: () => {
          element.destroy()
        },
      }
    },
  }
}

/** Stripe.js for each key and language it was asked for, made once: a page holds one of each. */
const loaded = new Map<string, Promise<Processor>>()

/**
 * Stripe.js, made with `publishableKey` (`BillingIntent.publishable_key`) to speak `locale`. The
 * script is fetched by the first call and by no page before it. It rejects where the script
 * could not be fetched, and a later call fetches it again.
 */
export function loadProcessor(publishableKey: string, locale: FormLocale): Promise<Processor> {
  const key = `${locale} ${publishableKey}`
  const before = loaded.get(key)
  if (before !== undefined) return before
  const made = loadStripe(publishableKey, { locale }).then((stripe) => {
    // Null on a server, where there is no page to add a script to: never here.
    if (stripe === null) throw new Error('loadProcessor: Stripe.js needs a page')
    return processorOver(stripe)
  })
  loaded.set(key, made)
  made.catch(() => {
    loaded.delete(key)
  })
  return made
}

/**
 * Leaves the app for `address`, a file at the payment processor's: an invoice's PDF. Only an
 * address over TLS is followed, whatever answered with it. It answers whether it was. `go` is
 * how the page is left: the browser's own, unless a test says.
 */
export function leaveFor(
  address: string,
  go: (href: string) => void = (href) => {
    window.location.assign(href)
  },
): boolean {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  go(url.href)
  return true
}
