/**
 * @household/tokens/native — the tokens as a React Native theme, one per theme, under the names
 * the stylesheet gives them. React Native has no rem, no cascade and no custom properties, so
 * every value is resolved here: a type size is its rem at 16 px, a line height is the size times
 * its multiplier, letter spacing is its em times the size, a colour name is its value, and a
 * step's family is the file of its weight (fonts.ts). The operating system's text size still
 * scales `fontSize` and `lineHeight` together, which is the 200 % case on a phone. This module
 * imports nothing of React Native's: it is data a `StyleSheet` reads.
 */
import { themes, type Theme } from './color.ts'
import { fonts } from './fonts.ts'
import { colorNames, resolve, type ColorName } from './names.ts'
import {
  density,
  durations,
  easings,
  radii,
  reducedMotion,
  remPx,
  shadows,
  space,
  tabularFigures,
  thresholds,
  typeScale,
  type RadiusToken,
  type ShadowToken,
  type TypeToken,
} from './scale.ts'

/** A type step as a React Native text style. */
export interface NativeTypeStep {
  readonly fontFamily: string
  readonly fontSize: number
  readonly lineHeight: number
  readonly letterSpacing: number
  readonly textTransform: 'none' | 'uppercase'
  /** Tabular, lining figures for the mono steps, so that a column of money aligns. */
  readonly fontVariant: readonly ('tabular-nums' | 'lining-nums')[]
}

/** One layer of a shadow, as React Native's `boxShadow` takes it. */
export interface NativeShadow {
  readonly offsetX: number
  readonly offsetY: number
  readonly blurRadius: number
  readonly color: string
}

export interface NativeTheme {
  readonly color: Readonly<Record<ColorName, string>>
  readonly space: typeof space
  readonly radii: Readonly<Record<RadiusToken, number>>
  readonly type: Readonly<Record<TypeToken, NativeTypeStep>>
  readonly shadows: Readonly<Record<ShadowToken, readonly NativeShadow[]>>
  /** In ms. */
  readonly durations: typeof durations
  /** Each the four control points `Easing.bezier` takes. */
  readonly easings: typeof easings
  /** In ms. */
  readonly thresholds: typeof thresholds
  readonly reducedMotion: typeof reducedMotion
  /** Comfortable, the only density on mobile (01-foundations §6), with its rule's colour. */
  readonly density: {
    readonly 'dens-pad-x': number
    readonly 'dens-pad-y': number
    readonly 'dens-row-min': number
    readonly 'dens-rule': string
  }
}

/** A value to the thousandth: a product of two decimals is not printed with its float's tail. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function entries<Key extends string, Value>(of: Readonly<Record<Key, Value>>): [Key, Value][] {
  return Object.entries(of) as [Key, Value][]
}

function mapped<Key extends string, From, To>(
  of: Readonly<Record<Key, From>>,
  to: (value: From, key: Key) => To,
): Record<Key, To> {
  return Object.fromEntries(entries(of).map(([key, value]) => [key, to(value, key)])) as Record<
    Key,
    To
  >
}

const type = mapped(typeScale, (step): NativeTypeStep => {
  const fontSize = step.size * remPx
  const families: Readonly<Record<number, string>> = fonts[step.face].native
  const fontFamily = families[step.weight]
  if (fontFamily === undefined) {
    throw new Error(`tokens: ${step.face} has no native file at weight ${String(step.weight)}`)
  }
  return {
    fontFamily,
    fontSize,
    lineHeight: round(fontSize * step.line),
    letterSpacing: round(fontSize * step.tracking),
    textTransform: step.uppercase ? 'uppercase' : 'none',
    fontVariant: step.face === 'mono' ? tabularFigures : [],
  }
})

function nativeTheme(theme: Theme): NativeTheme {
  const { comfortable } = density
  return {
    color: Object.fromEntries(colorNames.map((name) => [name, resolve(name, theme)])) as Record<
      ColorName,
      string
    >,
    space,
    // Half its box, whatever the box: any radius past half the shorter side is a full round.
    radii: mapped(radii, (value) => (typeof value === 'number' ? value : 9999)),
    type,
    shadows: mapped(shadows, (layers) =>
      layers[theme].map((l) => ({
        offsetX: l.x,
        offsetY: l.y,
        blurRadius: l.blur,
        color: l.color,
      })),
    ),
    durations,
    easings,
    thresholds,
    reducedMotion,
    density: {
      'dens-pad-x': comfortable['dens-pad-x'],
      'dens-pad-y': comfortable['dens-pad-y'],
      'dens-row-min': comfortable['dens-row-min'],
      'dens-rule': resolve(comfortable['dens-rule'], theme),
    },
  }
}

export const nativeThemes: Readonly<Record<Theme, NativeTheme>> = Object.fromEntries(
  themes.map((theme) => [theme, nativeTheme(theme)]),
) as Record<Theme, NativeTheme>

export type { ColorName, Theme }
