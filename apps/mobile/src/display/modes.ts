// The display modes a member chooses on this device (06-clients §3): the theme and motion. They
// are the device's and not the account's, as the web's are its browser's (ADR 0026): the account
// keeps none. A phone has two modes fewer than the web. Density is comfortable and nothing else
// (01-foundations), and the text is as large as the device says, held to between one and two
// times the type scale's own size: the operating system has the setting, so the app has none.
// This file is data, with nothing of React Native's: the keep and the provider read it.

/** `system` follows the device. Light is the default whatever the device prefers. */
export const themes = ['light', 'dark', 'system'] as const
export type ThemePreference = (typeof themes)[number]

/** `system` follows the device's own setting; `reduced` asks for less whatever it says. */
export const motions = ['system', 'reduced'] as const
export type MotionPreference = (typeof motions)[number]

export interface DisplayPreferences {
  readonly theme: ThemePreference
  readonly motion: MotionPreference
}

export const defaults: DisplayPreferences = { theme: 'light', motion: 'system' }

/** Where the preferences are kept, as one JSON object: the name the web keeps its own under. */
export const storageKey = 'household.display'

/** The least and the most the app's text is drawn at, as a multiple of the type scale's size. */
export const scaleBounds = { least: 1, most: 2 } as const

/**
 * The scale the text is drawn at for a device whose own font scale is `fontScale`: followed up
 * to 200 % and held there (06-clients §4), and never under the size the scale was designed at.
 */
export function textScaleOf(fontScale: number): number {
  if (!Number.isFinite(fontScale)) return scaleBounds.least
  return Math.min(scaleBounds.most, Math.max(scaleBounds.least, fontScale))
}

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

/** The preferences `stored` holds: what the device's storage gave, which may be anything at all. */
export function parsePreferences(stored: string | null): DisplayPreferences {
  const value = parsed(stored)
  const record: Partial<Record<string, unknown>> =
    typeof value === 'object' && value !== null ? { ...value } : {}
  return {
    theme: oneOf(themes, record.theme, defaults.theme),
    motion: oneOf(motions, record.motion, defaults.motion),
  }
}
