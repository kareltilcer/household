// What keeps the dev screens out of a build a member is served, read off the sources and off
// what `check` does with a bundle. That a real export holds none is seen by running it:
// `pnpm run export` and then `pnpm run check`.
import { describe, expect, it } from '@jest/globals'
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { devMarker } from '../src/dev/marker.ts'
import { bundlesOf, check, holds, standIns } from './bundles.ts'

/** apps/mobile: Jest runs in it. */
const app = resolve('.')

/** The files `pattern` names, by their path from apps/mobile, whatever the machine writes one with. */
const sources = (pattern: string) =>
  globSync(pattern, { cwd: app })
    .map((file) => file.replaceAll('\\', '/'))
    .sort()
const read = (file: string) => readFileSync(join(app, file), 'utf8')

/** Everything a bundle is made of that is the app's own: its entry, its routes and what they draw. */
const own = () => ['index.ts', ...sources('{app,src}/**/*.{ts,tsx}')]

/**
 * Whether `source` imports a file of a `dev` folder, any way a module can: by name (`from`),
 * behind a call (`import()`, `require()`), or bare, for what the file does as it loads.
 */
function importsDev(source: string): boolean {
  return /(?:\bfrom|\bimport|\brequire)\s*\(?\s*'[^']*\/dev\//.test(source)
}

/** The variable the build the flows walk is made with, which the condition reads. */
const variable = 'EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS'

/** The one file that writes the condition to be read, and the expression it writes. */
const gate = 'src/dev/gate.ts'
const condition = /^export const devScreens: boolean = (.+)$/m.exec(read(gate))?.[1] ?? ''

/** The two controls that lead to the dev screens from a screen every build holds. */
const ways = ['src/session/SignIn.tsx', 'src/shell/More.tsx']

describe('a dev screen', () => {
  const routes = sources('app/dev/*.tsx')

  it('is behind one condition, which one file writes to be read', () => {
    // What Metro folds: a global it replaces, and a variable Expo's preset writes the value
    // of into the bundle as it is made. Nothing else, and nothing imported.
    expect(condition).toContain('__DEV__')
    expect(condition).toContain(`process.env.${variable}`)
  })

  it('has a route that asks for it behind that condition, written out where it stands', () => {
    expect(routes.length).toBeGreaterThan(0)
    for (const file of routes) {
      const source = read(file)
      // Written out where it stands: imported, it would be a value Metro cannot fold.
      expect([file, source]).toEqual([
        file,
        expect.stringContaining(
          `export default ${condition}\n` + "  ? lazy(() => import('../../src/dev/",
        ),
      ])
      // And nothing of src/dev is imported any other way, which a production bundle would hold.
      expect([file, [...source.matchAll(/from '([^']+)'/g)].map(([, from]) => from)]).toEqual([
        file,
        ['react', '../../src/app/NotAvailable.tsx'],
      ])
    }
  })

  it('is led to by two controls, each behind that condition written out where it stands', () => {
    for (const file of ways) {
      // In the markup, so that what is drawn behind it goes with it when it is folded away.
      expect([file, read(file)]).toEqual([file, expect.stringContaining(`${condition} ? (\n`)])
    }
  })

  it('has its condition written in those places alone, and in no other words', () => {
    const writing = own().filter(
      (file) => file !== gate && !/\.test\.tsx?$/.test(file) && read(file).includes(variable),
    )
    expect(writing).toEqual([...routes, ...ways].sort())
    for (const file of writing) {
      const source = read(file)
      // As often as the variable is named, the whole condition is written.
      expect([file, source.split(variable).length]).toEqual([file, source.split(condition).length])
    }
  })

  it('is imported by nothing outside src/dev but its own route', () => {
    expect(own()).toContain('index.ts')
    const outside = own().filter((file) => !file.startsWith('src/dev/') && !routes.includes(file))
    expect(outside.filter((file) => importsDev(read(file)))).toEqual([])
    // Nor is the file that writes the condition to be read, by anything at all.
    expect(own().filter((file) => read(file).includes("/gate.ts'"))).toEqual([])
  })

  it('is found imported by name, behind a call, or for what a file does as it loads', () => {
    expect(importsDev("import { Harness } from '../dev/harness/index.tsx'\n")).toBe(true)
    expect(importsDev("export { devMarker } from '../../src/dev/marker.ts'\n")).toBe(true)
    expect(importsDev("const Sync = lazy(() => import('../dev/sync/index.tsx'))\n")).toBe(true)
    expect(importsDev("import '../dev/sample.ts'\n")).toBe(true)
    expect(importsDev("import './src/dev/sample.ts'\n")).toBe(true)
    // An address is no import, and neither is a folder that only ends as one does.
    expect(importsDev("const dev = { path: '/dev/harness' }\n")).toBe(false)
    expect(importsDev("import { paths } from '../devices/paths.ts'\n")).toBe(false)
  })

  it('holds the marker, through the screen every one of them stands in', () => {
    expect(read('src/dev/DevScreen.tsx')).toContain('devMarker')
    for (const file of routes) {
      const screen = /import\('\.\.\/\.\.\/(src\/dev\/[^']+)'\)/.exec(read(file))?.[1] ?? ''
      expect([file, read(screen)]).toEqual([file, expect.stringContaining('<DevScreen ')])
    }
  })
})

describe('what stands in for the server and the replica outside src/dev', () => {
  it('is each named by words its file still holds, and no other: the check would look for nothing, or name the wrong file', () => {
    expect(Object.keys(standIns).length).toBeGreaterThan(0)
    const others = sources('{app,src}/**/*.{ts,tsx}')
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => !/\.test\.tsx?$/.test(file))
    for (const [source, words] of Object.entries(standIns)) {
      expect([source, read(source)]).toEqual([source, expect.stringContaining(words)])
      expect([source, others.filter((file) => read(file).includes(words))]).toEqual([
        source,
        [source],
      ])
    }
  })

  // The files this is about: written for a test or a dev screen to draw over, and so named.
  it('is every file outside src/dev and src/test that is named as a fixture or a stand-in', () => {
    const named = sources('src/**/{*.fixtures.ts,standIn.ts,testing.ts}')
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => !file.startsWith('src/dev/') && !file.startsWith('src/test/'))
    expect(named.length).toBeGreaterThan(0)
    for (const file of named) expect(Object.keys(standIns)).toContain(file)
  })

  it('is found in an export that holds it, and named by its file', () => {
    const root = mkdtempSync(join(tmpdir(), 'household-mobile-check-'))
    try {
      mkdirSync(join(root, '_expo', 'static', 'js', 'ios'), { recursive: true })
      const [[source, words] = ['', '']] = Object.entries(standIns)
      // As bytecode keeps a string that is not plain ASCII.
      writeFileSync(
        join(root, '_expo', 'static', 'js', 'ios', 'index-3.hbc'),
        Buffer.from(`\0${words}\0`, 'utf16le'),
      )
      const { failures } = check(root)
      expect(failures).toHaveLength(1)
      expect(failures[0]).toContain(source)
      expect(failures[0]).toContain('index-3.hbc')
    } finally {
      rmSync(root, { recursive: true, force: true })
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
