// Checkbox, radio and switch (02-components §1; the web's are apps/web/src/ui/Choice.tsx). Each
// is one row that takes the press, so the whole 44 pt row is the target and the words are the
// name. A switch says what turning it on does in its label, not in a caption beside it.
//
// They are drawn here, and not the platform's own: the platform's switch is one size whatever
// the reader's text is, and it would be a second target inside the row that is the first. What
// is chosen is said by more than a colour: a check or a dash in the box, where the thumb
// stands, a dot in the ring.
import { useState, type ReactNode, type Ref } from 'react'
import { Pressable, View, type AccessibilityState } from 'react-native'
import { useDisplay, useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { BaseIcon } from './Icon.tsx'
import { Text } from './Text.tsx'

interface Shared {
  readonly label: string
  /** Out of its form: it takes no press, and says so. One that cannot act at all is absent. */
  readonly disabled?: boolean
  readonly testID?: string | undefined
  /** The row, for a form that gives the focus to its first refused control. */
  readonly ref?: Ref<View>
}

/** The row every choice is: its mark, its words, and the press. */
function Row({
  role,
  state,
  label,
  disabled = false,
  trailing = false,
  onPress,
  testID,
  ref,
  children,
}: Shared & {
  readonly role: 'checkbox' | 'switch' | 'radio'
  readonly state: AccessibilityState
  /** The mark after the words, where a device has a switch, and not before them. */
  readonly trailing?: boolean
  readonly onPress: () => void
  readonly children: ReactNode
}) {
  const theme = useTheme()
  const target = useTarget()
  // A keyboard's focus, or a switch's: a touch gives none.
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole={role}
      accessibilityState={{ ...state, ...(disabled ? { disabled: true } : {}) }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
      }}
      onBlur={() => {
        setFocused(false)
      }}
      style={{
        // The row is as wide as what it stands in: the press is the row's, not the mark's.
        alignSelf: 'stretch',
        minHeight: target,
        flexDirection: trailing ? 'row-reverse' : 'row',
        alignItems: 'center',
        gap: theme.space['space-15'],
        borderRadius: theme.radii['radius-control'],
        ...(focused
          ? {
              outlineWidth: 2,
              outlineStyle: 'solid',
              outlineOffset: 2,
              outlineColor: theme.color.focus,
            }
          : {}),
      }}
    >
      {children}
      <Text color={disabled ? 'text-disabled' : 'text-primary'} style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  )
}

export interface CheckboxProps extends Shared {
  readonly checked: boolean
  /** Told of a press, with what the box would then be. It is what its owner then says it is. */
  readonly onChange: (checked: boolean) => void
  /**
   * Neither on nor off: some of what it stands for is chosen. It stays so for as long as its
   * owner says so, whatever is pressed.
   */
  readonly indeterminate?: boolean
}

export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  ...shared
}: CheckboxProps) {
  const theme = useTheme()
  const { textScale } = useDisplay()
  const filled = checked || indeterminate
  const box = theme.space['space-3'] * textScale
  return (
    <Row
      {...shared}
      disabled={disabled}
      role="checkbox"
      state={{ checked: indeterminate ? 'mixed' : checked }}
      onPress={() => {
        onChange(!checked)
      }}
    >
      <View
        style={{
          width: box,
          height: box,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderRadius: theme.radii['radius-control'] / 2,
          borderColor:
            theme.color[disabled ? 'border-subtle' : filled ? 'accent' : 'border-strong'],
          backgroundColor:
            theme.color[filled ? (disabled ? 'border-subtle' : 'accent') : 'input-bg'],
        }}
      >
        {filled ? (
          <BaseIcon
            name={indeterminate ? 'minus' : 'check'}
            color={disabled ? 'text-muted' : 'text-on-accent'}
          />
        ) : null}
      </View>
    </Row>
  )
}

export interface SwitchProps extends Shared {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

export function Switch({ checked, onChange, disabled = false, ...shared }: SwitchProps) {
  const theme = useTheme()
  const { textScale } = useDisplay()
  const thumb = theme.space['space-3'] * textScale
  return (
    <Row
      {...shared}
      disabled={disabled}
      trailing
      role="switch"
      state={{ checked }}
      onPress={() => {
        onChange(!checked)
      }}
    >
      <View
        style={{
          width: thumb * 2,
          padding: 2,
          // On, the thumb stands at the far end: where it stands says it, with the ground.
          alignItems: checked ? 'flex-end' : 'flex-start',
          borderWidth: 1,
          borderRadius: theme.radii['radius-pill'],
          borderColor:
            theme.color[disabled ? 'border-subtle' : checked ? 'accent' : 'border-strong'],
          backgroundColor:
            theme.color[checked ? (disabled ? 'border-subtle' : 'accent') : 'surface-sunken'],
        }}
      >
        <View
          style={{
            width: thumb,
            height: thumb,
            borderRadius: theme.radii['radius-pill'],
            backgroundColor:
              theme.color[
                disabled ? 'text-disabled' : checked ? 'text-on-accent' : 'border-strong'
              ],
          }}
        />
      </View>
    </Row>
  )
}

export interface RadioOption {
  readonly value: string
  readonly label: string
}

/** One of a group's choices: a ring, with a dot in it where it is the one chosen. */
export function Radio({
  label,
  checked,
  onPress,
  testID,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onPress: () => void
  readonly testID?: string | undefined
}) {
  const theme = useTheme()
  const { textScale } = useDisplay()
  const ring = theme.space['space-3'] * textScale
  return (
    <Row role="radio" state={{ checked }} label={label} onPress={onPress} testID={testID}>
      <View
        style={{
          width: ring,
          height: ring,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderRadius: theme.radii['radius-pill'],
          borderColor: theme.color[checked ? 'accent' : 'border-strong'],
          backgroundColor: theme.color['input-bg'],
        }}
      >
        {checked ? (
          <View
            style={{
              width: ring / 2,
              height: ring / 2,
              borderRadius: theme.radii['radius-pill'],
              backgroundColor: theme.color.accent,
            }}
          />
        ) : null}
      </View>
    </Row>
  )
}

export interface RadioGroupProps {
  /** What is being chosen: the group's name. */
  readonly label: string
  /** What can be chosen. An option that cannot be is not among them. */
  readonly options: readonly RadioOption[]
  readonly value: string | undefined
  readonly onChange: (value: string) => void
  /** The group's own. Each choice is found by it too: `<testID>:<value>`. */
  readonly testID?: string
}

export function RadioGroup({ label, options, value, onChange, testID }: RadioGroupProps) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text step="caption" color="text-muted">
        {label}
      </Text>
      {options.map((option) => {
        const chosen = option.value === value
        return (
          <Radio
            key={option.value}
            testID={testID === undefined ? undefined : `${testID}:${option.value}`}
            label={option.label}
            checked={chosen}
            onPress={() => {
              // The one that is chosen is chosen already: its owner is told of a change.
              if (!chosen) onChange(option.value)
            }}
          />
        )
      })}
    </View>
  )
}
