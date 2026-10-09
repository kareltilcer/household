// What the specs of a household's later screens share (plan item 27; billing.spec.ts,
// data.spec.ts): how a screen's parts are found on a page, the words `Intl` writes that a test
// has to say as the app says them, who is at the screen, and paying in the payment form. The
// earlier specs keep their own (household.spec.ts), which these are written after.
import type { Locator, Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { buildFile } from '../src/update/build.ts'
import { expect, inspect, open, smallTargets } from './fixtures.ts'
import { call, createHousehold, person, register, signIn, whoAmI, type Person } from './stack.ts'

/** What the suite calls its households: no word a translator missed (stack.ts). */
export const home = 'Dům č. 7'

/** The zone the suite's households are in (stack.ts), which a household's days are said in. */
export const zone = 'Europe/Prague'

/** The page's one title, which a screen is known by. */
export function title(page: Page, name: string | RegExp): Locator {
  return page.getByRole('heading', { level: 1, name })
}

/** A toast on the screen, wherever its region is drawn: the page, or the modal that is open. */
export function toasts(scope: Page | Locator): Locator {
  return scope.locator('[data-third-party] li')
}

/** The rows a screen lists: the toasts are items of a list too, and stand outside the landmark. */
export function rows(page: Page): Locator {
  return page.getByRole('main').getByRole('listitem')
}

/** The way between the screens of household settings. */
export function settings(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Household settings' })
}

/** The shell's own navigation: the sidebar, which names the household and the member's role. */
export function sidebar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Household', exact: true })
}

/**
 * What stands above every screen of a household, before its landmark: the offline bar, and the
 * entitlement's banner, which says what the household's state means for whoever reads it
 * (shell/HouseholdBars.tsx). Nothing, for a household in good standing read with a connection.
 */
export function above(page: Page): Locator {
  return page.locator('main').locator('xpath=preceding-sibling::*')
}

/** A section of a settings screen, by its heading, which names it. */
export function section(page: Page, name: string | RegExp): Locator {
  return page.getByRole('main').getByRole('region', { name })
}

/** What a block of labels and values says under `key`. */
export function valueOf(scope: Page | Locator, key: string): Locator {
  return scope
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${key}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

/** What was said of a write: a toast with these words, on the page or in the modal that is open. */
export async function expectSaid(page: Page, words: string | RegExp): Promise<void> {
  await expect(toasts(page).filter({ hasText: words })).toBeVisible()
}

/** A phone's width, where the screens are read at twice the text's size too. */
export const phone = { width: 375, height: 812 } as const

/** How far the page scrolls sideways, in CSS px: nothing, where its layout holds. */
function sideways(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/**
 * Holds the page as it stands, with whatever it has open, to a phone's measures, as
 * narrow.spec.ts holds each route as it opens: nothing scrolls sideways, nothing that holds
 * text is clipped, and every control is a target of at least 44 × 44 px.
 */
export async function expectHolds(page: Page): Promise<void> {
  expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)
  // What is open over the page is drawn in the top layer, which widens no page: a question or
  // a panel is measured for itself, against the window and against what it holds.
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('dialog[open]')].flatMap((dialog) => {
        const box = dialog.getBoundingClientRect()
        const outside = box.left < -1 || box.right > window.innerWidth + 1
        return outside || dialog.scrollWidth - dialog.clientWidth > 1
          ? [`${String(box.left)} to ${String(box.right)}, ${String(dialog.scrollWidth)} wide`]
          : []
      }),
    ),
    'what is open is wider than the window, or scrolls sideways',
  ).toEqual([])
  expect((await inspect(page)).clipped, 'text is clipped').toEqual([])
  expect(await smallTargets(page.locator('body')), 'targets under 44 px').toEqual([])
}

/**
 * Holds the page as it stands, with whatever it has open, to the pseudo-locale's pass, as
 * pseudo.spec.ts holds each route as it opens: no word in plain letters, no bracket without
 * its pair, nothing clipped, and nothing wider than the page.
 */
export async function expectSurvives(page: Page): Promise<void> {
  expect(await inspect(page)).toEqual({ escaped: [], unbalanced: [], clipped: [] })
  expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)
}

