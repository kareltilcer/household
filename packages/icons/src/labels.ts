/**
 * The icon-only control register (07-delivery §3, 06-clients §4): every control drawn as a glyph
 * with no text beside it has a label, with no exception for an obvious one. Ported from
 * design/v1's `icons.js`. A label that refers to a row names it through an argument, `{name}` or
 * `{list}`, rather than saying "Delete" alone, and the catalogs' types make a caller pass it.
 *
 * A status or a module glyph that stands alone is labelled by its own key (glyphs.ts). The sync
 * mark and the conflict flag are controls, so they take sentences of their own here, which say
 * what opening them does: the prototype gave them their status's key with a different English.
 */
import type { MessageKey } from '@household/i18n'
import type { NavigationId, StatusId } from './glyphs.ts'
import type { BaseId } from './manifest.ts'

export type GlyphRef =
  | { readonly set: 'base'; readonly id: BaseId }
  | { readonly set: 'module'; readonly id: NavigationId }
  | { readonly set: 'status'; readonly id: StatusId }

export interface Control {
  readonly glyph: GlyphRef
  readonly labelKey: MessageKey
}

export const controls = {
  back: { glyph: { set: 'base', id: 'arrow-left' }, labelKey: 'a11y.control.back' },
  close_sheet: { glyph: { set: 'base', id: 'x' }, labelKey: 'a11y.control.close_sheet' },
  /** `{name}`: the row. */
  more_actions: {
    glyph: { set: 'base', id: 'more-horizontal' },
    labelKey: 'a11y.control.more_actions',
  },
  /** `{name}`: the object. */
  edit: { glyph: { set: 'base', id: 'pencil' }, labelKey: 'a11y.control.edit' },
  /** `{name}`: the object, so the destructive control names what it destroys. */
  delete: { glyph: { set: 'base', id: 'trash-2' }, labelKey: 'a11y.control.delete' },
  /** `{name}`: the object. */
  share: { glyph: { set: 'base', id: 'share-2' }, labelKey: 'a11y.control.share' },
  /** `{name}`: the file. */
  download: { glyph: { set: 'base', id: 'download' }, labelKey: 'a11y.control.download' },
  attach: { glyph: { set: 'base', id: 'paperclip' }, labelKey: 'a11y.control.attach' },
  camera: { glyph: { set: 'base', id: 'camera' }, labelKey: 'a11y.control.camera' },
  search: { glyph: { set: 'base', id: 'search' }, labelKey: 'a11y.control.search' },
  /** `{list}`: the list's name. */
  filter: { glyph: { set: 'base', id: 'filter' }, labelKey: 'a11y.control.filter' },
  /** `{list}`: the list's name. */
  sort: { glyph: { set: 'base', id: 'arrow-up-down' }, labelKey: 'a11y.control.sort' },
  /** `{name}`: the row. The label says how the keyboard moves it. */
  reorder: { glyph: { set: 'base', id: 'grip-vertical' }, labelKey: 'a11y.control.reorder' },
  add: { glyph: { set: 'module', id: 'add' }, labelKey: 'nav.add' },
  today: { glyph: { set: 'module', id: 'today' }, labelKey: 'nav.today' },
  /** `{household}`: the one that is open. */
  switch_household: {
    glyph: { set: 'base', id: 'chevrons-up-down' },
    labelKey: 'a11y.control.switch_household',
  },
  /** `{theme}`: the appearance in effect, in words. */
  theme: { glyph: { set: 'base', id: 'sun' }, labelKey: 'a11y.control.theme' },
  /** `{state}`: the sync state's own word. Drawn as the state's glyph; `syncing` is its register entry. */
  sync_state: { glyph: { set: 'status', id: 'syncing' }, labelKey: 'a11y.control.sync_state' },
  /** `{name}`: the row with two versions. */
  conflict: { glyph: { set: 'status', id: 'conflict' }, labelKey: 'a11y.control.conflict' },
  /** `{name}`: what is printed. */
  print: { glyph: { set: 'base', id: 'printer' }, labelKey: 'a11y.control.print' },
} as const satisfies Record<string, Control>

export type ControlId = keyof typeof controls
