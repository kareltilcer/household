// Accessibility: axe on every route, in both themes (06-clients §4 and §8), and each route's
// title, which axe does not read past its presence. The routes are the app's own list
// (src/app/paths.ts), which the router is built from, so a route added there is checked here
// with no further word.
import type { Page } from '@playwright/test'
import { paths, routeIds } from '../src/app/paths.ts'
import { displayKey, expect, expectAccessible, open, reach, test } from './fixtures.ts'

/**
 * Holds the page's title to the screen it shows: its one `<h1>`'s words, before the app's name
 * (WCAG 2.1, 2.4.2; D-165). axe asks only that a page has a title, and one title for every
 * screen would pass it. The two are read together until they agree: a screen that does
 * something as it opens changes its heading, and its title with it.
 */
async function expectNamed(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const heading = (await page.getByRole('heading', { level: 1 }).innerText()).trim()
      return (await page.title()) === `${heading} · Household`
    })
    .toBe(true)
}

// Each route as whoever it is drawn for sees it on opening its address: a visitor for the
// screens before sign-in, a member with a household for the shell's. What a route goes on to
// show, a second step, a dialog, is opened by the tests of the flows that reach it.
for (const id of routeIds) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${paths[id].path} is accessible in the ${theme} theme`, async ({ page, enter }) => {
      // The harness is a hundred and eight cells in two themes.
      test.slow(id === 'harness')
      await open(page, await reach(id, enter), { theme })
      await expectAccessible(page)
      // A route added to the list with a screen that does not say its name fails here.
      await expectNamed(page)
    })
  }
}

test('a page says what language it is in, and what it is', async ({ page }) => {
  await open(page, paths.home.example, { locale: 'cs' })
  await expect(page.locator('html')).toHaveAttribute('lang', 'cs')
  // A visitor is opened at the way in, and the page is named for it in their language.
  await expect(page).toHaveTitle('Přihlásit se · Household')
  await expectNamed(page)
})

test('a page whose language could not be fetched is loaded again when the connection is back', async ({
  page,
  faults,
}) => {
  // The file of the app's own words in its language, the part of the catalog fetched before a
  // word is drawn, refused for as long as the connection is away: the app's script came, and its
  // words did not.
  let away = true
  let refused = 0
  await page.route('**/assets/catalog-*.app-*.js', (route) => {
    if (!away) return route.continue()
    refused += 1
    return route.abort('internetdisconnected')
  })
  await page.goto(paths.signIn.example)
  await expect.poll(() => refused).toBe(1)
  // Nothing is drawn: there is no word to say so in.
  await expect(page.locator('#root')).toBeEmpty()

  // The browser keeps the import that failed, and would answer another of the same file with
  // that failure: the page is loaded again, and asks for every file of its own anew.
  away = false
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  expect(refused).toBe(1)
  // The file that was refused is the one fault, and this test's own.
  expect(faults).toEqual([expect.stringContaining('ERR_INTERNET_DISCONNECTED')])
  faults.length = 0
})

test('a screen whose words could not be fetched says to reload, as one whose file could not', async ({
  page,
  enter,
  faults,
}) => {
  const settings = await reach('settings', enter)
  // A household's own words, the part of the catalog its settings read (src/app/paths.ts), which
  // is fetched with the screen's file: refused, where the screen's script and the app's own
  // words came.
  let away = true
  let refused = 0
  await page.route('**/assets/catalog-*.household-*.js', (route) => {
    if (!away) return route.continue()
    refused += 1
    return route.abort('internetdisconnected')
  })
  await page.goto(settings)
  const failure = page.getByRole('heading', { level: 1, name: 'This page could not be shown' })
  await expect(failure).toBeVisible()
  expect(refused).toBe(1)
  // In the screen's place and in the app's own words, inside the shell, which stays.
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('main')).toContainText('This page could not be shown')
  await expect(page.getByRole('link', { name: 'Household settings' })).toBeVisible()
  await expectNamed(page)
  // The file that was refused is this test's own fault, as the browser and the router say it.
  expect(faults).toContainEqual(expect.stringContaining('ERR_INTERNET_DISCONNECTED'))
  faults.length = 0

  // The browser keeps the import that failed: the page is loaded again, by its member, and the
  // screen is drawn with its words.
  away = false
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()
  await expect(failure).toHaveCount(0)
  expect(refused).toBe(1)
})

test('a page opened at a route whose file is still on its way has its landmark already', async ({
  page,
}) => {
  // The route's own script, held back for as long as the test says.
  let send: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    send = resolve
  })
  await page.route('**/assets/Primitives-*.js', async (route) => {
    await held
    await route.continue()
  })
  await page.goto(paths.primitives.example, { waitUntil: 'commit' })
  // What every route is drawn in is drawn, the place of this one empty in it: not a page with
  // nothing on it, and nothing listening, until the file has come or failed to.
  const main = page.getByRole('main')
  await expect(main).toBeAttached()
  await expect(main).toBeEmpty()
  send()
  await expect(main.getByRole('heading', { level: 1, name: 'Primitives' })).toBeVisible()
  await expect(page.getByRole('main')).toHaveCount(1)
})

/** The page's ground, as the browser resolved it. */
function ground(page: Page): Promise<string> {
  return page.evaluate(() => window.getComputedStyle(document.body).backgroundColor)
}

test.describe('the theme', () => {
  test('is light unless the member chose otherwise, whatever the device prefers', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page, paths.home.example)
    const light = await ground(page)
    await open(page, paths.home.example, { theme: 'dark' })
    expect(await ground(page)).not.toBe(light)
  })

  test('follows the device when the member chose system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page, paths.home.example, { theme: 'system' })
    const light = await ground(page)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => ground(page)).not.toBe(light)
  })

  test('is on the root before the app has drawn anything', async ({ page }) => {
    // The app's own script is held back: what the root carries is the head's script's doing.
    await page.route('**/assets/index-*.js', () => new Promise<void>(() => undefined))
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, JSON.stringify({ theme: 'dark', scale: '200' }))
    }, displayKey)
    await page.goto(paths.home.example, { waitUntil: 'commit' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-scale', '200')
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
})
