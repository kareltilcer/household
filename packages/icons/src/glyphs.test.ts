import { isMessageKey } from '@household/i18n'
import { families, moduleFamilies, moduleIds, statuses } from '@household/tokens'
import { describe, expect, it } from 'vitest'
import { grid, moduleGlyphs, statusGlyphs, type StatusId } from './glyphs.ts'
import { bounds, flatten, inkDifference, rasterise } from './raster.ts'

const statusIds = Object.keys(statusGlyphs) as StatusId[]

const sets = [
  ...Object.entries(statusGlyphs).map(
    ([id, glyph]) => [`status ${id}`, glyph.paths, grid.statusStroke] as const,
  ),
  ...Object.entries(moduleGlyphs).map(
    ([id, glyph]) => [`module ${id}`, glyph.paths, grid.moduleStroke] as const,
  ),
]

describe('the status glyphs', () => {
  it('are thirteen, one for each status token', () => {
    expect(statusIds).toHaveLength(13)
    expect(statusIds.map((id) => statusGlyphs[id].token)).toEqual(Object.keys(statuses))
    for (const id of statusIds) {
      expect(statusGlyphs[id].token).toBe(`status-${id.replaceAll('_', '-')}`)
      expect(statusGlyphs[id].labelKey).toBe(`a11y.status.${id}`)
    }
  })

  // N2: a member who cannot tell the colours apart tells these apart. Each glyph is drawn as it
  // is on a row, 16 px, at twice that resolution with its colour discarded, and every pair must
  // differ in at least 40 % of the ink either one lays down. The floor is the design's
  // (design/v1, Icons and Illustration, the Stage 3 gate), and so is the method, with the
  // stroke's own geometry in place of a browser's canvas.
  it('are distinguishable in greyscale at 16 px, every pair of them', () => {
    const floor = 0.4
    const ink = statusIds.map((id) => rasterise(statusGlyphs[id].paths, grid.statusStroke, 32))
    const pairs = statusIds.flatMap((a, i) =>
      statusIds.slice(i + 1).map((b, j) => {
        const [first, second] = [ink[i] ?? [], ink[i + 1 + j] ?? []]
        return { pair: `${a} / ${b}`, difference: inkDifference(first, second) }
      }),
    )
    expect(pairs).toHaveLength(78)
    expect(pairs.filter(({ difference }) => difference < floor)).toEqual([])
    // The two clocks are the closest pair in the set, deliberately: both are about time. They
    // are the first to measure again if the stroke weight ever changes.
    const closest = pairs.reduce((a, b) => (b.difference < a.difference ? b : a))
    expect(closest.pair).toBe('overdue / stale')
  })

  it('each lay down ink: none is an empty drawing', () => {
    for (const id of statusIds) {
      const marked = rasterise(statusGlyphs[id].paths, grid.statusStroke, 32).filter(Boolean)
      expect(marked.length, id).toBeGreaterThan(40)
    }
  })
})

describe('the navigation glyphs', () => {
  it('are the seventeen modules, Today and Add', () => {
    expect(Object.keys(moduleGlyphs)).toHaveLength(19)
    expect(Object.keys(moduleGlyphs).sort()).toEqual([...moduleIds, 'today', 'add'].sort())
  })

  it('are each drawn in their family’s accent, Today and Add in the Household family’s', () => {
    for (const id of moduleIds) {
      expect(moduleGlyphs[id].family, id).toBe(moduleFamilies[id])
      expect(moduleGlyphs[id].labelKey).toBe(`module.${id}.name`)
    }
    expect([moduleGlyphs.today.family, moduleGlyphs.add.family]).toEqual(['household', 'household'])
    expect(families[moduleGlyphs.garden.family]).toBe('accent-garden')
  })
})

describe.each(sets)('%s', (_, paths, strokeWidth) => {
  it('is path data alone: no colour, no fill, nothing but the pen’s commands', () => {
    for (const d of paths) {
      expect(d).toMatch(/^[MLHVCSAZmlhvcsaz0-9 .,-]+$/)
      expect(() => flatten(d)).not.toThrow()
      expect(flatten(d).length).toBeGreaterThan(0)
    }
  })

  it('is on the grid: no terminal needs a third decimal', () => {
    const numbers = paths.flatMap((d) => d.match(/\d*\.\d+/g) ?? [])
    expect(numbers.filter((n) => (n.split('.')[1] ?? '').length > 2)).toEqual([])
  })

  it('keeps its ink inside the 24-unit box', () => {
    const [[left, top], [right, bottom]] = bounds(paths, strokeWidth)
    expect(Math.min(left, top)).toBeGreaterThanOrEqual(0)
    expect(Math.max(right, bottom)).toBeLessThanOrEqual(grid.box)
  })
})

describe('the glyphs’ labels', () => {
  it('are keys of the catalogs', () => {
    const keys = [...Object.values(statusGlyphs), ...Object.values(moduleGlyphs)].map(
      (glyph) => glyph.labelKey,
    )
    expect(keys.filter((key) => !isMessageKey(key))).toEqual([])
    expect(new Set(keys).size).toBe(13 + 19)
  })
})

describe('the raster', () => {
  it('flattens lines, closes a path, and repeats a command over its numbers', () => {
    expect(flatten('M1 1h2v2H1z')).toEqual([
      [
        [1, 1],
        [3, 1],
      ],
      [
        [3, 1],
        [3, 3],
      ],
      [
        [3, 3],
        [1, 3],
      ],
      [
        [1, 3],
        [1, 1],
      ],
    ])
    expect(flatten('M0 0L1 0 1 1').length).toBe(2)
    expect(flatten('m1 1 2 0').at(-1)).toEqual([
      [1, 1],
      [3, 1],
    ])
  })

  it('draws an arc through the points of its circle', () => {
    // A half circle of radius 5 about (5, 5), from its left to its right, over the top.
    const points = flatten('M0 5a5 5 0 0 1 10 0').map(([, to]) => to)
    for (const [x, y] of points) expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(5, 9)
    expect(points.at(-1)).toEqual([10, 5])
    expect(Math.min(...points.map(([, y]) => y))).toBeCloseTo(0, 1)
  })

  it('ends a curve where its data says, a smooth one reflecting the last', () => {
    expect(flatten('M0 0c1 2 3 2 4 0s3-2 4 0').at(-1)?.[1]).toEqual([8, 0])
    const [, [, y]] = flatten('M0 0C0 4 4 4 4 0').at(11) ?? [[], [0, 0]]
    expect(y).toBeCloseTo(3, 1)
  })

  it('refuses a command it does not read', () => {
    expect(() => flatten('M0 0Q1 1 2 0')).toThrow('does not read')
    expect(() => flatten('M0 0L1')).toThrow('ends inside')
  })

  it('marks the pixels a stroke covers, and measures how two marks differ', () => {
    const bar = rasterise(['M4 12h16'], 2, 24)
    expect(bar.filter(Boolean)).toHaveLength(18 * 2)
    expect(inkDifference(bar, bar)).toBe(0)
    expect(inkDifference(bar, rasterise(['M12 4v16'], 2, 24))).toBeGreaterThan(0.8)
    expect(inkDifference([], [])).toBe(0)
  })
})
