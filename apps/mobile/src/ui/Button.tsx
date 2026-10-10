// The app's button, in its four variants, and the icon-only one (02-components). The contract is
// the web's (apps/web/src/ui/Button.tsx), said in a device's terms.
//
// A button that is busy, or that takes no press for now, is never `disabled`: it keeps its
// place, its words and a screen reader's focus, says that it is busy or unavailable through
// `accessibilityState`, and drops every press. A control taken out of a screen reader's reach in
// the middle of a write is one its member has to go looking for; `disabled` is for a control
// out of its form, and one that cannot act at all is absent.
import { useState, type ReactNode } from 'react'
import { Pressable, View, type PressableProps, type ViewStyle } from 'react-native'
import { useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { Ink, StatusIcon } from './Icon.tsx'
import { Text } from './Text.tsx'
import type { ColorName } from '@household/tokens/native'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface Shared extends Omit<
  PressableProps,
  'children' | 'style' | 'disabled' | 'accessibilityRole' | 'accessibilityLabel' | 'role'
> {
  /** Left out, the secondary: one primary a screen at most. */
  readonly variant?: ButtonVariant
  /**
   * Its write is on its way: the busy glyph stands in the icon's place, every press is dropped,
   * and a screen reader is told it is busy. It stays where it is and keeps the focus.
   */
  readonly loading?: boolean
  /**
   * It takes no press for now and is not busy itself: another control's write is on its way.
   * It stays and keeps the focus, and a screen reader is told it is unavailable.
   */
  readonly idle?: boolean
}

export interface ButtonProps extends Shared {
  /** A glyph before the words, as decoration: the words are the name. */
  readonly icon?: ReactNode
  /** The words, which are its name. */
  readonly children: string
}

export interface IconButtonProps extends Shared {
  /**
   * Its name, translated, from the register of icon-only controls (@household/icons'
   * `controls`) and from nowhere else: the accessibility rules fail one that is not.
   */
  readonly label: string
  readonly icon: ReactNode
}

/** A variant's ground, its words' colour and its edge, each by its token. */
const paint: Readonly<
  Record<
    ButtonVariant,
    {
      readonly ground: ColorName | null
      readonly words: ColorName
      readonly edge: ColorName | null
    }
  >
> = {
  primary: { ground: 'button-primary-bg', words: 'button-primary-fg', edge: null },
  secondary: { ground: 'surface-raised', words: 'text-primary', edge: 'border-strong' },
  ghost: { ground: null, words: 'text-primary', edge: null },
  danger: { ground: 'button-danger-bg', words: 'text-on-danger', edge: null },
}

function useControl({ variant = 'secondary', loading = false, idle = false, ...rest }: Shared) {
  const theme = useTheme()
  const target = useTarget()
  // A keyboard's focus, or a switch's: a touch gives none, so this is drawn for them alone.
  const [focused, setFocused] = useState(false)
  const unheard = loading || idle
  const { ground, words, edge } = paint[variant]
  const { onPress, onLongPress, onPressIn, onPressOut, onFocus, onBlur, ...others } = rest
  const style = ({ pressed }: { pressed: boolean }): ViewStyle => ({
    minHeight: target,
    minWidth: target,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space['space-1'],
    paddingHorizontal: theme.density['dens-pad-x'],
    paddingVertical: theme.density['dens-pad-y'],
    borderRadius: theme.radii['radius-control'],
    borderWidth: 1,
    borderColor: edge === null ? 'transparent' : theme.color[edge],
    backgroundColor:
      pressed && !unheard
        ? theme.color[ground === null ? 'surface-sunken' : ground]
        : ground === null
          ? 'transparent'
          : theme.color[ground],
    // Pressed is shown by more than a ground that may not change: the whole control gives.
    opacity: pressed && !unheard ? 0.72 : 1,
    ...(focused
      ? {
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: 2,
          outlineColor: theme.color.focus,
        }
      : {}),
  })
  return {
    words,
    props: {
      ...others,
      accessibilityRole: 'button' as const,
      accessibilityState: {
        ...others.accessibilityState,
        ...(loading ? { busy: true } : {}),
        ...(idle && !loading ? { disabled: true } : {}),
      },
      // Dropped, not passed on: a busy control starts nothing, a menu and a second write alike.
      ...(unheard ? {} : { onPress, onLongPress, onPressIn, onPressOut }),
      onFocus: (event: Parameters<NonNullable<PressableProps['onFocus']>>[0]) => {
        setFocused(true)
        onFocus?.(event)
      },
      onBlur: (event: Parameters<NonNullable<PressableProps['onBlur']>>[0]) => {
        setFocused(false)
        onBlur?.(event)
      },
      style,
    },
  }
}

/** The glyph a busy control draws where its icon stands: the syncing mark, in its words' colour. */
function Busy({ color }: { readonly color: ColorName }) {
  return <StatusIcon status="syncing" color={color} />
}

export function Button({ icon, children, ...shared }: ButtonProps) {
  const { words, props } = useControl(shared)
  return (
    <Pressable {...props}>
      <Ink color={words}>{shared.loading === true ? <Busy color={words} /> : (icon ?? null)}</Ink>
      <Text color={words} weight={500} style={{ flexShrink: 1, textAlign: 'center' }}>
        {children}
      </Text>
    </Pressable>
  )
}

export function IconButton({ label, icon, ...shared }: IconButtonProps) {
  const { words, props } = useControl({ variant: 'ghost', ...shared })
  return (
    <Pressable {...props} accessibilityLabel={label}>
      {/* The glyph is the control's face and not its name: hidden, whatever it was given. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ink color={words}>{shared.loading === true ? <Busy color={words} /> : icon}</Ink>
      </View>
    </Pressable>
  )
}
