// Billing in a real browser, against the API itself and the suite's stand-ins for Stripe (plan
// item 27; A-27 to A-30, A-35): the third of the product's critical paths, *subscribe → lapse →
// read-only → export* (PRD 06 §8), and beside it what billing's screens write and whom they are
// drawn for. Each screen a path passes is held to axe as it stands, and each write to what a
// member who cannot see the screen is given of it: where the focus is afterwards, and what was
// said.
//
// Nothing here reaches Stripe. The payment form's script is the suite's stand-in for Stripe.js
// (stripe.js, served by fixtures.ts where a page asks Stripe for it), which confirms with the
// stand-in for Stripe's server that the suite's API pays against (server/cmd/stripe-standin);
// and what Stripe does on its own, a renewal that fails, a debit that clears, a period that
// ends, is asked of that stand-in from Node (stack.ts, `processor`). No price is this file's:
// each is read from the subscription's own answer, as the screens read it.
//
// Every test makes its own people and its own household (screens.ts), and whoever is at the
// screen changes as it does for a member: by the account's own way out.
import type { Page } from '@playwright/test'
import { inHousehold } from '../src/app/paths.ts'
import { buildFile } from '../src/update/build.ts'
import { expect, expectAccessible, open, test } from './fixtures.ts'
import {
  above,
  dayOf,
  expectHolds,
  expectSaid,
  expectSurvives,
  home,
  money,
  owner,
  payBy,
  paymentForm,
  phone,
  priceOf,
  rows,
  section,
  settings,
  sidebar,
  signInAs,
  signOutHere,
  subscriptionOf,
  title,
  toasts,
  valueOf,
  type Owner,
} from './screens.ts'
import {
  call,
  createHousehold,
  join,
  linked,
  makeOwner,
  passGrace,
  person,
  processor,
  registerUnverified,
  signIn,
  signOut,
  standingOf,
  subscribeNow,
  trialEndsIn,
  type Person,
} from './stack.ts'

/** Whom the suite brings into a household beside its owner, named as its people are. */
const guest = 'Vít Ježek'

/** The card the stand-in for Stripe pays with, as billing's screen says a method. */
const card = 'Visa ending in 4242, expires 12/2030'

/** The bank account the stand-in debits, as billing's screen says a method. */
const debit = 'SEPA Direct Debit, account ending in 3000'

