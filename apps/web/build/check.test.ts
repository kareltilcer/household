// @vitest-environment node
// The bundle budget and the check of a build (check.ts), run as CI runs it, against builds made
// here to be right and to be wrong in each way the check names.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  budgets,
  catalogChunk,
  catalogOf,
  compressed,
  initialFiles,
  isOwnWords,
  measure,
  ownWords,
} from './budget.ts'
import { metaPolicy } from './csp.ts'

const here = dirname(fileURLToPath(import.meta.url))
const made: string[] = []

afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true })
})

const id = '008f0f94379a5b41'

/** The page's statement of its encoding, as the build writes it: first in the head. */
const encoding = '<meta charset="utf-8">'

/**
 * index.html as the build writes it, with `head` in its head after the policy. A page that
 * `names` nothing is written with no script and no stylesheet at all.
 */
function page(head = '', policy = metaPolicy.replaceAll("'", '&#39;'), names = true): string {
  const boot = names ? '<script src="/assets/display-1.js"></script>' : ''
  const files = names
    ? `<script type="module" crossorigin src="/assets/index-1.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-1.js">
    <link rel="stylesheet" crossorigin href="/assets/index-1.css">`
    : ''
  return `<!doctype html>
<html lang="en">
  <head>
    ${encoding}
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    ${boot}
    <meta name="household-build" content="${id}" />
    ${files}
    ${head}
  </head>
  <body><div id="root"></div></body>
</html>
`
}

/** A build on disk: a right one, with `changed` written over it. */
function build(changed: Readonly<Record<string, string | Uint8Array | null>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'household-check-'))
  made.push(root)
  const files: Record<string, string | Uint8Array | null> = {
    'index.html': page(),
    'build.json': `${JSON.stringify({ id })}\n`,
    'assets/display-1.js': '(function(){})()',
    'assets/index-1.js': 'import "./vendor-1.js";console.log("app")',
    'assets/vendor-1.js': 'export const react = 1',
    // The app's own words, by the name the build gives their file: counted with the first download.
    'assets/catalog-en.app-1.js': 'export default {"app.name":"Household"}',
    'assets/index-1.css': 'body{color:var(--text-primary)}',
    ...changed,
  }
  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root
}

