import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { vendor } from '../scripts/lucide.ts'
import { baseGlyphs, lucideVersion } from './base.ts'
import { moduleGlyphs, statusGlyphs } from './glyphs.ts'
import { baseGroups, baseIds, lucideNames } from './manifest.ts'
import { flatten } from './raster.ts'

function committed(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
}

describe('the base set', () => {
  it('is 55 glyphs in five groups', () => {
    expect(Object.values(baseGroups).map((group) => group.length)).toEqual([9, 15, 10, 9, 12])
    expect(baseIds).toHaveLength(55)
    expect(new Set(baseIds).size).toBe(55)
    expect(Object.keys(baseGlyphs)).toEqual(baseIds)
  })

  it('is vendored as the pinned Lucide release draws it, with Lucide’s licence beside it', () => {
    const { json, license } = vendor()
    const remedy = 'run `pnpm --filter @household/icons vendor` and commit what it writes'
    expect(committed('./lucide.json'), remedy).toBe(json)
    expect(committed('../LICENSE.lucide'), remedy).toBe(license)
    expect(license).toContain('ISC License')
    const pinned: unknown = JSON.parse(committed('../package.json'))
    expect(pinned).toMatchObject({ devDependencies: { 'lucide-static': lucideVersion } })
  })

  it('reads a renamed glyph under Lucide’s name, and keeps the design’s', () => {
    expect(Object.keys(lucideNames).filter((id) => !baseIds.includes(id as never))).toEqual([])
    expect(lucideNames['trash-2']).toBe('trash')
    expect(baseGlyphs['trash-2'].length).toBeGreaterThan(0)
  })

  it('draws each glyph in shapes the drawing model has, with path data the pen reads', () => {
    for (const id of baseIds) {
      expect(baseGlyphs[id].length, id).toBeGreaterThan(0)
      for (const shape of baseGlyphs[id]) {
        expect(['path', 'circle', 'rect', 'line'], id).toContain(shape.tag)
        // No colour of its own, and no fill: a base glyph is one stroke in the current colour.
        expect(Object.keys(shape).filter((key) => /fill|stroke|color/i.test(key))).toEqual([])
        if (shape.tag !== 'path') continue
        expect(shape.d, id).toMatch(/^[a-zA-Z0-9 .,-]+$/)
        // The raster reads the in-house sets' commands, and every path of Lucide's is drawn
        // in them: a release that brings another fails here, with the glyph's name.
        expect(() => flatten(shape.d), id).not.toThrow()
        expect(flatten(shape.d).length, id).toBeGreaterThan(0)
      }
    }
    expect(baseIds.some((id) => baseGlyphs[id].some((shape) => shape.tag === 'path'))).toBe(true)
  })

  it('stands for no status and no module: those are drawn in-house', () => {
    const inHouse = new Set([...Object.keys(statusGlyphs), ...Object.keys(moduleGlyphs)])
    expect(baseIds.filter((id) => inHouse.has(id))).toEqual([])
  })
})
