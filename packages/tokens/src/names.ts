import { familyAccent, moduleIds, type AccentToken, type ModuleId } from './accent.ts'
import { colors, type ColorToken, type Theme } from './color.ts'
import { statuses, type StatusToken } from './status.ts'

/** Every name a colour is spent under: a token, a status, or a module's accent. */
export type ColorName = ColorToken | StatusToken | AccentToken

function isColorToken(name: string): name is ColorToken {
  return Object.hasOwn(colors, name)
}

function isStatusToken(name: string): name is StatusToken {
  return Object.hasOwn(statuses, name)
}

/** A module's accent, by its id: `accent-finance`. */
export function accentToken(module: ModuleId): AccentToken {
  return `accent-${module}`
}

/**
 * The token a name resolves through: itself, the colour a status aliases, or a module's family
 * accent.
 */
export function tokenOf(name: ColorName): ColorToken {
  if (isColorToken(name)) return name
  if (isStatusToken(name)) return statuses[name]
  const module = moduleIds.find((id) => accentToken(id) === name)
  if (module === undefined) throw new Error(`tokens: ${name} is not a colour`)
  return familyAccent(module)
}

/** A colour's value in a theme, `#RRGGBB`. */
export function resolve(name: ColorName, theme: Theme): string {
  return colors[tokenOf(name)][theme === 'light' ? 0 : 1]
}

/**
 * Every colour name, in the order the stylesheet declares them: the tokens, the thirteen
 * statuses, and the modules' accents. Garden's is the family token itself, `accent-garden`, and
 * is named once.
 */
export const colorNames: readonly ColorName[] = [
  ...(Object.keys(colors) as ColorToken[]),
  ...(Object.keys(statuses) as StatusToken[]),
  ...moduleIds.map(accentToken).filter((name) => !isColorToken(name)),
]

/** Every colour name's value in a theme: what the object and the React Native theme both hold. */
export function themeColors(theme: Theme): Readonly<Record<ColorName, string>> {
  return Object.fromEntries(colorNames.map((name) => [name, resolve(name, theme)])) as Record<
    ColorName,
    string
  >
}
