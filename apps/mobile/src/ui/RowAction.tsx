// A row's own control, drawn as one word and named for what it acts on (the web's `RowAction`,
// apps/web/src/ui/Button.tsx). A list of devices has a *Sign out* in every row, and what a
// screen reader reads out of such a list is those words alone: each is named in full, *Sign out
// Pixel 8*, and drawn as the word its name holds, together and in order, so that what is seen
// is what somebody who speaks to their device says to press it (WCAG 2.1, 2.5.3). The catalogs'
// own test holds each such pair of keys to that in all five languages.
import { useState, type ReactNode } from 'react'
import { Pressable } from 'react-native'
import { useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { StatusIcon } from './Icon.tsx'
import { Text } from './Text.tsx'
import type { ColorName } from '@household/tokens/native'

export interface RowActionProps {
  /** What it does and to what, for a screen reader: *Sign out Pixel 8*. */
  readonly name: string
  /** The word that is drawn, which the name holds: *Sign out*. */
  readonly word: string
  /** Its write is on its way: it stays, says that it is busy, and drops every press. */
  readonly loading?: boolean
  readonly onPress: () => void
  readonly testID?: string
}

/** What a row's control and a row's link both are: a word, under a name that holds it. */
export function Worded({
  role,
  name,
  word,
  color,
  edged,
  loading = false,
  onPress,
  testID,
  children,
}: Omit<RowActionProps, 'loading'> & {
  readonly role: 'button' | 'link'
  readonly color: ColorName
  /** Drawn in a control's edge: a button is, a link is not. */
  readonly edged: boolean
  readonly loading?: boolean
  /** A glyph after the word, as decoration. */
  readonly children?: ReactNode
}) {
  const theme = useTheme()
  const target = useTarget()
  // A keyboard's focus, or a switch's: a touch gives none.
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      // The name is the control's, and what is drawn inside it is not read after it.
      accessibilityLabel={name}
      accessibilityState={loading ? { busy: true } : {}}
      {...(loading ? {} : { onPress })}
      onFocus={() => {
        setFocused(true)
      }}
      onBlur={() => {
        setFocused(false)
      }}
      style={({ pressed }) => ({
        minHeight: target,
        minWidth: target,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space['space-05'],
        paddingHorizontal: edged ? theme.space['space-15'] : 0,
        borderRadius: theme.radii['radius-control'],
        borderWidth: 1,
        borderColor: edged ? theme.color['border-strong'] : 'transparent',
        backgroundColor: pressed && !loading ? theme.color['surface-sunken'] : 'transparent',
        ...(focused
          ? {
              outlineWidth: 2,
              outlineStyle: 'solid',
              outlineOffset: 2,
              outlineColor: theme.color.focus,
            }
          : {}),
      })}
    >
      {loading ? <StatusIcon status="syncing" color={color} /> : null}
      <Text color={color} weight={500} style={{ flexShrink: 1 }}>
        {word}
      </Text>
      {children}
    </Pressable>
  )
}

export function RowAction(props: RowActionProps) {
  return <Worded {...props} role="button" color="text-primary" edged />
}
