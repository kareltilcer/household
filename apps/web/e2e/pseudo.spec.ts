// The pseudo-locale pass (PRD 03 §9, 06-clients §8): every route in `en-XA`, English with each
// letter accented, bracketed and padded by about 40 %. Three things show on such a page, and each
// is held here:
//
// - a string that escaped the catalogs stands out unaccented: the pseudo-locale leaves no run of
//   plain letters, so one of any length is a word nobody translated;
// - a cut-off end loses its bracket: every opening bracket has its closing one, and nothing that
//   holds text is clipped;
// - a layout that only survives English breaks: nothing is wider than the box it is given.
import { paths, routeIds } from '../src/app/paths.ts'
import { expect, inspect, open, test } from './fixtures.ts'

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