test('an owner subscribes, the subscription lapses, and the read-only household is exported', async ({
  page,
}) => {
  // One path through a dozen screens, each under axe, and a wait for the hourly job.
  test.slow()
  const { who, household } = await owner(page)
  const member = person(guest)
  await join(page, who, household, member)
  const plan = await subscriptionOf(page, household)
  const yearly = money(priceOf(plan, 'year'))
  const monthly = money(priceOf(plan, 'month'))

  // Billing, from the settings: a household in its trial, with no subscription, whose owner
  // pays for it.
  await open(page, inHousehold.settings(household))
  await settings(page).getByRole('link', { name: 'Billing' }).click()
  await expect(title(page, 'Billing')).toBeVisible()
  const subscription = section(page, 'Subscription')
  await expect(subscription).toContainText('Trial')
  await expect(valueOf(subscription, 'Plan')).toHaveText('No subscription')
  await expect(valueOf(subscription, 'Paid by')).toHaveText(`${who.name} (you)`)
  await expect(valueOf(subscription, 'Trial ends')).toHaveText(dayOf(plan.trial_ends_at ?? ''))
  await expectAccessible(page)

  // Subscribe: the one plan, what storage adds to it, and nothing chosen for its payer.
  await subscription.getByRole('link', { name: 'Subscribe' }).click()
  await expect(title(page, 'Subscribe')).toBeVisible()
  await expect(page).toHaveURL(inHousehold.subscribe(household))
  await expect(section(page, 'What is included')).toContainText(
    `at ${money(plan.price_per_storage_block)} a month each`,
  )
  const often = page.getByRole('group', { name: 'How often you pay' })
  await expect(often.getByRole('radio')).toHaveCount(2)
  await expect(often.getByRole('radio', { name: `${yearly} a year` })).not.toBeChecked()
  await expect(often.getByRole('radio', { name: `${monthly} a month` })).not.toBeChecked()
  // What follows from the choice is absent until it is made (D-172).
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0)
  await expect(
    page.getByText(
      'The paid period starts when the payment goes through. What is left of the trial is not carried over.',
    ),
  ).toBeVisible()
  await expectAccessible(page)
  await often.getByRole('radio', { name: `${yearly} a year` }).check()
  await page.getByRole('button', { name: 'Continue to payment' }).click()

  // The payment form, in the control's place: the processor's, with the press that pays.
  const form = paymentForm(page)
  const pay = form.getByRole('button', { name: `Pay ${yearly} for a year` })
  await expect(pay).toBeVisible()
  await expect(
    form.getByText('Card details never reach Household.', { exact: false }),
  ).toBeVisible()
  await expectAccessible(page)
  await payBy(page, 'card')
  await pay.click()

  // Paid, which is said, and on Billing the household is active, with what it is charged to.
  await expect(title(page, 'Billing')).toBeVisible()
  await expect(toasts(page)).toHaveText([`${home} is subscribed. The payment went through.`])
  await expect(page).toHaveURL(inHousehold.billing(household))
  const paid = await subscriptionOf(page, household)
  expect(paid.state).toBe('active')
  await expect(subscription).toContainText('Active')
  await expect(valueOf(subscription, 'Plan')).toHaveText(`${yearly} a year`)
  await expect(valueOf(subscription, 'Next charge')).toHaveText(
    dayOf(paid.current_period_end ?? ''),
  )
  await expect(section(page, 'Payment method')).toContainText(card)
  await expect(above(page)).toHaveCount(0)
  await expectAccessible(page)

  // The lapse begins: the renewal fails. Nothing is restricted, and the owners are told above
  // every screen.
  await processor(household, 'fail-payment')
  await page.goto(inHousehold.home(household))
  await expect(title(page, 'Home')).toBeVisible()
  await expect(above(page)).toContainText('The last payment didn’t go through')
  await expect(above(page)).toContainText(
    'Everything still works. If the payment keeps failing, new files can’t be added.',
  )
  await expect(above(page).getByRole('link', { name: 'Go to billing' })).toBeVisible()
  await expectAccessible(page)

  // A member is told nothing of a payment: the banner of a failed one is the owners'.
  await signOutHere(page)
  await signInAs(page, member)
  await expect(title(page, 'Home')).toBeVisible()
  await expect(sidebar(page)).toContainText('Member')
  expect((await standingOf(page, household)).state).toBe('past_due')
  await expect(above(page)).toHaveCount(0)

  // The processor gives up: uploads are paused, which every member is told, with the day the
  // household becomes read-only and whom to ask.
  await processor(household, 'give-up')
  const grace = await standingOf(page, household)
  expect(grace.state).toBe('grace')
  await page.reload()
  await expect(above(page)).toContainText('New files can’t be added for now')
  await expect(above(page)).toContainText(
    `If nothing changes, the household becomes read-only on ${dayOf(grace.grace_ends_at ?? '')}.`,
  )
  await expect(above(page)).toContainText(`Only an owner can change this: ${who.name}.`)
  await expect(above(page).getByRole('link')).toHaveCount(0)
  await expectAccessible(page)

  // The fourteen days pass, and the hourly job reads the clock: the household is read-only.
  await signOutHere(page)
  await passGrace(household)
  await signInAs(page, who)
  await expect(title(page, 'Home')).toBeVisible()
  const lapsed = await standingOf(page, household)
  expect(lapsed.state).toBe('read_only')
  await expect(above(page)).toContainText(`${home} is read-only`)
  await expect(above(page)).toContainText(
    'Everything can still be read. Nothing can be added or changed until the subscription is paid.',
  )
  await expect(above(page)).toContainText(
    `Its data is kept until ${dayOf(lapsed.data_retained_until ?? '')}, then deleted.`,
  )
  await expectAccessible(page)

  // The controls that write are absent, on the profile and among the members.
  await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
  await expect(title(page, 'Household')).toBeVisible()
  await expect(valueOf(page, 'Name')).toHaveText(home)
  await expect(page.getByRole('button', { name: 'Edit the household' })).toHaveCount(0)
  await expectAccessible(page)
  await settings(page).getByRole('link', { name: 'Members' }).click()
  await expect(title(page, 'Members')).toBeVisible()
  await expect(rows(page).filter({ hasText: member.name })).toContainText('Member')
  await expect(page.getByRole('link', { name: 'Invite somebody' })).toHaveCount(0)
  // And the ones the gate lets through are there: billing's, and the household's data.
  await settings(page).getByRole('link', { name: 'Billing' }).click()
  await expect(title(page, 'Billing')).toBeVisible()
  await expect(subscription).toContainText('Read-only')
  await expect(subscription.getByRole('link', { name: 'Subscribe' })).toBeVisible()
  await expectAccessible(page)
  await settings(page).getByRole('link', { name: 'Data' }).click()
  await expect(title(page, 'Data')).toBeVisible()
  await expect(page.getByRole('button', { name: `Stop all changes in ${home}` })).toBeVisible()
  await expect(page.getByRole('button', { name: `Delete ${home}` })).toBeVisible()
  await expect(
    page.getByText('Nobody can be made an owner while the household takes no changes.'),
  ).toBeVisible()
  await expectAccessible(page)

  // The export, from the banner: asked for, waiting, and then ready, with what is in it.
  await above(page).getByRole('link', { name: 'Export the household' }).click()
  await expect(title(page, 'Export the household')).toBeVisible()
  await expect(page).toHaveURL(inHousehold.exports(household))
  await expect(
    page.getByText('The household is read-only. An export is made and downloaded all the same.'),
  ).toBeVisible()
  await expect(page.getByText('No export yet.', { exact: false })).toBeVisible()
  await expectAccessible(page)
  // The list's read is held back for as long as the test says: the worker begins at once, and
  // an export asked for and one that is ready would be one drawing.
  let made: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    made = resolve
  })
  await page.route(`**/households/${household}/exports`, async (route) => {
    if (route.request().method() === 'GET') await held
    await route.continue()
  })
  await page.getByRole('button', { name: 'Make an export' }).click()
  await expectSaid(page, 'The export was asked for. It is usually ready within a day.')
  const exported = rows(page).filter({ hasText: 'Asked for on' })
  await expect(exported).toHaveCount(1)
  await expect(exported).toContainText('Waiting to be made')
  await expect(
    page.getByText('An export is on its way, so another is not asked for yet.'),
  ).toBeVisible()
  // The control that asked left with the focus it held: it is on the list's own place.
  await expect(page.getByRole('main').locator('div[tabindex="-1"]').last()).toBeFocused()
  await expectAccessible(page)
  made()
  await expectSaid(page, 'The export is ready to download.')
  await expect(exported).toContainText('Ready')
  await expect(exported).toContainText(/Download it until .+\./)
  await expect(exported).toContainText(/One ZIP of [\d.,]+ (kB|MB)/)
  await exported.getByText('What is in it').click()
  await expect(exported).toContainText('manifest.json')
  await expect(exported).toContainText(
    'What is inside, when it was taken, and a checksum of every file',
  )
  await expectAccessible(page)

  // *Download* hands the browser the archive, and the page stays where it is.
  const downloading = page.waitForEvent('download')
  await exported.getByRole('button', { name: /^Download the export asked for on / }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^household-export-\d{4}-\d{2}-\d{2}\.zip$/)
  await expectSaid(page, 'Your browser is downloading the export.')
  await expect(title(page, 'Export the household')).toBeVisible()
  await download.cancel()
})

