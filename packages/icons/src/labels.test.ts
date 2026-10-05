import { catalogs, isMessageKey, locales, parseMessage, signature } from '@household/i18n'
import { describe, expect, it } from 'vitest'
import { baseGlyphs } from './base.ts'
import { moduleGlyphs, statusGlyphs } from './glyphs.ts'
import { controls, type Control } from './labels.ts'

const register: readonly (readonly [string, Control])[] = Object.entries(controls)

/** The arguments a label takes, in English. */
function takes(control: Control): string[] {
  return [...signature(parseMessage(catalogs.en[control.labelKey])).keys()].sort()
}

describe('the icon-only control register', () => {
  it('holds the twenty controls the design registers, and the three a primitive draws itself', () => {
    expect(register).toHaveLength(23)
    expect(register.slice(20).map(([id]) => id)).toEqual(['dismiss', 'decrease', 'increase'])
  })

  it.each(register)('%s is drawn as a glyph of its set', (_, control) => {
    const sets = { base: baseGlyphs, module: moduleGlyphs, status: statusGlyphs }
    expect(Object.keys(sets[control.glyph.set])).toContain(control.glyph.id)
  })

  it.each(register)('%s has a label in every language', (_, control) => {
    expect(isMessageKey(control.labelKey)).toBe(true)
    for (const locale of locales) {
      const catalog: Readonly<Record<string, string>> = catalogs[locale]
      expect((catalog[control.labelKey] ?? '').trim(), locale).not.toBe('')
    }
  })

  // "Delete" alone is no label for one row's control among twenty: the label names the row.
  it('names what a row’s control acts on, through an argument the caller must pass', () => {
    const named = Object.fromEntries(
      register.flatMap(([id, control]) => {
        const args = takes(control)
        return args.length > 0 ? [[id, args] as const] : []
      }),
    )
    expect(named).toEqual({
      more_actions: ['name'],
      edit: ['name'],
      delete: ['name'],
      share: ['name'],
      download: ['name'],
      filter: ['list'],
      sort: ['list'],
      reorder: ['name'],
      switch_household: ['household'],
      theme: ['theme'],
      sync_state: ['state'],
      conflict: ['name'],
      print: ['name'],
      decrease: ['name'],
      increase: ['name'],
    })
  })

  it('gives a control a sentence of its own, never a status’s word', () => {
    const words = new Set(Object.values(statusGlyphs).map((glyph) => glyph.labelKey as string))
    expect(register.filter(([, control]) => words.has(control.labelKey))).toEqual([])
  })
})
