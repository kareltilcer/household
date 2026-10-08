// The way in, end to end, against the API itself (plan item 25; A-1 to A-10): a person registers,
// proves their address by the link their email carried, signs in, and signs in again once a
// second step is on; a visitor who opened a member's address lands there after signing in; and a
// password is set anew by a reset's link. Each person is this test's own, at an address nobody
// else is registered with, and each screen a journey passes is held to axe as it stands.
import type { Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, expectAccessible, open, test } from './fixtures.ts'
import { call, linkToken, person, register, totp, type Person } from './stack.ts'

/** The page's one title, which a screen is known by. */
function title(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name })
}

/** Fills the sign-in screen's two fields as `who`, with `password` where it is not their own. */
async function signInAs(page: Page, who: Person, password = who.password): Promise<void> {
  await expect(title(page, 'Sign in')).toBeVisible()
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('a person registers, verifies their address by the link in their email, and signs in', async ({
  page,
}) => {
  const who = person()
  await open(page, paths.register.example)
  await page.getByLabel('Name').fill(who.name)
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await expectAccessible(page)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(title(page, 'Check your email')).toBeVisible()
  await expect(page.getByText(who.email)).toBeVisible()
  await expectAccessible(page)

  // The link the email carried, opened as a mail client opens it: a new document of the app's.
  const token = await linkToken(who.email, 'verify-email')
  await page.goto(`${paths.verifyEmail.path}#token=${token}`)
  await expect(title(page, 'Your email is verified')).toBeVisible()
  // The token is spent, and is in the address no longer.
  expect(new URL(page.url()).hash).toBe('')
  await expectAccessible(page)

  await page.getByRole('link', { name: 'Go to sign in' }).click()
  await signInAs(page, who, 'not their password')
  await expect(page.getByText('Email or password is not correct.')).toBeVisible()
  await expectAccessible(page)

  await signInAs(page, who)
  // They are in no household yet, and their account is theirs either way (A-19).
  await expect(page).toHaveURL(paths.account.path)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('a member whose second step is on signs in with a code from their authenticator', async ({
  page,
}) => {
  const who = person()
  await open(page, paths.signIn.example)
  await register(page, who)
  await signInAs(page, who)
  await expect(page).toHaveURL(paths.account.path)

  // The second step is turned on as the account's own screen turns it on: an enrolment the
  // password allows, and a code from the authenticator. A code is taken once, and none older
  // than the last one taken, so the authenticator's last code turns it on, and the one it shows
  // now is left for the sign-in.
  const enrolled = await call(page, 'POST', '/auth/mfa/enroll', { password: who.password })
  expect(enrolled.status).toBe(200)
  const { secret } = enrolled.body as { readonly secret: string }
  const activated = await call(page, 'POST', '/auth/mfa/activate', {
    code: totp(secret, Date.now() - 30_000),
  })
  expect(activated.status).toBe(200)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await signInAs(page, who)

  await expect(title(page, 'Enter your code')).toBeVisible()
  await expect(page).toHaveURL(paths.secondStep.path)
  await expectAccessible(page)
  await page.getByLabel('Six-digit code').fill('000000')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('That code isn’t right.', { exact: false })).toBeVisible()
  await expectAccessible(page)

  await page.getByLabel('Six-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(paths.account.path)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('a visitor who opens a member’s address signs in and lands there', async ({ page }) => {
  const who = person()
  await page.goto(paths.signIn.example)
  await register(page, who)

  // A cold start: the address is the first thing this browser asks the app for.
  const address = `${paths.accountDevices.path}?from=email`
  await page.goto(address)
  await expect(title(page, 'Sign in')).toBeVisible()
  await expect(page).toHaveURL(paths.signIn.path)
  await expect(
    page.getByText('After you sign in, you’ll go to the page you opened.'),
  ).toBeVisible()
  await expectAccessible(page)

  await signInAs(page, who)
  await expect(page).toHaveURL(address)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('a password is set anew by the link a reset’s email carried, and the old one signs in no longer', async ({
  page,
}) => {
  const who = person()
  await page.goto(paths.signIn.example)
  await register(page, who)

  await open(page, paths.reset.example)
  await page.getByLabel('Email').fill(who.email)
  await page.getByRole('button', { name: 'Send the link' }).click()
  await expect(page.getByText('If that address has an account', { exact: false })).toBeVisible()
  await expectAccessible(page)

  const token = await linkToken(who.email, 'reset/set')
  await page.goto(`${paths.resetSet.path}#token=${token}`)
  await expect(title(page, 'Choose a new password')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  await expectAccessible(page)

  const next = person().password
  await page.getByLabel('New password', { exact: true }).fill(next)
  await page.getByRole('button', { name: 'Set password and sign out everywhere' }).click()

  await expect(title(page, 'Sign in')).toBeVisible()
  await expect(page.getByText('Your password is set', { exact: false })).toBeVisible()
  await expectAccessible(page)

  await signInAs(page, who)
  await expect(page.getByText('Email or password is not correct.')).toBeVisible()
  await signInAs(page, who, next)
  await expect(page).toHaveURL(paths.account.path)
})
