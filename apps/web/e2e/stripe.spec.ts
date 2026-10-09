// The app's policy against the payment processor's own script (plan item 27; build/csp.ts): that
// Stripe.js, fetched from Stripe, loads and mounts its frame on a page of the app with no
// violation, and that the page then asks nothing of any origin the policy does not name for the
// processor. Every other test pays in the suite's stand-in for Stripe.js (stripe.js), which is
// served at Stripe's address and says nothing of what Stripe's script itself needs.
//
// It is no gate and no part of the suite's run: it reaches js.stripe.com, which a run of the
// suite never does, so it runs only where `HOUSEHOLD_E2E_STRIPE_JS` asks for it, as the
// server's tests of the converter and of what billing sends Stripe run only where their
// variable names a service. The API it runs against is the suite's, which pays against the
// stand-in for Stripe's server: the key the page is handed opens nothing at Stripe, so the real
// script fetches itself, draws its frames, asks Stripe for the form, and then says that the
// form could not be loaded. What is asserted is what the policy let through on the way there.
// A payment in Stripe's own test mode is staging's (docs/runbooks/billing.md).
import type { Request } from '@playwright/test'
import { previewOrigin } from '../build/preview.ts'
import { processor } from '../build/csp.ts'
import { inHousehold } from '../src/app/paths.ts'
import { expect, open, test } from './fixtures.ts'
import { money, owner, paymentForm, priceOf, subscriptionOf } from './screens.ts'

test.skip(
  process.env.HOUSEHOLD_E2E_STRIPE_JS === undefined,
  'reaches js.stripe.com: asked for with HOUSEHOLD_E2E_STRIPE_JS=1',
)
test.use({ processorScript: 'stripe' })

/**
 * A secret of the form Stripe's script takes, `{id}_secret_{secret}`, and of nothing at Stripe.
 * The stand-in's own are of another form, which the real script refuses before it draws
 * anything; with this one it goes on to make its element, and is refused by Stripe for its key.
 */
const wellFormed = 'pi_1_secret_2'

/** Whether `origin` is one a directive's `sources` admit, a `*.` standing for any name under it. */
function admitted(origin: string, sources: readonly string[]): boolean {
  return sources.some((source) => {
    const [scheme = '', host = ''] = source.split('://')
    const asked = new URL(origin)
    if (asked.protocol !== `${scheme}:`) return false
    return host.startsWith('*.') ? asked.hostname.endsWith(host.slice(1)) : asked.hostname === host
  })
}

test('Stripe’s own script loads and mounts its frame under the app’s policy, and the page asks no other origin', async ({
  page,
  faults,
}) => {
  const { household } = await owner(page)
  const plan = await subscriptionOf(page, household)
  const asked: Request[] = []
  page.on('request', (request) => asked.push(request))
  // What the API hands the page for the form is the stand-in's, but for the secret's form.
  await page.route(`**/households/${household}/billing/subscription`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    const intent = (await response.json()) as Readonly<Record<string, unknown>>
    return route.fulfill({ response, json: { ...intent, client_secret: wellFormed } })
  })
  await open(page, inHousehold.subscribe(household))
  await page.getByRole('radio', { name: `${money(priceOf(plan, 'year'))} a year` }).check()
  const fetched = page.waitForResponse(
    (response) => new URL(response.url()).origin === 'https://js.stripe.com',
  )
  await page.getByRole('button', { name: 'Continue to payment' }).click()

  // The script came from Stripe and ran: the policy's `script-src` admitted it.
  expect((await fetched).ok()).toBe(true)
  await expect.poll(() => page.evaluate(() => 'Stripe' in window)).toBe(true)
  // And a frame of Stripe's is a document in the page: `frame-src` admitted it.
  await expect
    .poll(() =>
      page
        .frames()
        .filter((frame) => frame.parentFrame() === page.mainFrame())
        .map((frame) => frame.url().split('/').slice(0, 3).join('/')),
    )
    .toContain('https://js.stripe.com')
  // The stand-in's key opens nothing at Stripe: the form says, in the app's words, that it
  // could not be loaded, which is the element's own word for it.
  await expect(paymentForm(page).getByRole('alert')).toContainText(
    'The payment form could not be loaded',
  )

  // Nothing the page did was refused by its policy.
  expect(faults.filter((fault) => fault.startsWith('Content-Security-Policy:'))).toEqual([])
  // And beside its own origin and the sync service's, on the loopback as the page is, the page
  // itself asked only the processor's: each kind of request at an origin its directive names.
  const others = asked
    .filter(
      (request) =>
        request.frame() === page.mainFrame() ||
        (request.isNavigationRequest() && request.frame().parentFrame() === page.mainFrame()),
    )
    .map((request) => ({
      origin: new URL(request.url()).origin,
      kind: request.isNavigationRequest() ? 'frame' : request.resourceType(),
    }))
    .filter(({ origin }) => new URL(origin).hostname !== new URL(previewOrigin).hostname)
  const refused = others.filter(({ origin, kind }) =>
    kind === 'frame'
      ? !admitted(origin, processor.frame)
      : kind === 'script'
        ? !admitted(origin, processor.script)
        : !admitted(origin, processor.connect),
  )
  expect(refused).toEqual([])
  expect(others.map(({ origin }) => origin)).toContain('https://js.stripe.com')
  // What Stripe's script says on the console of a key it does not know is its own to say.
  faults.length = 0
})
