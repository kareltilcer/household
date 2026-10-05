// The build-id reload prompt (06-clients §7): a page left open learns that a newer build is live
// and offers to reload. It asks build.json, which the build writes beside index.html with the id
// index.html itself carries, and it never reloads on its own.
import type { Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, open, test } from './fixtures.ts'

/** The page is looked at again: what makes it ask which build is live. */
function lookAgain(page: Page): Promise<void> {
  return page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

test('a page carries the id of the build that made it, which build.json names too', async ({
  page,
  request,
}) => {
  await open(page, paths.home.example)
  const own = await page.locator('meta[name="household-build"]').getAttribute('content')
  expect(own).toMatch(/^[0-9a-f]{16}$/)
  const live = await request.get('/build.json')
  expect(await live.json()).toEqual({ id: own })
})

test('nothing is said while the build that is live is the page’s own', async ({ page }) => {
  await open(page, paths.home.example)
  const asked = page.waitForResponse('**/build.json')
  await lookAgain(page)
  await asked
  await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
})

test('a newer build is offered, and the page reloads only when the member says so', async ({
  page,
}) => {
  await open(page, paths.home.example)
  await page.route('**/build.json', (route) => route.fulfill({ json: { id: 'a-newer-build' } }))
  await lookAgain(page)
  await expect(page.getByText('A new version of Household is ready.')).toBeVisible()
  // Still the page it was: nothing reloaded by itself.
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-kept', '')
  })
  await expect(page.locator('html')).toHaveAttribute('data-kept', '')

  await page.unroute('**/build.json')
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-kept')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
})

test('a server that cannot say which build is live is not taken for a newer one', async ({
  page,
  faults,
}) => {
  await open(page, paths.home.example)
  await page.route('**/build.json', (route) => route.fulfill({ status: 503, body: 'deploying' }))
  const asked = page.waitForResponse('**/build.json')
  await lookAgain(page)
  await asked
  await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
  // The browser says a response of 503 on its console: the one this test asked for.
  expect(faults).toEqual([expect.stringContaining('503')])
  faults.length = 0
})
