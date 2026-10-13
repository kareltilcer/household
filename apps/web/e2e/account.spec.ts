// A member's own account in a real browser (plan item 25; A-12, A-13, A-19): what its screens
// open, under the two gates every route is under, and what a browser alone can show of them: a
// picture drawn from the object store under the policy. routes.spec.ts and pseudo.spec.ts look at
// each screen as it opens, which is before a dialog or a side panel is drawn; here each is opened
// first. The member is this file's own, with a second step on and a phone signed in beside the
// browser, so that every control that opens something is on the page.
import type { Page } from '@playwright/test'
import { apiPath } from '../src/api/names.ts'
import { paths } from '../src/app/paths.ts'
import { buildFile } from '../src/update/build.ts'
import { expect, expectAccessible, frames, inspect, open, test } from './fixtures.ts'
import {
  call,
  person,
  picture,
  register,
  signIn,
  signInOnPhone,
  totp,
  type Person,
} from './stack.ts'

/** What the phone is called in the member's list: no word a translator missed (stack.ts). */
const phone = 'Áňin 5a'

/**
 * A member with a second step on and a phone signed in, signed in to this page's browser.
 * Each test makes its own: one test signs every session out, and another's would go with it.
 */
async function member(page: Page): Promise<Person> {
  const who = person()
  // A document of the app's origin to ask the API from, with none of the app in it.
  await page.goto(buildFile)
  await register(page, who)
  await signIn(page, who)
  // The phone first: once the second step is on, a sign-in is challenged for it.
  await signInOnPhone(page, who, phone)
  const enrolled = await call(page, 'POST', '/auth/mfa/enroll', { password: who.password })
  expect(enrolled.status).toBe(200)
  const { secret } = enrolled.body as { readonly secret: string }
  expect((await call(page, 'POST', '/auth/mfa/activate', { code: totp(secret) })).status).toBe(200)
  return who
}

/** Opens each thing the account's screens open, and hands it to `look` as it stands. */
async function openEach(page: Page, look: () => Promise<void>): Promise<void> {
  // A control is found by where it stands and never by its words, which the pseudo-locale
  // changes. The password that is asked for before a second step is set up again: the one
  // button of that screen.
  await page.goto(paths.accountSecondStep.example)
  await page.locator('main').getByRole('button').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await look()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The two confirmations of the second step's own section, which a password answers: a new
  // set of recovery codes, and turning the step off.
  await page.goto(paths.accountSecurity.example)
  const secondStep = page
    .locator('main section')
    .filter({ has: page.locator(`a[href="${paths.accountSecondStep.path}"]`) })
  for (const control of [0, 1]) {
    await secondStep.getByRole('button').nth(control).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await look()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }

  // Where the account is signed in: a phone's name in a side panel, the confirmation that signs
  // it out, and the one that signs out everywhere.
  await page.goto(paths.accountDevices.example)
  const row = page.getByRole('listitem').filter({ hasText: phone })
  await expect(row).toBeVisible()
  for (const control of [0, 1]) {
    await row.getByRole('button').nth(control).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await look()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  await page.locator('main').getByRole('button').last().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await look()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

for (const theme of ['light', 'dark'] as const) {
  test(`what the account’s screens open is accessible in the ${theme} theme`, async ({ page }) => {
    // Six passes of axe, one for each thing opened.
    test.slow()
    await member(page)
    await open(page, paths.account.example, { theme })
    await openEach(page, () => expectAccessible(page))
  })
}

test('what the account’s screens open survives the pseudo-locale', async ({ page }) => {
  test.slow()
  await member(page)
  await open(page, paths.account.example, { locale: 'en-XA' })
  await openEach(page, async () => {
    await expect(page.getByRole('dialog').last().getByRole('button').last()).toContainText('⟦')
    expect(await inspect(page)).toEqual({ escaped: [], unbalanced: [], clipped: [] })
  })
})

test('a member’s picture is drawn from the object store, under the policy', async ({ page }) => {
  const who = person()
  await page.goto(buildFile)
  await register(page, who)
  await signIn(page, who)
  await open(page, paths.account.example)

  // Their initials stand where a picture would be, until there is one.
  const portrait = page.locator('main img')
  await expect(portrait).toHaveCount(0)
  // What each address was answered with, as to who may keep it.
  const policies = new Map<string, string | undefined>()
  page.on('response', (response) => {
    policies.set(response.url(), response.headers()['cache-control'])
  })
  await page
    .locator('main input[type="file"]')
    .setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: picture() })

  // The link is the object store's, another origin than the page's: drawn, it was admitted by
  // the policy, and a refusal would fail this test as any violation does (fixtures.ts).
  await expect(portrait).toBeVisible()
  await expect
    .poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  const address = (await portrait.getAttribute('src')) ?? ''
  expect(new URL(address).origin).not.toBe(new URL(page.url()).origin)
  // And the store said that no cache keeps it (D-198): a browser's own would hold the picture on
  // disk past its member's sign-out, where nothing of the app's reaches to remove it. The answer's
  // word is what a test here can hold: Playwright turns the HTTP cache off in a context that has a
  // route, as each of this suite's has, and what Chromium does with a profile on disk is ADR 0015's.
  expect(policies.get(address)).toBe('no-store')
  await expectAccessible(page)

  await page.getByRole('button', { name: 'Remove picture' }).click()
  await expect(portrait).toHaveCount(0)
})