test('a declined card changes nothing and says so, with the form still there to pay again', async ({
  page,
}) => {
  const { household } = await owner(page)
  const plan = await subscriptionOf(page, household)
  const monthly = money(priceOf(plan, 'month'))
  await open(page, inHousehold.subscribe(household))
  await page.getByRole('radio', { name: `${monthly} a month` }).check()
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  const form = paymentForm(page)
  const pay = form.getByRole('button', { name: `Pay ${monthly} for a month` })
  await payBy(page, 'declined_card')
  await pay.click()

  // Said in the app's own words, as it arrives, and never in the processor's: what was not
  // accepted, that nothing was charged, and that the household is as it was.
  const refusal = form.getByRole('alert')
  await expect(refusal).toContainText(
    'The payment method was not accepted, and nothing was charged. Check the details, or use another method.',
  )
  await expect(refusal).toContainText(`${home} is as it was.`)
  await expect(refusal).not.toContainText('Your card was declined')
  // The form is there to pay again, its press theirs again and the focus still on it.
  await expect(pay).not.toHaveAttribute('aria-busy', 'true')
  await expect(pay).toBeFocused()
  await expect(page).toHaveURL(inHousehold.subscribe(household))
  const still = await subscriptionOf(page, household)
  expect([still.state, still.interval, still.payment_pending]).toEqual(['trialing', null, false])
  await expectAccessible(page)

  // Paid with a card that is accepted, the same form subscribes the household.
  await payBy(page, 'card')
  await pay.click()
  await expect(title(page, 'Billing')).toBeVisible()
  await expectSaid(page, `${home} is subscribed. The payment went through.`)
  await expect(section(page, 'Subscription')).toContainText('Active')
  await expect(valueOf(page, 'Plan')).toHaveText(`${monthly} a month`)
})

test('a bank debit leaves the household as it was with a payment on its way, and clears to active', async ({
  page,
}) => {
  const { household } = await owner(page)
  const plan = await subscriptionOf(page, household)
  const yearly = money(priceOf(plan, 'year'))
  await open(page, inHousehold.subscribe(household))
  await page.getByRole('radio', { name: `${yearly} a year` }).check()
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await payBy(page, 'debit')
  await paymentForm(page)
    .getByRole('button', { name: `Pay ${yearly} for a year` })
    .click()

  // The processor took it and has not said how it went: nothing is claimed of a payment, and
  // the household is in its trial as before.
  await expect(title(page, 'Billing')).toBeVisible()
  await expect(toasts(page)).toHaveText([
    `The payment was sent to the payment processor. ${home} is subscribed once the processor says it went through, and billing shows how it stands.`,
  ])
  const subscription = section(page, 'Subscription')
  await expect(subscription).toContainText('Trial')
  await expect(subscription).toContainText(
    'A payment for a subscription is on its way. A bank debit takes some days to clear, and until the payment processor says how it went the household stays as it is.',
  )
  await expect(valueOf(subscription, 'Plan')).toHaveText('No subscription')
  // No second subscription is offered beside the one being paid for.
  await expect(subscription.getByRole('link', { name: 'Subscribe' })).toHaveCount(0)
  expect((await subscriptionOf(page, household)).payment_pending).toBe(true)
  await expectAccessible(page)
  // And its own address says the same, with the way back.
  await page.goto(inHousehold.subscribe(household))
  const onItsWay = section(page, 'A payment is on its way')
  await expect(onItsWay).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expectAccessible(page)

  // The debit clears, at the bank's own pace: the household is active, charged to the account.
  await processor(household, 'clear-debit')
  await onItsWay.getByRole('link', { name: 'Billing' }).click()
  await expect(title(page, 'Billing')).toBeVisible()
  await expect(subscription).toContainText('Active')
  await expect(valueOf(subscription, 'Plan')).toHaveText(`${yearly} a year`)
  await expect(section(page, 'Payment method')).toContainText(debit)
  await expect(subscription.getByText('A payment for a subscription is on its way')).toHaveCount(0)
})

