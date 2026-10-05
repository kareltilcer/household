// The twelve-state harness, measured (plan item 24's Done-when; the gate of design/v1's stage 4):
// every data-bearing body renders twelve states in two themes at 200 % text, each cell resolves to
// exactly one treatment, no body is wider than the box it is given, and every target is 44 pt,
// compact density included. The measurements are taken on live rectangles, not on declared
// minimums. Axe on the page, in both themes, is routes.spec.ts's.
import type { Page } from '@playwright/test'
import { paths } from '../src/app/paths.ts'
import {
  bodies,
  bodyIds,
  cellId,
  cellThemes,
  variantIds,
  type BodyId,
} from '../src/dev/harness/model.ts'
import { dataStates, treatments, type DataState } from '../src/ui/states.ts'
import { expect, holdTheClock, open, smallTargets, test } from './fixtures.ts'

const harness = paths.harness.example

function cell(page: Page, body: BodyId, state: DataState, theme: 'light' | 'dark' = 'light') {
  return page.locator(`[data-harness-cell="${cellId(body, state, theme)}"]`)
}

test.describe('the harness', () => {
  test('draws every body in every state in both themes, at 200 % text', async ({ page }) => {
    test.slow()
    await open(page, harness)
    expect(
      await page.evaluate(() => window.getComputedStyle(document.documentElement).fontSize),
    ).toBe('32px')

    const drawn = await page
      .locator('[data-harness-cell]')
      .evaluateAll((cells) =>
        cells.map((element) => [
          element.getAttribute('data-harness-cell'),
          element.getAttribute('data-kind'),
          element.getAttribute('data-theme'),
        ]),
      )
    const expected = bodyIds.flatMap((body) =>
      dataStates.flatMap((state) =>
        cellThemes.map((theme) => [cellId(body, state, theme), treatments[state].kind, theme]),
      ),
    )
    expect(drawn).toEqual(expected)
    expect(drawn).toHaveLength(9 * 12 * 2)
    await expect(page.locator('[data-harness-variant]')).toHaveCount(variantIds.length * 2)
  })

  test('gives no body more room than its box, and the page none sideways', async ({ page }) => {
    test.slow()
    await open(page, harness)
    const overflowing = await page
      .locator('[data-harness-cell], [data-harness-variant]')
      .evaluateAll((cells) =>
        cells
          .filter((element) => element.scrollWidth - element.clientWidth > 1)
          .map(
            (element) =>
              element.getAttribute('data-harness-cell') ??
              element.getAttribute('data-harness-variant'),
          ),
      )
    expect(overflowing).toEqual([])
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })

  for (const density of ['comfortable', 'compact'] as const) {
    test(`keeps every target at 44 pt under ${density} density`, async ({ page }) => {
      test.slow()
      await open(page, harness, { density })
      expect(await smallTargets(page.locator('main'))).toEqual([])
    })
  }

  test('draws nothing at all for a member who may not see a body', async ({ page }) => {
    await open(page, `${harness}?body=list`)
    for (const theme of cellThemes) {
      const absent = cell(page, 'list', 'absent', theme)
      await expect(absent).toBeEmpty()
    }
  })

  test('leaves out what writes where a state writes nothing, and disables nothing', async ({
    page,
  }) => {
    await open(page, `${harness}?body=list`)
    await expect(cell(page, 'list', 'populated').getByRole('button', { name: 'Open' })).toHaveCount(
      3,
    )
    for (const state of dataStates.filter((state) => !treatments[state].writes)) {
      await expect(cell(page, 'list', state).getByRole('button', { name: 'Open' })).toHaveCount(0)
    }
    await expect(page.locator('[data-harness-cell] :disabled')).toHaveCount(0)
    await expect(page.locator('[data-harness-cell] [aria-disabled="true"]')).toHaveCount(0)
  })

  test('says each state in words of its own', async ({ page }) => {
    await open(page, `${harness}?body=list`)
    const list = bodies.list
    await expect(cell(page, 'list', 'empty')).toContainText(list.empty.sentence)
    await expect(cell(page, 'list', 'empty')).toContainText(list.empty.example)
    await expect(cell(page, 'list', 'empty').getByRole('button')).toHaveText(list.empty.action)
    await expect(cell(page, 'list', 'error')).toContainText(list.error)
    await expect(cell(page, 'list', 'rejected')).toContainText(list.rejected)
    await expect(cell(page, 'list', 'withdrawn')).toContainText(list.withdrawn)
    await expect(cell(page, 'list', 'readonly')).toContainText(list.readonly)
    await expect(cell(page, 'list', 'offline')).toContainText(
      'Offline — changes are saved and will sync',
    )
    // A status is its glyph and its word together, and a row in sync carries neither.
    await expect(cell(page, 'list', 'pending')).toContainText('Not sent yet')
    await expect(cell(page, 'list', 'rejected')).toContainText('Not accepted')
    await expect(cell(page, 'list', 'populated').locator('[data-status]')).toHaveCount(0)
    await expect(
      cell(page, 'list', 'conflicted').getByRole('button', {
        name: 'Two versions of Electricity, cellar meter. Open to resolve',
      }),
    ).toBeVisible()
  })

  test('shows that a row is syncing only once it has taken longer than a moment', async ({
    page,
  }) => {
    await holdTheClock(page)
    await open(page, `${harness}?body=list`)
    const syncing = cell(page, 'list', 'syncing')
    await expect(syncing.getByText('Electricity, cellar meter')).toBeVisible()
    await page.clock.runFor(799)
    await expect(syncing.locator('[data-status="syncing"]')).toHaveCount(0)
    await page.clock.runFor(1)
    await expect(syncing.locator('[data-status="syncing"]')).toContainText('Sending')
  })

  test('gives the table no column of sync marks until a row has one to draw in it', async ({
    page,
  }) => {
    await holdTheClock(page)
    await open(page, `${harness}?body=table`)
    const heads = (state: DataState) => cell(page, 'table', state).getByRole('columnheader')
    await expect(heads('populated')).toHaveCount(3)
    // A row that waits to be sent is marked at once, and the column its mark stands in is there.
    await expect(heads('pending')).toHaveCount(4)
    // One that is syncing has no mark for a moment, and until then no column either: a write
    // that is over within the moment moves nothing in the table.
    await page.clock.runFor(799)
    await expect(heads('syncing')).toHaveCount(3)
    await expect(cell(page, 'table', 'syncing').locator('[data-status]')).toHaveCount(0)
    await page.clock.runFor(1)
    await expect(heads('syncing')).toHaveCount(4)
    await expect(cell(page, 'table', 'syncing').locator('[data-status="syncing"]')).toBeVisible()
  })

  test('draws the illustration at 100 % text and gives its room to the sentence at 200 %', async ({
    page,
  }) => {
    await open(page, `${harness}?body=list&scale=100`)
    const empty = cell(page, 'list', 'empty')
    await expect(empty.locator('svg[viewBox="0 0 200 140"]')).toBeVisible()
    await open(page, `${harness}?body=list`)
    await expect(empty).toContainText(bodies.list.empty.sentence)
    await expect(empty.locator('svg[viewBox="0 0 200 140"]')).toHaveCount(0)
  })

  test('sets the table compact by itself, and comfortable when the member says so', async ({
    page,
  }) => {
    const region = cell(page, 'table', 'populated').getByRole('region', { name: 'Ledger, March' })
    await open(page, `${harness}?body=table`)
    await expect(region).toHaveAttribute('data-density', 'compact')
    const compact = await region
      .locator('td')
      .first()
      .evaluate((td) => getComputedStyle(td).paddingLeft)
    await open(page, `${harness}?body=table`, { density: 'comfortable' })
    await expect(region).not.toHaveAttribute('data-density')
    const comfortable = await region
      .locator('td')
      .first()
      .evaluate((td) => getComputedStyle(td).paddingLeft)
    expect([compact, comfortable]).toEqual(['8px', '16px'])
  })

  test('sorts the table from its column heads, by the keyboard', async ({ page }) => {
    await open(page, `${harness}?body=table`)
    const table = cell(page, 'table', 'populated')
    const amount = table.getByRole('columnheader', { name: 'Amount' })
    await expect(table.getByRole('columnheader', { name: 'Date' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    await amount.getByRole('button').focus()
    await page.keyboard.press('Enter')
    await expect(amount).toHaveAttribute('aria-sort', 'ascending')
    await expect(table.locator('tbody tr').first()).toContainText('Electricity advance')
  })
})
