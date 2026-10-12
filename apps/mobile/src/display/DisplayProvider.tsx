// The display modes at run time, and what every component draws by: the theme's tokens, the
// reader's text size, the smallest thing a finger can be asked to hit, and whether anything may
// move. React Native has no cascade and no custom properties, so what the web's stylesheet
// resolves by itself is resolved here and read through hooks.
//
// The app scales its own type. A step of the type scale is drawn at its size times the reader's
// scale, the device's font scale held to between one and two (modes.ts), and every `Text` turns
// the operating system's own scaling off (ui/Text.tsx): left on, the two would multiply, and
// nothing could hold the text at 200 % or draw a harness cell at a scale the device is not set
// to.
import { nativeThemes, type NativeTheme, type Theme } from '@household/tokens/native'
import type { TypeToken } from '@household/tokens'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useColorScheme, useWindowDimensions, type TextStyle } from 'react-native'
import { watchReducedMotion } from '../ui/announce.ts'
import { writePreferences } from './keep.ts'
import { defaults, textScaleOf, type DisplayPreferences } from './modes.ts'

/** What a dev screen may hold the display at while it is open, over the member's own. */
export interface HeldModes extends Partial<DisplayPreferences> {
  /** The text scale, whatever the device says: 1 or 2 in the harness. */
  readonly scale?: number
}

export interface Display {
  /** The modes in force: the member's own, under whatever a dev screen holds. */
  readonly preferences: DisplayPreferences
  /** Changes the member's modes, and keeps them on this device. */
  readonly set: (change: Partial<DisplayPreferences>) => void
  /** The theme drawn: the member's choice, `system` resolved by the device. */
  readonly theme: Theme
  /** Whether motion is reduced: the member's choice, or the device's. */
  readonly reducedMotion: boolean
  /** What every type step is multiplied by: between 1 and 2. */
  readonly textScale: number
  /**
   * Layers `modes` over the member's own without keeping them, until the answer's function is
   * called: the harness holds the scale at 2 while it is open.
   */
  readonly hold: (modes: HeldModes) => () => void
}

const DisplayContext = createContext<Display | null>(null)

/** The theme a subtree is drawn in, where a `ThemeScope` names one over the display's own. */
const ThemeContext = createContext<Theme | null>(null)

interface Hold {
  readonly modes: HeldModes
}

export interface DisplayProviderProps {
  readonly children: ReactNode
  /** The modes this device kept (keep.ts), read before anything is drawn. Left out, the defaults. */
  readonly preferences?: DisplayPreferences
}

export function DisplayProvider({ children, preferences: kept = defaults }: DisplayProviderProps) {
  const [stored, setStored] = useState(kept)
  // Every hold that has not been let go, in the order they were taken: a later one is over an
  // earlier one where both hold the same mode.
  const [holds, setHolds] = useState<readonly Hold[]>([])
  const held = useMemo(
    () => holds.reduce<HeldModes>((over, each) => ({ ...over, ...each.modes }), {}),
    [holds],
  )
  const preferences = useMemo<DisplayPreferences>(
    () => ({ theme: held.theme ?? stored.theme, motion: held.motion ?? stored.motion }),
    [stored, held],
  )

  const device = useColorScheme()
  // The window's own font scale, which React Native reads again when the device's setting
  // changes: a member changes it away from the app and comes back to text of the new size.
  const { fontScale } = useWindowDimensions()
  const [deviceReduced, setDeviceReduced] = useState(false)
  useEffect(() => watchReducedMotion(setDeviceReduced), [])

  // Written once the change has been taken, and only a change made here.
  const changed = useRef(false)
  const set = useCallback((change: Partial<DisplayPreferences>) => {
    changed.current = true
    setStored((current) => ({ ...current, ...change }))
  }, [])
  useEffect(() => {
    if (!changed.current) return
    changed.current = false
    writePreferences(stored)
  }, [stored])

  const hold = useCallback((modes: HeldModes) => {
    // Its own entry, so that letting go ends this hold and no other, whatever the two hold.
    const taken: Hold = { modes }
    setHolds((current) => [...current, taken])
    return () => {
      setHolds((current) => current.filter((each) => each !== taken))
    }
  }, [])

  const theme: Theme =
    preferences.theme === 'system' ? (device === 'dark' ? 'dark' : 'light') : preferences.theme
  const value = useMemo<Display>(
    () => ({
      preferences,
      set,
      theme,
      reducedMotion: preferences.motion === 'reduced' || deviceReduced,
      textScale: held.scale ?? textScaleOf(fontScale),
      hold,
    }),
    [preferences, set, theme, deviceReduced, held.scale, fontScale, hold],
  )
  return <DisplayContext value={value}>{children}</DisplayContext>
}

export function useDisplay(): Display {
  const display = use(DisplayContext)
  if (display === null) throw new Error('useDisplay: no DisplayProvider above this component')
  return display
}

/**
 * Draws its subtree in `theme`, whatever the display's own is: a harness cell in each theme side
 * by side. It draws nothing itself: what stands in it paints its own ground from the tokens.
 */
export function ThemeScope({
  theme,
  children,
}: {
  readonly theme: Theme
  readonly children: ReactNode
}) {
  return <ThemeContext value={theme}>{children}</ThemeContext>
}

/** The theme this component is drawn in: its scope's, or the display's. */
export function useThemeName(): Theme {
  const scoped = use(ThemeContext)
  const display = useDisplay()
  return scoped ?? display.theme
}

/**
 * The tokens of the theme this component is drawn in (@household/tokens/native): a colour by its
 * semantic name, the space, radius and motion scales. A component names a token and never a raw
 * colour, which ESLint fails.
 */
export function useTheme(): NativeTheme {
  return nativeThemes[useThemeName()]
}

/** What `Text` takes of a type step: its family, and its measures at the reader's scale. */
export type TypeStyle = Pick<
  TextStyle,
  'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing' | 'textTransform' | 'fontVariant'
>

/**
 * A step of the type scale at the reader's scale: its size, line height and tracking multiplied,
 * its family as the step names it (one static file a weight). Whatever draws with it turns the
 * device's own font scaling off, as `Text` does.
 */
export function useType(step: TypeToken): TypeStyle {
  const { textScale } = useDisplay()
  const type = useTheme().type[step]
  return useMemo(
    () => ({
      fontFamily: type.fontFamily,
      fontSize: type.fontSize * textScale,
      lineHeight: type.lineHeight * textScale,
      letterSpacing: type.letterSpacing * textScale,
      textTransform: type.textTransform,
      fontVariant: type.fontVariant,
    }),
    [type, textScale],
  )
}

/**
 * The least a control is high and wide: 44 pt (06-clients §4), grown with the text, so a label
 * at 200 % sits in a target twice as tall and never in a fixed one.
 */
export function useTarget(): number {
  const { textScale } = useDisplay()
  return useTheme().density['dens-row-min'] * textScale
}
