/**
 * The scales that are not colour: space, radii, type, elevation, motion and density, ported from
 * design/v1's `foundations.js`. Application code spends these by name (D-152): the design gives
 * them no semantic layer, and each step is already named for its use or its place in the scale.
 * Lengths are numbers of pixels here and type sizes numbers of rem, so that the stylesheet and
 * the React Native theme are both computed from one value.
 */
import type { ColorToken, Theme } from './color.ts'

/**
 * The 8-point space scale, in px. The 4 pt half-steps, `space-05` and `space-15`, are permitted
 * at the two smallest sizes and nowhere else (01-foundations §5).
 */
export const space = {
  /** Half-step. */
  'space-05': 4,
  /** The base unit. */
  'space-1': 8,
  /** Half-step. */
  'space-15': 12,
  /** Control padding, list row inset. */
  'space-2': 16,
  /** Block separation. */
  'space-3': 24,
  /** Section separation. */
  'space-4': 32,
  'space-5': 40,
  /** Page gutter, web. */
  'space-6': 48,
  'space-8': 64,
  /** Page top on web at wide widths. */
  'space-10': 80,
} as const

export type SpaceToken = keyof typeof space

/** Radii, in px but for `radius-full`, which is half its box. They do not vary by module. */
export const radii = {
  /** Buttons, inputs, chips. */
  'radius-control': 8,
  /** Cards, panels, list wells. */
  'radius-card': 12,
  /** Bottom sheets, dialogs: top corners only on mobile. */
  'radius-sheet': 20,
  /** Status pills, segmented controls. */
  'radius-pill': 999,
  /** Avatars, the hold-progress ring. */
  'radius-full': '50%',
} as const

export type RadiusToken = keyof typeof radii

export type Face = 'sans' | 'mono'

export interface TypeStep {
  /** The font size, in rem. */
  readonly size: number
  /** The line height, a unitless multiplier, so that 200 % text scaling stays proportional. */
  readonly line: number
  readonly weight: 400 | 500 | 600
  /** The letter spacing, in em. */
  readonly tracking: number
  readonly face: Face
  /** Set in capitals: the overline alone. */
  readonly uppercase: boolean
}

/**
 * The type scale: eight steps in the UI face, and three in the mono face that share a sans step's
 * size and line height, so that a money value in a table row sits on its label's baseline
 * (01-foundations §4). The line heights leave room for Ď, Ř and Ł at 200 % text.
 */
export const typeScale = {
  /** One per screen at most. Finance flow total, Utilities settlement figure. */
  display: { size: 2.5, line: 1.12, weight: 500, tracking: -0.02, face: 'sans', uppercase: false },
  /** Screen title on web. */
  'title-1': {
    size: 1.875,
    line: 1.22,
    weight: 500,
    tracking: -0.015,
    face: 'sans',
    uppercase: false,
  },
  /** Screen title on mobile, section head on web. */
  'title-2': {
    size: 1.5,
    line: 1.24,
    weight: 500,
    tracking: -0.01,
    face: 'sans',
    uppercase: false,
  },
  /** Card and sheet titles, group heads. */
  'title-3': {
    size: 1.25,
    line: 1.3,
    weight: 600,
    tracking: -0.005,
    face: 'sans',
    uppercase: false,
  },
  /** Lead paragraph, empty-state sentence. */
  'body-lg': { size: 1.125, line: 1.55, weight: 400, tracking: 0, face: 'sans', uppercase: false },
  /** Everything. Compact density never goes below this. */
  body: { size: 1, line: 1.55, weight: 400, tracking: 0, face: 'sans', uppercase: false },
  /** Secondary row line, metadata, help text. */
  caption: { size: 0.8125, line: 1.45, weight: 400, tracking: 0, face: 'sans', uppercase: false },
  /** Column heads, eyebrow labels. */
  overline: { size: 0.6875, line: 1.3, weight: 600, tracking: 0.1, face: 'sans', uppercase: true },
  /** Meter reading entry, balance figure. Shares title-3's baseline. */
  'num-lg': { size: 1.25, line: 1.3, weight: 500, tracking: 0, face: 'mono', uppercase: false },
  /** Money and unit columns. Shares body's baseline. */
  num: { size: 1, line: 1.55, weight: 400, tracking: 0, face: 'mono', uppercase: false },
  /** Tariff component breakdown. Shares caption's baseline. */
  'num-sm': { size: 0.8125, line: 1.45, weight: 400, tracking: 0, face: 'mono', uppercase: false },
} as const satisfies Record<string, TypeStep>

export type TypeToken = keyof typeof typeScale

