// A stand-in for Stripe.js, for the end-to-end suite alone. The suite never reaches Stripe: where
// a page asks for the processor's script (`https://js.stripe.com/…`, which the app's loader adds
// when a payment form is first drawn, src/billing/stripe.ts), the suite answers with this file
// (fixtures.ts), under the app's policy as it is written.
//
// It is only what the app calls: `Stripe(key, { locale })`, `stripe.elements`, the payment
// element's `on`, `mount` and `destroy`, `elements.update`, and `stripe.confirmPayment` and
// `stripe.confirmSetup`. A confirmation asks the processor's API, at the origin the policy admits
// for it, which the suite answers from the stand-in for Stripe's server
// (server/cmd/stripe-standin, `POST /_standin/confirm`), and resolves as Stripe.js does: a
// payment or a setup with its status, or an `error`, and never a rejection.
//
// What the mounted element draws is its own: one list by which a test says how the customer
// pays, a card that is accepted, one that is declined, or a bank debit. It stands in for none of
// what makes the real form the processor's: Stripe's own frame, which no page reads into, its
// validation of what is typed, its wallets, and a bank's challenge (3-D Secure) drawn over the
// page. Those are Stripe's to test, and staging's (docs/runbooks/billing.md).
/* global document, fetch, setTimeout, URLSearchParams, window */
;(() => {
  /** Where a confirmation is asked: the processor's API, as the policy's `connect-src` names it. */
  const confirmAt = 'https://api.stripe.com/v1/standin/confirm'

  /** How a customer may pay, as the stand-in for Stripe's server names each. */
  const ways = [
    ['card', 'Card'],
    ['declined_card', 'Declined card'],
    ['debit', 'Bank debit'],
  ]

  /** How many elements this page has mounted: each list has an id of its own. */
  let mounted = 0

  /**
   * Asks for `secret` to be confirmed, paid by `way`, as the `kind` of confirmation it is for:
   * a `payment` or a `setup`. An answer that is no `200` is the stand-in's own refusal, a secret
   * it never handed out, and one that never came is a connection that failed: Stripe.js
   * resolves with an error for each.
   */
  async function ask(kind, secret, way) {
    let response
    try {
      // Sent as a form, as Stripe.js sends: a request the browser asks nobody's leave for.
      response = await fetch(confirmAt, {
        method: 'POST',
        body: new URLSearchParams({ client_secret: secret, with: way }),
      })
    } catch {
      return { error: { type: 'api_connection_error' } }
    }
    const answer = await response.json()
    if (!response.ok) return { error: { type: 'invalid_request_error' } }
    if (answer.error !== undefined) return { error: answer.error }
    // The secret of a setup handed to `confirmPayment`, or the other way about.
    if (answer.intent !== kind) return { error: { type: 'invalid_request_error' } }
    return kind === 'payment'
      ? { paymentIntent: { status: answer.status } }
      : { setupIntent: { status: answer.status } }
  }

  function Stripe() {
    return {
      elements: ({ clientSecret }) => {
        const label = document.createElement('label')
        const list = document.createElement('select')
        const heard = {}
        let drawn = false
        const elements = {
          create: () => ({
            on: (event, listener) => {
              heard[event] = listener
            },
            mount: (node) => {
              mounted += 1
              list.id = `stripe-standin-${String(mounted)}`
              // Every way is shown at once: a list of its rows, and a target of their height.
              list.size = ways.length
              for (const [value, text] of ways) list.append(new window.Option(text, value))
              list.value = 'card'
              label.htmlFor = list.id
              label.textContent = 'Pay by'
              node.append(label, list)
              drawn = true
              // The real element says it is ready a moment after it is mounted, never during.
              setTimeout(() => {
                if (drawn) heard.ready?.()
              }, 0)
            },
            destroy: () => {
              drawn = false
              label.remove()
              list.remove()
            },
          }),
          // The look is the frame's, and the stand-in draws no frame: taken, and nothing done.
          update: () => Promise.resolve(),
          /** What the stand-in keeps of a form, for the confirmation that names its `elements`. */
          standIn: { secret: clientSecret, way: () => list.value },
        }
        return elements
      },
      confirmPayment: ({ elements }) =>
        ask('payment', elements.standIn.secret, elements.standIn.way()),
      confirmSetup: ({ elements }) => ask('setup', elements.standIn.secret, elements.standIn.way()),
    }
  }
  // The release the app's loader was built for, which it holds a test key's script to.
  Stripe.version = 'dahlia'
  window.Stripe = Stripe
})()