function check(root: string): { readonly passed: boolean; readonly said: string } {
  try {
    const said = execFileSync(process.execPath, [join(here, 'check.ts'), root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { passed: true, said }
  } catch (error) {
    const { stdout, stderr } = error as { stdout: string; stderr: string }
    return { passed: false, said: `${stdout}${stderr}` }
  }
}

describe('the bundle budget', () => {
  it('counts what index.html makes a browser fetch before the app runs', () => {
    expect(initialFiles(page('<link rel="icon" href="/favicon.svg">'))).toEqual({
      script: ['/assets/display-1.js', '/assets/index-1.js', '/assets/vendor-1.js'],
      style: ['/assets/index-1.css'],
    })
  })

  it('measures the initial scripts together, the stylesheets together, and a later script alone', () => {
    const contents: Readonly<Record<string, string>> = {
      '/assets/display-1.js': 'a'.repeat(100),
      '/assets/index-1.js': 'b'.repeat(100),
      '/assets/vendor-1.js': 'c'.repeat(100),
      '/assets/index-1.css': 'd'.repeat(100),
      '/assets/Harness-1.js': 'e'.repeat(100),
    }
    const read = (path: string) => contents[path] ?? ''
    const one = compressed('a'.repeat(100))
    expect(
      measure(
        page(),
        Object.keys(contents).filter((path) => path.endsWith('.js')),
        read,
      ),
    ).toEqual([
      { budget: 'script', what: '3 initial scripts', bytes: one * 3, limit: budgets.script },
      { budget: 'style', what: '1 initial stylesheets', bytes: one, limit: budgets.style },
      { budget: 'lazy', what: '/assets/Harness-1.js', bytes: one, limit: budgets.lazy },
    ])
  })

  // The app holds one language at a time, and a language in parts (D-159): its own words are
  // fetched before it draws one, in whichever language its member reads, and a screen's with
  // the screen.
  it('counts the app’s own words in the largest language with the initial scripts, and a screen’s as its script', () => {
    const contents: Readonly<Record<string, string | Uint8Array>> = {
      '/assets/display-1.js': 'a'.repeat(100),
      '/assets/index-1.js': 'b'.repeat(100),
      '/assets/vendor-1.js': 'c'.repeat(100),
      '/assets/index-1.css': 'd'.repeat(100),
      '/assets/catalog-en.app-1.js': randomBytes(1000),
      '/assets/catalog-de.app-1.js': randomBytes(3000),
      '/assets/catalog-cs.app-1.js': randomBytes(2000),
      '/assets/catalog-de.household-1.js': randomBytes(4000),
      '/assets/catalog-en.storage-1.js': 'e'.repeat(100),
    }
    const read = (path: string) => contents[path] ?? ''
    const one = compressed('a'.repeat(100))
    const sized = (path: string) => compressed(read(path))
    expect(
      measure(
        page(),
        Object.keys(contents).filter((path) => path.endsWith('.js')),
        read,
      ),
    ).toEqual([
      {
        budget: 'script',
        what: "3 initial scripts and the app's own words in the largest language",
        bytes: one * 3 + sized('/assets/catalog-de.app-1.js'),
        limit: budgets.script,
      },
      { budget: 'style', what: '1 initial stylesheets', bytes: one, limit: budgets.style },
      {
        budget: 'lazy',
        what: '/assets/catalog-de.household-1.js',
        bytes: sized('/assets/catalog-de.household-1.js'),
        limit: budgets.lazy,
      },
      { budget: 'lazy', what: '/assets/catalog-en.storage-1.js', bytes: one, limit: budgets.lazy },
    ])
  })

  it('knows a part of a catalog by the file @household/i18n generates for it', () => {
    const parts = join(here, '..', '..', '..', 'packages', 'i18n', 'src', 'generated', 'parts')
    expect(catalogOf([join(parts, 'de.household.json')])).toBe('de.household')
    // As Vite writes a path on every platform, and with the query a plugin may add.
    expect(catalogOf([`${join(parts, 'en.app.json').split('\\').join('/')}?import`])).toBe('en.app')
    // A chunk that holds anything else, or anything more, is no part's own file.
    expect(catalogOf([join(here, '..', 'src', 'main.tsx')])).toBeUndefined()
    expect(
      catalogOf([join(parts, 'en.app.json'), join(parts, 'en.household.json')]),
    ).toBeUndefined()
    expect(catalogOf([join(parts, '..', '..', '..', 'catalogs', 'en.json')])).toBeUndefined()
    expect(catalogOf([])).toBeUndefined()
    // The file is there, and the app's own words are a part it writes: what the build names by.
    expect(existsSync(join(parts, `en.${ownWords}.json`))).toBe(true)
    expect(isOwnWords(`/assets/${catalogChunk}pl.${ownWords}-B2quqb2a.js`)).toBe(true)
    expect(isOwnWords(`/assets/${catalogChunk}pl.household-B2quqb2a.js`)).toBe(false)
    expect(isOwnWords('/assets/app-B2quqb2a.js')).toBe(false)
  })

  it('counts a file as a server sends it', () => {
    expect(compressed('a'.repeat(10_000))).toBeLessThan(100)
    expect(compressed(randomBytes(10_000))).toBeGreaterThan(10_000)
  })
})

describe('the check of a build', () => {
  it('passes a build that is under budget, clean under the policy and names its id', () => {
    const { passed, said } = check(build())
    expect(said).toContain('under budget, clean under the policy, no dev-only page')
    expect(passed).toBe(true)
  })

  it('finds no script before the policy of a page that names none', () => {
    // Written without them, not with them taken out: a page is no text to strip tags from.
    const bare = page('', undefined, false)
    expect(bare).not.toContain('<script')
    expect(bare).not.toContain('<link')
    const { passed, said } = check(build({ 'index.html': bare }))
    expect(said).not.toContain('before its policy')
    expect(passed).toBe(true)
  })

  it.each([
    [
      'an initial script over the budget',
      // What does not compress is as large on the wire as on the disk.
      { 'assets/vendor-1.js': randomBytes(budgets.script + 1000) },
      'is over the script budget',
    ],
    [
      'a stylesheet over the budget',
      { 'assets/index-1.css': randomBytes(budgets.style + 1000) },
      'is over the style budget',
    ],
    [
      'a later script over the budget',
      { 'assets/Garden-1.js': randomBytes(budgets.lazy + 1000) },
      'is over the lazy budget',
    ],
    [
      'the app’s own words over what the initial scripts leave of the budget',
      { 'assets/catalog-de.app-1.js': randomBytes(budgets.script) },
      'is over the script budget',
    ],
    [
      'a screen’s words over the budget',
      { 'assets/catalog-de.household-1.js': randomBytes(budgets.lazy + 1000) },
      'is over the lazy budget',
    ],
    [
      // Named otherwise, or written into another script, they would be counted with nothing.
      'no file of the app’s own words',
      { 'assets/catalog-en.app-1.js': null },
      "holds no file of the app's own words",
    ],
    [
      'no encoding declared',
      { 'index.html': page().replace(encoding, '') },
      'does not declare its encoding',
    ],
    [
      'its encoding declared past what a browser reads for it',
      // As a policy widened for many origins would push it, were it written after the policy.
      { 'index.html': page().replace(encoding, `<!--${'-'.repeat(1024)}-->${encoding}`) },
      'past the 1024 a browser reads',
    ],
    [
      'its encoding declared after a script',
      {
        'index.html': page()
          .replace(encoding, '')
          .replace('<meta name="household-build"', `${encoding}<meta name="household-build"`),
      },
      'a script before it declares its encoding',
    ],
    [
      'no policy',
      { 'index.html': page().replace(/<meta http-equiv[^>]*>/, '') },
      'carries no Content-Security-Policy',
    ],
    [
      'a policy that admits inline script',
      { 'index.html': page('', 'default-src &#39;self&#39; &#39;unsafe-inline&#39;') },
      "policy is not csp.ts's",
    ],
    [
      'a script before the policy',
      { 'index.html': page().replace('<head>', '<head><script src="/assets/early.js"></script>') },
      'before its policy',
    ],
    [
      'an inline script',
      { 'index.html': page('<script>document.title = 1</script>') },
      'holds an inline script',
    ],
    [
      'an inline script whose end tag is written loosely',
      { 'index.html': page('<script src="/assets/index-1.js">document.title = 1</script >') },
      'holds an inline script',
    ],
    [
      'an inline script in capitals, with an attribute on its end tag',
      { 'index.html': page('<SCRIPT>document.title = 1</SCRIPT data-x="1">') },
      'holds an inline script',
    ],
    [
      'an inline script that is never closed',
      { 'index.html': page().replace('</body>', '<script>document.title = 1</body>') },
      'holds an inline script',
    ],
    ['an inline style', { 'index.html': page('<style>body{}</style>') }, 'holds an inline <style>'],
    [
      'a style attribute',
      { 'index.html': page().replace('<div id="root">', '<div id="root" style="margin:0">') },
      'holds an inline style attribute',
    ],
    [
      'an inline handler',
      { 'index.html': page().replace('<body>', '<body onload="start()">') },
      'holds an inline event handler',
    ],
    [
      'a file of another origin',
      { 'index.html': page('<link rel="stylesheet" href="https://fonts.example/plex.css">') },
      "is not this origin's",
    ],
    [
      'a font inlined as data',
      { 'assets/index-1.css': '@font-face{src:url(data:font/woff2;base64,AAAA)}' },
      'holds a data: URL',
    ],
    [
      'a font of another origin',
      { 'assets/index-1.css': '@font-face{src:url("https://fonts.example/plex.woff2")}' },
      'names a file of another origin',
    ],
    [
      'the dev-only harness',
      { 'assets/Harness-1.js': 'el.setAttribute("data-harness-cell", id)' },
      'carries the dev-only harness',
    ],
    [
      'a source map',
      { 'assets/index-1.js.map': '{"version":3,"sources":["../../src/main.tsx"]}' },
      'is a source map',
    ],
    [
      'a file the build did not write',
      { 'assets/vendor-1.js': null },
      'which the build did not write',
    ],
    ['no build.json', { 'build.json': null }, 'build.json is missing'],
    [
      'a build.json of another build',
      { 'build.json': '{"id":"ffffffffffffffff"}' },
      'does not name the build index.html names',
    ],
    ['no build id', { 'index.html': page().replace(id, 'development') }, 'names no build id'],
  ] as const)('fails a build with %s', (_, changed, reason) => {
    const { passed, said } = check(build(changed))
    expect(said).toContain(reason)
    expect(passed).toBe(false)
  })

  it('fails, and says what to run, where there is no build', () => {
    const empty = mkdtempSync(join(tmpdir(), 'household-check-'))
    made.push(empty)
    const { passed, said } = check(empty)
    expect(said).toContain('pnpm run build')
    expect(passed).toBe(false)
  })
})
