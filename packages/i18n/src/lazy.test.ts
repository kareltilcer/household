import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogs } from './catalogs.ts'
import {
  catalogLocale,
  clientParts,
  isLocale,
  loadCatalog,
  locales,
  partOf,
  pseudoLocale,
  serverSegments,
  translatorOver,
  type DisplayLocale,
  type Locale,
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

  /** `locale`'s messages whose keys `keep` passes, as the package holds them whole. */
  function held(locale: Locale, keep: (key: string) => boolean): Record<string, string> {
    return Object.fromEntries(Object.entries(catalogs[locale]).filter(([key]) => keep(key)))
  }

  it('loads each part of each language’s catalog as the package holds it, once', async () => {
    for (const locale of locales) {
      for (const part of clientParts) {
        const messages = await loadCatalog(locale, part)
        const name = `${locale}.${part}`
        expect(messages, name).toEqual(held(locale, (key) => partOf(key) === part))
        expect(loadCatalog(locale, part), name).toBe(loadCatalog(locale, part))
      }
    }
    // The parts were told apart at all: the app's own words and a household's are two files.
    expect(await loadCatalog('en', 'app')).toHaveProperty(['app.name'])
    expect(await loadCatalog('en', 'app')).not.toHaveProperty(['household.invitation.none.title'])
    expect(await loadCatalog('en', 'household')).toHaveProperty(['household.invitation.none.title'])
  })

  // Nothing is lost between the files: what no client fetches is what the server alone renders.
  it('loads a language whole in its parts, but for what is the server’s alone', async () => {
    for (const locale of locales) {
      const fetched = await Promise.all(clientParts.map((part) => loadCatalog(locale, part)))
      const each = fetched.flatMap((messages) => Object.entries(messages))
      const together = Object.fromEntries(each)
      // No key is in two files.
      expect(Object.keys(together), locale).toHaveLength(each.length)
      const servers = held(locale, (key) =>
        serverSegments.some((segment) => key.startsWith(`${segment}.`)),
      )
      expect(Object.keys(servers), locale).not.toHaveLength(0)
      expect({ ...together, ...servers }, locale).toEqual(catalogs[locale])
      expect(
        Object.keys(together).filter((key) => key in servers),
        locale,
      ).toEqual([])
    }
  })

  it('translates over a loaded part as the package’s own translator does', async () => {
    const shown: readonly DisplayLocale[] = [...locales, pseudoLocale]
    for (const locale of shown) {
      const own = createTranslator(locale)
      const over = translatorOver(locale, await loadCatalog(catalogLocale(locale), 'app'))
      expect(over('app.name'), locale).toBe(own('app.name'))
      expect(over('a11y.control.delete', { name: 'Milk' }), locale).toBe(
        own('a11y.control.delete', { name: 'Milk' }),
      )
    }
  })

  // A word of a part that was not fetched is no word: nothing stands in for it, and the screen
  // that asked fails where a test or its member sees it.
  it('refuses a key of a part it was not given, naming the key and the part', async () => {
    const over = translatorOver('cs', await loadCatalog('cs', 'app'))
    expect(() => over('household.invitation.none.title')).toThrow(
      /household\.invitation\.none\.title.*its part of the catalog, household, is not held/,
    )
    // Given that part too, it has the word.
    const both = translatorOver('cs', {
      ...(await loadCatalog('cs', 'app')),
      ...(await loadCatalog('cs', 'household')),
    })
    expect(both('household.invitation.none.title')).toBe(
      catalogs.cs['household.invitation.none.title'],
    )
    // What the server alone renders is in no part.
    expect(() => both('email.verify_email.subject')).toThrow(
      /email\.verify_email\.subject.*server’s alone/,
    )
  })

  it('knows a language Household ships from any other value', () => {
    expect(locales.every(isLocale)).toBe(true)
    for (const value of [pseudoLocale, 'fr', '', null, undefined, 7]) {
      expect(isLocale(value), String(value)).toBe(false)
    }
  })
})
