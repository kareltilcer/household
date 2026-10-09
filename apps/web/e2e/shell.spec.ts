// The shell in a real browser (plan item 25; F-13, F-15, A-36): what it opens, under the two
// gates every route is under, and what a browser alone can show of it: a menu's list on its own
// surface, the focus that stays on a handle whose row moved. Its parts are drawn over fixture
// households on the dev page (src/dev/shell), where the sidebar has modules to list: a
// deployment's build has none with a screen until the items that add them.
import type { Locator, Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, expectAccessible, inspect, open, test } from './fixtures.ts'

const shell = paths.devShell.example

/** The first sidebar the page draws: several modules, one pinned, one put away. */
function sidebar(page: Page): Locator {
  return page.getByRole('navigation').first()
}

/** The menus of the arrange lists' rows, in the order drawn. */
function rowMenus(page: Page): Locator {
  return page.locator('main li button[aria-haspopup="menu"]')
}

for (const theme of ['light', 'dark'] as const) {
  test(`what the shell opens is accessible in the ${theme} theme`, async ({ page }) => {
    await open(page, shell, { theme })

    // The switcher's list: the member's other households, each with the role in it.
    await sidebar(page).locator('button[aria-haspopup="menu"]').click()
    await expect(page.getByRole('menuitem')).toHaveCount(2)
    await expectAccessible(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()

    // A row's menu on the arrange screen.
    await rowMenus(page).first().click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expectAccessible(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()
  })
}

test('what the shell opens survives the pseudo-locale', async ({ page }) => {
  const clean = { escaped: [], unbalanced: [], clipped: [] }
  await open(page, shell, { locale: 'en-XA' })
  await sidebar(page).locator('button[aria-haspopup="menu"]').click()
  await expect(page.getByRole('menuitem').first()).toContainText('⟦')
  expect(await inspect(page)).toEqual(clean)
  await page.keyboard.press('Escape')
  await rowMenus(page).first().click()
  await expect(page.getByRole('menuitem').first()).toContainText('⟦')
  expect(await inspect(page)).toEqual(clean)
})

test('the switcher names the household that is open and each other with its role and its state', async ({
  page,
}) => {
  await open(page, shell)
  const opener = sidebar(page).getByRole('button', {
    name: 'Switch household. Currently Tilcerovi',
  })
  await opener.click()
  await expect(page.getByRole('menuitem')).toHaveText([
    'Chata Vysočina · Member · read-only',
    'Babička · Member',
  ])
  // Escape is the menu's, and the focus goes back to what opened it.
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
})

test('arranging moves a row by the arrow keys, and the focus stays on the row’s handle', async ({
  page,
}) => {
  await open(page, shell)
  const order = page.getByRole('region', { name: 'In order' }).first()
  await expect(order.getByRole('listitem')).toHaveText(['Tasks', 'Shopping', 'Household settings'])

  const handle = order.getByRole('button', { name: 'Reorder Tasks. Use arrow keys to move it' })
  await handle.focus()
  await page.keyboard.press('ArrowDown')
  await expect(order.getByRole('listitem')).toHaveText(['Shopping', 'Tasks', 'Household settings'])
  // The handle is the same row's still, wherever the row went, and where it came to is said.
  await expect(handle).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: 'Tasks' })).toHaveText('Tasks: 2 of 3')

  // The sidebar is the same arrangement, at once.
  await expect(sidebar(page).getByRole('link')).toContainText(['Shopping', 'Tasks'])
  const listed = await sidebar(page).getByRole('link').allTextContents()
  expect(listed.indexOf('Shopping')).toBeLessThan(listed.indexOf('Tasks'))

  // And it is this browser's to keep: the page opened again draws it so.
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'In order' }).first().getByRole('listitem'),
  ).toHaveText(['Shopping', 'Tasks', 'Household settings'])
})

test('a module the member put away is named in the arrange screen alone, and comes back from there', async ({
  page,
}) => {
  await open(page, shell)
  // Put away in the fixture: in no list of the sidebar's.
  await expect(sidebar(page).getByRole('link', { name: 'Notes' })).toHaveCount(0)
  const hidden = page.getByRole('region', { name: 'Hidden by me' }).first()
  await expect(hidden.getByRole('listitem')).toHaveText([/Notes/])
  await hidden.getByRole('button', { name: 'Show Notes in your list again' }).click()
  await expect(sidebar(page).getByRole('link', { name: 'Notes' })).toBeVisible()
  // Finance is held at `none`: it is nowhere on the page, the arrange screen neither.
  await expect(page.getByText('Finance')).toHaveCount(0)
})

// The row leaves the list its controls were in, and what held the focus goes with its old place:
// in a browser the menu hands the focus back to its opener first, which is gone a moment later.
test('a row that is pinned or put away says so, and the focus goes with it to the list it went to', async ({
  page,
}) => {
  await open(page, shell)
  const said = page.getByRole('status').filter({ hasText: 'Tasks' })
  const order = page.getByRole('region', { name: 'In order' }).first()
  await order.getByRole('button', { name: 'More actions for Tasks' }).click()
  await page.getByRole('menuitem', { name: 'Pin to the top' }).click()
  await expect(said).toHaveText('Tasks is pinned to the top.')
  const pinned = page.getByRole('region', { name: 'Pinned' }).first()
  await expect(pinned.getByRole('button', { name: /^Reorder Tasks/ })).toBeFocused()

  // By the keyboard alone from there: the row's menu, and putting it away.
  await page.keyboard.press('Tab')
  await expect(pinned.getByRole('button', { name: 'More actions for Tasks' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Unpin' }).press('Enter')
  await expect(said).toHaveText('Tasks is no longer pinned.')
  await expect(order.getByRole('button', { name: /^Reorder Tasks/ })).toBeFocused()

  await order.getByRole('button', { name: 'More actions for Tasks' }).click()
  await page.getByRole('menuitem', { name: 'Hide from my list' }).click()
  await expect(said).toHaveText('Tasks is hidden from your list.')
  const show = page
    .getByRole('region', { name: 'Hidden by me' })
    .first()
    .getByRole('button', { name: 'Show Tasks in your list again' })
  await expect(show).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(said).toHaveText('Tasks is back in your list.')
  await expect(order.getByRole('button', { name: /^Reorder Tasks/ })).toBeFocused()
})
