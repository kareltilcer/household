// What keeps the dev screens out of a build a member is served, read off the sources and off
// what `check` does with a bundle. That a real export holds none is seen by running it:
// `pnpm run export` and then `pnpm run check`.
import { describe, expect, it } from '@jest/globals'
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { devMarker } from '../src/dev/marker.ts'
import { bundlesOf, check, holds } from './bundles.ts'

/** apps/mobile: Jest runs in it. */
const app = resolve('.')

const sources = (pattern: string) => globSync(pattern, { cwd: app }).sort()
const read = (file: string) => readFileSync(join(app, file), 'utf8')

describe('a dev screen', () => {
  const routes = sources('app/dev/*.tsx')

  it('has a route that asks for it behind the one condition Metro folds away', () => {
    expect(routes.length).toBeGreaterThan(0)
    for (const file of routes) {
      const source = read(file)
      // Written out where it stands: imported, it would be a value Metro cannot fold.
      expect([file, source]).toEqual([
        file,
        expect.stringContaining(
          "export default __DEV__ || process.env.EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS === '1'\n" +
            "  ? lazy(() => import('../../src/dev/",
        ),
      ])
      // And nothing of src/dev is imported any other way, which a production bundle would hold.
      expect([file, [...source.matchAll(/from '([^']+)'/g)].map(([, from]) => from)]).toEqual([
        file,
        ['react', '../../src/app/NotAvailable.tsx'],
      ])
    }
  })

  it('is imported by nothing outside src/dev but its own route', () => {
    const outside = sources('{app,src}/**/*.{ts,tsx}').filter(
      (file) => !file.replaceAll('\\', '/').startsWith('src/dev/') && !routes.includes(file),
    )
    const importing = outside.filter((file) =>
      /from '[^']*\/dev\/|import\('[^']*\/dev\//.test(read(file)),
    )
    expect(importing).toEqual([])
  })

  it('holds the marker, through the screen every one of them stands in', () => {
    expect(read('src/dev/DevScreen.tsx')).toContain('devMarker')
    for (const file of routes) {
      const screen = /import\('\.\.\/\.\.\/(src\/dev\/[^']+)'\)/.exec(read(file))?.[1] ?? ''
      expect([file, read(screen)]).toEqual([file, expect.stringContaining('<DevScreen ')])
    }
  })
})

describe('the check of an export', () => {
  it('finds the marker in a bundle as JavaScript writes it and as bytecode may', () => {
    expect(holds(Buffer.from(`var a="${devMarker}:engine"`), devMarker)).toBe(true)
    expect(holds(Buffer.from(`\0\0${devMarker}`, 'utf16le'), devMarker)).toBe(true)
    expect(holds(Buffer.from('var a="household"'), devMarker)).toBe(false)
  })

  it('fails an export that carries a dev screen, and names the bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'household-mobile-check-'))
    try {
      for (const platform of ['android', 'ios']) {
        mkdirSync(join(root, '_expo', 'static', 'js', platform), { recursive: true })
      }
      writeFileSync(join(root, '_expo', 'static', 'js', 'android', 'index-1.hbc'), 'clean')
      writeFileSync(join(root, '_expo', 'static', 'js', 'ios', 'index-2.hbc'), `x${devMarker}:x`)
      expect(bundlesOf(root)).toHaveLength(2)
      const { failures } = check(root)
      expect(failures).toHaveLength(1)
      expect(failures[0]).toContain('index-2.hbc')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
