// Accessibility: axe on every route, in both themes (06-clients §4 and §8). The routes are the
// app's own list (src/app/paths.ts), which the router is built from, so a route added there is
// checked here with no further word.
import type { Page } from '@playwright/test'
import { paths, routeIds } from '../src/app/paths.ts'
import { displayKey, expect, expectAccessible, open, test } from './fixtures.ts'

for (const id of routeIds) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${paths[id].path} is accessible in the ${theme} theme`, async ({ page }) => {
      // The harness is a hundred and eight cells in two themes.
      test.slow(id === 'harness')
      await open(page, paths[id].example, { theme })
      await expectAccessible(page)
    })
  }
}

test('a page says what language it is in, and what it is', async ({ page }) => {
  await open(page, paths.home.example, { locale: 'cs' })
  await expect(page.locator('html')).toHaveAttribute('lang', 'cs')
  await expect(page).toHaveTitle('Household')
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
