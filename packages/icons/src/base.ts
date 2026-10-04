/**
 * The base set's glyphs, read from the vendored `lucide.json`. The file is data another project
 * drew, so it is read into the drawing model shape by shape, and a shape the model does not know
 * is refused rather than passed through to a client.
 */
import vendored from './lucide.json'
import { baseIds, type BaseId } from './manifest.ts'
import type { Shape } from './svg.ts'

type Attributes = Readonly<Record<string, string | number>>

function number(attributes: Attributes, name: string, glyph: string): number {
  const value = attributes[name]
  if (typeof value !== 'number') throw new Error(`icons: ${glyph} has no number ${name}`)
  return value
}

function optional(attributes: Attributes, name: string, glyph: string): number | undefined {
  return attributes[name] === undefined ? undefined : number(attributes, name, glyph)
}

function shape(node: Attributes, glyph: string): Shape {
  const tag = node.tag
  switch (tag) {
    case 'path': {
      const d = node.d
      if (typeof d !== 'string') throw new Error(`icons: ${glyph} has a path with no data`)
      return { tag, d }
    }
    case 'circle':
      return {
        tag,
        cx: number(node, 'cx', glyph),
        cy: number(node, 'cy', glyph),
        r: number(node, 'r', glyph),
      }
    case 'rect': {
      const [rx, ry] = [optional(node, 'rx', glyph), optional(node, 'ry', glyph)]
      return {
        tag,
        x: number(node, 'x', glyph),
        y: number(node, 'y', glyph),
        width: number(node, 'width', glyph),
        height: number(node, 'height', glyph),
        ...(rx === undefined ? {} : { rx }),
        ...(ry === undefined ? {} : { ry }),
      }
    }
    case 'line':
      return {
        tag,
        x1: number(node, 'x1', glyph),
        y1: number(node, 'y1', glyph),
        x2: number(node, 'x2', glyph),
        y2: number(node, 'y2', glyph),
      }
    default:
      throw new Error(
        `icons: ${glyph} has a <${String(tag)}>, which the drawing model does not draw`,
      )
  }
}

const icons: Readonly<Record<string, readonly Attributes[] | undefined>> = vendored.icons

/** The Lucide release the vendored glyphs are from. */
export const lucideVersion: string = vendored.version

function glyphs(): Record<BaseId, readonly Shape[]> {
  const out: Partial<Record<BaseId, readonly Shape[]>> = {}
  for (const id of baseIds) {
    const drawn = icons[id]
    if (drawn === undefined) throw new Error(`icons: ${id} is not vendored`)
    out[id] = drawn.map((node) => shape(node, id))
  }
  // Every id of the manifest is set above, or the loop threw.
  return out as Record<BaseId, readonly Shape[]>
}

export const baseGlyphs: Readonly<Record<BaseId, readonly Shape[]>> = glyphs()
