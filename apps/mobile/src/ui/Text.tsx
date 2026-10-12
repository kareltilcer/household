// The one text primitive: a step of the type scale, in a colour token, at the reader's scale.
// Nothing else in the app renders React Native's own `Text` (ESLint fails the import, and the
// accessibility rules fail a text that was drawn another way): a text drawn outside this file
// would be scaled by the operating system and by nothing the app knows of, in whatever face the
// platform falls back to.
import { fonts, typeScale, type TypeToken } from '@household/tokens'
import type { ColorName } from '@household/tokens/native'
import {
  Text as NativeText,
  type StyleProp,
  type TextProps as NativeTextProps,
  type TextStyle,
} from 'react-native'
import { useTheme, useType } from '../display/DisplayProvider.tsx'

export interface TextProps extends Omit<
  NativeTextProps,
  'allowFontScaling' | 'maxFontSizeMultiplier' | 'accessibilityRole' | 'role' | 'style'
> {
  /** The step of the type scale it is set in. Left out, the body's. */
  readonly step?: TypeToken
  /** The colour it is drawn in, by its token. Left out, the primary text's. */
  readonly color?: ColorName
  /**
   * A weight other than its step's, in the same face: a control's label is the body's size at
   * 500. No type step is made of it, which would change with a title it has nothing to do with.
   */
  readonly weight?: 400 | 500 | 600
  /** A title: what a screen reader lists as a header and moves between. */
  readonly header?: boolean
  /** Layout only: where it stands and how it wraps. Its type and its colour are its props'. */
  readonly style?: StyleProp<
    Pick<TextStyle, 'flex' | 'flexShrink' | 'flexGrow' | 'textAlign' | 'alignSelf' | 'margin'>
  >
}

/** The family of `step`'s face at `weight`, where the face has a file of that weight. */
function familyAt(step: TypeToken, weight: 400 | 500 | 600): string | undefined {
  const families: Readonly<Record<number, string>> = fonts[typeScale[step].face].native
  return families[weight]
}

export function Text({
  step = 'body',
  color = 'text-primary',
  weight,
  header = false,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme()
  const type = useType(step)
  const family = weight === undefined ? undefined : familyAt(step, weight)
  return (
    <NativeText
      {...rest}
      // The app scales its own type (display/DisplayProvider.tsx): the system's would multiply it.
      allowFontScaling={false}
      {...(header ? { accessibilityRole: 'header' as const } : {})}
      style={[
        type,
        { color: theme.color[color] },
        family === undefined ? null : { fontFamily: family },
        style,
      ]}
    />
  )
}