/** The sans step each mono step shares its size and line height with. */
export const baselineOf = {
  'num-lg': 'title-3',
  num: 'body',
  'num-sm': 'caption',
} as const satisfies Partial<Record<TypeToken, TypeToken>>

/** One CSS pixel per `1/remPx` rem: the root font size both the browsers and the scale assume. */
export const remPx = 16

/**
 * The figures of every table and every money value: tabular and lining, so that columns align
 * (01-foundations §4). Prose keeps the face's own.
 */
export const tabularFigures = ['tabular-nums', 'lining-nums'] as const

export interface Shadow {
  readonly x: number
  readonly y: number
  readonly blur: number
  readonly color: string
}

/**
 * The two elevated levels' shadows. Dark themes cannot rely on shadow, so every level is also a
 * surface step (`surface-raised`, `surface-overlay`), and the shadow only reinforces it.
 */
export const shadows = {
  'shadow-1': {
    light: [
      { x: 0, y: 1, blur: 2, color: 'rgba(20, 22, 30, 0.06)' },
      { x: 0, y: 1, blur: 1, color: 'rgba(20, 22, 30, 0.04)' },
    ],
    dark: [{ x: 0, y: 1, blur: 2, color: 'rgba(0, 0, 0, 0.5)' }],
  },
  'shadow-2': {
    light: [
      { x: 0, y: 8, blur: 24, color: 'rgba(20, 22, 30, 0.1)' },
      { x: 0, y: 2, blur: 6, color: 'rgba(20, 22, 30, 0.06)' },
    ],
    dark: [{ x: 0, y: 8, blur: 24, color: 'rgba(0, 0, 0, 0.55)' }],
  },
} as const satisfies Record<string, Record<Theme, readonly Shadow[]>>

export type ShadowToken = keyof typeof shadows

/** Durations, in ms. */
export const durations = {
  /** State change on a control already under the finger. */
  'dur-fast': 120,
  /** Sheet, panel, route transition. */
  'dur-base': 200,
  /** Full-screen push, first paint of a two-pane change. */
  'dur-slow': 320,
} as const

export type DurationToken = keyof typeof durations

/** Easings, each the four control points of a cubic Bézier. */
export const easings = {
  /** Anything arriving. */
  'ease-entrance': [0.16, 0.84, 0.44, 1],
  /** Anything leaving. */
  'ease-exit': [0.4, 0, 1, 1],
} as const

export type EasingToken = keyof typeof easings

/** Thresholds, in ms: times the design fixes that no animation runs for. */
export const thresholds = {
  /** Below this a sync shows nothing at all (06-clients §5). */
  'sync-indicate-after': 800,
  /** Fixed by 02-components. The pointer and the keyboard path show the same progress. */
  'hold-to-complete': 2000,
  /** The undo affordance stays for the whole dwell. */
  'toast-dwell': 5000,
} as const

export type ThresholdToken = keyof typeof thresholds

/**
 * What reduced motion substitutes (01-foundations §7). Transitions become instant state changes,
 * not slower animations: every duration is this one. The 2000 ms hold cannot be removed, being
 * the only feedback that the gesture is working, and fills in this many steps instead of
 * sweeping. Sync indication is unchanged, being threshold-driven, and a skeleton is a static
 * shape with no shimmer.
 */
export const reducedMotion = { duration: 0, holdSteps: 10 } as const

export type Density = 'comfortable' | 'compact'

export interface DensityScale {
  /** Horizontal cell padding, in px. Compact drops one space step. */
  readonly 'dens-pad-x': number
  /** Vertical cell padding, in px. It shrinks until the row meets its floor and stops. */
  readonly 'dens-pad-y': number
  /** The floor of an interactive row, in px: 44 pt in both, so compact cannot buy row height. */
  readonly 'dens-row-min': number
  /** The colour of a row's rule: borders become `divider` under compact. */
  readonly 'dens-rule': ColorToken
  /** Whether the optional secondary line is shown. Compact moves it to a column or the detail pane. */
  readonly secondaryLine: boolean
}

/**
 * Density (01-foundations §6). Mobile is comfortable and nothing else; web is comfortable but for
 * the five screens that are tables (DD-3), and one member preference overrides both. Compact is a
 * column-density change, not a row-height one: it never goes below `body` or below 44 pt on an
 * interactive row.
 */
export const density = {
  comfortable: {
    'dens-pad-x': 16,
    'dens-pad-y': 10,
    'dens-row-min': 44,
    'dens-rule': 'border',
    secondaryLine: true,
  },
  compact: {
    'dens-pad-x': 8,
    'dens-pad-y': 6,
    'dens-row-min': 44,
    'dens-rule': 'divider',
    secondaryLine: false,
  },
} as const satisfies Record<Density, DensityScale>
