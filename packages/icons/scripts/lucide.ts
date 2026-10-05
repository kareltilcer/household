// What the package vendors of Lucide (PL-13): the manifest's 55 glyphs as the drawing model's
// shapes, and Lucide's licence, which its ISC terms keep with every copy. Read from the release
// package.json pins, lucide-static, a devDependency: nothing of Lucide is installed with the
// package or fetched by a client. `vendor.ts` writes these two files and src/base.test.ts fails a
// committed one that is not what the pinned release gives.
import { readFileSync } from 'node:fs'
import { baseIds, lucideNames } from '../src/manifest.ts'

const lucide = new URL('../node_modules/lucide-static/', import.meta.url)

function read(file: string): string {
  return readFileSync(new URL(file, lucide), 'utf8')
}

type Json = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A shape as lucide-static states it, `[tag, attributes]`, as the drawing model's object. */
function shape(node: unknown, glyph: string): Record<string, string | number> {
  if (!Array.isArray(node) || typeof node[0] !== 'string' || !isRecord(node[1])) {
    throw new Error(`vendor: ${glyph} has a shape that is not [tag, attributes]`)
  }
  const [tag, attributes] = [node[0], node[1]]
  const out: Record<string, string | number> = { tag }
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== 'string') throw new Error(`vendor: ${glyph} ${tag} ${name} is no string`)
    // Path data stays text; every other attribute of the shapes the set uses is a number.
    if (name === 'd') out[name] = value
    else if (/^-?\d+(\.\d+)?$/.test(value)) out[name] = Number(value)
    else throw new Error(`vendor: ${glyph} ${tag} ${name}="${value}" is not a number`)
  }
  return out
}

export function vendor(): { readonly json: string; readonly license: string } {
  const version: unknown = (JSON.parse(read('package.json')) as Json).version
  const nodes: unknown = JSON.parse(read('icon-nodes.json'))
  if (typeof version !== 'string' || !isRecord(nodes)) {
    throw new Error('vendor: lucide-static is not the package this script reads')
  }
  const icons = Object.fromEntries(
    baseIds.map((id) => {
      const drawn = nodes[lucideNames[id] ?? id]
      if (!Array.isArray(drawn)) {
        throw new Error(`vendor: Lucide ${version} has no ${lucideNames[id] ?? id} (${id})`)
      }
      return [id, drawn.map((node: unknown) => shape(node, id))]
    }),
  )
  return {
    json: `${JSON.stringify({ version, icons }, null, 2)}\n`,
    license: read('LICENSE').replaceAll('\r\n', '\n'),
  }
}
