// What a route opens, under the two gates every route is under (06-clients §4 and §8): a
// confirmation, a side panel with a menu and a toast drawn inside it, a menu with an item that
// destroys, toasts with and without an undo, the word a hold let go early says, and the prompt
// that a newer build is live. routes.spec.ts and pseudo.spec.ts look at each route as it opens,
// which is before any of these is drawn; here each is opened first. The sheets and menus stand on
// a surface of their own, with contrast pairs of their own (@household/tokens), and nothing else
// reads those pairs off a drawn page.
import type { Locator, Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, expectAccessible, inspect, open, test } from './fixtures.ts'

const primitives = paths.primitives.example

/** A toast on the screen, wherever its region is drawn: the page, or the modal that is open. */
function toasts(scope: Page | Locator): Locator {
  return scope.locator('[data-third-party] li')
}

/** A newer build goes live, and the page is looked at again. */
async function deploy(page: Page): Promise<void> {
  await page.route('**/build.json', (route) => route.fulfill({ json: { id: 'a-newer-build' } }))
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`what a route opens is accessible in the ${theme} theme`, async ({ page }) => {
    // Eight passes of axe over the page of primitives, one for each thing opened.
    test.slow()
    await open(page, primitives, { theme })

    // A confirmation.
    await page.getByRole('button', { name: 'Delete Weekly shop' }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete Weekly shop?' })
    await expect(confirmation).toBeVisible()
    await expectAccessible(page)
    await confirmation.getByRole('button', { name: 'Keep the list' }).click()
    await expect(confirmation).toBeHidden()

    // A side panel: an editor's fields, one of them in error, then its menu, then a toast in it.
    await page.getByRole('button', { name: 'Edit the cellar meter' }).click()
    const panel = page.getByRole('dialog', { name: 'Cellar meter' })
    await expect(panel).toBeVisible()
    await expectAccessible(page)
    await panel.getByRole('button', { name: 'More actions for Serial number' }).click()
    await expect(panel.getByRole('menu')).toBeVisible()
    await expectAccessible(page)
    await panel.getByRole('menuitem', { name: 'Clear the serial number' }).click()
    await expect(toasts(panel)).toBeVisible()
    await expectAccessible(page)
    await panel.getByRole('button', { name: 'Close' }).click()
    await expect(panel).toBeHidden()

    // A menu on the page, an item that destroys among its items.
    await page.getByRole('button', { name: 'More actions for Cellar meter' }).click()
    await expect(page.getByRole('menuitem', { name: 'Delete the cellar meter' })).toBeVisible()
    await expectAccessible(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()

    // Toasts on the page: one with an undo, one without.
    await page.getByRole('button', { name: 'Clear checked items' }).click()
    await page.getByRole('button', { name: 'Save offline' }).click()
    await expect(toasts(page).filter({ hasText: 'Saved on this device' })).toBeVisible()
    await expectAccessible(page)

    // The word of a hold let go early.
    const ring = page
      .getByRole('button', { name: 'Complete Take out the bins' })
      .locator('xpath=preceding-sibling::span[1]')
    await ring.hover()
    await page.mouse.down()
    await page.mouse.up()
    await expect(page.getByText('Keep holding to complete')).toBeVisible()
    await expectAccessible(page)

    // The prompt that a newer build is live.
    await deploy(page)
    await expect(page.getByText('A new version of Household is ready.')).toBeVisible()
    await expectAccessible(page)
  })
}

test.describe('under the pseudo-locale, where no control has a name a test can spell', () => {
  const clean = { escaped: [], unbalanced: [], clipped: [] }

  /** The sections of the page of primitives, in the order it draws them (src/dev/Primitives.tsx). */
  const sections = { dialogs: 2, menus: 3, toasts: 4, holds: 5 } as const
  function section(page: Page, name: keyof typeof sections): Locator {
    return page.locator('main section').nth(sections[name])
  }

  test('a confirmation and a side panel, its menu and a toast in it, survive', async ({ page }) => {
    await open(page, primitives, { locale: 'en-XA' })
    // While none of its dialogs is open, the section's buttons are the four that open one.
    const openers = section(page, 'dialogs').getByRole('button')
    await expect(openers).toHaveCount(4)

    await openers.nth(0).click()
    const confirmation = page.getByRole('dialog')
    await expect(confirmation.getByRole('heading')).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
    await page.keyboard.press('Escape')
    await expect(confirmation).toBeHidden()

    await openers.nth(1).click()
    const panel = page.getByRole('dialog')
    await expect(panel.getByRole('heading')).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
    await panel.locator('button[aria-haspopup="menu"]').click()
    await expect(panel.getByRole('menuitem').first()).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
    await panel.getByRole('menuitem').first().click()
    await expect(toasts(panel)).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
  })

  test('a menu, toasts, the word of a hold let go early and the prompt of a newer build survive', async ({
    page,
  }) => {
    await open(page, primitives, { locale: 'en-XA' })

    await section(page, 'menus').locator('button[aria-haspopup="menu"]').click()
    await expect(page.getByRole('menuitem')).toHaveCount(3)
    await expect(page.getByRole('menuitem').last()).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()

    const raisers = section(page, 'toasts').getByRole('button')
    await raisers.nth(0).click()
    await raisers.nth(1).click()
    await expect(toasts(page)).toHaveCount(2)
    await expect(toasts(page).last()).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)

    const hold = section(page, 'holds').locator('[data-phase]').first()
    await hold.locator(':scope > span').first().hover()
    await page.mouse.down()
    await page.mouse.up()
    await expect(hold).toHaveAttribute('data-phase', 'released')
    await expect(hold.getByRole('status')).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)

    // The prompt stands before the page's landmark, in what every route is drawn in.
    await deploy(page)
    await expect(page.locator('main').locator('xpath=preceding-sibling::*')).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      'the page scrolls sideways',
    ).toBeLessThanOrEqual(1)
  })
})
