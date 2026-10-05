import { colors, cssVar, families, resolve, themes, type ColorToken } from '@household/tokens'
import { describe, expect, it } from 'vitest'
import {
  compositions,
  fillOpacity,
  frame,
  illustration,
  parts,
  partScales,
  type Composition,
  type CompositionId,
  type Part,
} from './illustration.ts'
import { bounds, flatten } from './raster.ts'
import { nodes, type Drawing, type Path } from './svg.ts'

const ids = Object.keys(compositions) as CompositionId[]
const composed: readonly (readonly [CompositionId, Composition])[] = ids.map((id) => [
  id,
  compositions[id],
])
const kit: readonly (readonly [string, Part])[] = Object.entries(parts)

function drawnPaths(drawing: Drawing): Path[] {
  return nodes(drawing).filter((node): node is Path => node.tag === 'path')
}

describe('the kit', () => {
  it('is eighteen parts and eleven compositions', () => {
    expect(kit).toHaveLength(18)
    expect(ids).toHaveLength(11)
  })

  it.each(kit)('%s is strokes on the 48-unit box, with fills only in closed areas', (_, part) => {
    expect(part.paths.length).toBeGreaterThan(0)
    const [[left, top], [right, bottom]] = bounds([...part.paths, ...part.fills], frame.stroke)
    expect(Math.min(left, top)).toBeGreaterThanOrEqual(0)
    expect(Math.max(right, bottom)).toBeLessThanOrEqual(frame.partBox)
    for (const d of [...part.paths, ...part.fills]) {
      expect(d).toMatch(/^[MLHVCSAZmlhvcsaz0-9 .,-]+$/)
      expect(() => flatten(d)).not.toThrow()
    }
    // Rule 4: a fill is the accent's, and only inside a closed part.
    for (const d of part.fills) expect(d).toMatch(/z$/)
    if (part.fills.length > 0) expect(part.tone).toBe('accent')
  })

  it('has one dashed part, the slot, which is ink', () => {
    expect(kit.filter(([, part]) => part.dashed).map(([id]) => id)).toEqual(['slot'])
    expect(parts.slot.tone).toBe('ink')
  })

  it('keeps the parts no composition uses yet', () => {
    const used = new Set(composed.flatMap(([, c]) => c.parts.map(([part]) => part)))
    expect(kit.map(([id]) => id).filter((id) => !used.has(id as never))).toEqual([
      'crate',
      'card',
      'clock',
      'house',
    ])
  })
})

describe.each(composed)('%s', (id, composition) => {
  const drawing = illustration(id, cssVar)

  it('is four parts at most, each of the kit, at a quarter-step scale (rules 2 and 3)', () => {
    expect(composition.parts.length).toBeGreaterThan(0)
    expect(composition.parts.length).toBeLessThanOrEqual(4)
    for (const [part, , , scale] of composition.parts) {
      expect(Object.keys(parts)).toContain(part)
      expect(partScales).toContain(scale)
    }
  })

  it('fits the frame (rule 1)', () => {
    expect(drawing.viewBox).toBe('0 0 200 140')
    for (const [, x, y, scale] of composition.parts) {
      expect(Math.min(x, y)).toBeGreaterThanOrEqual(0)
      expect(x + frame.partBox * scale).toBeLessThanOrEqual(frame.width)
      expect(y + frame.partBox * scale).toBeLessThanOrEqual(frame.height)
    }
  })

  it('holds one 2-unit stroke whatever a part’s scale (rule 3)', () => {
    const groups = drawing.children.filter((node) => node.tag === 'g')
    expect(groups).toHaveLength(composition.parts.length)
    groups.forEach((group, at) => {
      const scale = composition.parts[at]?.[3] ?? 1
      expect(group.transform).toMatch(new RegExp(`scale\\(${String(scale)}\\)$`))
      for (const path of group.children) {
        if (path.tag !== 'path' || path.stroke === 'none') continue
        expect((path.strokeWidth ?? 0) * scale).toBeCloseTo(frame.stroke, 1)
        if (path.strokeDasharray !== undefined) {
          const [dash = 0, gap = 0] = path.strokeDasharray.split(' ').map(Number)
          expect([dash * scale, gap * scale].map(Math.round)).toEqual([5, 4])
        }
      }
    })
  })

  it('is two tones, ink and its family’s accent, with fills at 12 % (rule 4)', () => {
    const accents: readonly ColorToken[] = Object.values(families)
    expect(accents).toContain(composition.accent)
    const [ink, accent] = [cssVar('text-muted'), cssVar(composition.accent)]
    for (const path of drawnPaths(drawing)) {
      if (path.stroke === 'none') {
        expect([path.fill, path.fillOpacity]).toEqual([accent, fillOpacity])
      } else {
        expect([ink, accent]).toContain(path.stroke)
        expect(path.fill).toBe('none')
      }
    }
    expect(fillOpacity).toBe(0.12)
  })

  it('has the slot if it is an empty state (rule 5)', () => {
    const slotted = composition.parts.some(([part]) => part === 'slot')
    if (composition.kind === 'empty') expect(slotted).toBe(true)
  })

  it('is paths in groups and nothing else: no text (rule 7)', () => {
    expect([...new Set(nodes(drawing).map((node) => node.tag))].sort()).toEqual(['g', 'path'])
  })

  it('is the same shapes in dark, with only the colours changed (rule 8)', () => {
    const [light, dark] = themes.map((theme) =>
      illustration(id, (name) => resolve(name, theme), 200),
    )
    // Every element but for its two colours: a group as its placement, a path as its data.
    const shapes = (d: Drawing | undefined) =>
      (d === undefined ? [] : nodes(d)).map((node) => {
        if (node.tag === 'g') return { tag: node.tag, transform: node.transform }
        return Object.fromEntries(
          Object.entries(node).filter(([name]) => name !== 'fill' && name !== 'stroke'),
        )
      })
    expect(shapes(light)).toEqual(shapes(dark))
    const inks = (d: Drawing | undefined) =>
      d === undefined ? [] : drawnPaths(d).map((path) => path.stroke)
    expect(inks(light)).not.toEqual(inks(dark))
    // Each colour is one of the two tones' values in that theme.
    for (const theme of themes) {
      const tones = [resolve('text-muted', theme), resolve(composition.accent, theme), 'none']
      const drawn = illustration(id, (name) => resolve(name, theme))
      for (const path of drawnPaths(drawn)) expect(tones).toContain(path.stroke)
    }
  })
})

describe('an illustration', () => {
  it('fills the width it is given, or is drawn at one in the frame’s proportion', () => {
    expect(illustration('shopping.empty', cssVar).width).toBeUndefined()
    expect(illustration('shopping.empty', cssVar, 300)).toMatchObject({ width: 300, height: 210 })
  })

  it('never shows history in a no-history composition', () => {
    expect(compositions['garden.no_history'].parts.map(([part]) => part)).not.toContain('bars')
  })

  it('draws a money answer in the money family’s accent and Garden’s in Garden’s own', () => {
    expect(compositions['finance.setup.pooled'].accent).toBe('accent-family-money')
    expect(compositions['garden.setup.beds'].accent).toBe('accent-garden')
    expect(Object.keys(colors)).toContain(compositions['documents.empty'].accent)
  })
})
