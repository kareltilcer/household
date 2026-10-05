/**
 * The licensed base set (DD-10, PL-13): the 55 general glyphs taken from Lucide (ISC), vendored
 * into `lucide.json` by `scripts/vendor.ts` and never fetched at runtime (N8). Only these are
 * vendored: the manifest is what the package ships of Lucide.
 *
 * A base glyph may never stand for a status or a module. If one starts carrying meaning, it moves
 * in-house and joins one of the two sets in glyphs.ts.
 */
export const baseGroups = {
  navigation: [
    'chevron-left',
    'chevron-right',
    'chevron-up',
    'chevron-down',
    'chevrons-up-down',
    'arrow-left',
    'arrow-right',
    'external-link',
    'x',
  ],
  actions: [
    'plus',
    'minus',
    'check',
    'pencil',
    'trash-2',
    'copy',
    'share-2',
    'download',
    'upload',
    'printer',
    'archive',
    'rotate-ccw',
    'more-horizontal',
    'more-vertical',
    'grip-vertical',
  ],
  find: [
    'search',
    'filter',
    'arrow-up-down',
    'calendar-days',
    'clock',
    'camera',
    'image',
    'paperclip',
    'qr-code',
    'map-pin',
  ],
  meaning: [
    'info',
    'alert-triangle',
    'alert-circle',
    'help-circle',
    'eye',
    'eye-off',
    'star',
    'pin',
    'link',
  ],
  identity: [
    'user',
    'users',
    'key',
    'shield',
    'log-out',
    'smartphone',
    'monitor',
    'credit-card',
    'bell',
    'bell-off',
    'sun',
    'moon',
  ],
} as const

export type BaseId = (typeof baseGroups)[keyof typeof baseGroups][number]

export const baseIds: readonly BaseId[] = Object.values(baseGroups).flat()

/**
 * Lucide's name for a glyph it has renamed since the design named the set. Household keeps the
 * name the design and its screens use; the vendoring reads the glyph under Lucide's.
 */
export const lucideNames: Readonly<Partial<Record<BaseId, string>>> = {
  'trash-2': 'trash',
  'more-horizontal': 'ellipsis',
  'more-vertical': 'ellipsis-vertical',
  filter: 'funnel',
  'alert-triangle': 'triangle-alert',
  'alert-circle': 'circle-alert',
  'help-circle': 'circle-question-mark',
}

/** Lucide draws every glyph on a 24-unit grid at a 2-unit stroke, round caps and joins. */
export const baseStroke = 2
