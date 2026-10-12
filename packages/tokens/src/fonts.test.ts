// PL-13, held to the files the web clients serve and to the static files the mobile app embeds
// (plan item 28): self-hosted, with the Latin Extended letters the launch languages and the next
// ones write, and figures of one width.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openSync, type Font } from 'fontkit'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { fonts, typeScale } from './index.ts'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(pkg, 'package.json'))

interface FontFace {
  readonly family: string
  readonly style: string
  readonly weight: string
  readonly urls: readonly string[]
  /** The woff2 file, as a path on disk. */
  readonly file: string
  readonly range: readonly (readonly [from: number, to: number])[]
}

function value(block: string, property: string): string {
  return new RegExp(`${property}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? ''
}

/** Every `@font-face` of the stylesheets fonts.css imports. */
const faces: FontFace[] = [
  ...readFileSync(join(pkg, 'fonts.css'), 'utf8').matchAll(/@import '([^']+)';/g),
].flatMap(([, specifier = '']) => {
  const sheet = require.resolve(specifier)
  return [...readFileSync(sheet, 'utf8').matchAll(/@font-face\s*\{([^}]+)\}/g)].map(
    ([, block = '']) => {
      const urls = [...block.matchAll(/url\(([^)]+)\)/g)].map(([, url = '']) => url)
      const woff2 = urls.find((url) => url.endsWith('.woff2')) ?? ''
      return {
        family: value(block, 'font-family').replaceAll("'", ''),
        style: value(block, 'font-style'),
        weight: value(block, 'font-weight'),
        urls,
        file: join(dirname(sheet), woff2),
        range: value(block, 'unicode-range')
          .split(',')
          .map((part) => {
            const [from = '', to = from] = part.trim().replace(/^U\+/i, '').split('-')
            return [Number.parseInt(from, 16), Number.parseInt(to, 16)] as const
          }),
      }
    },
  )
})

/** A font file, which is one font: a collection of several is no file fonts.css names. */
function open(file: string): Font {
  const font = openSync(file)
  if ('fonts' in font) throw new Error(`${file} is a collection`)
  return font
}

function facesOf(family: string, style: string, weight: number): FontFace[] {
  return faces.filter((face) => {
    const [from = Number.NaN, to = from] = face.weight.split(' ').map(Number)
    return face.family === family && face.style === style && from <= weight && weight <= to
  })
}

/** The code points a family draws at a weight: each file's own glyphs, within its declared range. */
function drawn(family: string, weight: number): Set<number> {
  const points = new Set<number>()
  for (const face of facesOf(family, 'normal', weight)) {
    for (const point of open(face.file).characterSet) {
      if (face.range.some(([from, to]) => from <= point && point <= to)) points.add(point)
    }
  }
  return points
}

const used = Object.entries(fonts).flatMap(([name, face]) =>
  face.weights.map((weight) => [name, face.family, weight] as const),
)

/** What PL-13 asks a face to draw and `points` does not hold: a code point in hex, or the letter. */
function undrawn(points: ReadonlySet<number>): string[] {
  const missing: string[] = []
  // Latin Extended-A, whole: Czech, Slovak, Polish and German are written in it (N8).
  for (let point = 0x0100; point <= 0x017f; point++) {
    if (!points.has(point)) missing.push(point.toString(16))
  }
  // Latin Extended-B, as far as a European language is written in it: Romanian's
  // comma-below letters, Ș ș Ț ț. The block's other letters are not Europe's.
  for (const letter of 'ȘșȚț') {
    const point = letter.codePointAt(0) ?? 0
    if (!points.has(point)) missing.push(point.toString(16))
  }
  // And every letter the five launch languages add to the basic alphabet.
  for (const letter of 'ÁÄČĎÉĚÍĹĽŇÓÔŔŘŠŤÚŮÝŽáäčďéěíĺľňóôŕřšťúůýžĄĆĘŁŃŚŹŻąćęłńśźżÖÜẞöüß') {
    const point = letter.codePointAt(0) ?? 0
    if (!points.has(point)) missing.push(letter)
  }
  return missing
}

/** The advance of each of the ten digits in `font`. */
function figureWidths(font: Font): number[] {
  return Array.from({ length: 10 }, (_, digit) => font.glyphForCodePoint(0x30 + digit).advanceWidth)
}

describe('fonts.css', () => {
  it('declares both faces from files in this workspace, and fetches none', () => {
    expect(faces.length).toBeGreaterThan(0)
    expect(new Set(faces.map((face) => face.family))).toEqual(
      new Set([fonts.sans.family, fonts.mono.family]),
    )
    for (const face of faces) {
      expect(face.urls.filter((url) => !url.startsWith('./files/'))).toEqual([])
      expect(existsSync(face.file), face.file).toBe(true)
    }
  })

  it.each(used)('%s (%s) is declared at weight %i', (_, family, weight) => {
    expect(facesOf(family, 'normal', weight).length).toBeGreaterThan(0)
  })

  it('sets the type scale only in weights it declares', () => {
    for (const step of Object.values(typeScale)) {
      expect(facesOf(fonts[step.face].family, 'normal', step.weight).length).toBeGreaterThan(0)
    }
  })

  it.each(used)(
    '%s (%s) at %i draws all of Latin Extended-A and the Latin Extended-B of Romanian',
    (_, family, weight) => {
      expect(undrawn(drawn(family, weight))).toEqual([])
    },
  )

  // The digits' own file, once for each: the sans is one variable file, measured at the instance
  // it opens at, and the mono a file for each weight.
  const digitFiles = [
    ...new Set(
      used.flatMap(([, family, weight]) =>
        facesOf(family, 'normal', weight)
          .filter((face) => face.range.some(([from, to]) => from <= 0x30 && 0x39 <= to))
          .map((face) => face.file),
      ),
    ),
  ]

  it('has a file for the digits of each face', () => {
    expect(digitFiles.length).toBe(1 + fonts.mono.weights.length)
  })

  it.each(digitFiles.map((file) => [file.slice(dirname(file).length + 1), file] as const))(
    '%s has figures of one width',
    (_, file) => {
      const widths = figureWidths(open(file))
      expect(new Set(widths).size, widths.join(' ')).toBe(1)
    },
  )

  it('builds into an app with every font file served from the app itself', async () => {
    const output = await build({
      root: join(pkg, 'src', 'testdata', 'app'),
      logLevel: 'silent',
      configFile: false,
      build: { write: false },
    })
    const chunks = (Array.isArray(output) ? output : [output]).flatMap((o) =>
      'output' in o ? o.output : [],
    )
    const assets = chunks.filter((chunk) => chunk.type === 'asset')
    const fontFiles = assets.filter((asset) => asset.fileName.endsWith('.woff2'))
    expect(fontFiles.length).toBeGreaterThan(0)
    const css = assets
      .filter((asset) => asset.fileName.endsWith('.css'))
      .map((asset) => (typeof asset.source === 'string' ? asset.source : ''))
      .join('\n')
    expect(css).toContain('IBM Plex Sans Variable')
    expect(css).toContain('IBM Plex Mono')
    expect(css).toContain('--text-primary')
    // Every url() is a file of the build's own; none names another origin.
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(([, url = '']) => url)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((url) => /^["']?(https?:)?\/\//.test(url))).toEqual([])
    expect(css).not.toMatch(/@import/)
  }, 120_000)
})

// A native app has one static file for each weight of each face, embedded in its binary. iOS
// finds a file by the PostScript name it carries and Android by the name the app registers it
// under, so the family a type step names (native.ts) has to be both.
describe('the static files a native app embeds', () => {
  const files = Object.values(fonts).flatMap((face) => {
    const families: Readonly<Record<number, string>> = face.native
    const paths: Readonly<Record<number, string>> = face.files
    return face.weights.map(
      (weight) => [families[weight] ?? '', weight, paths[weight] ?? ''] as const,
    )
  })

  it('are one for each weight the type scale sets, and no other', () => {
    for (const face of Object.values(fonts)) {
      expect(Object.keys(face.native).map(Number)).toEqual(face.weights)
      expect(Object.keys(face.files).map(Number)).toEqual(face.weights)
    }
  })

  it.each(files)('%s is the file of its family and its weight (%i)', (family, weight, file) => {
    const font = open(require.resolve(file))
    expect(font.postscriptName).toBe(family)
    expect(font['OS/2'].usWeightClass).toBe(weight)
  })

  it.each(files)(
    '%s draws all of Latin Extended-A and the Latin Extended-B of Romanian',
    (_, __, file) => {
      expect(undrawn(new Set(open(require.resolve(file)).characterSet))).toEqual([])
    },
  )

  it.each(files)('%s has figures of one width', (_, __, file) => {
    const widths = figureWidths(open(require.resolve(file)))
    expect(new Set(widths).size, widths.join(' ')).toBe(1)
  })
})