test('the payer changes how often they pay, cancels and takes it back, and replaces the card', async ({
  page,
}) => {
  test.slow()
  const { household } = await owner(page)
  await subscribeNow(page, household, 'year')
  const plan = await subscriptionOf(page, household)
  const monthly = money(priceOf(plan, 'month'))
  await open(page, inHousehold.billing(household))
  const subscription = section(page, 'Subscription')
  await expect(valueOf(subscription, 'Plan')).toHaveText(`${money(priceOf(plan, 'year'))} a year`)
  /** The section's own place, which takes the focus of a control that left it (D-166). */
  const place = subscription.locator('div[tabindex="-1"]')

  // How often they pay: asked, with what it comes to, and prorated now.
  await subscription.getByRole('button', { name: 'Pay monthly instead' }).click()
  const asked = page.getByRole('dialog', { name: 'Pay monthly from now on?' })
  await expect(asked).toContainText(`You would pay ${monthly} a month. The change takes effect now`)
  await expectAccessible(page)
  await asked.getByRole('button', { name: 'Pay monthly instead' }).click()
  await expect(asked).toBeHidden()
  await expectSaid(page, 'You pay monthly now.')
  await expect(valueOf(subscription, 'Plan')).toHaveText(`${monthly} a month`)
  // The control that asked is the one that changes it back: the focus is on it again.
  await expect(subscription.getByRole('button', { name: 'Pay yearly instead' })).toBeFocused()

  // Cancelling: the question names the household, and says what follows and when.
  const ends = dayOf((await subscriptionOf(page, household)).current_period_end ?? '')
  await subscription.getByRole('button', { name: 'Cancel the subscription' }).click()
  const question = page.getByRole('dialog', { name: `Cancel the subscription for ${home}?` })
  await expect(question).toContainText(
    `${home} stays exactly as it is until ${ends}, and until then you can take the cancellation back.`,
  )
  await expect(question.getByRole('button', { name: 'Keep the subscription' })).toBeVisible()
  await expectAccessible(page)
  await question.getByRole('button', { name: `Cancel the subscription for ${home}` }).click()
  await expect(question).toBeHidden()
  await expect(toasts(page).last()).toHaveText(
    `The subscription for ${home} ends on ${ends}. Nothing changes until then.`,
  )
  // Billing says the day it ends, and offers to take it back; the control that cancelled is
  // gone with the focus the question gave back to it, which is on the section's own place.
  await expect(valueOf(subscription, 'Ends on')).toHaveText(ends)
  await expect(subscription).toContainText(
    `The subscription is cancelled and ends on ${ends}. Nothing changes until then, and until then the cancellation can be taken back.`,
  )
  await expect(subscription.getByRole('button', { name: 'Cancel the subscription' })).toHaveCount(0)
  await expect(place).toBeFocused()
  // Nothing has changed for the household: it is active, and no banner says otherwise.
  await expect(subscription).toContainText('Active')
  await expect(above(page)).toHaveCount(0)
  await expectAccessible(page)

  // Taken back, with no question: it destroys nothing.
  const resume = subscription.getByRole('button', { name: 'Resume the subscription' })
  await resume.click()
  await expect(toasts(page).last()).toHaveText(
    `The cancellation was taken back. The subscription for ${home} carries on.`,
  )
  await expect(valueOf(subscription, 'Next charge')).toHaveText(ends)
  await expect(resume).toHaveCount(0)
  await expect(place).toBeFocused()
  await expect(subscription.getByRole('button', { name: 'Cancel the subscription' })).toBeVisible()

  // The card is replaced in the processor's own form, drawn where the control stood, and the
  // method that is drawn changes once the processor has said the new one is in use.
  const method = section(page, 'Payment method')
  await expect(method).toContainText(card)
  await method.getByRole('button', { name: 'Replace the payment method' }).click()
  const save = paymentForm(page).getByRole('button', { name: 'Save the payment method' })
  await expect(save).toBeVisible()
  await expect(paymentForm(page).getByRole('button', { name: 'Not now' })).toBeVisible()
  await expectAccessible(page)
  await payBy(page, 'debit')
  await save.click()
  await expect(method.getByRole('status')).toHaveText('The new payment method is in use.')
  await expect(method).toContainText(debit)
  await expect(method).not.toContainText(card)
  // The form left with the press that confirmed it: the focus is on the section's own place.
  await expect(method.locator('div[tabindex="-1"]')).toBeFocused()
  await expect(method.getByRole('button', { name: 'Replace the payment method' })).toBeVisible()
  await expectAccessible(page)

  // Cancelled and left to its end, the household is read-only at once, by its payer's own
  // decision: the banner says so, and leads them to subscribing again.
  await subscription.getByRole('button', { name: 'Cancel the subscription' }).click()
  await question.getByRole('button', { name: `Cancel the subscription for ${home}` }).click()
  await expect(question).toBeHidden()
  await processor(household, 'end-period')
  await page.reload()
  await expect(above(page)).toContainText('The subscription was cancelled')
  await expect(above(page).getByRole('link', { name: 'Subscribe' })).toBeVisible()
  await expect(above(page).getByRole('link', { name: 'Export the household' })).toBeVisible()
  await expect(subscription).toContainText('Cancelled')
  await expect(valueOf(subscription, 'Plan')).toHaveText('No subscription')
  await expectAccessible(page)
})

test('a payment that failed is tried with a new method as soon as it is confirmed, and the household is active again', async ({
  page,
}) => {
  const { household } = await owner(page)
  await subscribeNow(page, household, 'month')
  await processor(household, 'fail-payment')
  await open(page, inHousehold.billing(household))
  const subscription = section(page, 'Subscription')
  await expect(subscription).toContainText('Payment failed')
  await expect(subscription).toContainText(
    'The last payment did not go through. The payment processor tries it again, and nothing is restricted meanwhile.',
  )
  await expect(above(page)).toContainText('The last payment didn’t go through')
  await expectAccessible(page)

  // Replacing the method says, before anything is confirmed, what becomes of the payment.
  const method = section(page, 'Payment method')
  await method.getByRole('button', { name: 'Replace the payment method' }).click()
  await expect(method).toContainText(
    'The payment that did not go through is tried with the new method as soon as it is confirmed.',
  )
  await paymentForm(page).getByRole('button', { name: 'Save the payment method' }).click()

  // The processor's word, and not this page's: the payment went through with it, the household
  // is active, and the banner that said otherwise is gone from above every screen.
  await expect(method.getByRole('status')).toHaveText('The new payment method is in use.')
  await expect(subscription).toContainText('Active')
  await expect(above(page)).toHaveCount(0)
  expect((await standingOf(page, household)).state).toBe('active')
  await expect(method.locator('div[tabindex="-1"]')).toBeFocused()
})

