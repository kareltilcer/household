// A menu of actions (02-components §1; the web's is apps/web/src/ui/Menu.tsx): a trigger that
// carries its own name, and on a phone a sheet of the actions, which is named as its trigger is.
// An item that cannot act is not in the list, and a menu with no item is not drawn.
//
// The chosen item acts once the sheet has gone and the focus is back on the trigger, and not as
// it is pressed. What an item opens is often a confirmation, which is another modal: iOS
// refuses to present one while the one before it is still leaving, and whatever opens then
// takes the trigger for what opened it, and gives the focus back there when it closes.
import { cloneElement, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react'
import { Pressable, type AccessibilityState, type View } from 'react-native'
import { useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { Ink } from './Icon.tsx'
import { Sheet } from './Sheet.tsx'
import { Text } from './Text.tsx'

export interface MenuItem {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  /** A glyph before the words: decoration. */
  readonly icon?: ReactNode
  /** Destroys something: its label names what (06-clients §3). */
  readonly danger?: boolean
}

/** What the menu reads of its trigger and gives it: a `Button` or an `IconButton` has them all. */
interface TriggerProps {
  /** An icon-only trigger's name. */
  readonly label?: string
  /** A worded trigger's name: its words. */
  readonly children?: string
  readonly onPress?: () => void
  readonly accessibilityState?: AccessibilityState
  readonly ref?: Ref<View>
}

export interface MenuProps {
  /** The control that opens it: a Button or an IconButton, which carries its own name. */
  readonly trigger: ReactElement<TriggerProps>
  readonly items: readonly MenuItem[]
}

export function Menu({ trigger, items }: MenuProps) {
  const theme = useTheme()
  const target = useTarget()
  const opener = useRef<View>(null)
  const [open, setOpen] = useState(false)
  /** The item that was pressed, until the sheet has gone. */
  const chosen = useRef<MenuItem | null>(null)
  if (items.length === 0) return null
  return (
    <>
      {cloneElement(trigger, {
        ref: opener,
        // A trigger that is busy drops its press (ui/Button.tsx), and opens nothing.
        onPress: () => {
          setOpen(true)
        },
        accessibilityState: { ...trigger.props.accessibilityState, expanded: open },
      })}
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false)
        }}
        title={trigger.props.label ?? trigger.props.children ?? ''}
        opener={opener}
        onClosed={() => {
          const item = chosen.current
          chosen.current = null
          item?.onSelect()
        }}
      >
        {items.map((item) => {
          const words = item.danger === true ? 'danger' : 'text-primary'
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => {
                chosen.current = item
                setOpen(false)
              }}
              style={({ pressed }) => ({
                alignSelf: 'stretch',
                minHeight: target,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space['space-15'],
                paddingHorizontal: theme.space['space-1'],
                borderRadius: theme.radii['radius-control'],
                backgroundColor: pressed ? theme.color['surface-sunken'] : 'transparent',
              })}
            >
              <Ink color={words}>{item.icon ?? null}</Ink>
              <Text color={words} style={{ flex: 1 }}>
                {item.label}
              </Text>
            </Pressable>
          )
        })}
      </Sheet>
    </>
  )
}
