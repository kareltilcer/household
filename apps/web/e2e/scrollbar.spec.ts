// Where a scrollbar takes room of the window, as it does on Windows and Linux. Headless Chromium
// draws none unless it is asked to, so every other test sees a page as wide as its window whatever
// is open over it: this file's browser is launched with its scrollbars, which Playwright lets a
// file ask for and no single test.
import type { Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import { drawn, expect, open, test } from './fixtures.ts'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

/** One pixel of the window as it is drawn, the scrollbar's room with it: its red, green, blue. */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  return page.evaluate(async (png) => {
    const bytes = Uint8Array.from(window.atob(png), (byte) => byte.charCodeAt(0))
    const image = await window.createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no canvas to read a pixel on')
    context.drawImage(image, 0, 0)
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }, shot.toString('base64'))
}

test('a dialog leaves the page behind it as wide as it was, and a side panel stays on the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await open(page, paths.primitives.example)
  const room = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth)
  test.skip(room === 0, 'no scrollbar takes room on this platform')
  // What is laid out, and not what the root says of itself, which counts the room as its own
  // while nothing scrolls.
  const widths = () =>
    page.evaluate(() => ({
      page: document.body.getBoundingClientRect().width,
      main: document.querySelector('main')?.getBoundingClientRect().width,
    }))
  const before = await widths()
  expect(before.page).toBe(420 - room)

  // A modal takes the page's scrollbar away (styles/base.css), and not its room: nothing behind
  // it moves sideways as it opens, or back as it closes.
  await page.getByRole('button', { name: 'Delete Weekly shop' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete Weekly shop?' })
  await expect(dialog).toBeVisible()
  expect(await widths()).toEqual(before)
  // The scrollbar's room is the root's own ground, under no dialog's backdrop: the root draws it
  // as the page's ground is under the backdrop's veil, and no strip of the page is left undimmed
  // beside the rest. Read off the window as it is drawn, at its top, where the page is bare.
  const bare = await drawn(page, [
    await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor),
  ])
  const [dimmed, kept] = [await pixel(page, 420 - room - 2, 2), await pixel(page, 420 - 2, 2)]
  // A veil drawn over the ground and the two mixed into one colour round to within a step of
  // each other, and both are far from the ground with no veil on it.
  const apart = (one: number[], other: number[]) =>
    Math.max(...one.map((channel, at) => Math.abs(channel - (other[at] ?? 0))))
  expect(apart(dimmed, bare)).toBeGreaterThan(16)
  expect(apart(kept, dimmed)).toBeLessThanOrEqual(2)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await widths()).toEqual(before)

  await page.getByRole('button', { name: 'Edit the cellar meter' }).click()
  const panel = page.getByRole('dialog', { name: 'Cellar meter' })
  await expect(panel).toBeVisible()
  expect(await widths()).toEqual(before)
  // As wide as the page at most, which is narrower than the window here.
  const box = await panel.boundingBox()
  expect(box?.x).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(before.page)
})