test('the trial’s first notice is put away once and stays away, and the banner of its last days stays', async ({
  page,
}) => {
  const { household } = await owner(page)
  // A trial that began today says nothing for twenty days.
  await open(page, inHousehold.home(household))
  await expect(title(page, 'Home')).toBeVisible()
  await expect(above(page)).toHaveCount(0)

  // With eight days left the server says a notice, which its payer may put away.
  await trialEndsIn(household, 8)
  await page.reload()
  await expect(above(page)).toContainText(/^[78] days of the trial left/)
  await expect(above(page).getByRole('link', { name: 'Subscribe' })).toHaveAttribute(
    'href',
    inHousehold.subscribe(household),
  )
  await expectAccessible(page)
  await above(page).getByRole('button', { name: 'Dismiss' }).click()
  // It went with its control and the focus that control held, which is on the page's landmark.
  await expect(above(page)).toHaveCount(0)
  await expect(page.getByRole('main')).toBeFocused()
  // Put away in this browser, for this trial: it does not come back as the same notice.
  await page.reload()
  await expect(title(page, 'Home')).toBeVisible()
  expect((await standingOf(page, household)).state).toBe('trialing')
  await expect(above(page)).toHaveCount(0)

  // In its last five days the banner stays, with nothing to put it away by.
  await trialEndsIn(household, 3)
  await page.reload()
  await expect(above(page)).toContainText(/^[23] days of the trial left/)
  await expect(above(page).getByRole('button')).toHaveCount(0)
  await expect(above(page).getByRole('link', { name: 'Subscribe' })).toBeVisible()
  await expectAccessible(page)
})

test('a payer whose address is not verified is refused where they press, and is drawn no payment form', async ({
  page,
}) => {
  const who = person()
  await page.goto(buildFile)
  await registerUnverified(page, who)
  await signIn(page, who)
  const household = await createHousehold(page, home)
  const plan = await subscriptionOf(page, household)
  await open(page, inHousehold.subscribe(household))
  await page.getByRole('radio', { name: `${money(priceOf(plan, 'month'))} a month` }).check()
  await page.getByRole('button', { name: 'Continue to payment' }).click()

  // The server's word, said as it arrives where the press was, with the link offered again in
  // the press's place.
  const blocked = page.getByRole('main').getByRole('status')
  await expect(blocked).toContainText('Verify your email first')
  await expect(blocked).toContainText(
    'Subscribing waits for a verified address: it is where the invoices are sent.',
  )
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Send the verification link again' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0)
  await expect(paymentForm(page)).toHaveCount(0)
  // The press left with the focus it held, which is on the place the block stands in.
  await expect(section(page, 'How you pay').locator('div[tabindex="-1"]')).toBeFocused()
  const still = await subscriptionOf(page, household)
  expect([still.state, still.interval, still.payment_pending]).toEqual(['trialing', null, false])
  await expectAccessible(page)
})

interface Two extends Owner {
  /** The household's other owner, who does not pay for it. */
  readonly second: Person
  readonly secondUser: string
}

/**
 * A household with two owners: the one who made it and pays for it, who is signed in to the
 * page's browser, which has drawn nothing of the app yet, and a second, whose address is
 * verified.
 */
async function twoOwners(page: Page): Promise<Two> {
  const first = await owner(page)
  const second = person(guest)
  const secondUser = await join(page, first.who, first.household, second)
  await makeOwner(page, first.household, secondUser)
  return { ...first, second, secondUser }
}

/** Offers billing to `user`, as the signed-in person, who pays, with no screen. */
async function offer(page: Page, household: string, user: string): Promise<void> {
  const answer = await call(page, 'POST', `/households/${household}/billing/transfer`, {
    user_id: user,
  })
  expect(answer.status).toBe(202)
}

