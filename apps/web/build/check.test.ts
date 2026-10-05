// @vitest-environment node
// The bundle budget and the check of a build (check.ts), run as CI runs it, against builds made
// here to be right and to be wrong in each way the check names.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { budgets, compressed, initialFiles, measure } from './budget.ts'
import { metaPolicy } from './csp.ts'

const here = dirname(fileURLToPath(import.meta.url))
const made: string[] = []

afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true })
})

const id = '008f0f94379a5b41'

/** index.html as the build writes it, with `head` in its head after the policy. */
function page(head = '', policy = metaPolicy.replaceAll("'", '&#39;')): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    <script src="/assets/display-1.js"></script>
    <meta name="household-build" content="${id}" />
    <script type="module" crossorigin src="/assets/index-1.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-1.js">
    <link rel="stylesheet" crossorigin href="/assets/index-1.css">
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
