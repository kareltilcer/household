/**
 * @household/icons — the glyphs and the illustration kit, as data and as drawings (PL-13, design
 * 01-foundations §8, DD-5, DD-10). Ported from design/v1's `icons.js` and `illustration.js`.
 *
 * - glyphs.ts: the thirteen status and nineteen navigation glyphs, drawn in-house.
 * - manifest.ts, base.ts: the 55 general glyphs vendored from Lucide.
 * - labels.ts: the register of icon-only controls, each with its label's key.
 * - illustration.ts: eighteen parts, eleven compositions and the eight rules.
 * - svg.ts: the drawing both clients draw. `@household/icons/web` draws it as React DOM's SVG
 *   elements and `@household/icons/native` as react-native-svg's; the clients share no component
 *   (D-36), so they share the drawing.
 *
 * Every icon-only control has a label (06-clients §4): a glyph drawn without one is decoration
 * beside words that say the same thing, and is hidden from assistive technology.
 */
import { baseGlyphs } from './base.ts'
import { grid, moduleGlyphs, statusGlyphs, type NavigationId, type StatusId } from './glyphs.ts'
import { baseStroke, type BaseId } from './manifest.ts'
import { glyph, type Drawing, type Path } from './svg.ts'

export { baseGlyphs, lucideVersion } from './base.ts'
export {
  grid,
  moduleGlyphs,
  statusGlyphs,
  type ModuleGlyph,
  type NavigationId,
  type StatusGlyph,
  type StatusId,
} from './glyphs.ts'
export {
  compositions,
  fillOpacity,
  frame,
  illustration,
  parts,
  partScales,
  type Composition,
  type CompositionId,
  type Paint,
  type Part,
  type PartId,
  type PartScale,
  type Placement,
} from './illustration.ts'
export { controls, type Control, type ControlId, type GlyphRef } from './labels.ts'
export { baseGroups, baseIds, baseStroke, lucideNames, type BaseId } from './manifest.ts'
export {
  nodes,
  type Circle,
  type Drawing,
  type Group,
  type Line,
  type Node,
  type Path,
  type Presentation,
  type Rect,
  type Shape,
} from './svg.ts'

function paths(data: readonly string[]): Path[] {
  return data.map((d) => ({ tag: 'path', d }))
}

/** The sizes each set is reviewed at, in px, its first the one it is drawn at when none is asked. */
export const sizes = {
  /** A row's mark, and a status stated in words. */
  status: [16, 20],
  /** The web sidebar, and the mobile tab bar. */
  module: [20, 28],
  base: [20, 24],
} as const

/** A status glyph, at the status set's weight. */
export function statusIcon(id: StatusId, size: number = sizes.status[0]): Drawing {
  return glyph(paths(statusGlyphs[id].paths), grid.statusStroke, size)
}

/** A module's glyph, or Today's or Add's, at the module set's weight. */
export function moduleIcon(id: NavigationId, size: number = sizes.module[0]): Drawing {
  return glyph(paths(moduleGlyphs[id].paths), grid.moduleStroke, size)
}

/** A glyph of the base set, at Lucide's weight. */
export function baseIcon(id: BaseId, size: number = sizes.base[0]): Drawing {
  return glyph(baseGlyphs[id], baseStroke, size)
}
