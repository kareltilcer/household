/**
 * The two sets drawn in-house (DD-10), ported from design/v1's `icons.js`: the thirteen status
 * glyphs and the nineteen navigation glyphs, seventeen modules plus Today and Add. They are where
 * an icon carries meaning rather than decoration, which no licensed set fits.
 *
 * Every glyph is path data on one 24-unit grid, stroked in `currentColor`: no fill, no second
 * colour, no letter and no digit. So a glyph is legible in greyscale (N2), takes its module's
 * accent or its status's token from the surface it sits on, and is the same in five languages.
 * One weight per set: the status set is drawn heavier because it renders at 16 to 20 px on rows,
 * where a 2-unit stroke lands on 1.33 device px; the module set renders at 20 px in the sidebar
 * and 28 px in the tab bar. The distinguishing feature is the outline at 16 px, and interior
 * detail only confirms what the silhouette already says.
 */
import type { MessageKey } from '@household/i18n'
import type { Family, ModuleId, StatusToken } from '@household/tokens'

/** The grid, and each set's stroke: a property of the set, never of the call site. */
export const grid = {
  box: 24,
  /** A 3-unit keyline all round, so a 24 px glyph never touches the edge of its 44 pt target. */
  live: [3, 21],
  statusStroke: 2,
  moduleStroke: 1.75,
} as const

export interface StatusGlyph {
  /** The status's colour (@household/tokens). Colour, icon and word: never one alone. */
  readonly token: StatusToken
  /** The status's word: shown beside the glyph, and its label where the glyph stands alone. */
  readonly labelKey: MessageKey
  readonly paths: readonly string[]
}

/**
 * The thirteen status glyphs (01-foundations §8). `synced` is the one exception to where it is
 * drawn, never to whether: no row carries it, so it appears only where sync is stated in words.
 * Re-snapshot needed has no glyph of its own: it is shown as `syncing`, which it is.
 */
export const statusGlyphs = {
  /** Closed ring, check inside. */
  synced: {
    token: 'status-synced',
    labelKey: 'a11y.status.synced',
    paths: ['M12 3.6a8.4 8.4 0 1 0 0 16.8a8.4 8.4 0 1 0 0-16.8', 'M8.1 12.1l2.7 2.7 5.1-5.5'],
  },
  /** Arrow under a ceiling: what it has not passed yet. Deliberately not an error shape. */
  pending: {
    token: 'status-pending',
    labelKey: 'a11y.status.pending',
    paths: ['M4.6 4.8h14.8', 'M12 20.2V8.4', 'M7.8 12.6L12 8.4l4.2 4.2'],
  },
  /** Two arcs, opposed. Only past the 800 ms threshold. */
  syncing: {
    token: 'status-syncing',
    labelKey: 'a11y.status.syncing',
    paths: [
      'M4.8 12a7.2 7.2 0 0 1 12.4-5',
      'M17.6 3.4v3.9h-3.9',
      'M19.2 12a7.2 7.2 0 0 1-12.4 5',
      'M6.4 20.6v-3.9h3.9',
    ],
  },
  /** Two offset squares: two of the same thing, a shape with no severity in it. */
  conflict: {
    token: 'status-conflict',
    labelKey: 'a11y.status.conflict',
    paths: ['M4.6 4.6h9.8v9.8H4.6z', 'M9.6 9.6h9.8v9.8H9.6z'],
  },
  /** Return hook: a different category of event from conflict, drawn as coming back, not as a cross. */
  rejected: {
    token: 'status-rejected',
    labelKey: 'a11y.status.rejected',
    paths: ['M6.4 8.6h9.1a4.6 4.6 0 0 1 0 9.2H9.2', 'M9.8 5L6.2 8.6l3.6 3.6'],
  },
  /** Arcs with a slash. */
  offline: {
    token: 'status-offline',
    labelKey: 'a11y.status.offline',
    paths: [
      'M4.6 9.6a11.4 11.4 0 0 1 14.8 0',
      'M7.6 13.2a7.2 7.2 0 0 1 8.8 0',
      'M12 16.9a1.3 1.3 0 1 0 0 2.6a1.3 1.3 0 1 0 0-2.6',
      'M4.8 19.6L19.6 4.8',
    ],
  },
  /** Closed clock, with a mark at twelve: the pair to stale's open one. */
  overdue: {
    token: 'status-overdue',
    labelKey: 'a11y.status.overdue',
    paths: ['M12 4.4a7.8 7.8 0 1 0 0 15.6a7.8 7.8 0 1 0 0-15.6', 'M12 8.4v4.2l3.4 2', 'M12 2v2.4'],
  },
  /** Wide barrier: the only wide horizontal silhouette in the set. */
  blocked: {
    token: 'status-blocked',
    labelKey: 'a11y.status.blocked',
    paths: ['M3.6 9.8h16.8v4.6H3.6z', 'M9.3 9.8L5.9 14.4', 'M14.9 9.8L11.5 14.4'],
  },
  /** Double tilde: the approximation sign itself. */
  estimated: {
    token: 'status-estimated',
    labelKey: 'a11y.status.estimated',
    paths: [
      'M4.6 10c1.85-2.6 3.85-2.6 5.7 0s3.85 2.6 5.7 0',
      'M4.6 15.4c1.85-2.6 3.85-2.6 5.7 0s3.85 2.6 5.7 0',
    ],
  },
  /** Hatched block: an area with something in it that cannot be opened. */
  private: {
    token: 'status-private',
    labelKey: 'a11y.status.private',
    paths: [
      'M4.6 5.4h14.8v13.2H4.6z',
      'M5.6 11.4L10.6 6.4',
      'M5.6 16.4L15.6 6.4',
      'M10.6 17.4L18.4 9.6',
    ],
  },
  /** Padlock. Absence beats disabling, so this glyph is rarer than it looks. */
  locked: {
    token: 'status-locked',
    labelKey: 'a11y.status.locked',
    paths: ['M6.8 10.6h10.4v8.2H6.8z', 'M9.4 10.6V8.4a2.6 2.6 0 0 1 5.2 0v2.2'],
  },
  /** Open clock: the gap in the ring is the point. Time has passed and nothing came in. */
  stale: {
    token: 'status-stale',
    labelKey: 'a11y.status.stale',
    paths: ['M19.4 12A7.4 7.4 0 1 0 12 19.4', 'M16.6 9.6L19.4 12l-2.8 2.4', 'M12 9.6v2.8l2.3 1.4'],
  },
  /** Empty axes: the dash is where a series would be, a shape a genuine zero never takes. */
  no_history: {
    token: 'status-no-history',
    labelKey: 'a11y.status.no_history',
    paths: ['M5.4 4.8v14h14', 'M8.6 13.6h7.4'],
  },
} as const satisfies Record<string, StatusGlyph>

