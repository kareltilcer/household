// The pseudo-locale pass (PRD 03 §9, 06-clients §8): every route in `en-XA`, English with each
// letter accented, bracketed and padded by about 40 %. Three things show on such a page, and each
// is held here:
//
// - a string that escaped the catalogs stands out unaccented: the pseudo-locale leaves no run of
//   plain letters, so one of any length is a word nobody translated;
// - a cut-off end loses its bracket: every opening bracket has its closing one, and nothing that
//   holds text is clipped;
// - a layout that only survives English breaks: nothing is wider than the box it is given.
import type { Page } from '@playwright/test'
import { paths, routeIds } from '../src/app/paths.ts'
import { expect, open, test } from './fixtures.ts'

/**
 * Plain words a page may show that are no language of the app's: what `Intl` writes into a date
 * in English, the language the pseudo-locale formats in. A unit or a currency code is under the
 * length that counts as a word.
 */
const formatted = new Set(
  Array.from({ length: 12 }, (_, month) =>
    (['long', 'short'] as const).map((style) =>
      new Intl.DateTimeFormat('en', { month: style, timeZone: 'UTC' }).format(
        Date.UTC(2026, month, 1),
      ),
    ),
  ).flat(),
)

/** The shortest run of plain letters that is taken for a word: `kWh` and `CZK` are not. */
const wordLength = 4

interface Finding {
  readonly escaped: string[]
  readonly unbalanced: string[]
  readonly clipped: string[]
}

function inspect(page: Page): Promise<Finding> {
  return page.evaluate(
    ([shortest, allowed]) => {
      const plain = new RegExp(`[A-Za-z]{${String(shortest)},}`, 'g')
      const escaped: string[] = []
      const unbalanced: string[] = []
      const clipped: string[] = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim()
        const parent = node.parentElement
        if (text === '' || parent === null || !parent.checkVisibility()) continue
        if (parent.closest('script, style, option') !== null) continue
        for (const word of text.match(plain) ?? []) {
          if (!allowed.includes(word)) escaped.push(`${word} in "${text.slice(0, 60)}"`)
        }
        const opened = text.split('⟦').length - 1
        const closed = text.split('⟧').length - 1
        if (opened !== closed) unbalanced.push(text.slice(0, 80))
      }
      for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
        if (!element.checkVisibility() || element.textContent.trim() === '') continue
        // Drawn nowhere by design: a word for assistive technology alone (ui/a11y.module.css).
        const box = element.getBoundingClientRect()
        if (box.width <= 1 || box.height <= 1) continue
        const style = window.getComputedStyle(element)
        const clips = style.overflowX === 'hidden' || style.overflowX === 'clip'
        if (clips && element.scrollWidth - element.clientWidth > 1) {
          clipped.push(element.textContent.trim().slice(0, 60))
        }
      }
      return { escaped, unbalanced, clipped }
    },
    [wordLength, [...formatted]] as const,
  )
}

for (const id of routeIds) {
  test(`${paths[id].path} survives the pseudo-locale`, async ({ page }) => {
    test.slow(id === 'harness')
    await open(page, paths[id].example, { locale: 'en-XA' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('⟦')

    expect(await inspect(page)).toEqual({ escaped: [], unbalanced: [], clipped: [] })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      'the page scrolls sideways',
    ).toBeLessThanOrEqual(1)
  })
}

test('the pass finds a string that is in no catalog', async ({ page }) => {
  await open(page, paths.home.example, { locale: 'en-XA' })
  await page.evaluate(() => {
    document.querySelector('main')?.append('Shopping list')
  })
  expect((await inspect(page)).escaped).toEqual([
    'Shopping in "Shopping list"',
    'list in "Shopping list"',
  ])
})