// A read within the five minutes a link was signed in hands the same link (D-9), and no cache
// keeps what it fetched (D-198): a picture that did not load is drawn by the page's own asking
// again (ui/Chip.tsx), and what that stands on is the browser's to show. A picture the page
// hides is fetched all the same, and an address that failed is fetched anew.

/** The picture as the account's screen draws it, and the member's initials in its place. */
const portraitIn = (page: Page) => page.locator('main img')
const initialsIn = (page: Page) => page.getByRole('main').getByText('ÁD', { exact: true })

/** Whether a request or an answer is the account's own read. */
const ofAccount = (asked: { url: () => string }) =>
  new URL(asked.url()).pathname === `${apiPath}/me`

/**
 * A member with a picture, at their account, opened again while the object store cannot be
 * reached: the account was answered, every fetch of the picture failed, and their initials
 * stand. It answers with the store's reach given back, and nothing told to the page.
 */
async function unfetched(page: Page): Promise<void> {
  const who = person()
  await page.goto(buildFile)
  await register(page, who)
  await signIn(page, who)
  await open(page, paths.account.example)
  const portrait = portraitIn(page)
  await page
    .locator('main input[type="file"]')
    .setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: picture() })
  await expect(portrait).toBeVisible()
  const store = new URL((await portrait.getAttribute('src')) ?? '').origin

  // The picture is asked for as the screen is drawn from what the browser kept, where it kept
  // the account with its picture, and for the account's answer: each asking is counted, and
  // each failure.
  let asked = 0
  let failed = 0
  page.on('request', (request) => {
    if (new URL(request.url()).origin === store) asked += 1
  })
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).origin === store) failed += 1
  })
  await page.route(`${store}/**`, (route) => route.abort('connectionfailed'))
  const answered = page.waitForResponse(ofAccount)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await (await answered).finished()
  // The page has the account's answer, and has asked for whatever it asks for by it.
  await frames(page)
  await expect.poll(() => asked).toBeGreaterThan(0)
  await expect.poll(() => failed).toBe(asked)
  await expect(portrait).toHaveCount(0)
  await expect(initialsIn(page)).toBeVisible()

  // The store can be reached again, which nothing tells the page: the initials stand.
  await page.unroute(`${store}/**`)
  await frames(page)
  expect(failed).toBe(asked)
  await expect(portrait).toHaveCount(0)
}

/** Whether the picture is drawn, and not only asked for: its element shown, with its pixels. */
async function expectDrawn(page: Page): Promise<void> {
  const portrait = portraitIn(page)
  await expect(portrait).toBeVisible()
  await expect
    .poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  await expect(initialsIn(page)).toHaveCount(0)
}

/** A fault that is a picture's fetch failing, as each of these tests has it fail on purpose. */
const unfetchedFault = /ERR_CONNECTION_FAILED|ERR_INTERNET_DISCONNECTED/

test('a picture that did not load is drawn once the account is answered again', async ({
  page,
  faults,
}) => {
  await unfetched(page)
  // The page is looked at again: the account is read, and names the link it named.
  const answered = page.waitForResponse(ofAccount)
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  })
  await answered
  await expectDrawn(page)
  await expectAccessible(page)
  expect(faults.filter((fault) => !unfetchedFault.test(fault))).toEqual([])
  faults.length = 0
})

test('a picture that did not load is drawn once the browser has its connection back', async ({
  page,
  context,
  faults,
}) => {
  await unfetched(page)
  // The account was read a moment ago and is not read for this: the browser's word alone.
  let asked = 0
  page.on('request', (request) => {
    if (ofAccount(request)) asked += 1
  })
  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => window.navigator.onLine)).toBe(false)
  await expect(initialsIn(page)).toBeVisible()
  await context.setOffline(false)
  await expectDrawn(page)
  expect(asked).toBe(0)
  expect(faults.filter((fault) => !unfetchedFault.test(fault))).toEqual([])
  faults.length = 0
})