export type StatusId = keyof typeof statusGlyphs

/** A destination in the navigation: a module, or one of the two platform tabs that are none. */
export type NavigationId = ModuleId | 'today' | 'add'

export interface ModuleGlyph {
  /** The family whose accent the glyph is drawn in (DD-1). */
  readonly family: Family
  /** The destination's name. */
  readonly labelKey: MessageKey
  readonly paths: readonly string[]
}

/**
 * The seventeen module glyphs, plus Today and Add, which are not modules and are in no accent
 * map: they render in the Household family's hue.
 */
export const moduleGlyphs = {
  /** The widget list itself, at its 2-column reading. */
  dashboard: {
    family: 'household',
    labelKey: 'module.dashboard.name',
    paths: ['M4.6 4.6h6v6h-6z', 'M13.4 4.6h6v6h-6z', 'M4.6 13.4h6v6h-6z', 'M13.4 13.4h6v6h-6z'],
  },
  /** One bubble, not two: threads are the module, a conversation is not. */
  chat: {
    family: 'household',
    labelKey: 'module.chat.name',
    paths: ['M4.8 6.2h14.4v9.4H10.6L6.2 19v-3.4H4.8z'],
  },
  /** A trace across time. Deliberately not a list. */
  activity: {
    family: 'household',
    labelKey: 'module.activity.name',
    paths: ['M4.6 15.4L7.4 15.4 10 8.4 13 18.2 15.8 6.2 18 15.4 19.4 15.4'],
  },
  /** The house with its own controls inside it. Not a gear: a gear is every settings screen. */
  admin: {
    family: 'household',
    labelKey: 'module.admin.name',
    paths: ['M4.8 10.8L12 5.2l7.2 5.6v8.4H4.8z', 'M8.4 14h7.2', 'M8.4 17h4.4'],
  },
  /** Three columns at three heights: the board. */
  tasks: {
    family: 'time',
    labelKey: 'module.tasks.name',
    paths: ['M5 5.4h3.6v13.2H5z', 'M10.2 5.4h3.6v9.2h-3.6z', 'M15.4 5.4h3.6v11h-3.6z'],
  },
  /** The one conventional glyph kept: a reminder is a day, not an instant, so a clock would lie. */
  reminders: {
    family: 'time',
    labelKey: 'module.reminders.name',
    paths: ['M8 16.6V11a4 4 0 0 1 8 0v5.6', 'M6.2 16.6h11.6', 'M10.3 19a1.9 1.9 0 0 0 3.4 0'],
  },
  /** Frame, head rule, two pegs, one day marked. The marked day separates it from Today. */
  calendar: {
    family: 'time',
    labelKey: 'module.calendar.name',
    paths: [
      'M4.8 6.4h14.4v12.8H4.8z',
      'M4.8 10.2h14.4',
      'M9 4.4v3.4',
      'M15 4.4v3.4',
      'M11.2 13.4h1.8v1.8h-1.8z',
    ],
  },
  /** Recurring, and done: the arc is the schedule, the check is the completion. No trophy. */
  chores: {
    family: 'time',
    labelKey: 'module.chores.name',
    paths: ['M19.2 12a7.2 7.2 0 1 1-2.7-5.6', 'M19.8 4.4v3.8h-3.8', 'M8.6 12.2l2.4 2.4 4.6-4.8'],
  },
  /** N sources to M accounts: the flow view in miniature. */
  finance: {
    family: 'money',
    labelKey: 'module.finance.name',
    paths: [
      'M6.6 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6',
      'M6.6 14.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6',
      'M17.4 10.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6',
      'M8.4 8.6C12 9.6 12.8 10.6 15.6 11.5',
      'M8.4 15.4C12 14.4 12.8 13.4 15.6 12.5',
    ],
  },
  /** A register with a needle on a plinth: the meter. */
  utilities: {
    family: 'money',
    labelKey: 'module.utilities.name',
    paths: ['M5.4 15.6a6.6 6.6 0 1 1 13.2 0', 'M12 15.6L15.4 11.4', 'M4.6 18.6h14.8'],
  },
  /** The house with a door: the thing you go into, as against the house that means the household. */
  property: {
    family: 'things',
    labelKey: 'module.property.name',
    paths: ['M4.8 10.8L12 5.2l7.2 5.6v8.4H4.8z', 'M10.2 19.2v-4.6h3.6v4.6'],
  },
  /** People look for their car under car. */
  vehicles: {
    family: 'things',
    labelKey: 'module.vehicles.name',
    paths: [
      'M5 14.4L6.9 9.4h10.2l1.9 5',
      'M4.6 14.4h14.8v3.6H4.6z',
      'M8.4 17.1a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
      'M15.6 17.1a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
    ],
  },
  /** A paw, and the only module glyph with no straight line in it. */
  pets: {
    family: 'things',
    labelKey: 'module.pets.name',
    paths: [
      'M7.6 8.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
      'M10.7 6.3a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
      'M14 6.3a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
      'M16.6 8.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
      'M12 12.4c3.3 0 5.1 2.3 5.1 4.3s-2 3.1-5.1 3.1-5.1-1.1-5.1-3.1 1.8-4.3 5.1-4.3z',
    ],
  },
  /** A written page: a thing you wrote, as against a thing you were given. */
  notes: {
    family: 'keeping',
    labelKey: 'module.notes.name',
    paths: ['M6.4 4.6h11.2v14.8H6.4z', 'M9.2 9h5.6', 'M9.2 12.4h5.6', 'M9.2 15.8h3.4'],
  },
  /** The folder, because the module is custody. */
  documents: {
    family: 'keeping',
    labelKey: 'module.documents.name',
    paths: ['M4.6 7.6h5.6l1.8 2.2h7.4v9.2H4.6z'],
  },
  /** A basket, not a cart: the module is used in the aisle with one hand. */
  shopping: {
    family: 'keeping',
    labelKey: 'module.shopping.name',
    paths: ['M4.6 9.6h14.8l-1.8 9H6.4z', 'M9 9.6a3 3 0 0 1 6 0'],
  },
  /** A sprout with two leaves and one stem: legible at 20 px, which a plant with three is not. */
  garden: {
    family: 'garden',
    labelKey: 'module.garden.name',
    paths: [
      'M12 19.4v-6.6',
      'M12 12.8c-3.4 0-5.6-2-5.6-5 3.6 0 5.6 2 5.6 5z',
      'M12 12.8c3.4 0 5.6-2 5.6-5-3.6 0-5.6 2-5.6 5z',
    ],
  },
  /** One day rather than a calendar, so it never reads as Calendar. */
  today: {
    family: 'household',
    labelKey: 'nav.today',
    paths: [
      'M4.6 17.6h14.8',
      'M7.8 17.6a4.2 4.2 0 0 1 8.4 0',
      'M12 6.4v2.4',
      'M6.8 8.6l1.7 1.7',
      'M17.2 8.6l-1.7 1.7',
    ],
  },
  /** The plus is the one glyph in the product that must never mean anything else. */
  add: {
    family: 'household',
    labelKey: 'nav.add',
    paths: ['M12 5.6v12.8', 'M5.6 12h12.8'],
  },
} as const satisfies Record<NavigationId, ModuleGlyph>
