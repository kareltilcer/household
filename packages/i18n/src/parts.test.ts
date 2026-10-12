import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogs, locales } from './catalogs.ts'
import { loaders } from './generated/loaders.ts'
import { clientParts, deviceSegments, partOf, parts, serverSegments } from './parts.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** The first segment of `key`: what places it in a row of the table. */
const segmentOf = (key: string) => key.split('.', 1)[0] ?? ''

describe('the parts of a catalog', () => {
  /** The table's rows: each part's first segments, the server's alone, and the mobile app's. */
  const rows: readonly (readonly string[])[] = [
    ...clientParts.map((part) => parts[part]),
    serverSegments,
    deviceSegments,
  ]

  // A key in no row is in no file a client fetches and is not said to be the server's either:
  // the screen that reads it would find no word. A new first segment is added to a row.
  it('place every key of the catalog in a row, by its first segment', () => {
    const placed = new Set(rows.flat())
    expect(Object.keys(catalogs.en).filter((key) => !placed.has(segmentOf(key)))).toEqual([])
  })

  it('place no first segment in two rows', () => {
    const segments = rows.flat()
    expect(segments.filter((segment, at) => segments.indexOf(segment) !== at)).toEqual([])
  })

  it('give a key its part, and none to one of the server’s alone or of the mobile app’s', () => {
    expect(clientParts[0]).toBe('app')
    expect(partOf('app.name')).toBe('app')
    expect(partOf('module.shopping.name')).toBe('app')
    expect(partOf('household.invitation.none.title')).toBe('household')
    expect(partOf('clients.title')).toBe('health')
    const unfetched: readonly string[] = [...serverSegments, ...deviceSegments]
    for (const key of Object.keys(catalogs.en)) {
      expect(partOf(key) === undefined, key).toBe(unfetched.includes(segmentOf(key)))
    }
    // A word of the mobile app's is in no file the web fetches.
    expect(partOf('device.app.error.title')).toBeUndefined()
    expect(Object.keys(catalogs.en).some((key) => segmentOf(key) === 'device')).toBe(true)
    // The two messages of an invoice's lines, which the server alone renders, ride with theirs.
    expect(partOf('billing.storage_line')).toBe('billing')
  })
})

// What scripts/gen.ts writes for a client that loads one language at a time (lazy.ts).
describe('the generated parts', () => {
  const file = (name: string) => resolve(here, 'generated', 'parts', name)

  it.each(locales)('are %s’s messages, each part’s in a file of its own, in order', (locale) => {
    for (const part of clientParts) {
      const written: unknown = JSON.parse(readFileSync(file(`${locale}.${part}.json`), 'utf8'))
      const held = Object.entries(catalogs[locale]).filter(([key]) => partOf(key) === part)
      expect(written, part).toEqual(Object.fromEntries(held))
      expect(Object.keys(written as object), part).toEqual(held.map(([key]) => key).sort())
    }
  })

  it('are each imported by a loader of their own, which names the file', async () => {
    expect(Object.keys(loaders)).toEqual([...locales])
    const source = readFileSync(resolve(here, 'generated', 'loaders.ts'), 'utf8')
    for (const locale of locales) {
      expect(Object.keys(loaders[locale]), locale).toEqual([...clientParts])
      for (const part of clientParts) {
        // Written out: a bundler makes a file of an import it can read, and none of one it has
        // to compute.
        expect(source).toContain(`${part}: () => import('./parts/${locale}.${part}.json')`)
      }
    }
    expect((await loaders.de.household()).default).toHaveProperty(
      ['household.invitation.none.title'],
      catalogs.de['household.invitation.none.title'],
    )
  })
})
