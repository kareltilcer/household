// A link opened where its page is drawn already (ADR 0026): pasted into the address of a tab
// that is on the link's page, or taken from a bookmark there. The browser loads nothing and only
// changes the fragment under the page, so the page is begun again for what arrived
// (src/auth/fragment.ts). A unit harness goes there by its router; what a browser does with an
// address, only a browser shows, and every other spec opens a link from another document, as a
// mail client does.
import type { Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { buildFile } from '../src/update/build.ts'
import { expect, open, test } from './fixtures.ts'
import { call, linkToken, person } from './stack.ts'

/** The page's one title, which a screen is known by. */
function title(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name })
}

/** Marks the document the page is, to tell it later from one loaded since. */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.drawn = 'before'
  })
}

/** Whether the page is still the document that was marked: nothing was loaded since. */
function marked(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.dataset.drawn === 'before')
}

test('a link opened in a tab that is on its page already is the one the page reads', async ({
  page,
}) => {
  // Somebody who registered, and has not opened the link in their email yet.
  const who = person()
  await page.goto(buildFile)
  const registered = await call(page, 'POST', '/auth/register', {
    email: who.email,
    password: who.password,
    display_name: who.name,
    locale: 'en',
  })
  expect(registered.status).toBe(202)
  const link = `${paths.verifyEmail.path}#token=${await linkToken(who.email, 'verify-email')}`

  let asked = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/auth/verify-email')) asked += 1
  })

  // The page loaded with no link holds none, and says to open the link again.
  await open(page, paths.verifyEmail.path)
  await expect(title(page, 'This link doesn’t verify anything')).toBeVisible()
  expect(asked).toBe(0)
  await mark(page)
  // Opened where they are, as a link pasted into the address is. It is spent as a load would
  // spend it, and is in the address no longer.
  await page.goto(link)
  await expect(title(page, 'Your email is verified')).toBeVisible()
  await expect(page).toHaveURL(paths.verifyEmail.path)
  expect(asked).toBe(1)
  expect(await marked(page), 'the browser loaded nothing').toBe(true)

  // The same link again, where the page says what it came to: the server is asked again, as a
  // load would ask it, and answers a link that verified its address as it did the first time.
  await page.goto(link)
  await expect.poll(() => asked).toBe(2)
  await expect(title(page, 'Your email is verified')).toBeVisible()
  await expect(page).toHaveURL(paths.verifyEmail.path)
  expect(await marked(page), 'the browser loaded nothing').toBe(true)

  // The pages whose link is spent by a press draw their form for a link that arrives: any
  // token, which the server is asked about only once the form is sent.
  for (const [path, none, opened] of [
    [paths.resetSet.path, 'This link doesn’t open anything', 'Choose a new password'],
    [paths.graduate.path, 'This link doesn’t open anything', 'Choose your password'],
    [paths.deletionCancel.path, 'This link doesn’t cancel anything', 'Keep your account'],
  ] as const) {
    await open(page, path)
    await expect(title(page, none)).toBeVisible()
    await mark(page)
    await page.goto(`${path}#token=nobody-was-sent-this`)
    await expect(title(page, opened)).toBeVisible()
    await expect(page).toHaveURL(path)
    expect(await marked(page), 'the browser loaded nothing').toBe(true)
  }
})
