import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  colorNames,
  cssVar,
  durations,
  resolve,
  rules,
  stylesheet,
  thresholds,
  type Rule,
} from './index.ts'
import { ramps } from './primitives.ts'

const sheet = rules()

function rule(selector: string, media?: string): Rule {
  const found = sheet.find((r) => r.selector === selector && r.media === media)
  if (found === undefined) throw new Error(`no rule for ${selector}`)
  return found
}

const light = rule(":root, [data-theme='light'], [data-theme='system']")
const dark = rule("[data-theme='dark']")
const system = rule("[data-theme='system']", '@media (prefers-color-scheme: dark)')

describe('tokens.css', () => {
  it('is committed as the emitter writes it', () => {
    const committed = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
    expect(
      committed.replaceAll('\r\n', '\n'),
      'run `pnpm --filter @household/tokens css` and commit tokens.css',
    ).toBe(stylesheet())
  })

  it('declares the whole light palette on the root, every colour name resolved', () => {
    const declared = new Map(light.declarations)
    for (const name of colorNames) expect(declared.get(name), name).toBe(resolve(name, 'light'))
    // Resolved, never a reference: an alias computed on the root would not follow a theme
    // set on an element inside it.
    expect(light.declarations.filter(([, value]) => value.includes('var('))).toEqual([])
  })

  it('redeclares for dark only what changes, and defines nothing there alone', () => {
    const root = new Map(light.declarations)
    expect(dark.declarations.filter(([property]) => !root.has(property))).toEqual([])
    expect(dark.declarations.filter(([property, value]) => root.get(property) === value)).toEqual(
      [],
    )
    for (const name of colorNames) {
      const expected =
        resolve(name, 'dark') === resolve(name, 'light') ? [] : [resolve(name, 'dark')]
      expect(
        dark.declarations.filter(([property]) => property === name).map(([, value]) => value),
        name,
      ).toEqual(expected)
    }
  })

  it('gives the system theme the dark block when the system is dark', () => {
    expect(system.declarations).toEqual(dark.declarations)
    // After the root's block, which names the system theme too, so that it wins at its specificity.
    expect(sheet.indexOf(system)).toBeGreaterThan(sheet.indexOf(light))
  })

  it('declares no primitive', () => {
    const primitive = new RegExp(`^(${ramps.join('|')})-\\d+$`)
    const properties = sheet.flatMap((r) => r.declarations.map(([property]) => property))
    expect(properties.filter((property) => primitive.test(property))).toEqual([])
    expect(stylesheet()).not.toMatch(new RegExp(`--(${ramps.join('|')})-\\d`))
  })

  it('makes every duration instant under reduced motion, and leaves the thresholds alone', () => {
    const still = Object.keys(durations).map((token) => [token, '0ms'])
    expect(rule("[data-motion='reduced']").declarations).toEqual(still)
    expect(rule(':root', '@media (prefers-reduced-motion: reduce)').declarations).toEqual(still)
    const scales = new Map(rule(':root').declarations)
    expect(scales.get('hold-to-complete')).toBe('2000ms')
    for (const token of Object.keys(thresholds)) {
      expect(sheet.filter((r) => r.declarations.some(([property]) => property === token))).toEqual([
        rule(':root'),
      ])
    }
  })

  it('keeps the 44 pt row under compact density, and swaps the rule for the divider', () => {
    const compact = new Map(
      rule("[data-density='compact'], [data-density='compact'] [data-theme]").declarations,
    )
    expect(compact.get('dens-row-min')).toBe('44px')
    expect(compact.get('dens-pad-x')).toBe('8px')
    expect(compact.get('dens-rule')).toBe('var(--divider)')
    // A theme's scope computes the rule's colour for itself, after the themes' own blocks.
    expect(rule(':root, [data-theme]').declarations).toEqual([['dens-rule', 'var(--border)']])
  })

  it('sets a type step as its family, size, line, weight and tracking', () => {
    const scales = new Map(rule(':root').declarations)
    expect(scales.get('type-title-1-size')).toBe('1.875rem')
    expect(scales.get('type-title-1-line')).toBe('1.22')
    expect(scales.get('type-num-family')).toBe('var(--font-mono)')
    expect(scales.get('type-overline-transform')).toBe('uppercase')
    expect(scales.get('figures-tabular')).toBe('tabular-nums lining-nums')
  })

  it('doubles the root font size at the 200 % text scale', () => {
    expect(stylesheet()).toContain(":root[data-scale='200'] {\n  font-size: 200%;\n}")
  })
})

describe('cssVar', () => {
  it('names a token as CSS reads it', () => {
    expect(cssVar('text-primary')).toBe('var(--text-primary)')
    expect(cssVar('accent-garden')).toBe('var(--accent-garden)')
    const declared = new Set(sheet.flatMap((r) => r.declarations.map(([property]) => property)))
    expect(declared.has('accent-finance') && declared.has('status-no-history')).toBe(true)
  })
})
