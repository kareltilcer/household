// A member's own account in a real browser (plan item 25; A-12, A-13, A-19): what its screens
// open, under the two gates every route is under, and what a browser alone can show of them: a
// picture drawn from the object store under the policy. routes.spec.ts and pseudo.spec.ts look at
// each screen as it opens, which is before a dialog or a side panel is drawn; here each is opened
// first. The member is this file's own, with a second step on and a phone signed in beside the
// browser, so that every control that opens something is on the page.
import type { Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { buildFile } from '../src/update/build.ts'
import { expect, expectAccessible, inspect, open, test } from './fixtures.ts'
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
  await page
    .locator('main input[type="file"]')
    .setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: picture() })

  // The link is the object store's, another origin than the page's: drawn, it was admitted by
  // the policy, and a refusal would fail this test as any violation does (fixtures.ts).
  await expect(portrait).toBeVisible()
  await expect
    .poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  expect(new URL((await portrait.getAttribute('src')) ?? '').origin).not.toBe(
    new URL(page.url()).origin,
  )
  await expectAccessible(page)

  await page.getByRole('button', { name: 'Remove picture' }).click()
  await expect(portrait).toHaveCount(0)
})
