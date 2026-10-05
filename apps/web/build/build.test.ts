// @vitest-environment jsdom
// The build's own parts, held without a build: the policy, the script that sets the display modes
// before the first paint, and the build's id. What a build actually wrote is check.ts's, and what
// a browser does under the policy is the end-to-end suite's.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attributesOf,
  densities,
  motions,
  parsePreferences,
  scales,
  storageKey,
  themes,
} from '../src/display/modes.ts'
import { bootScript } from './boot.ts'
import { directives, headerOnly, headerPolicy, metaPolicy, unsafeSources } from './csp.ts'
import { buildId, devOnly } from './plugin.ts'

describe('the policy', () => {
  it('admits nothing inline and nothing evaluated', () => {
    for (const source of unsafeSources) expect(headerPolicy).not.toContain(source)
    expect(directives['default-src']).toEqual(["'none'"])
    // Scripts and styles from the app's own origin alone: no scheme, no wildcard, no other host.
    expect(directives['script-src']).toEqual(["'self'"])
    expect(directives['style-src']).toEqual(["'self'"])
  })

  it('names every source as itself or nothing', () => {
    const sources: readonly string[] = Object.values({ ...directives, ...headerOnly }).flat()
    expect(sources.filter((source) => source !== "'self'" && source !== "'none'")).toEqual([])
  })

  it('keeps what a <meta> cannot carry for the header alone', () => {
    expect(metaPolicy).not.toContain('frame-ancestors')
    expect(headerPolicy).toBe(`${metaPolicy}; frame-ancestors 'none'`)
  })
})

describe('the script in the head', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Runs the script as a page does: a classic script, with the page's own globals. */
  function boot(): void {
    const script = document.createElement('script')
    script.textContent = bootScript()
    document.head.append(script)
    script.remove()
  }

  function run(stored: string | null): Record<string, string> {
    for (const attribute of [...document.documentElement.attributes]) {
      document.documentElement.removeAttribute(attribute.name)
    }
    window.localStorage.clear()
    if (stored !== null) window.localStorage.setItem(storageKey, stored)
    boot()
    return Object.fromEntries(
      [...document.documentElement.attributes].map(({ name, value }) => [name, value]),
    )
  }

  /** What the app itself puts on the root for the same stored value. */
  function app(stored: string | null): Record<string, string> {
    return Object.fromEntries(
      Object.entries(attributesOf(parsePreferences(stored))).filter(
        (entry): entry is [string, string] => entry[1] !== null,
      ),
    )
  }

  const stored = [
    ...themes.flatMap((theme) =>
      densities.flatMap((density) =>
        scales.flatMap((scale) =>
          motions.map((motion) => JSON.stringify({ theme, density, scale, motion })),
        ),
      ),
    ),
    // What storage may hold that the app never wrote.
    null,
    '',
    'not json',
    'null',
    '[]',
    '"dark"',
    JSON.stringify({ theme: 'sepia', density: 3, scale: 200, motion: null }),
    JSON.stringify({ theme: ['dark'], extra: 'dark' }),
    JSON.stringify({ theme: 'dark' }),
  ]

  it.each(stored)('sets what the app sets for %j', (value) => {
    expect(run(value)).toEqual(app(value))
  })

  it('sets the dark theme and 200 % text, which is what it is for', () => {
    expect(run(JSON.stringify({ theme: 'dark', scale: '200' }))).toEqual({
      'data-theme': 'dark',
      'data-scale': '200',
    })
  })

  it('leaves the root alone where storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(run(null)).toEqual({})
  })
})

describe("a build's id", () => {
  const files = { 'index.html': '<html>', 'assets/a.js': 'a()', 'assets/b.css': 'b{}' }

  it('is the same for the same files, in whatever order they were written', () => {
    const reordered = {
      'assets/b.css': 'b{}',
      'assets/a.js': 'a()',
      'index.html': '<html>',
    }
    expect(buildId(reordered)).toBe(buildId(files))
    expect(buildId(files)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes with any file, by its content or by its name', () => {
    expect(buildId({ ...files, 'assets/a.js': 'a2()' })).not.toBe(buildId(files))
    const { 'assets/a.js': script, ...rest } = files
    expect(buildId({ ...rest, 'assets/c.js': script })).not.toBe(buildId(files))
    // A name and a content are told apart: `a` + `bc` is not `ab` + `c`.
    expect(buildId({ a: 'bc' })).not.toBe(buildId({ ab: 'c' }))
  })
})

describe('the dev-only pages', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const file = (path: string) => join(root, path)

  it('are known by where they are kept: every file under src/dev, and none beside it', () => {
    const shipped = [
      file('src/app/Home.tsx'),
      file('src/ui/Button.module.css'),
      file('src/developer.ts'),
      resolve(root, '..', '..', 'packages', 'i18n', 'src', 'dev', 'index.ts'),
      '\0vite/preload-helper.js',
    ]
    const dev = [
      file('src/dev/Primitives.tsx'),
      file('src/dev/sample.ts'),
      file('src/dev/harness/Harness.tsx'),
      // As a bundler names a stylesheet it made a module of, and a module a plugin made up.
      `${file('src/dev/Primitives.module.css')}?used`,
      `\0${file('src/dev/harness/model.ts')}`,
      // As Vite writes a path on every platform.
      file('src/dev/DevToolbar.tsx').split('\\').join('/'),
    ]
    expect(devOnly([...shipped, ...dev], root)).toEqual(dev)
    expect(devOnly(shipped, root)).toEqual([])
  })
})