test('the payer hands billing to another owner, who is emailed, confirms a card and pays from then on', async ({
  page,
}) => {
  // Three people at one screen in turn, and the processor's word waited for.
  test.slow()
  const { who, household, second } = await twoOwners(page)
  await subscribeNow(page, household, 'year')
  const plan = await subscriptionOf(page, household)
  await open(page, inHousehold.billing(household))
  const handover = section(page, 'Hand billing over')
  await handover.getByRole('button', { name: 'Hand billing to another owner' }).click()
  const panel = page.getByRole('dialog', { name: 'Hand billing to another owner' })
  await expect(panel).toContainText(
    'Two steps: you offer, and they accept and confirm a payment method of their own.',
  )
  // Offered to nobody, it goes nowhere: the focus is on the choice, which says what it wants.
  await panel.getByRole('button', { name: 'Offer billing' }).click()
  const to = panel.getByLabel('To')
  await expect(to).toBeFocused()
  await expect(to).toHaveAccessibleDescription('Choose who billing is offered to.')
  await expectAccessible(page)
  await to.selectOption({ label: second.name })
  await panel.getByRole('button', { name: `Offer billing to ${second.name}` }).click()
  await expect(panel).toBeHidden()
  await expectSaid(
    page,
    `Billing was offered to ${second.name}, who is told by email. You go on paying until they accept.`,
  )
  // The offer stands in the control's place, with the day it lapses and the way to take it
  // back; the control went with the focus the panel gave back to it.
  const made = (await subscriptionOf(page, household)).transfer
  if (made === null) throw new Error('no offer is open')
  await expect(handover).toContainText(
    `You offered billing to another owner on ${dayOf(made.offered_at)}: ${second.name}. You go on paying until they accept. The offer lapses on ${dayOf(made.expires_at)}.`,
  )
  await expect(handover.getByRole('button', { name: 'Take the offer back' })).toBeVisible()
  await expect(handover.locator('div[tabindex="-1"]')).toBeFocused()
  await expectAccessible(page)

  // The other owner opens the link their email carried, and signs in: what they would pay, and
  // from when, which is the day the period already paid for ends.
  const link = await linked(second.email, inHousehold.takeover(household))
  await signOutHere(page)
  await page.goto(link)
  await signInAs(page, second)
  await expect(title(page, 'Take over billing')).toBeVisible()
  await expect(page).toHaveURL(inHousehold.takeover(household))
  const offered = section(page, `${who.name} has offered you billing`)
  await expect(valueOf(offered, 'Offered by')).toHaveText(who.name)
  await expect(valueOf(offered, 'Lapses on')).toHaveText(dayOf(made.expires_at))
  await expect(valueOf(offered, 'What you would pay')).toHaveText(
    `${money(priceOf(plan, 'year'))} a year`,
  )
  await expect(valueOf(offered, 'Your subscription starts')).toHaveText(
    dayOf(plan.current_period_end ?? ''),
  )
  await expect(offered).toContainText(
    `Until your payment method is confirmed, ${who.name} goes on paying, and nothing lapses in between.`,
  )
  await expectAccessible(page)
  await page.getByRole('button', { name: 'Take over billing' }).click()

  // Accepting changes nothing by itself: it draws the form a card of their own is confirmed in.
  const confirm = paymentForm(page).getByRole('button', { name: 'Confirm and take over billing' })
  await expect(confirm).toBeVisible()
  expect((await subscriptionOf(page, household)).transfer).not.toBeNull()
  await expectAccessible(page)
  await confirm.click()

  // The processor confirms it, billing moves, which is said, and they are on Billing as the
  // household's payer.
  await expect(title(page, 'Billing')).toBeVisible()
  await expectSaid(page, `You pay for ${home} now. Whoever paid before is told by email.`)
  const subscription = section(page, 'Subscription')
  await expect(valueOf(subscription, 'Paid by')).toHaveText(`${second.name} (you)`)
  await expect(section(page, 'Hand billing over')).toBeVisible()
  await expectAccessible(page)

  // The owner who paid before reads how billing stands and who pays, and no more: no method,
  // and no control.
  await signOutHere(page)
  await signInAs(page, who)
  await expect(title(page, 'Home')).toBeVisible()
  await page.goto(inHousehold.billing(household))
  await expect(subscription).toContainText('Active')
  await expect(valueOf(subscription, 'Paid by')).toHaveText(second.name)
  await expect(section(page, 'Who pays')).toContainText(
    `${second.name} pays for the household. The payment method and the invoices are theirs alone to read, and offering billing to another owner is theirs to do.`,
  )
  await expect(section(page, 'Payment method')).toHaveCount(0)
  await expect(section(page, 'Hand billing over')).toHaveCount(0)
  await expect(subscription.getByRole('button')).toHaveCount(0)
  await expectAccessible(page)
})

test('in a household with no subscription billing moves as it is accepted, and no card is asked for', async ({
  page,
}) => {
  const { who, household, second } = await twoOwners(page)
  await open(page, inHousehold.billing(household))
  const handover = section(page, 'Hand billing over')
  await handover.getByRole('button', { name: 'Hand billing to another owner' }).click()
  const panel = page.getByRole('dialog', { name: 'Hand billing to another owner' })
  // Said before anything is offered: there is no card to hand over.
  await expect(panel).toContainText(
    'The household has no subscription now, so they are asked for no card: they pay for it from the moment they accept.',
  )
  await panel.getByLabel('To').selectOption({ label: second.name })
  await panel.getByRole('button', { name: `Offer billing to ${second.name}` }).click()
  await expect(panel).toBeHidden()

  await signOutHere(page)
  await page.goto(await linked(second.email, inHousehold.takeover(household)))
  await signInAs(page, second)
  await expect(title(page, 'Take over billing')).toBeVisible()
  const offered = section(page, `${who.name} has offered you billing`)
  await expect(valueOf(offered, 'What you would pay')).toHaveText('No subscription')
  await expect(offered).toContainText(
    `${home} has no subscription now, so no card is asked for. You pay for it from the moment you accept, and subscribing is then yours to do.`,
  )
  await expectAccessible(page)
  await page.getByRole('button', { name: 'Take over billing' }).click()

  // Billing has moved already: no form was drawn, and subscribing is theirs.
  await expect(title(page, 'Billing')).toBeVisible()
  await expectSaid(page, `You pay for ${home} now. Whoever paid before is told by email.`)
  await expect(paymentForm(page)).toHaveCount(0)
  const subscription = section(page, 'Subscription')
  await expect(valueOf(subscription, 'Paid by')).toHaveText(`${second.name} (you)`)
  await expect(subscription.getByRole('link', { name: 'Subscribe' })).toBeVisible()
})

