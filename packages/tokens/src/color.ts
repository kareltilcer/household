/**
 * The semantic and component colour tokens, in both themes, ported from design/v1's
 * `foundations.js`. Each is its light value and its dark one: no colour is defined in one theme
 * alone (01-foundations §2). The values are resolved, not references to the primitive ramps,
 * because many sit off them by design (ADR 0024); the trail each comment gives is where the value
 * came from, and a `+` or `−` marks one that sits between two steps.
 */

export type Theme = 'light' | 'dark'
export const themes: readonly Theme[] = ['light', 'dark']

type Pair = readonly [light: string, dark: string]

export const colors = {
  // Surfaces. The elevation ramp is surface → surface-raised → surface-overlay and stops there:
  // a third level would have no dark surface to land on (01-foundations §5).
  /** The page ground, level 0. A module's screen is this, never its accent. neutral-50 / neutral-950 */
  surface: ['#F9FAFD', '#1A1B22'],
  /** Level 1: cards, list wells, the web sidebar. white / neutral-900+ */
  'surface-raised': ['#FFFFFF', '#23252D'],
  /** Level 2: sheets, dialogs. white / neutral-850+ */
  'surface-overlay': ['#FFFFFF', '#2D2F37'],
  /** Below the ground, for grouped-list wells. Not on the elevation ramp. neutral-100 / neutral-990 */
  'surface-sunken': ['#F1F2F7', '#12131A'],
  /** Tooltips and the one-off inverse chip. neutral-900− / neutral-200 */
  'surface-inverse': ['#262831', '#E6E8EC'],

  // Text.
  /** Body and headings. neutral-900 / neutral-200 */
  'text-primary': ['#2C2E38', '#E6E8EC'],
  /** The secondary row line. Tested at 4.5:1, not 3:1: it carries real content. neutral-700 / neutral-500− */
  'text-muted': ['#6A6E7A', '#9498A5'],
  /** Not a declared pair. Never the sole carrier of anything; absence is preferred to disabling. neutral-500 / neutral-800+ */
  'text-disabled': ['#A2A5AF', '#63656F'],
  /** Ink on an accent fill. Dark puts dark ink on a light accent: the fill flips, the pair holds. white / neutral-950 */
  'text-on-accent': ['#FFFFFF', '#1A1B22'],
  /** Ink on a danger fill. Tested separately because danger is the darkest status in light. white / neutral-950 */
  'text-on-danger': ['#FFFFFF', '#1A1B22'],
  /** Ink on surface-inverse. neutral-50 / neutral-950 */
  'text-inverse': ['#F9FAFD', '#1A1B22'],
  /** Inline link. The household accent at text contrast, never at 3:1. indigo-600 / indigo-400 */
  'text-link': ['#476CBA', '#6F97E9'],

  // Borders.
  /** Input and table boundaries, which must clear 3:1 as UI components. neutral-600 / neutral-700+ */
  'border-strong': ['#888A94', '#767982'],
  /** Card and row edges. Decorative; not a declared pair. neutral-400 / neutral-800 */
  border: ['#BFC1CA', '#4E5057'],
  /** Nested edges inside a well. neutral-300 / neutral-850+ */
  'border-subtle': ['#D6D7DF', '#3F4146'],
  /** Row separators, and what border becomes under compact density. neutral-300− / neutral-850 */
  divider: ['#DCDEE6', '#3B3D42'],
  /** The focus ring. 3:1 against every surface in both themes. Between indigo-600 and indigo-400 in both. */
  focus: ['#5A85E4', '#4F79D6'],
  /** The gap between ring and control, so the ring reads on raised surfaces too. white / neutral-950 */
  'focus-ring-offset': ['#FFFFFF', '#1A1B22'],

  // Accents: the five families and Garden (DD-1). A module's own `accent-<id>` is in accent.ts.
  /** The product's own accent, and the Household family's hue. indigo-600 / indigo-400 */
  accent: ['#476CBA', '#6F97E9'],
  /** Dashboard, Chat, Activity, Household settings. Today and Add render here too, with no key of their own. indigo */
  'accent-family-household': ['#476CBA', '#6F97E9'],
  /** Tasks, Reminders, Calendar, Chores: the things that ask something of you today. violet */
  'accent-family-time': ['#7F5CB7', '#AA86E5'],
  /** Finance, Utilities: the things with a number that must be right. teal */
  'accent-family-money': ['#007B7C', '#34A7A8'],
  /** Property, Vehicles, Pets: the asset engine's three faces. tan */
  'accent-family-things': ['#916444', '#BE8E6D'],
  /** Notes, Documents, Shopping: capture and retrieval. plum */
  'accent-family-keeping': ['#A94B92', '#D876BD'],
  /** Garden alone, outside the five families. moss */
  'accent-garden': ['#5D7719', '#86A249'],

  // Statuses. Reserved: never a module accent, in either theme (01-foundations §3).
  /** Destructive and failed. red-600 / red-400 */
  danger: ['#C43F3E', '#F66C66'],
  /** Needs attention, still works. amber-600 / amber-400 */
  warning: ['#A05E00', '#CE8A1A'],
  /** Done, settled, in sync. emerald-600 / emerald-400 */
  positive: ['#007E54', '#3EAA7C'],
  /** The fourth status: neither problem nor success. The offline bar and staleness badges. azure-600 / azure-400 */
  info: ['#0074AE', '#35A1DC'],

  // Charts: one categorical ramp, shared by Utilities, Finance, Pets and Garden.
  /** indigo */
  'chart-1': ['#6389DB', '#5378C7'],
  /** teal */
  'chart-2': ['#209A9B', '#008889'],
  /** plum */
  'chart-3': ['#C969B0', '#B7589E'],
  /** amber */
  'chart-4': ['#BC7E1A', '#AA6D00'],
  /** moss */
  'chart-5': ['#7A943C', '#698328'],
  /** violet */
  'chart-6': ['#9D79D7', '#8C68C4'],
  /** red */
  'chart-7': ['#E2625D', '#CE514C'],
  /** tan */
  'chart-8': ['#B08160', '#9E7050'],
  /** Grid lines. Decorative; not a declared pair. neutral-300 / neutral-850+ */
  'chart-grid': ['#D4D5DD', '#424349'],
  /** Axis lines and tick labels: a UI boundary, so 3:1 binds. */
  'chart-axis': ['#888A94', '#767982'],

  // Component tokens: per-component values where a semantic one is wrong for one component.
  /** The primary button's fill. */
  'button-primary-bg': ['#476CBA', '#6F97E9'],
  /** The primary button's ink. */
  'button-primary-fg': ['#FFFFFF', '#1A1B22'],
  /** The destructive button's fill. */
  'button-danger-bg': ['#C43F3E', '#F66C66'],
  /** The one place dark deliberately inverts the ramp: a field reads as a well, not a raise. white / neutral-990 */
  'input-bg': ['#FFFFFF', '#12131A'],
  /** Sticky column heads. Sunken in light, raised in dark, so the head separates either way. */
  'table-header-bg': ['#F1F2F7', '#23252D'],
  /** Loading shapes. Not a declared pair; static under reduced motion. neutral-200 / neutral-850+ */
  'skeleton-bg': ['#E6E8EC', '#2D2F37'],
  /** The 2000 ms hold's unfilled track. */
  'hold-track': ['#D6D7DF', '#3F4146'],
  /** Its fill. Stepped, not swept, under reduced motion. */
  'hold-fill': ['#476CBA', '#6F97E9'],
} as const satisfies Record<string, Pair>

export type ColorToken = keyof typeof colors

/**
 * The tokens that are another's value under a name of their own: the component tokens that say
 * `= accent`, and the chart axis, which is the strong border. Each stays its own token, so that
 * one component can move without the rest, and a test holds each to the value it names until it
 * does.
 */
export const sameAs = {
  'accent-family-household': 'accent',
  'chart-axis': 'border-strong',
  'button-primary-bg': 'accent',
  'button-primary-fg': 'text-on-accent',
  'button-danger-bg': 'danger',
  'hold-track': 'border-subtle',
  'hold-fill': 'accent',
} as const satisfies Partial<Record<ColorToken, ColorToken>>

/**
 * The surface each component background is drawn as, by theme: its ink is tested on that surface,
 * so it needs no pairs of its own while a test holds it to the surface's value.
 */
export const drawnAs = {
  'input-bg': { light: 'surface-raised', dark: 'surface-sunken' },
  'table-header-bg': { light: 'surface-sunken', dark: 'surface-raised' },
} as const satisfies Partial<Record<ColorToken, Record<Theme, ColorToken>>>
