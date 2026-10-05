// The display modes (06-clients §3, 01-foundations §2, §6 and §7): what a member chooses about how
// the app is drawn, kept in this browser, and written as the attributes @household/tokens'
// stylesheet reads on the root: `data-theme`, `data-density`, `data-scale` and `data-motion`
// (ADR 0024). This file is data and pure functions, with nothing of the DOM's or React's, since
// the build reads it too: the script that sets the attributes before the first paint is generated
// from it (build/boot.ts), so the two cannot disagree about a key or a value.

/** Light is the default (06-clients §3); `system` follows the device. */
export const themes = ['light', 'dark', 'system'] as const
export type ThemePreference = (typeof themes)[number]

/**
 * `auto` leaves each screen its own default, comfortable but for the five that are tables (DD-3);
 * either other value is the one member preference that overrides both.
 */
export const densities = ['auto', 'comfortable', 'compact'] as const
export type DensityPreference = (typeof densities)[number]

/** The root font size, in percent: 200 is 07-delivery §3's case without the browser's setting. */
export const scales = ['100', '200'] as const
export type ScalePreference = (typeof scales)[number]

/** `system` follows `prefers-reduced-motion`; `reduced` asks for it here whatever the device says. */
export const motions = ['system', 'reduced'] as const
export type MotionPreference = (typeof motions)[number]

export interface DisplayPreferences {
  readonly theme: ThemePreference
  readonly density: DensityPreference
  readonly scale: ScalePreference
  readonly motion: MotionPreference
}

export const defaults: DisplayPreferences = {
  theme: 'light',
  density: 'auto',
  scale: '100',
  motion: 'system',
}

/** Where the preferences are kept, as one JSON object. */
export const storageKey = 'household.display'

export type DisplayAttribute = 'data-theme' | 'data-density' | 'data-scale' | 'data-motion'

/**
 * Each attribute with the stored values that are written as it. A value that is not here is its
 * mode's default, which the stylesheet draws with the attribute absent.
 */
export const written = {
  theme: ['dark', 'system'],
  density: ['comfortable', 'compact'],
  scale: ['200'],
  motion: ['reduced'],
} as const satisfies { readonly [K in keyof DisplayPreferences]: readonly DisplayPreferences[K][] }

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback
}

function parsed(stored: string | null): unknown {
  if (stored === null) return null
  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

/** The preferences `stored` holds: what `localStorage` gave, which may be anything at all. */
export function parsePreferences(stored: string | null): DisplayPreferences {
  const value = parsed(stored)
  const record: Partial<Record<string, unknown>> =
    typeof value === 'object' && value !== null ? { ...value } : {}
  return {
    theme: oneOf(themes, record.theme, defaults.theme),
    density: oneOf(densities, record.density, defaults.density),
    scale: oneOf(scales, record.scale, defaults.scale),
    motion: oneOf(motions, record.motion, defaults.motion),
  }
}

/** The attributes `preferences` puts on the root: a value, or null for one that is taken off. */
export function attributesOf(
  preferences: DisplayPreferences,
): Readonly<Record<DisplayAttribute, string | null>> {
  const value = (mode: keyof DisplayPreferences): string | null => {
    const values: readonly string[] = written[mode]
    return values.includes(preferences[mode]) ? preferences[mode] : null
  }
  return {
    'data-theme': value('theme'),
    'data-density': value('density'),
    'data-scale': value('scale'),
    'data-motion': value('motion'),
  }
}
