// The tab bar (F-11, F-12, 04-navigation §3): the slots a member's bar holds (tabs.ts), each a
// glyph and its word, always both. It is drawn for five slots, for four and for three, and each
// is a whole bar: the slots share the width between them, so none is stretched over a gap and
// none is left empty. A slot is 44 pt high at the least and grows with the reader's text; at
// 200 % a label wraps and the bar is taller, and no label is ever dropped to buy room.
//
// The slot that is open says so to a screen reader, and is drawn so by more than its colour: a
// rule above it, and its word in a heavier weight. Add is no place: it is a button among the
// tabs, which opens its sheet over whichever of them is open, so pressing it never changes
// which one that is.
//
// On a tablet the bar is a layout of its own (F-11): its slots are as wide as their words need
// and stand together in the middle, each glyph beside its word, where a phone's five shares
// stretched over that width would be five wide gaps. Which of the two is drawn is told by the
// room, counted in the reader's text (width.ts).
import { remPx } from '@household/tokens'
import type { ColorName } from '@household/tokens/native'
import { useState, type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'
import { useDisplay, useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Badge } from '../ui/Badge.tsx'
import { BaseIcon, Ink, ModuleIcon } from '../ui/Icon.tsx'
import { Text } from '../ui/Text.tsx'
import type { Destination, Place } from './tabs.ts'
import { isWide } from './width.ts'

/** How much of the device's edges the bar reaches, and keeps its slots clear of. */
export interface BarInsets {
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export interface TabBarProps {
  /** The slots, in order (tabs.ts): five, four or three of them. */
  readonly slots: readonly Destination[]
  /** The place that is open, or null where what is on screen stands under none of them. */
  readonly open: Place | null
  readonly onOpen: (place: Place) => void
  /** Opens the Add sheet, over the place that is open. */
  readonly onAdd: () => void
  /** The room the bar has, in points: the window's width, or a dev screen's box. */
  readonly width: number
  /** How many changes wait for the member (F-5): said on More, which leads to them. */
  readonly waiting?: number
  /** The device's own edges. Left out, none: a bar drawn in a box reaches no edge. */
  readonly insets?: BarInsets
  /** Told how high the slots stand, without the device's foot: what a toast is drawn above. */
  readonly onHeight?: (height: number) => void
  /** The bar's own, and each slot's with its destination after it: `tab-bar:home`. */
  readonly testID?: string
}

/** The size a module's glyph is reviewed at for a tab bar, and for a list (@household/icons, `sizes`). */
const glyphSize = { bar: 28, list: 20 } as const

/** The least a tablet's slot is wide, in rem: wider than a phone's, narrower than a sidebar. */
const slotRem = 9

const noInsets: BarInsets = { bottom: 0, left: 0, right: 0 }

function Glyph({ slot, size }: { readonly slot: Destination; readonly size: number }) {
  const theme = useTheme()
  const { textScale } = useDisplay()
  switch (slot) {
    case 'home':
      return <ModuleIcon module="dashboard" size={size} />
    case 'today':
      return <ModuleIcon module="today" size={size} />
    case 'chat':
      return <ModuleIcon module="chat" size={size} />
    case 'more':
      return <BaseIcon name="more-horizontal" size={size} />
    case 'add':
      // The one filled glyph of the bar: Add is an action, and is drawn as one.
      return (
        <View
          style={{
            width: size * textScale,
            height: size * textScale,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radii['radius-pill'],
            backgroundColor: theme.color.accent,
          }}
        >
          <Ink color="text-on-accent">
            <ModuleIcon module="add" size={glyphSize.list} />
          </Ink>
        </View>
      )
  }
}

interface SlotProps {
  readonly slot: Destination
  readonly label: string
  /** What a screen reader calls it: its label, and after it whatever else it carries. */
  readonly name: string
  readonly open: boolean
  readonly wide: boolean
  readonly onPress: () => void
  /** What stands beside the glyph: the count of what waits. */
  readonly beside?: ReactNode
  readonly testID: string
}

function Slot({ slot, label, name, open, wide, onPress, beside, testID }: SlotProps) {
  const theme = useTheme()
  const target = useTarget()
  const { textScale } = useDisplay()
  // A keyboard's focus, or a switch's: a touch gives none.
  const [focused, setFocused] = useState(false)
  const ink: ColorName = open || slot === 'add' ? 'text-primary' : 'text-muted'
  return (
    <Pressable
      testID={testID}
      // Add opens a sheet and is no tab; the rest are, and the open one says that it is.
      accessibilityRole={slot === 'add' ? 'button' : 'tab'}
      accessibilityLabel={name}
      accessibilityState={slot === 'add' ? {} : { selected: open }}
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
      }}
      onBlur={() => {
        setFocused(false)
      }}
      style={({ pressed }) => ({
        minHeight: target,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: theme.space['space-1'],
        // A tablet's slot is as wide as its words, from a least width; a phone's is its share
        // of the bar, which five of them have little of.
        ...(wide
          ? {
              flexDirection: 'row' as const,
              gap: theme.space['space-1'],
              minWidth: slotRem * remPx * textScale,
              paddingHorizontal: theme.space['space-2'],
            }
          : {
              flex: 1,
              gap: theme.space['space-05'],
              paddingHorizontal: theme.space['space-05'],
            }),
        // The open slot is drawn by more than a colour: the rule above it, and its heavier word.
        borderTopWidth: 2,
        borderTopColor: open ? theme.color.accent : 'transparent',
        backgroundColor: pressed ? theme.color['surface-sunken'] : 'transparent',
        ...(focused
          ? {
              outlineWidth: 2,
              outlineStyle: 'solid' as const,
              outlineOffset: -2,
              outlineColor: theme.color.focus,
            }
          : {}),
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['space-05'] }}>
        <Ink color={ink}>
          <Glyph slot={slot} size={wide ? glyphSize.list : glyphSize.bar} />
        </Ink>
        {beside}
      </View>
      {/* Never held to a line: at twice the text a label wraps, and the bar grows taller. */}
      <Text
        step="caption"
        color={ink}
        {...(open ? { weight: 600 as const } : {})}
        style={{ textAlign: 'center', flexShrink: 1 }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function TabBar({
  slots,
  open,
  onOpen,
  onAdd,
  width,
  waiting = 0,
  insets = noInsets,
  onHeight,
  testID = 'tab-bar',
}: TabBarProps) {
  const t = useTranslate()
  const theme = useTheme()
  const { textScale } = useDisplay()
  const wide = isWide(width, textScale)
  const labels: Readonly<Record<Destination, string>> = {
    home: t('nav.home'),
    today: t('nav.today'),
    add: t('nav.add'),
    chat: t('module.chat.name'),
    more: t('device.nav.more'),
  }
  // What the number on More counts, in words: its slot's name carries them after its label.
  const attention = waiting > 0 ? t('shell.sidebar.attention', { count: waiting }) : undefined
  return (
    <View
      testID={testID}
      style={{
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
        backgroundColor: theme.color['surface-raised'],
        borderTopWidth: 1,
        borderTopColor: theme.color['border-subtle'],
      }}
    >
      <View
        testID={`${testID}:tabs`}
        // The one role React Native gives iOS a tab bar's own trait for is `tabbar`, under
        // which VoiceOver counts the tabs itself; Android has a word for a list of tabs.
        accessibilityRole={Platform.OS === 'ios' ? 'tabbar' : 'tablist'}
        accessibilityLabel={t('shell.navigation')}
        onLayout={(event) => {
          onHeight?.(event.nativeEvent.layout.height)
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'stretch',
          justifyContent: 'center',
          ...(wide ? { gap: theme.space['space-1'] } : {}),
        }}
      >
        {slots.map((slot) => {
          const counted = slot === 'more' ? attention : undefined
          return (
            <Slot
              key={slot}
              testID={`${testID}:${slot}`}
              slot={slot}
              label={labels[slot]}
              name={counted === undefined ? labels[slot] : `${labels[slot]}, ${counted}`}
              open={slot === open}
              wide={wide}
              onPress={() => {
                if (slot === 'add') onAdd()
                else onOpen(slot)
              }}
              beside={
                counted === undefined ? undefined : (
                  // The slot's own name says the count in words: the figure is not read again.
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Badge count={waiting} label={counted} />
                  </View>
                )
              }
            />
          )
        })}
      </View>
    </View>
  )
}
