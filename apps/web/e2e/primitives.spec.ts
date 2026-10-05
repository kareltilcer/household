// The primitives' behaviour in a real browser (02-components §1 and §4.1): what a component test
// in jsdom cannot hold, since it is the browser's own doing. A modal dialog traps the focus, closes
// on Escape and gives the focus back; a menu is driven by the keyboard; a toast's undo is a button
// for the whole dwell; and hold-to-complete takes two seconds of a pointer and none of a keyboard.
import type { Locator, Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { expect, frames, holdTheClock, open, smallTargets, test } from './fixtures.ts'

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

/**
 * A toast arrives by itself, as one does for something that took a while: raised by no press of
 * the member's, whose focus stays where it was. The button that raises one is pressed by the
 * page's own script, which reaches it under a modal too, where the page is inert to a member.
 */
function arrive(page: Page): Promise<void> {
  return page.evaluate((name) => {
    const raises = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === name,
    )
    if (raises === undefined) throw new Error(`no button named ${name}`)
    raises.click()
  }, 'Save offline')
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

  test('as a side panel opens on the field its owner names, not on what closes it', async ({
    page,
  }) => {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Edit the cellar meter' }).click()
    const panel = page.getByRole('dialog', { name: 'Cellar meter' })
    await expect(panel.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused()
  })

  test('closes on a press on the ground behind it', async ({ page }) => {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Delete Weekly shop' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.mouse.click(4, 4)
    await expect(dialog).toBeHidden()
  })

  test('stays when a press that began on the ground behind it is let go inside it', async ({
    page,
  }) => {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Delete Weekly shop' }).click()
    const dialog = page.getByRole('dialog')
    const title = await dialog.getByRole('heading').boundingBox()
    if (title === null) throw new Error('the dialog draws no title')
    // The click of such a press is the dialog's own, as the click of one on the ground is:
    // where the pointer was let go tells the two apart.
    await page.mouse.move(4, 4)
    await page.mouse.down()
    await page.mouse.move(title.x + 4, title.y + 4, { steps: 4 })
    await page.mouse.up()
    await frames(page)
    await expect(dialog).toBeVisible()
    await page.mouse.click(4, 4)
    await expect(dialog).toBeHidden()
  })

  test('as a side panel that asks before it closes, is there through every Escape, its question over it', async ({
    page,
  }) => {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Add a note' }).click()
    const panel = page.getByRole('dialog', { name: 'Note on the cellar meter' })
    const question = page.getByRole('dialog', { name: 'Discard the note?' })
    const note = panel.getByRole('textbox', { name: 'What to remember' })
    await expect(note).toBeFocused()
    await note.fill('Read it on the first of the month')

    // Escape asks the panel, which asks its question and stays; Escape again answers the
    // question, to keep writing. A browser lets a page refuse Escape only so many times in a
    // row, and then closes the dialog whatever the page says: the panel is there all the same,
    // shown again, and its question opened after it and so over it.
    for (let press = 1; press <= 8; press++) {
      await page.keyboard.press('Escape')
      await expect(panel).toBeVisible()
      if (press % 2 === 1) {
        await expect(question).toBeVisible()
        // The safe choice is the first, and the one the focus is on.
        await expect(question.getByRole('button', { name: 'Keep writing' })).toBeFocused()
      } else {
        await expect(question).toBeHidden()
      }
    }
    await expect(note).toHaveValue('Read it on the first of the month')

    // Over the panel, where a pointer reaches it: under it, the press would land on the panel.
    await page.keyboard.press('Escape')
    await question.getByRole('button', { name: 'Keep writing' }).click()
    await expect(question).toBeHidden()
    await expect(panel).toBeVisible()
    await expect(note).toHaveValue('Read it on the first of the month')

    await panel.getByRole('button', { name: 'Close' }).click()
    await question.getByRole('button', { name: 'Discard the note' }).click()
    await expect(panel).toBeHidden()
    await expect(page.getByRole('button', { name: 'Add a note' })).toBeFocused()
  })

  test('as a side panel drawn only while it is open, gives the focus back when it is taken away, its question with it', async ({
    page,
  }) => {
    await open(page, primitives)
    const opener = page.getByRole('button', { name: 'Rename the cellar meter' })
    const panel = page.getByRole('dialog', { name: 'Rename the cellar meter' })
    const question = page.getByRole('dialog', { name: 'Discard the name?' })

    // Its owner draws it for as long as it is open, and saved it is gone from the page. The
    // platform gives the focus back from a dialog that is in the document still, and from one
    // taken out of it gives none: the focus would be the page's, at its top.
    await opener.click()
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'Save the name' }).click()
    await expect(panel).toHaveCount(0)
    await expect(opener).toBeFocused()

    // Taken away with its question open over it, the two at once: the question holds the page
    // inert until it is closed, the opener with it, so it is closed before the panel is.
    await page.keyboard.press('Enter')
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(question.getByRole('button', { name: 'Keep renaming' })).toBeFocused()
    await question.getByRole('button', { name: 'Discard the name' }).click()
    await expect(panel).toHaveCount(0)
    await expect(opener).toBeFocused()

    // Nothing is left holding the page inert: it opens again.
    await page.keyboard.press('Enter')
    await expect(panel).toBeVisible()
  })
})