test('an offer of billing is taken back by the payer, and one that is declined leaves them paying', async ({
  page,
}) => {
  const { who, household, second, secondUser } = await twoOwners(page)
  await offer(page, household, secondUser)
  await open(page, inHousehold.billing(household))
  const handover = section(page, 'Hand billing over')
  await handover.getByRole('button', { name: 'Take the offer back' }).click()
  await expectSaid(page, `The offer was taken back: ${second.name}. You go on paying.`)
  // The control that offers is there again, and the one that was pressed is gone with the
  // focus it held, which is on the section's own place.
  await expect(
    handover.getByRole('button', { name: 'Hand billing to another owner' }),
  ).toBeVisible()
  await expect(handover.locator('div[tabindex="-1"]')).toBeFocused()

  // Offered again, the other owner declines it, which is said, and reads who pays.
  await offer(page, household, secondUser)
  await signOutHere(page)
  await page.goto(inHousehold.takeover(household))
  await signInAs(page, second)
  await expect(title(page, 'Take over billing')).toBeVisible()
  await expect(
    page.getByText(
      `If you decline, ${who.name} goes on paying and is told. If you do nothing, the offer lapses.`,
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Decline' }).click()
  await expectSaid(page, `You declined. ${who.name} goes on paying, and is told.`)
  const none = section(page, 'No offer is waiting for you')
  await expect(none).toContainText(`${who.name} pays for the household.`)
  await expect(page.getByRole('button', { name: 'Take over billing' })).toHaveCount(0)
  // The two presses left with the offer: the focus is on the screen's own place.
  await expect(page.getByRole('main').locator('div[tabindex="-1"]').first()).toBeFocused()
  expect((await subscriptionOf(page, household)).transfer).toBeNull()
  await expectAccessible(page)
})

test('the payer’s refusal on the leave screen leads to where billing is handed over', async ({
  page,
}) => {
  // With another owner in the household, paying for it is the one thing in the way.
  const { household } = await twoOwners(page)
  await open(page, inHousehold.leave(household))
  await expect(title(page, `Leave ${home}`)).toBeVisible()
  await expect(page.getByText('One thing has to be settled first.')).toBeVisible()
  const pays = section(page, 'You pay for the household')
  await expect(pays).toContainText(
    'Whoever pays stays in the household until billing has moved to another owner: you offer it on the billing page, and it moves once they accept. Cancelling the subscription does not change who pays.',
  )
  // No control that could only be refused.
  await expect(page.getByRole('button', { name: `Leave ${home}` })).toHaveCount(0)
  await expectAccessible(page)
  await pays.getByRole('link', { name: 'Hand billing over' }).click()
  await expect(title(page, 'Billing')).toBeVisible()
  await expect(
    section(page, 'Hand billing over').getByRole('button', {
      name: 'Hand billing to another owner',
    }),
  ).toBeVisible()
})

test('a member has no billing, and an owner who does not pay reads how it stands and nothing of the payer’s', async ({
  page,
}) => {
  test.slow()
  const { who, household, second } = await twoOwners(page)
  const member = person('Ema Šťastná')
  await join(page, who, household, member)
  await subscribeNow(page, household, 'year')
  const plan = await subscriptionOf(page, household)
  await signOut(page)
  await signIn(page, member)

  // A member: no way in among the settings, and nothing asked of the server at its addresses.
  let asked = 0
  page.on('request', (request) => {
    if (request.url().includes(`/households/${household}/billing/`)) asked += 1
  })
  await open(page, inHousehold.settings(household))
  await expect(settings(page).getByRole('link', { name: 'Data' })).toBeVisible()
  await expect(settings(page).getByRole('link', { name: 'Billing' })).toHaveCount(0)
  for (const address of [
    inHousehold.billing(household),
    inHousehold.subscribe(household),
    inHousehold.takeover(household),
  ]) {
    await page.goto(address)
    await expect(title(page, 'This link doesn’t open anything here.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go to Home' })).toBeVisible()
  }
  await expectAccessible(page)
  expect(asked).toBe(0)

  // Another owner: the state, the plan, who pays and the month's storage; no method, no
  // invoice, and no control.
  await signOutHere(page)
  await signInAs(page, second)
  await expect(title(page, 'Home')).toBeVisible()
  await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
  await settings(page).getByRole('link', { name: 'Billing' }).click()
  await expect(title(page, 'Billing')).toBeVisible()
  const subscription = section(page, 'Subscription')
  await expect(subscription).toContainText('Active')
  await expect(valueOf(subscription, 'Plan')).toHaveText(`${money(priceOf(plan, 'year'))} a year`)
  await expect(valueOf(subscription, 'Paid by')).toHaveText(who.name)
  await expect(section(page, 'This month’s storage')).toBeVisible()
  await expect(section(page, 'Who pays')).toContainText(`${who.name} pays for the household.`)
  await expect(section(page, 'Payment method')).toHaveCount(0)
  await expect(section(page, 'Invoices')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expectAccessible(page)
  // Subscribing is the payer's: its address says whose, and offers no choice and no form.
  await page.goto(inHousehold.subscribe(household))
  await expect(section(page, 'Already subscribed')).toBeVisible()
  await page.goto(inHousehold.takeover(household))
  await expect(section(page, 'No offer is waiting for you')).toContainText(
    `${who.name} pays for the household.`,
  )
})

test('what a bank’s own page sent back with is taken out of the address, and the subscription is read', async ({
  page,
}) => {
  const { household } = await owner(page)
  await subscribeNow(page, household, 'month')
  let read = 0
  page.on('request', (request) => {
    if (request.url().endsWith(`/households/${household}/billing/subscription`)) read += 1
  })
  // What Stripe adds to the address it sends a customer back to: the names of what was
  // confirmed. Their being there says somebody came back, and nothing of them is believed.
  await open(
    page,
    `${inHousehold.billing(household)}?payment_intent=pi_1&payment_intent_client_secret=x&redirect_status=succeeded`,
  )
  expect(new URL(page.url()).search).toBe('')
  await expect(page).toHaveURL(inHousehold.billing(household))
  await expect(
    page.getByText('You are back from confirming with your bank.', { exact: false }),
  ).toBeVisible()
  const subscription = section(page, 'Subscription')
  await expect(subscription).toContainText('Active')
  expect(read).toBeGreaterThan(0)
  await expectAccessible(page)
  // The address was put right in its place, and the one that carried them is no entry of the
  // browser's history: the way back leads to what was open before it.
  await page.goBack()
  expect(new URL(page.url()).pathname).toBe(buildFile)
})

/**
 * Opens each thing billing's screen opens for its payer, in a household that is subscribed and
 * has a second owner, and hands the page to `look` as it stands with each: the question that
 * changes how often they pay and the one that cancels, the payment form as the app frames it
 * and what it says of a card that is declined, the panel that hands billing over with its
 * choice refused, and the toast of an offer made. The invoice the payer has, with its lines, is
 * on the page throughout.
 *
 * A control is found by where it stands and never by its words, which the pseudo-locale
 * changes: the screen's sections in the order it draws them (billing/Billing.tsx), the
 * subscription, the payment method, the month's storage, the invoices, handing over.
 */
async function openEach(page: Page, look: () => Promise<void>): Promise<void> {
  const sections = page.locator('main section')
  await expect(sections).toHaveCount(5)
  const dialog = page.getByRole('dialog')
  await expect(sections.nth(3).getByRole('listitem').first()).toBeVisible()

  for (const question of [0, 1]) {
    const asks = sections.nth(0).getByRole('button').nth(question)
    await asks.click()
    await expect(dialog).toBeVisible()
    await look()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // Put away unanswered, a question gives the focus back to the control that asked it.
    await expect(asks).toBeFocused()
  }

  // The stand-in's list stands where the processor's frame would, and what is said of a card
  // that is declined is the app's. The form's own two controls: the press that confirms, and
  // the one that puts it away.
  await sections.nth(1).getByRole('button').click()
  const form = sections.nth(1).getByRole('group')
  await expect(form.locator('select')).toBeVisible()
  await look()
  await form.locator('select').selectOption('declined_card')
  await form.getByRole('button').first().click()
  await expect(form.getByRole('alert')).toBeVisible()
  await look()
  await form.getByRole('button').last().click()
  await expect(form).toHaveCount(0)

  // The panel, offered to nobody, and then to the household's other owner.
  await sections.nth(4).getByRole('button').click()
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog.locator('select')).toBeFocused()
  await look()
  await dialog.locator('select').selectOption({ index: 1 })
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog).toBeHidden()
  await expect(toasts(page)).toHaveCount(1)
  await look()
}

