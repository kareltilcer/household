// A select (02-components §1): a field that reads what is chosen and opens a sheet of its
// choices. The web's is the platform's own (apps/web/src/ui/Field.tsx); a phone's own pickers
// are a wheel on one platform and a dialog on the other, neither in the app's type at the
// reader's scale, so the list is a sheet of the app's, each choice a 44 pt row.
//
// Where nothing says what is chosen, nothing is: the field reads its placeholder, no row of the
// sheet is marked, and its owner is told of a choice only when a member makes one. No first
// option is taken without a word, so a required field does not pass on a choice nobody made
// (D-172). The placeholder is no option, and cannot be chosen back.
//
// Its owner is told of a choice once the sheet has gone and the focus is back on the field,
// and not as the choice is pressed, as a menu's item acts (ui/Menu.tsx) and for its reason:
// what a choice sets off may open another modal, which iOS refuses while this one is still
// leaving, and whatever it moves the focus to would have the focus taken back by the sheet as
// it goes. Until then the field reads what it read.
//
// As it opens, the keyboard of whatever field was being typed in is put away: the sheet takes
// the screen from that field, and its keyboard would stand over the choices. React Native's
// modal says nothing to the keyboard on either platform *(read: ReactModalHostView.kt and
// RCTModalHostViewComponentView.mm name it nowhere)*; what each platform's own window then
// does with it is not in this repository, and is seen on no device yet.
import { useRef, useState, type Ref } from 'react'
import { Keyboard, Pressable, View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useFocusRing } from './focus.ts'
import { Radio } from './Choice.tsx'
import { Field, useAttached, useControlStyle, type FieldProps } from './Field.tsx'
import { BaseIcon } from './Icon.tsx'
import { useRefusable } from './refusal.ts'
import { Sheet } from './Sheet.tsx'
import { Text } from './Text.tsx'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectProps extends FieldProps {
  readonly options: readonly SelectOption[]
  /** What is chosen: one of the options' values, or nothing. */
  readonly value: string | undefined
  /** Told of a choice a member made, and of nothing else. */
  readonly onChange: (value: string) => void
  /** What the field reads while nothing is chosen. */
  readonly placeholder?: string
  /** Out of its form: it opens nothing, and says so. */
  readonly disabled?: boolean
  /**
   * The field's own. Its sheet is found by it too, as `<testID>:choices` (and what a sheet's
   * `testID` gives, ui/Dialog.tsx), and each choice as `<testID>:<value>`.
   */
  readonly testID?: string
  /** The field's control, for a form that gives the focus to its first refused one. */
  readonly ref?: Ref<View>
}

export function Select({
  label,
  help,
  error,
  required,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  testID,
  ref,
}: SelectProps) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  /** The choice that was pressed, until the sheet has gone. */
  const picked = useRef<SelectOption | null>(null)
  const focus = useFocusRing()
  const invalid = error !== undefined
  const control = useControlStyle({
    invalid,
    ring: focus.ring,
    fixed: disabled ? 'disabled' : undefined,
  })
  const opener = useRefusable(invalid)
  const attach = useAttached(opener, ref)
  const chosen = options.find((option) => option.value === value)
  const reads = chosen?.label ?? placeholder
  return (
    <Field label={label} help={help} error={error} required={required}>
      {(wiring) => (
        <>
          <Pressable
            ref={attach}
            testID={testID}
            // What a screen reader says of it is its name, what it reads, and that it is a
            // button: a device has no word for a list that drops down.
            accessibilityRole="button"
            accessibilityLabel={wiring.name}
            {...(reads === undefined ? {} : { accessibilityValue: { text: reads } })}
            {...(wiring.hint === undefined ? {} : { accessibilityHint: wiring.hint })}
            accessibilityState={{ expanded: open, ...(disabled ? { disabled: true } : {}) }}
            disabled={disabled}
            onPress={() => {
              Keyboard.dismiss()
              setOpen(true)
            }}
            onFocus={focus.onFocus}
            onBlur={focus.onBlur}
            style={[
              control,
              {
                // A field is as wide as what it stands in.
                alignSelf: 'stretch',
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space['space-1'],
              },
            ]}
          >
            <Text
              color={
                disabled ? 'text-disabled' : chosen === undefined ? 'text-muted' : 'text-primary'
              }
              style={{ flex: 1 }}
            >
              {reads}
            </Text>
            <BaseIcon name="chevron-down" color={disabled ? 'text-disabled' : 'text-muted'} />
          </Pressable>
          <Sheet
            {...(testID === undefined ? {} : { testID: `${testID}:choices` })}
            open={open}
            onClose={() => {
              setOpen(false)
            }}
            title={label}
            opener={opener}
            onClosed={() => {
              const option = picked.current
              picked.current = null
              if (option !== null) onChange(option.value)
            }}
          >
            <View accessibilityRole="radiogroup" accessibilityLabel={label}>
              {options.map((option) => (
                <Radio
                  key={option.value}
                  testID={testID === undefined ? undefined : `${testID}:${option.value}`}
                  label={option.label}
                  checked={option === chosen}
                  onPress={() => {
                    // Chosen again, it is what it was: its owner is told of a change.
                    picked.current = option === chosen ? null : option
                    setOpen(false)
                  }}
                />
              ))}
            </View>
          </Sheet>
        </>
      )}
    </Field>
  )
}
