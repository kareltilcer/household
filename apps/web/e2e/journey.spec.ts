// The way in, end to end, against the API itself (plan item 25; A-1 to A-10): a person registers,
// proves their address by the link their email carried, signs in, turns a second step on from
// their account, and signs in again with a code from it and then with a recovery code; a visitor
// who opened a member's address lands there after signing in; a member whose browser kept their
// account and lost its session signs in again on the page that found it so; and a password is
// set anew by a reset's link. Each person is this test's own, at an address nobody
// else is registered with, and each screen a journey passes is held to axe as it stands.
import type { Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, expectAccessible, frames, open, test } from './fixtures.ts'
import { linkToken, person, register, totp, type Person } from './stack.ts'

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

test('a person registers, verifies their address, signs in, turns the second step on and signs in with it', async ({
  page,
}) => {
  // One journey through eight screens, each under axe.
  test.slow()
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
  // They are in no household yet, and are opened at making one, the first thing a new account
  // does (DD-6); their account is beside it either way (A-19).
  await expect(page).toHaveURL(paths.householdNew.path)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  // The second step, turned on from the account's own screens (A-5): the password, the
  // authenticator's key, a code from it.
  await page.getByRole('link', { name: 'Signing in' }).click()
  await page.getByRole('link', { name: 'Add a second step' }).click()
  await expect(title(page, 'Add a second step')).toBeVisible()
  await page.getByRole('button', { name: 'Set it up' }).click()
  const asked = page.getByRole('dialog', { name: 'Your password, first' })
  await asked.getByLabel('Password', { exact: true }).fill(who.password)
  await expectAccessible(page)
  await asked.getByRole('button', { name: 'Continue' }).click()

  const key = page.getByText('Key to type').locator('xpath=following-sibling::p[1]')
  await expect(key).toBeVisible()
  const secret = (await key.innerText()).replace(/\s/g, '')
  await expectAccessible(page)
  // A code is taken once, and none older than the last one taken: the authenticator's last code
  // turns the step on, and the one it shows now is left for the sign-in that follows.
  await page.getByLabel('Code from the app').fill(totp(secret, Date.now() - 30_000))
  await page.getByRole('button', { name: 'Turn it on' }).click()

  // The ten recovery codes, shown once (A-6), and saved as a file the page makes itself.
  await expect(title(page, 'Ten codes, in case the app is gone')).toBeVisible()
  const codes = await page
    .getByRole('list', { name: 'Recovery codes' })
    .getByRole('listitem')
    .allInnerTexts()
  expect(codes).toHaveLength(10)
  await expectAccessible(page)
  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  await saved
  await page.getByLabel('I have saved them').check()
  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(title(page, 'Signing in')).toBeVisible()
  await expect(page.getByText('On. Signing in on a new browser', { exact: false })).toBeVisible()
  await expectAccessible(page)

  // Signing in again is challenged for a code (A-7).
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
  await expect(page).toHaveURL(paths.householdNew.path)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  // And with the authenticator out of reach, one of the ten stands in for it (A-8).
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signInAs(page, who)
  await page.getByRole('link', { name: 'Use a recovery code instead' }).click()
  await expect(title(page, 'Use a recovery code')).toBeVisible()
  await expectAccessible(page)
  await page.getByLabel('Recovery code').fill(codes[0] ?? '')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(paths.householdNew.path)
  await page.getByRole('link', { name: 'Signing in' }).click()
  await expect(page.getByText('9 recovery codes left')).toBeVisible()
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
  await expect(page.getByText('After you sign in, you’ll go to the page you opened.')).toBeVisible()
  await expectAccessible(page)

  await signInAs(page, who)
  await expect(page).toHaveURL(address)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

/**
 * The reads this browser keeps, by their keys: the app's persisted cache as it wrote it, one
 * clone under one key of one store (src/api/query.ts). Read once the app has drawn, which is
 * after it opened the store.
 */
function kept(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const opening = indexedDB.open('household-web')
        opening.onerror = () => {
          reject(new Error('the kept reads could not be opened'))
        }
        opening.onsuccess = () => {
          const database = opening.result
          const read = database.transaction('query-cache').objectStore('query-cache').get('client')
          read.onerror = () => {
            reject(new Error('the kept reads could not be read'))
          }
          read.onsuccess = () => {
            const client = read.result as
              | { readonly clientState: { readonly queries: { readonly queryHash: string }[] } }
              | undefined
            database.close()
            resolve((client?.clientState.queries ?? []).map((query) => query.queryHash))
          }
        }
      }),
  )
}

// A second visit, which a browser that kept nothing never makes: the account is in what this
// browser kept, and the session's cookies are not. The page that finds it so removes what was
// kept and draws nothing again for that, and a sign-in on it is still seen (ADR 0026).
test('a member whose browser kept their account and lost its session signs in on the page that found it so', async ({
  page,
  context,
}) => {
  const who = person()
  await page.goto(paths.signIn.example)
  await register(page, who)
  await signInAs(page, who)
  // In no household yet, a member is opened at making one, and this browser keeps no replica.
  await expect(page).toHaveURL(paths.householdNew.path)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect.poll(() => kept(page)).toContain(JSON.stringify(['me']))

  // The cookies go and the rest stays, as when they are cleared by themselves.
  await context.clearCookies()
  await page.goto(paths.account.path)
  await expect(title(page, 'Sign in')).toBeVisible()
  await expect.poll(() => kept(page)).not.toContain(JSON.stringify(['me']))

  await signInAs(page, who)
  await expect(page).toHaveURL(paths.account.path)
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
  await expect(page).toHaveURL(paths.householdNew.path)
})

test('a sign-in pressed with no connection says so at once, and nothing signs in once the connection is back', async ({
  page,
  context,
  faults,
}) => {
  const who = person()
  await page.goto(paths.signIn.example)
  await register(page, who)

  await open(page, paths.signIn.example)
  let asked = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/auth/login')) asked += 1
  })
  await context.setOffline(true)
  await signInAs(page, who)
  // Asked at once, and not held for a connection: the screen says the server was not reached,
  // and the control is theirs again.
  await expect(page.getByRole('alert')).toContainText('We couldn’t reach Household.')
  const button = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(button).not.toHaveAttribute('aria-busy', 'true')

  // The connection is back, and nothing was left waiting for it: a sign-in sent now, with
  // nobody at the screen, would sign in whoever had walked away from it.
  const before = asked
  await context.setOffline(false)
  await frames(page, 10)
  expect(asked).toBe(before)
  await expect(page).toHaveURL(paths.signIn.path)

  await button.click()
  await expect(page).toHaveURL(paths.householdNew.path)
  // The requests that found no connection, as the browser says each, are this test's own doing.
  expect(faults.filter((fault) => !/ERR_INTERNET_DISCONNECTED/.test(fault))).toEqual([])
  faults.length = 0
})