// What billing's screens open, under the two gates every route is under (06-clients §4 and
// §8) and at a phone's width: routes.spec.ts, pseudo.spec.ts and narrow.spec.ts look at each
// route as it opens, in a household in its trial, which is before a question, the panel or the
// payment form is drawn, and before there is an invoice.
for (const theme of ['light', 'dark'] as const) {
  test(`what billing’s screens open is accessible in the ${theme} theme`, async ({ page }) => {
    // Seven passes of axe, one for each thing opened.
    test.slow()
    const { household } = await twoOwners(page)
    await subscribeNow(page, household, 'year')
    await open(page, inHousehold.billing(household), { theme })
    await openEach(page, () => expectAccessible(page))
  })
}

test('what billing’s screens open survives the pseudo-locale', async ({ page }) => {
  test.slow()
  const { household } = await twoOwners(page)
  await subscribeNow(page, household, 'year')
  await open(page, inHousehold.billing(household), { locale: 'en-XA' })
  await expect(page.getByRole('main')).toContainText('⟦')
  await openEach(page, () => expectSurvives(page))
})

test('what billing’s screens open holds at a phone’s width and 200 % text', async ({ page }) => {
  test.slow()
  const { household } = await twoOwners(page)
  await subscribeNow(page, household, 'year')
  await page.setViewportSize(phone)
  await open(page, inHousehold.billing(household), { scale: '200' })
  await openEach(page, () => expectHolds(page))
})

test('subscribing, with its payment form, holds at a phone’s width and 200 % text, and so does the invoice it leaves', async ({
  page,
}) => {
  const { household } = await owner(page)
  await page.setViewportSize(phone)
  const plan = await subscriptionOf(page, household)
  const yearly = money(priceOf(plan, 'year'))
  await open(page, inHousehold.subscribe(household), { scale: '200' })
  await page.getByRole('radio', { name: `${yearly} a year` }).check()
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  const pay = paymentForm(page).getByRole('button', { name: `Pay ${yearly} for a year` })
  await expect(pay).toBeVisible()
  await expectHolds(page)

  // Paid, the invoice is on Billing, each of its lines beside its amount.
  await pay.click()
  await expect(title(page, 'Billing')).toBeVisible()
  const invoice = section(page, 'Invoices').getByRole('listitem').first()
  await expect(invoice).toContainText('Subscription')
  await expect(invoice).toContainText(yearly)
  await expectHolds(page)
})

test('an offer of billing, as the owner it was made to reads it, survives the pseudo-locale and holds at a phone’s width', async ({
  page,
}) => {
  const { household, second, secondUser } = await twoOwners(page)
  await subscribeNow(page, household, 'year')
  await offer(page, household, secondUser)
  await signOut(page)
  await signIn(page, second)
  await open(page, inHousehold.takeover(household), { locale: 'en-XA' })
  // The offer's two presses, the first of which draws the form a card is confirmed in.
  const presses = page.getByRole('main').locator('div[tabindex="-1"]').getByRole('button')
  await expect(presses).toHaveCount(2)
  await expectSurvives(page)
  await presses.first().click()
  await expect(page.getByRole('main').locator('select')).toBeVisible()
  await expectSurvives(page)

  await page.setViewportSize(phone)
  await open(page, inHousehold.takeover(household), { scale: '200' })
  await expect(presses).toHaveCount(2)
  await expectHolds(page)
  await presses.first().click()
  await expect(page.getByRole('main').locator('select')).toBeVisible()
  await expectHolds(page)
})
