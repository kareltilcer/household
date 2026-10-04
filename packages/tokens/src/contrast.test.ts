// The build gate of 06-clients §4: every declared pair clears its minimum in both themes, and a
// pair that does not fails the build. Gates are not rewritten to pass: a failure here is a token
// to change in design, not a minimum to lower.
import { describe, expect, it } from 'vitest'
import { contrast, exempt, grounds, lateSpends, pairs, resolve, themes } from './index.ts'
import { hues } from './primitives.ts'

describe('contrast', () => {
  it('is WCAG’s ratio', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 10)
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 10)
    expect(contrast('#777777', '#777777')).toBe(1)
    // The grey that just misses AA on white, and the one that just meets it.
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.478, 3)
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.542, 3)
  })

  it('refuses what is not a colour', () => {
    expect(() => contrast('#FFF', '#000000')).toThrow('#FFF')
    expect(() => contrast('var(--surface)', '#000000')).toThrow()
  })
})

describe.each(themes)('the declared pairs in %s', (theme) => {
  it.each(pairs.map((pair) => [`${pair.fg} on ${pair.bg}`, pair] as const))(
    '%s clears its minimum',
    (_, pair) => {
      const ratio = contrast(resolve(pair.fg, theme), resolve(pair.bg, theme))
      expect(ratio, `${pair.use}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(pair.min)
    },
  )
})

describe('the declared pairs', () => {
  // The design's 111, and the Household family's accent under its own name, which the design
  // tests as `accent`: on the three grounds, and under its ink. Counted, because a pair that
  // leaves the list while each of its tokens stays in another fails no other test.
  it('are 115', () => {
    // The two texts on four surfaces; on each ground the link, seven accents, four statuses,
    // the strong border and the focus ring; the inks on seven accents, danger and the inverse
    // surface; eight series on two surfaces and the axis; thirteen statuses on three grounds.
    expect(pairs).toHaveLength(2 * 4 + 3 * (1 + 7 + 4 + 1 + 1) + (7 + 1 + 1) + (8 * 2 + 1) + 13 * 3)
    expect(pairs).toHaveLength(115)
  })

  it('name no pair twice', () => {
    const names = pairs.map((pair) => `${pair.fg} on ${pair.bg}`)
    expect(names.filter((name, at) => names.indexOf(name) !== at)).toEqual([])
  })

  it('hold every colour spend drawn after the list was settled, at its minimum', () => {
    const undeclared = lateSpends.filter(
      (spend) =>
        !pairs.some(
          (pair) => pair.fg === spend.fg && pair.bg === spend.bg && pair.min >= spend.min,
        ),
    )
    expect(undeclared).toEqual([])
    expect(lateSpends).toHaveLength(18)
  })
})

describe('the exemptions', () => {
  it('say why text-disabled is no pair: 2.2:1 at its lowest in light, by intent', () => {
    expect(exempt['text-disabled']).toContain('2.2:1')
    const ratios = grounds.map((ground) =>
      contrast(resolve('text-disabled', 'light'), resolve(ground, 'light')),
    )
    // On the sunken well, the darkest light ground. It clears 3:1 on none of the three.
    expect(Math.min(...ratios)).toBeCloseTo(2.2, 1)
    expect(Math.max(...ratios)).toBeLessThan(3)
  })
})

describe('the hue ramps', () => {
  it.each(Object.entries(hues))(
    '%s is solved: 600 is ink on the darkest light surface, 400 on the lightest dark one',
    (_, steps) => {
      expect(contrast(steps[600], resolve('surface-sunken', 'light'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(steps[400], resolve('surface-overlay', 'dark'))).toBeGreaterThanOrEqual(4.5)
    },
  )
})
