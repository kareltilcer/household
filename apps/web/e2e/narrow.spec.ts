// Every route at a phone's width and 200 % text (07-delivery §3, 06-clients §4): the hardest
// place a layout has to hold, and one nobody sees by reading a stylesheet. Measured on live
// rectangles, as the primitives' own measurements are: nothing scrolls sideways, nothing that
// holds text is clipped, and every control is a target of at least 44 × 44 px. The shell's
// navigation is a panel there, opened from the bar, and is held to the same.
//
// The twelve-state harness is the one route left out: it is a table of a hundred and eight
// cells, wider than a phone by its design, and is held at 200 % text by its own tests.
import { paths, routeIds } from '../src/app/paths.ts'
import { expect, inspect, open, reach, smallTargets, test } from './fixtures.ts'

const phone = { width: 375, height: 812 }

/** How far the page scrolls sideways, in CSS px: nothing, where its layout holds. */
function sideways(page: Parameters<typeof inspect>[0]): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

for (const id of routeIds.filter((route) => route !== 'harness')) {
  test(`${paths[id].path} holds at a phone’s width and 200 % text`, async ({ page, enter }) => {
    await page.setViewportSize(phone)
    await open(page, await reach(id, enter), { scale: '200' })
    expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)
    expect((await inspect(page)).clipped, 'text is clipped').toEqual([])
    expect(await smallTargets(page.locator('body')), 'targets under 44 px').toEqual([])
  })
}

test('the shell’s navigation is a panel at a phone’s width, and holds there too', async ({
  page,
  enter,
}) => {
  await page.setViewportSize(phone)
  await open(page, await reach('household', enter), { scale: '200' })
  // Beside the content there is no room for it: it is opened from the bar.
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await page.getByRole('button', { name: 'Menu' }).click()
  const panel = page.getByRole('dialog', { name: 'Household' })
  await expect(panel.getByRole('navigation', { name: 'Household' })).toBeVisible()
  expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)
  expect(await smallTargets(panel), 'targets under 44 px').toEqual([])
  // A destination chosen closes it, and is where the member now is.
  await panel.getByRole('link', { name: 'Your account' }).click()
  await expect(panel).toBeHidden()
  await expect(page).toHaveURL(paths.account.path)
})
