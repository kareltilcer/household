import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogs } from './catalogs.ts'
import {
  catalogLocale,
  isLocale,
  loadCatalog,
  locales,
  pseudoLocale,
  translatorOver,
  type DisplayLocale,
} from './lazy.ts'
import { createTranslator } from './translator.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** The modules `file` imports for their code, by path: a type's import is no code. */
function imported(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const paths: string[] = []
  // A static import or re-export of a relative module, but one of types alone.
  for (const [, clause = '', path = ''] of source.matchAll(
    /^(?:import|export)\s+(?!type\b)([^'"]*?)\s*from\s+'(\.[^']+)'/gm,
  )) {
    const typesOnly = /^\{[^}]*\}$/.test(clause.trim())
      ? clause
          .trim()
          .slice(1, -1)
          .split(',')
          .every((name) => name.trim() === '' || name.trim().startsWith('type '))
      : false
    if (!typesOnly) paths.push(resolve(dirname(file), path))
  }
  return paths
}

/** Every module `entry` reaches by a static import, itself among them. */
function reached(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue
    seen.add(file)
    if (file.endsWith('.ts')) queue.push(...imported(file))
  }
  return seen
}

describe('the entry for a client that loads one language at a time', () => {
  // What the entry is for: a bundle that imports it holds no catalog until it asks for one.
  it('reaches no catalog by a static import, nor the module that holds all five', () => {
    const files = [...reached(resolve(here, 'lazy.ts'))]
    expect(files.filter((file) => file.endsWith('.json'))).toEqual([])
    expect(files).not.toContain(resolve(here, 'catalogs.ts'))
    expect(files).not.toContain(resolve(here, 'translator.ts'))
    expect(files).not.toContain(resolve(here, 'index.ts'))
    // And the walk reads imports at all: the module that holds the catalogs reaches five.
    expect(
      [...reached(resolve(here, 'catalogs.ts'))].filter((file) => file.endsWith('.json')),
    ).toHaveLength(locales.length)
  })

  it('loads each language’s catalog as the package holds it, once', async () => {
    for (const locale of locales) {
      const catalog = await loadCatalog(locale)
      expect(catalog, locale).toEqual(catalogs[locale])
      expect(loadCatalog(locale), locale).toBe(loadCatalog(locale))
    }
  })

  it('translates over a loaded catalog as the package’s own translator does', async () => {
    const shown: readonly DisplayLocale[] = [...locales, pseudoLocale]
    for (const locale of shown) {
      const own = createTranslator(locale)
      const over = translatorOver(locale, await loadCatalog(catalogLocale(locale)))
      expect(over('app.name'), locale).toBe(own('app.name'))
      expect(over('a11y.control.delete', { name: 'Milk' }), locale).toBe(
        own('a11y.control.delete', { name: 'Milk' }),
      )
    }
  })

  it('knows a language Household ships from any other value', () => {
    expect(locales.every(isLocale)).toBe(true)
    for (const value of [pseudoLocale, 'fr', '', null, undefined, 7]) {
      expect(isLocale(value), String(value)).toBe(false)
    }
  })
})
