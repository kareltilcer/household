// What the sync UI opens, under the two gates every route is under (plan item 25; 03-patterns
// §4): the side panel of a conflict, the side panel of a change that was not accepted, one for
// every reason a refusal is recorded with, and the confirmation that lets such a change go.
// routes.spec.ts and pseudo.spec.ts look at the page as it opens, before any of these is drawn.
// They are opened over the stand-in replica of the dev page (src/dev/sync), since no module
// writes offline yet and a household's own inbox is empty.
import type { Locator, Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, expectAccessible, inspect, open, test } from './fixtures.ts'

const sync = paths.devSync.example

/**
 * The controls that open a resolver, in the cell of `state` that is drawn light: a cell is named
 * by its section, its state and its theme (src/dev/sync/model.ts).
 */
function openers(page: Page, state: string): Locator {
  return page.locator(`[data-sync-cell="resolvers:${state}:light"]`).getByRole('button')
}

/** The panel that is open: the one modal the page has, until a confirmation stands over it. */
function panel(page: Page): Locator {
  return page.getByRole('dialog').first()
}

async function close(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

for (const theme of ['light', 'dark'] as const) {
  test(`what the sync UI opens is accessible in the ${theme} theme`, async ({ page }) => {
    // A pass of axe for each panel: the conflict's, and one for every reason of a refusal.
    test.slow()
    await open(page, sync, { theme })

    await openers(page, 'conflict').first().click()
    await expect(panel(page).getByRole('button', { name: 'Keep mine' })).toBeVisible()
    await expectAccessible(page)
    await close(page)

    const refusals = openers(page, 'rejected')
    const count = await refusals.count()
    expect(count).toBeGreaterThan(1)
    for (let index = 0; index < count; index += 1) {
      await refusals.nth(index).click()
      await expect(panel(page).getByRole('button', { name: 'Discard' })).toBeVisible()
      await expectAccessible(page)
      await close(page)
    }

    // The confirmation, over the panel it was asked from.
    await refusals.first().click()
    await panel(page).getByRole('button', { name: 'Discard' }).click()
    const confirmation = page.getByRole('dialog').filter({
      has: page.getByRole('button', { name: 'Keep it' }),
    })
    await expect(confirmation.last()).toBeVisible()
    await expectAccessible(page)
  })
}

test('what the sync UI opens survives the pseudo-locale', async ({ page }) => {
  test.slow()
  const clean = { escaped: [], unbalanced: [], clipped: [] }
  await open(page, sync, { locale: 'en-XA' })

  await openers(page, 'conflict').first().click()
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByRole('button').last()).toContainText('⟦')
  expect(await inspect(page)).toEqual(clean)
  await close(page)

  const refusals = openers(page, 'rejected')
  const count = await refusals.count()
  for (let index = 0; index < count; index += 1) {
    await refusals.nth(index).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('button').last()).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
    await close(page)
  }
})
