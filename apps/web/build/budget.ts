// The web app's bundle budget (06-clients §8, D-153): what a first visit downloads before the app
// can draw, compressed as a server sends it. A budget is a number in this file: a pull request
// that needs more raises it here, in a line of its diff, or loads what it added later.
import { gzipSync } from 'node:zlib'

/** One thousand bytes, as the build's own report counts. */
const kB = 1000

export const budgets = {
  /** The scripts index.html names: the entry, and every file the entry imports before it runs. */
  script: 200 * kB,
  /** The stylesheets index.html names. The faces they name are fetched by script, and are not here. */
  style: 20 * kB,
  /** Any one script loaded later, by a route or a feature of its own. */
  lazy: 150 * kB,
} as const

export type Budget = keyof typeof budgets

/** A file's size as a server sends it: gzip at its best level, in bytes. */
export function compressed(content: string | Uint8Array): number {
  return gzipSync(content, { level: 9 }).byteLength
}

const tag = /<(script|link)\b([^>]*)>/gi
const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attributes)?.[1]

/**
 * The files `html` makes a browser fetch before the app runs, by kind: each `<script src>`, each
 * `<link rel="modulepreload">`, which is a file the entry imports, and each stylesheet.
 */
export function initialFiles(html: string): {
  readonly script: string[]
  readonly style: string[]
} {
  const script: string[] = []
  const style: string[] = []
  for (const [, name = '', attributes = ''] of html.matchAll(tag)) {
    if (name.toLowerCase() === 'script') {
      const src = attribute(attributes, 'src')
      if (src !== undefined) script.push(src)
      continue
    }
    const rel = attribute(attributes, 'rel')?.toLowerCase()
    const href = attribute(attributes, 'href')
    if (href === undefined) continue
    if (rel === 'modulepreload') script.push(href)
    if (rel === 'stylesheet') style.push(href)
  }
  return { script, style }
}

export interface Measured {
  readonly budget: Budget
  /** What was measured: a kind of file, or one file by name. */
  readonly what: string
  readonly bytes: number
  readonly limit: number
}

/**
 * Every measurement of a build against its budget: the initial scripts together, the initial
 * stylesheets together, and each other script alone. `read` gives a file's content by the path
 * index.html or the build names it.
 */
export function measure(
  html: string,
  scripts: readonly string[],
  read: (path: string) => string | Uint8Array,
): Measured[] {
  const initial = initialFiles(html)
  const total = (paths: readonly string[]) =>
    paths.reduce((sum, path) => sum + compressed(read(path)), 0)
  return [
    {
      budget: 'script',
      what: `${String(initial.script.length)} initial scripts`,
      bytes: total(initial.script),
      limit: budgets.script,
    },
    {
      budget: 'style',
      what: `${String(initial.style.length)} initial stylesheets`,
      bytes: total(initial.style),
      limit: budgets.style,
    },
    ...scripts
      .filter((path) => !initial.script.includes(path))
      .map((path): Measured => ({
        budget: 'lazy',
        what: path,
        bytes: compressed(read(path)),
        limit: budgets.lazy,
      })),
  ]
}
