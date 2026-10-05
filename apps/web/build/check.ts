// `pnpm --filter @household/web run check`: what a build a deployment serves is held to, read off
// the files `vite build` wrote to dist/www (06-clients §8, PRD 07 §4). It exits 1 when the build
//
// - is over its bundle budget (budget.ts);
// - is not clean under the policy (csp.ts): index.html does not carry it, or holds a script, a
//   style or a handler inline, or names a file of another origin, or a stylesheet holds a `data:`
//   URL. What a browser refuses at run time the end-to-end suite hears; this is what can be read;
// - carries a dev-only page: the twelve-state harness is in no build a member is served;
// - does not name its own id in build.json, by which a page learns a newer build is live.
//
// An argument names another directory to read than dist/www, which this script's test uses.
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFile, buildMeta } from '../src/update/build.ts'
import { budgets, measure } from './budget.ts'
import { metaPolicy } from './csp.ts'

const root = resolve(
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'www'),
)

/** What marks a dev-only page in a bundle: an attribute the harness alone writes. */
const devMarker = 'data-harness-cell'

const failures: string[] = []
const fail = (message: string) => {
  failures.push(message)
}

if (!existsSync(join(root, 'index.html'))) {
  console.error(`check: ${root} holds no build. Run \`pnpm run build\` first.`)
  process.exit(1)
}

const read = (path: string) => readFileSync(join(root, path.replace(/^\//, '')))

/** Whether `url` is a path of this origin: `/assets/…`, and neither another origin's nor a scheme's. */
const own = (url: string) => url.startsWith('/') && !url.startsWith('//')

/**
 * A file index.html names, for the budget: empty where the build wrote none, which is said once
 * below, or where it is another origin's, which the policy's check says.
 */
const unwritten = new Set<string>()
const named = (path: string): Uint8Array | string => {
  if (!own(path)) return ''
  if (existsSync(join(root, path.replace(/^\//, '')))) return read(path)
  unwritten.add(path)
  return ''
}
const html = read('index.html').toString('utf8')
const files = globSync('**/*', { cwd: root, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) =>
    join(entry.parentPath, entry.name)
      .slice(root.length + 1)
      .split('\\')
      .join('/'),
  )
  .sort()
const scripts = files.filter((file) => file.endsWith('.js')).map((file) => `/${file}`)

// The budget.
const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`
for (const measured of measure(html, scripts, named)) {
  const over = measured.bytes > measured.limit
  console.log(
    `${over ? 'over ' : 'under'}  ${measured.what}: ${kB(measured.bytes)} gzip of ${kB(measured.limit)}`,
  )
  if (over) {
    fail(
      `${measured.what}: ${kB(measured.bytes)} gzip is over the ${measured.budget} budget of ` +
        `${kB(measured.limit)} (build/budget.ts)`,
    )
  }
}
console.log(
  `budgets: ${Object.entries(budgets)
    .map(([name, limit]) => `${name} ${kB(limit)}`)
    .join(', ')}`,
)

for (const path of unwritten) fail(`index.html names ${path}, which the build did not write`)

// The policy, as far as a build's files say.
const entities: Readonly<Record<string, string>> = { '&#39;': "'", '&quot;': '"', '&amp;': '&' }
const decoded = (text: string) =>
  text.replace(/&#39;|&quot;|&amp;/g, (entity) => entities[entity] ?? entity)
const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1]
if (policy === undefined) fail('index.html carries no Content-Security-Policy')
else if (decoded(policy) !== metaPolicy)
  fail(`index.html's policy is not csp.ts's: ${decoded(policy)}`)
if (html.indexOf('http-equiv="Content-Security-Policy"') > html.search(/<(script|link)\b/)) {
  fail(
    'index.html names a script or a stylesheet before its policy, which the policy does not hold',
  )
}
for (const [, attributes = '', body = ''] of html.matchAll(
  /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
)) {
  if (!/\bsrc\s*=/.test(attributes) || body.trim() !== '') fail('index.html holds an inline script')
}
if (/<style\b/i.test(html)) fail('index.html holds an inline <style>')
if (/<[^>]+\sstyle\s*=/i.test(html)) fail('index.html holds an inline style attribute')
if (/<[^>]+\son[a-z]+\s*=/i.test(html)) fail('index.html holds an inline event handler')
for (const [, , url = ''] of html.matchAll(/\b(src|href)\s*=\s*"([^"]*)"/gi)) {
  if (!own(url)) fail(`index.html names ${url}, which is not this origin's`)
}
for (const file of files.filter((name) => name.endsWith('.css'))) {
  const css = read(file).toString('utf8')
  if (/url\(\s*["']?data:/i.test(css)) fail(`${file} holds a data: URL, which the policy refuses`)
  if (/url\(\s*["']?(https?:)?\/\//i.test(css)) fail(`${file} names a file of another origin`)
}

// No dev-only page.
for (const file of files.filter((name) => /\.(js|css|html)$/.test(name))) {
  if (read(file).includes(devMarker)) fail(`${file} carries the dev-only harness`)
}

// The build's id.
const id = new RegExp(`<meta name="${buildMeta}" content="([0-9a-f]{16})"`).exec(html)?.[1]
if (id === undefined) fail(`index.html names no build id in <meta name="${buildMeta}">`)
else if (!existsSync(join(root, buildFile))) fail(`${buildFile} is missing`)
else if (read(buildFile).toString('utf8').trim() !== JSON.stringify({ id })) {
  fail(`${buildFile} does not name the build index.html names, ${id}`)
}

for (const failure of failures) console.error(`check: ${failure}`)
console.log(
  failures.length === 0
    ? `check: ${String(files.length)} files, under budget, clean under the policy, no dev-only page`
    : `check: ${String(failures.length)} failed`,
)
process.exitCode = failures.length === 0 ? 0 : 1
