// The build-id reload prompt (06-clients §7): a page left open learns that a newer build is live
// and offers to reload. It asks build.json, which the build writes beside index.html with the id
// index.html itself carries, and it never reloads on its own.
import type { Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, frames, open, test } from './fixtures.ts'

/** The page is looked at again: what makes it ask which build is live. */
function lookAgain(page: Page): Promise<void> {
  return page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/**
 * The page is looked at again, and what build.json answered has been read and drawn. A prompt is
 * not on the page as the answer arrives: the page reads the answer in a task of its own, draws
 * the banner, and puts the banner's words and its button into it two frames later (ui/Banner). A
 * test that expects no prompt waits all of that out. Looking as the answer arrives, it would find
 * none whatever the page went on to do.
 */
async function lookAgainAndSettle(page: Page): Promise<void> {
  const asked = page.waitForResponse('**/build.json')
  await lookAgain(page)
  await (await asked).finished()
  // A task for the answer to be read in, then the frames a prompt is drawn over, twice.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
  await frames(page, 6)
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
  await lookAgainAndSettle(page)
  await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
  await expect(page.getByText('A new version of Household is ready.')).toHaveCount(0)
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
  await lookAgainAndSettle(page)
  await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
  await expect(page.getByText('A new version of Household is ready.')).toHaveCount(0)
  // The browser says a response of 503 on its console: the one this test asked for.
  expect(faults).toEqual([expect.stringContaining('503')])
  faults.length = 0
})
