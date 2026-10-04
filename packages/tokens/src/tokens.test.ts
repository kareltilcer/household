import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  baselineOf,
  colorNames,
  colors,
  drawnAs,
  exempt,
  families,
  fonts,
  moduleFamilies,
  moduleIds,
  pairs,
  radii,
  resolve,
  sameAs,
  space,
  statuses,
  themes,
  tokenOf,
  tokens,
  typeScale,
  type ColorToken,
} from './index.ts'
import { hues, neutral, primitives, ramps } from './primitives.ts'

const colorTokens = Object.keys(colors) as ColorToken[]

describe('the colour tokens', () => {
  it('each have a value in both themes: none is defined in one alone', () => {
    const malformed = colorTokens.flatMap((token) =>
      themes
        .filter((theme) => !/^#[0-9A-F]{6}$/.test(resolve(token, theme)))
        .map((theme) => `${token} in ${theme}`),
    )
    expect(malformed).toEqual([])
  })

  it('that take another token’s value under a name of their own hold that value', () => {
    for (const [token, same] of Object.entries(sameAs)) {
      expect(colors[token as ColorToken], `${token} = ${same}`).toEqual(colors[same])
    }
  })

  it('that are a component’s background are a tested surface’s value in each theme', () => {
    for (const [token, drawn] of Object.entries(drawnAs)) {
      for (const theme of themes) {
        expect(resolve(token as ColorToken, theme), `${token} in ${theme}`).toBe(
          resolve(drawn[theme], theme),
        )
      }
    }
  })

  it('are each in a declared pair, drawn as a token that is, or exempt with a reason', () => {
    const paired = new Set<string>(pairs.flatMap((pair) => [tokenOf(pair.fg), pair.bg]))
    const covered = new Set([...paired, ...Object.keys(sameAs), ...Object.keys(drawnAs)])
    expect(colorTokens.filter((token) => !covered.has(token)).sort()).toEqual(
      Object.keys(exempt).sort(),
    )
    // An exempt token is in no pair, or the exemption says nothing.
    expect(Object.keys(exempt).filter((token) => paired.has(token))).toEqual([])
  })
})

describe('the status tokens', () => {
  it('are thirteen names over five values', () => {
    expect(Object.keys(statuses)).toHaveLength(13)
    for (const theme of themes) {
      const values = new Set(Object.keys(statuses).map((s) => resolve(s as never, theme)))
      expect(values.size, theme).toBe(5)
    }
  })

  it('are reserved: no accent is a status colour, in either theme', () => {
    const reserved = ['danger', 'warning', 'positive', 'info'] as const
    for (const theme of themes) {
      const taken = new Set(reserved.map((status) => resolve(status, theme)))
      const accents = ['accent', ...Object.values(families)] as const
      expect(accents.filter((accent) => taken.has(resolve(accent, theme)))).toEqual([])
    }
  })
})

describe('the accent map', () => {
  it("is keyed by the contract's seventeen module ids", () => {
    const contract: unknown = parse(
      readFileSync(new URL('../../../docs/api/openapi.yaml', import.meta.url), 'utf8'),
    )
    const modules = (
      contract as { components: { schemas: { ModuleKeyValue: { enum: string[] } } } }
    ).components.schemas.ModuleKeyValue.enum
    expect([...moduleIds].sort()).toEqual([...modules].sort())
    expect(moduleIds).toHaveLength(17)
  })

  it('resolves seventeen names to six values, a family’s or Garden’s', () => {
    for (const theme of themes) {
      const values = new Set(moduleIds.map((id) => resolve(`accent-${id}`, theme)))
      expect(values.size, theme).toBe(6)
      for (const id of moduleIds) {
        expect(resolve(`accent-${id}`, theme)).toBe(resolve(families[moduleFamilies[id]], theme))
      }
    }
    expect(new Set(Object.values(moduleFamilies))).toEqual(new Set(Object.keys(families)))
  })
})

describe('the tokens as an object', () => {
  it('resolve every colour name in both themes', () => {
    for (const theme of themes) {
      expect(Object.keys(tokens.color[theme])).toEqual(colorNames)
      for (const name of colorNames) expect(tokens.color[theme][name]).toBe(resolve(name, theme))
    }
    // 47 tokens, 13 statuses, and 16 module accents beside Garden's, which is its family's token.
    expect(colorNames).toHaveLength(47 + 13 + 16)
    expect(new Set(colorNames).size).toBe(colorNames.length)
  })
})

describe('the type scale', () => {
  it('is eight steps in the UI face and three in the mono face', () => {
    const faces = Object.values(typeScale).map((step) => step.face)
    expect(faces.filter((face) => face === 'sans')).toHaveLength(8)
    expect(faces.filter((face) => face === 'mono')).toHaveLength(3)
    expect(typeScale['title-1'].line).toBe(1.22)
  })

  it('puts each mono step on a sans step’s baseline', () => {
    for (const [mono, sans] of Object.entries(baselineOf)) {
      const [a, b] = [typeScale[mono as keyof typeof baselineOf], typeScale[sans]]
      expect([a.face, a.size, a.line], mono).toEqual(['mono', b.size, b.line])
    }
  })

  it('sets each face only in weights the face is loaded in, on the web and natively', () => {
    for (const [name, step] of Object.entries(typeScale)) {
      const face = fonts[step.face]
      expect(face.weights, name).toContain(step.weight)
      expect(Object.keys(face.native).map(Number), name).toContain(step.weight)
    }
  })

  it('never sets body text below 1 rem, nor a line below its diacritics', () => {
    expect(typeScale.body.size).toBe(1)
    // Ď, Ř and Ł stand above the cap height: a line under 1.1 clips them (01-foundations §4).
    expect(Object.values(typeScale).filter((step) => step.line < 1.1)).toEqual([])
  })
})

describe('the space and radius scales', () => {
  it('are eight-point, with a four-point half-step at the two smallest sizes only', () => {
    const halves = Object.entries(space).filter(([, value]) => value % 8 !== 0)
    expect(halves).toEqual([
      ['space-05', 4],
      ['space-15', 12],
    ])
  })

  it('name five radii', () => {
    expect(Object.keys(radii)).toEqual([
      'radius-control',
      'radius-card',
      'radius-sheet',
      'radius-pill',
      'radius-full',
    ])
  })
})

describe('the primitives', () => {
  it('are thirteen neutrals and ten hues of two steps', () => {
    expect(Object.keys(neutral)).toHaveLength(13)
    expect(Object.keys(hues)).toHaveLength(10)
    expect(Object.keys(primitives)).toHaveLength(13 + 20)
    expect(ramps).toEqual(['neutral', ...Object.keys(hues)])
  })
})
