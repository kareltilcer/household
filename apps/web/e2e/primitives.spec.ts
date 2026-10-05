// The primitives' behaviour in a real browser (02-components §1 and §4.1): what a component test
// in jsdom cannot hold, since it is the browser's own doing. A modal dialog traps the focus, closes
// on Escape and gives the focus back; a menu is driven by the keyboard; a toast's undo is a button
// for the whole dwell; and hold-to-complete takes two seconds of a pointer and none of a keyboard.
import type { Locator, Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, holdTheClock, open, smallTargets, test } from './fixtures.ts'

const primitives = paths.primitives.example

/**
 * Whether the focus is on the page outside `scope`. A modal dialog makes the page behind it
 * inert, so the Tab key reaches the dialog's own controls and the browser's, which is the
 * platform's behaviour and no leak: the focus is then on no element of the page at all.
 */
function focusEscaped(scope: Locator): Promise<boolean> {
  return scope.evaluate((element) => {
    const focused = document.activeElement
    return focused !== null && focused !== document.body && !element.contains(focused)
  })
}

test.describe('a dialog', () => {
  test('traps the focus, closes on Escape and gives the focus back', async ({ page }) => {
    await open(page, primitives)
    const opener = page.getByRole('button', { name: 'Delete Weekly shop' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Delete Weekly shop?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleDescription(/14 items are deleted for everyone/)
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    for (let press = 0; press < 6; press++) {
      await page.keyboard.press('Tab')
      expect(await focusEscaped(dialog)).toBe(false)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('names what it destroys on the button that destroys it, and keeps on the other', async ({
    page,
  }) => {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Delete Weekly shop' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Keep the list' }).click()
    await expect(dialog).toBeHidden()
  })

  test('as a side panel closes by its own control, which has a name', async ({ page }) => {
    await open(page, primitives)
    const opener = page.getByRole('button', { name: 'Edit the cellar meter' })
    await opener.click()
    const panel = page.getByRole('dialog', { name: 'Cellar meter' })
    await expect(panel.getByRole('textbox', { name: 'Serial number' })).toHaveAccessibleDescription(
      'A serial number has no spaces.',
    )
    await panel.getByRole('button', { name: 'Close' }).click()
    await expect(panel).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('closes on a press on the ground behind it', async ({ page }) => {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Delete Weekly shop' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.mouse.click(4, 4)
    await expect(dialog).toBeHidden()
  })
})

test('a menu opens, moves and chooses by the keyboard, and gives the focus back', async ({
  page,
}) => {
  await open(page, primitives)
  const trigger = page.getByRole('button', { name: 'More actions for Cellar meter' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Rename',
    'Archive',
    'Delete the cellar meter',
  ])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(page.locator('[data-chosen]')).toHaveText('Archive')
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})

test.describe('a toast', () => {
  test('takes it back with a button, for the whole dwell, and then goes', async ({ page }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: 'Clear checked items' }).click()
    const toast = page
      .locator('[data-third-party] li')
      .filter({ hasText: '7 checked items cleared' })
    await expect(toast).toBeVisible()
    await page.clock.runFor(4900)
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible()
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '1')
    await expect(toast).toBeHidden()
  })

  test('goes by itself once the dwell is over', async ({ page }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: 'Save offline' }).click()
    const toast = page.locator('[data-third-party] li').filter({ hasText: 'Saved on this device' })
    await expect(toast).toBeVisible()
    await page.clock.runFor(4900)
    await expect(toast).toBeVisible()
    await page.clock.runFor(200)
    await expect(toast).toBeHidden()
  })
})

test.describe('hold-to-complete', () => {
  /** The ring a pointer holds, beside the plain button of the same name. */
  function ring(page: Page, name: string): Locator {
    return page.getByRole('button', { name }).locator('xpath=preceding-sibling::span[1]')
  }
  const bins = 'Complete Take out the bins'
  const done = (page: Page) => page.locator('[data-completions]')

  test('completes after two seconds of holding, and not a moment before', async ({ page }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await ring(page, bins).hover()
    await page.mouse.down()
    await page.clock.runFor(1999)
    await expect(done(page)).toHaveAttribute('data-completions', '0')
    await page.clock.runFor(1)
    await expect(done(page)).toHaveAttribute('data-completions', '1')
    await page.mouse.up()
  })

  test('does nothing when it is let go early, and says to keep holding', async ({ page }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await ring(page, bins).hover()
    await page.mouse.down()
    await page.clock.runFor(900)
    await page.mouse.up()
    await page.clock.runFor(5000)
    await expect(done(page)).toHaveAttribute('data-completions', '0')
    await expect(page.getByText('Keep holding to complete')).toBeVisible()
  })

  test('completes at once from the keyboard, with no hold', async ({ page }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: bins }).focus()
    await page.keyboard.press('Enter')
    await expect(done(page)).toHaveAttribute('data-completions', '1')
    // The ring shows where the focus is, since the button itself is drawn nowhere.
    await expect
      .poll(() => ring(page, bins).evaluate((element) => getComputedStyle(element).outlineStyle))
      .toBe('solid')
  })

  test('says so when the completion fails, and can be tried again', async ({ page }) => {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Complete Water the tomatoes' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Not completed. Try again')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Not completed. Try again')).toBeVisible()
  })

  test('fills in steps, not in a sweep, under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, primitives)
    const target = ring(page, bins)
    await target.hover()
    await page.mouse.down()
    const fill = target.locator('circle').nth(1)
    await expect
      .poll(() => fill.evaluate((circle) => getComputedStyle(circle).animationTimingFunction))
      .toMatch(/^steps\(10(, end)?\)$/)
    expect(await fill.evaluate((circle) => getComputedStyle(circle).animationDuration)).toBe('2s')
    await page.mouse.up()
  })
})

test('reduced motion makes every transition an instant change of state', async ({ page }) => {
  await open(page, primitives, { motion: 'reduced' })
  const button = page.getByRole('button', { name: 'Save reading' }).first()
  expect(await button.evaluate((element) => getComputedStyle(element).transitionDuration)).toMatch(
    /^0s(, 0s)*$/,
  )
  await page.getByRole('button', { name: 'More actions for Cellar meter' }).click()
  expect(
    await page.getByRole('menu').evaluate((element) => getComputedStyle(element).animationDuration),
  ).toBe('0s')
})

for (const density of ['comfortable', 'compact'] as const) {
  test(`every target is 44 pt under ${density} density`, async ({ page }) => {
    await open(page, primitives, { density })
    const small = await smallTargets(page.locator('main'))
    expect(small).toEqual([])
  })
}