test('a checkbox that is neither on nor off is neither still after a press, where its owner says so', async ({
  page,
}) => {
  await open(page, primitives)
  const some = page.getByRole('checkbox', { name: 'Some of these lists' })
  await expect(some).toHaveJSProperty('indeterminate', true)
  // The platform makes a pressed box plainly on or off; this one stands for what its owner says.
  await some.click()
  await expect(some).toHaveJSProperty('indeterminate', true)
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
  // Radix moves the focus a moment after the key that asks for it, on a timer of its own: the
  // next key is pressed once the focus is where that one put it, as a member's is.
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Archive' })).toBeFocused()
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

test('a confirmation opened from a menu gives the focus back to the menu’s trigger', async ({
  page,
}) => {
  await open(page, primitives)
  const trigger = page.getByRole('button', { name: 'More actions for Cellar meter' })
  const menu = page.getByRole('menu')
  const remove = menu.getByRole('menuitem', { name: 'Delete the cellar meter' })
  const dialog = page.getByRole('dialog', { name: 'Delete the cellar meter?' })

  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(remove).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(menu).toBeHidden()
  // The safe choice is the first, and the one the focus is on.
  await expect(dialog.getByRole('button', { name: 'Keep the meter' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  // The item that opened it is gone with its menu: the focus is where the menu was opened.
  await expect(trigger).toBeFocused()

  // By a pointer as by the keyboard.
  await trigger.click()
  await remove.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep the meter' }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('a select reads its placeholder while nothing is chosen, and no first option', async ({
  page,
}) => {
  await open(page, primitives)
  const register = page.getByRole('combobox', { name: 'Register' })
  await expect(register).toHaveValue('')
  expect(
    await register.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent),
  ).toBe('Choose')
  await register.selectOption('night')
  await expect(register).toHaveValue('night')
})

test('a stepper holds a whole number: a fraction typed in is the nearest one once it is left', async ({
  page,
}) => {
  await open(page, primitives)
  const members = page.getByRole('spinbutton', { name: 'Members' })
  await members.fill('2.5')
  await members.blur()
  await expect(members).toHaveValue('3')
})

test.describe('inside a side panel, which makes the page outside it inert', () => {
  const serial = 'More actions for Serial number'

  async function openPanel(page: Page): Promise<Locator> {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Edit the cellar meter' }).click()
    const panel = page.getByRole('dialog', { name: 'Cellar meter' })
    await expect(panel).toBeVisible()
    return panel
  }

  test('a menu is the panel’s own: it opens, chooses, and closes alone on Escape', async ({
    page,
  }) => {
    const panel = await openPanel(page)
    const trigger = panel.getByRole('button', { name: serial })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const menu = panel.getByRole('menu')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    // Escape closed the menu, and the panel it was opened from is where it was.
    await expect(panel).toBeVisible()
    await expect(trigger).toBeFocused()

    await trigger.click()
    await menu.getByRole('menuitem', { name: 'Copy the serial number' }).click()
    await expect(menu).toBeHidden()
    await expect(panel).toBeVisible()
  })

  test('a toast is drawn in the panel, and its undo can be pressed there', async ({ page }) => {
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: serial }).click()
    await panel.getByRole('menuitem', { name: 'Clear the serial number' }).click()
    const toast = panel
      .locator('[data-third-party] li')
      .filter({ hasText: 'Serial number cleared' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '1')
    await expect(toast).toBeHidden()
    await expect(panel).toBeVisible()
  })

  test('a toast stays, on the page again, when the panel closes under it', async ({ page }) => {
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: serial }).click()
    await panel.getByRole('menuitem', { name: 'Clear the serial number' }).click()
    await expect(panel.locator('[data-third-party] li')).toBeVisible()
    await panel.getByRole('button', { name: 'Close' }).click()
    await expect(panel).toBeHidden()
    const toast = page.locator('[data-third-party] li').filter({ hasText: 'Serial number cleared' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '1')
  })

  test('a toast stays, its undo with it, when Escape closes the panel under it', async ({
    page,
  }) => {
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: serial }).click()
    await panel.getByRole('menuitem', { name: 'Clear the serial number' }).click()
    await expect(panel.locator('[data-third-party] li')).toBeVisible()
    // One Escape, pressed in the panel, is the panel's: Radix would put the newest toast away
    // for it as well, and the Undo would be gone before its dwell was.
    await expect(panel.getByRole('button', { name: serial })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    const toast = page.locator('[data-third-party] li').filter({ hasText: 'Serial number cleared' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '1')
  })

  test('Escape on a toast puts the toast away, and the panel it is drawn in stays', async ({
    page,
  }) => {
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: serial }).click()
    await panel.getByRole('menuitem', { name: 'Clear the serial number' }).click()
    const toast = panel
      .locator('[data-third-party] li')
      .filter({ hasText: 'Serial number cleared' })
    await toast.getByRole('button', { name: 'Undo' }).focus()
    await page.keyboard.press('Escape')
    await expect(toast).toBeHidden()
    // The key was spent on the toast: the editor around it was not asked to close by it too.
    await expect(panel).toBeVisible()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '0')
    // The next one is the panel's.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })

  test('Escape in a menu closes the menu alone, though a toast arrived while it was open', async ({
    page,
  }) => {
    const panel = await openPanel(page)
    const trigger = panel.getByRole('button', { name: serial })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const menu = panel.getByRole('menu')
    await expect(menu.getByRole('menuitem').first()).toBeFocused()
    await arrive(page)
    const toast = panel.locator('[data-third-party] li').filter({ hasText: 'Saved on this device' })
    await expect(toast).toBeVisible()
    // Radix hands the key to what it layered last, which is the toast. The menu closes by it all
    // the same, the toast keeps its dwell, and the panel is not asked to close by a key the menu
    // has spent: what was typed in it is still there.
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(panel).toBeVisible()
    await expect(toast).toBeVisible()
    await expect(trigger).toBeFocused()
    // The next one is the panel's.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })

  test('a toast leaves the panel’s own actions clear on a narrow window, for as long as it is shown', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const panel = await openPanel(page)
    const save = panel.getByRole('button', { name: 'Save', exact: true })
    const rest = await save.boundingBox()
    await panel.getByRole('button', { name: serial }).click()
    await panel.getByRole('menuitem', { name: 'Clear the serial number' }).click()
    const toast = panel
      .locator('[data-third-party] li')
      .filter({ hasText: 'Serial number cleared' })
    await expect(toast).toBeVisible()
    // The toasts are over the foot of the window, which is where the panel keeps Save: the
    // panel's foot stands above them, or a press meant for Save would land on the toast's Undo.
    await expect
      .poll(async () => {
        const [button, over] = await Promise.all([save.boundingBox(), toast.boundingBox()])
        return button !== null && over !== null && button.y + button.height <= over.y
      })
      .toBe(true)
    await save.click({ trial: true })
    // And is where it was once the toast has gone.
    await toast.getByRole('button', { name: 'Dismiss' }).click()
    await expect(toast).toBeHidden()
    await expect.poll(async () => (await save.boundingBox())?.y).toBe(rest?.y)
  })

  test('a toast pointed at while the panel closes under it goes once the pointer has left it', async ({
    page,
  }) => {
    await holdTheClock(page)
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: serial }).click()
    await panel.getByRole('menuitem', { name: 'Clear the serial number' }).click()
    const toast = page.locator('[data-third-party] li').filter({ hasText: 'Serial number cleared' })
    await expect(toast).toBeVisible()
    await toast.hover()
    // Closed from the keyboard, so the pointer stays where it is: on the toast, which is drawn
    // in the same place on the page as it was in the panel.
    await panel.getByRole('button', { name: 'Close' }).focus()
    await page.keyboard.press('Enter')
    await expect(panel).toBeHidden()
    await page.clock.runFor(6000)
    await expect(toast).toBeVisible()
    await page.mouse.move(4, 4)
    await page.clock.runFor(5100)
    await expect(toast).toBeHidden()
  })
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

  /** The two toasts of the page, the second raised once the first has been closed. */
  const cleared = (page: Page) =>
    page.locator('[data-third-party] li').filter({ hasText: '7 checked items cleared' })
  const saved = (page: Page) =>
    page.locator('[data-third-party] li').filter({ hasText: 'Saved on this device' })

  test('takes it back once and goes, though the pointer drifted as it pressed Undo', async ({
    page,
  }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: 'Clear checked items' }).click()
    const undo = await cleared(page).getByRole('button', { name: 'Undo' }).boundingBox()
    if (undo === null) throw new Error('the toast draws no Undo')
    // A press is seldom still. Radix takes one that moves two pixels for a swipe called off,
    // and lets its click take back but not close: the toast would stay, to undo a second time.
    const [x, y] = [undo.x + undo.width / 2, undo.y + undo.height / 2]
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 4, y, { steps: 4 })
    await page.mouse.up()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '1')
    await expect(cleared(page)).toBeHidden()
  })

  test('stays, its Undo with it, when a pointer is dragged across it', async ({ page }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: 'Clear checked items' }).click()
    const words = await cleared(page).getByText('7 checked items cleared').boundingBox()
    if (words === null) throw new Error('the toast draws no words')
    // No gesture puts a toast away: Radix's swipe, of which nothing would be drawn, is not on.
    const y = words.y + words.height / 2
    await page.mouse.move(words.x + 4, y)
    await page.mouse.down()
    await page.mouse.move(words.x + 84, y, { steps: 8 })
    await page.mouse.up()
    await expect(cleared(page).getByRole('button', { name: 'Undo' })).toBeVisible()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '0')
    await cleared(page).getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '1')
    await expect(cleared(page)).toBeHidden()
  })

  test('goes after its dwell though the one before it was closed by a press on its Undo', async ({
    page,
  }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: 'Clear checked items' }).click()
    // Pointed at, a toast's dwell is held; closed there, it is gone before the pointer leaves.
    await cleared(page).getByRole('button', { name: 'Undo' }).click()
    await expect(cleared(page)).toBeHidden()
    await page.getByRole('button', { name: 'Save offline' }).click()
    await expect(saved(page)).toBeVisible()
    await page.clock.runFor(5100)
    await expect(saved(page)).toBeHidden()
  })

  test('goes after its dwell though another beside it was closed by a press on its Undo', async ({
    page,
  }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: 'Clear checked items' }).click()
    await page.getByRole('button', { name: 'Save offline' }).click()
    await expect(saved(page)).toBeVisible()
    // Radix hands the focus of a toast that closes to the toasts' region, and holds every dwell
    // while the focus is there, where a member who pressed with a pointer is not.
    await cleared(page).getByRole('button', { name: 'Undo' }).click()
    await expect(cleared(page)).toBeHidden()
    await expect(page.locator('[data-undone]')).toHaveAttribute('data-undone', '1')
    await expect(saved(page)).toBeVisible()
    // The pointer leaves the toasts, with no press anywhere else.
    await page.mouse.move(4, 4)
    await page.clock.runFor(5100)
    await expect(saved(page)).toBeHidden()
  })

  test('is left alone by Escape pressed in a menu, which closes, though it arrived after the menu opened', async ({
    page,
  }) => {
    await open(page, primitives)
    const trigger = page.getByRole('button', { name: 'More actions for Cellar meter' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem').first()).toBeFocused()
    await arrive(page)
    await expect(saved(page)).toBeVisible()
    // One Escape does one thing, and in a menu it closes the menu.
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(saved(page)).toBeVisible()
    await expect(trigger).toBeFocused()
    // Nor is the next one the toast's, with nothing else open: the focus is on the page, and
    // the key is for what it is in. A toast is no layer the member opened.
    await page.keyboard.press('Escape')
    await expect(saved(page)).toBeVisible()
    // From among the toasts, reached by their key, it puts the toast away.
    await page.keyboard.press('F8')
    await expect(page.locator('ol[data-third-party]')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(saved(page)).toBeHidden()
  })

  test('keeps the focus among the toasts when Escape there puts one away, whatever was pressed before', async ({
    page,
  }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: 'Clear checked items' }).click()
    await page.getByRole('button', { name: 'Save offline' }).click()
    await expect(saved(page)).toBeVisible()
    // A press on a toast's words, which closes nothing, and a press on the page after it.
    await cleared(page).getByText('7 checked items cleared').click()
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('F8')
    const region = page.locator('ol[data-third-party]')
    await expect(region).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(saved(page)).toBeHidden()
    // Closed by a key: the member is among the toasts still, and the one that remains waits.
    await expect(region).toBeFocused()
    await expect(cleared(page)).toBeVisible()
  })

  test('goes after its dwell though the one before it was closed from the keyboard', async ({
    page,
  }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await page.getByRole('button', { name: 'Clear checked items' }).focus()
    await page.keyboard.press('Enter')
    await cleared(page).getByRole('button', { name: 'Undo' }).focus()
    await page.keyboard.press('Enter')
    await expect(cleared(page)).toBeHidden()
    await page.getByRole('button', { name: 'Save offline' }).focus()
    await page.keyboard.press('Enter')
    await expect(saved(page)).toBeVisible()
    await page.clock.runFor(5100)
    await expect(saved(page)).toBeHidden()
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

  test('does nothing when it is let go early, says to keep holding, and is then as it was', async ({
    page,
  }) => {
    await holdTheClock(page)
    await open(page, primitives)
    await ring(page, bins).hover()
    await page.mouse.down()
    await page.clock.runFor(900)
    await page.mouse.up()
    await expect(page.getByText('Keep holding to complete')).toBeVisible()
    await page.clock.runFor(4900)
    await expect(page.getByText('Keep holding to complete')).toBeVisible()
    // The word stays as long as a toast would, and the row is not left saying it.
    await page.clock.runFor(200)
    await expect(page.getByText('Keep holding to complete')).toBeHidden()
    await expect(done(page)).toHaveAttribute('data-completions', '0')
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

  test('has the region its word is said in on the page before any word, taking no room', async ({
    page,
  }) => {
    await open(page, primitives)
    const target = ring(page, bins)
    const hold = target.locator('xpath=..')
    // There for assistive technology while it is empty: what is put into a region already on
    // the page is said, and a region that arrives with its word in it need not be.
    await expect(hold.getByRole('status')).toHaveCount(1)
    await expect(hold.getByRole('status')).toBeEmpty()
    const [whole, held] = await Promise.all([hold.boundingBox(), target.boundingBox()])
    expect(whole?.width).toBe(held?.width)
  })

  test('says so when the completion fails, and can be tried again', async ({ page }) => {
    await open(page, primitives)
    await page.getByRole('button', { name: 'Complete Water the tomatoes' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Not completed. Try again')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Not completed. Try again')).toBeVisible()
  })

  test.describe('under a finger', () => {
    test.use({ hasTouch: true })

    /** A finger on the screen, which Playwright's own touch screen only taps with. */
    async function finger(page: Page) {
      const session = await page.context().newCDPSession(page)
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: [number, number][]) =>
        session.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: at.map(([x, y]) => ({ x, y })),
        })
      return {
        down: (x: number, y: number) => touch('touchStart', [[x, y]]),
        move: (x: number, y: number) => touch('touchMove', [[x, y]]),
        up: () => touch('touchEnd', []),
      }
    }

    /** The middle of the ring, brought into the window. */
    async function middle(target: Locator): Promise<[number, number]> {
      await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox()
      if (box === null) throw new Error('the control draws no ring')
      return [box.x + box.width / 2, box.y + box.height / 2]
    }

    test('completes after two seconds of a finger kept on the ring', async ({ page }) => {
      await holdTheClock(page)
      await open(page, primitives)
      const [x, y] = await middle(ring(page, bins))
      const touch = await finger(page)
      await touch.down(x, y)
      // A finger is never quite still: it moves, and stays on the ring.
      await touch.move(x + 4, y + 3)
      await page.clock.runFor(1999)
      await expect(done(page)).toHaveAttribute('data-completions', '0')
      await page.clock.runFor(1)
      await expect(done(page)).toHaveAttribute('data-completions', '1')
      await touch.up()
    })

    test('is given up by a finger that slides off the ring, though it stays down', async ({
      page,
    }) => {
      await holdTheClock(page)
      await open(page, primitives)
      const [x, y] = await middle(ring(page, bins))
      const touch = await finger(page)
      await touch.down(x, y)
      await page.clock.runFor(500)
      // A touch is held by what it lands on, which is told of no leaving while the finger is
      // down: the ring lets go of it, and hears that the finger has left as it hears of a mouse.
      await touch.move(x + 60, y)
      await touch.move(x + 120, y)
      await expect(page.getByText('Keep holding to complete')).toBeVisible()
      await page.clock.runFor(2000)
      await expect(done(page)).toHaveAttribute('data-completions', '0')
      await touch.up()
    })
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