/** An amount of money as the app writes it in English: its currency's code, then the figure. */
export function money(amount: { readonly amount_minor: number; readonly currency: string }) {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: amount.currency,
    currencyDisplay: 'code',
  }).format(amount.amount_minor / 100)
}

/** The day of an instant as the app writes it in English, in the household's zone. */
export function dayOf(at: string | Date, style: 'medium' | 'long' = 'medium'): string {
  return new Intl.DateTimeFormat('en', { dateStyle: style, timeZone: zone }).format(new Date(at))
}

/** An instant as the app writes it in English, in the household's zone: its day and its time. */
export function instantOf(at: string | Date): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(new Date(at))
}

/**
 * Opens `path`, a screen of a household's, and waits until the browser has the last of the files
 * its replica of the household runs on, the SQLite it is kept in. A test that then takes the
 * connection away takes it from a page that has loaded, as a member's has who loses theirs: one
 * taken while those files were on their way is a replica that could not be opened, which is
 * another state than a write pressed with no connection.
 */
export async function openLoaded(page: Page, path: string): Promise<void> {
  const fetched = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('.wasm'),
  )
  await open(page, path)
  await (await fetched).finished()
}

/** Fills the sign-in screen's two fields as `who`. */
export async function signInAs(page: Page, who: Person): Promise<void> {
  await expect(title(page, 'Sign in')).toBeVisible()
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

/**
 * Signs out as a member does, by the account's own way out: what this browser kept of them goes
 * with their session, and whoever signs in next is drawn nothing of theirs (D-161).
 */
export async function signOutHere(page: Page): Promise<void> {
  await page.goto(paths.account.path)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(title(page, 'Sign in')).toBeVisible()
}

export interface Owner {
  readonly who: Person
  /** Their id, which billing names its payer by. */
  readonly user: string
  readonly household: string
}

/**
 * A person of this test's own who owns a household in its trial, and pays for it, signed in to
 * the page's browser, which has drawn nothing of the app yet.
 */
export async function owner(page: Page, name?: string): Promise<Owner> {
  const who = person(name)
  // A document of the app's origin to ask the API from, with none of the app in it.
  await page.goto(buildFile)
  await register(page, who)
  await signIn(page, who)
  return { who, user: await whoAmI(page), household: await createHousehold(page, home) }
}

/** A plan's price, as the subscription's own answer gives it. */
export interface Price {
  readonly amount_minor: number
  readonly currency: string
}

/** What a household's subscription says, as far as a test asks it (`Subscription`). */
export interface Subscription {
  readonly state: string
  readonly interval: 'year' | 'month' | null
  readonly current_period_end: string | null
  readonly trial_ends_at: string | null
  readonly grace_ends_at: string | null
  readonly data_retained_until: string | null
  readonly payment_pending: boolean
  readonly plans: readonly { readonly interval: 'year' | 'month'; readonly price: Price }[]
  readonly price_per_storage_block: Price
  readonly transfer: { readonly offered_at: string; readonly expires_at: string } | null
}

/** The subscription of `household`, as the signed-in person, who owns it, reads it. */
export async function subscriptionOf(page: Page, household: string): Promise<Subscription> {
  const answer = await call(page, 'GET', `/households/${household}/billing/subscription`)
  if (answer.status !== 200) {
    throw new Error(`reading the subscription answered ${String(answer.status)}`)
  }
  return answer.body as Subscription
}

/** What `interval` costs, as the server says it: no price is a spec's own. */
export function priceOf(subscription: Subscription, interval: 'year' | 'month'): Price {
  const plan = subscription.plans.find((each) => each.interval === interval)
  if (plan === undefined) throw new Error(`the subscription offers no plan by the ${interval}`)
  return plan.price
}

/**
 * The payment form as the app frames it: the processor's element inside it, which in this suite
 * is the stand-in's (stripe.js), a list of how the customer pays.
 */
export function paymentForm(page: Page): Locator {
  return page.getByRole('group', { name: 'Payment details' })
}

/** How a customer pays in the stand-in's form, by the stand-in's own name for each. */
export type Way = 'card' | 'declined_card' | 'debit'

/** Says how the customer pays in the payment form that is drawn, once it takes input. */
export async function payBy(page: Page, way: Way): Promise<void> {
  await paymentForm(page).getByLabel('Pay by').selectOption(way)
}
