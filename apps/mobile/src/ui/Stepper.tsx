// A stepper (02-components §1; the web's is in apps/web/src/ui/Field.tsx): a whole number with a
// button either side of it, each named for what it does to what. A whole number typed in is
// given to `onChange` as soon as it is within the bounds. A fraction is no value of it and is
// given to nobody: when the field is left, what it holds is made the nearest whole number and
// held to the bounds, and the keyboard's own key for *done* settles it as leaving it does.
//
// At a bound a button has nothing to do and stays where it is, saying that it cannot go
// further: taken away under a finger that was stepping, the next press would land on whatever
// moved into its place. A stepper that takes no change at all, read-only or out of its form,
// has no buttons: a control that cannot act is absent.
import { controls } from '@household/icons'
import { useState } from 'react'
import { Platform, View } from 'react-native'
import { useDisplay, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { IconButton } from './Button.tsx'
import { Field, FieldInput, type FieldProps } from './Field.tsx'
import { BaseIcon } from './Icon.tsx'

export interface StepperProps extends FieldProps {
  readonly value: number
  readonly onChange: (value: number) => void
  /** The least and the most it holds, and how far a button moves it: whole numbers, as it is. */
  readonly min?: number
  readonly max?: number
  readonly step?: number
  /** Out of its form: it takes no step and no typing, and says so. */
  readonly disabled?: boolean
  /** Its number is shown and not changed here. */
  readonly readOnly?: boolean
  readonly testID?: string
}

/**
 * What was typed, as a number: digits, with a sign and with a fraction after a point or a
 * comma, which is how four of the five languages write one. Anything else is no number: an
 * emptied field, and a number on its way to a fraction, "2," before its "5".
 */
function typedNumber(text: string): number {
  const written = text.trim()
  return /^[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(written)
    ? Number(written.replace(',', '.'))
    : Number.NaN
}

export function Stepper({
  label,
  help,
  error,
  required,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  readOnly = false,
  testID,
}: StepperProps) {
  const t = useTranslate()
  const theme = useTheme()
  const { textScale } = useDisplay()
  // What the field holds while it is typed in, until it is left.
  const [typed, setTyped] = useState<string | undefined>(undefined)
  const fixed = disabled || readOnly
  const low = min ?? Number.NEGATIVE_INFINITY
  const high = max ?? Number.POSITIVE_INFINITY
  const held = (next: number) => Math.min(high, Math.max(low, next))
  const stepTo = (next: number) => {
    setTyped(undefined)
    onChange(held(next))
  }
  const down = () => {
    if (value > low) stepTo(value - step)
  }
  const up = () => {
    if (value < high) stepTo(value + step)
  }
  // What the field holds is made a value of it. Between two whole numbers, it is the nearer;
  // outside its bounds, it is held to them. Empty, it is what it was.
  const settle = () => {
    const next = typed === undefined ? Number.NaN : typedNumber(typed)
    setTyped(undefined)
    if (!Number.isFinite(next)) return
    const whole = held(Math.round(next))
    if (whole !== value) onChange(whole)
  }
  const decrease = t(controls.decrease.labelKey, { name: label })
  const increase = t(controls.increase.labelKey, { name: label })
  return (
    <Field label={label} help={help} error={error} required={required} typed>
      {(wiring) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['space-1'] }}>
          {fixed ? null : (
            <IconButton
              variant="secondary"
              label={decrease}
              icon={<BaseIcon name={controls.decrease.glyph.id} />}
              idle={value <= low}
              onPress={down}
            />
          )}
          <FieldInput
            wiring={wiring}
            {...(testID === undefined ? {} : { testID })}
            numeric
            align="center"
            // As wide as the row leaves it, and never narrower than four figures.
            layout={{ flex: 1, minWidth: 64 * textScale }}
            // Digits alone, where its least allows no minus: a fraction cannot be typed on
            // that keyboard, and can on a keyboard plugged in, or be pasted.
            keyboardType={
              low < 0
                ? Platform.OS === 'ios'
                  ? 'numbers-and-punctuation'
                  : 'numeric'
                : 'number-pad'
            }
            disabled={disabled}
            readOnly={readOnly}
            value={typed ?? String(value)}
            onChangeText={(text) => {
              // Kept as typed until the field is left. The "1" of "12" is under a least of 5,
              // and an emptied field is on its way to any value: held to the bounds at each
              // key, neither could be typed. A fraction is no value of it, and is not given.
              setTyped(text)
              const next = typedNumber(text)
              if (Number.isInteger(next) && next >= low && next <= high) onChange(next)
            }}
            onBlur={settle}
            // The keyboard's own key ends the typing before the field is left: settled here,
            // what a form then sends is what the field shows.
            onSubmitEditing={settle}
            // The two steps again, for a screen reader's own list of actions on the field, by
            // the buttons' names: an action with no label is offered under its English name.
            {...(fixed
              ? {}
              : {
                  accessibilityActions: [
                    { name: 'increment', label: increase },
                    { name: 'decrement', label: decrease },
                  ],
                  onAccessibilityAction: (event) => {
                    if (event.nativeEvent.actionName === 'increment') up()
                    if (event.nativeEvent.actionName === 'decrement') down()
                  },
                })}
          />
          {fixed ? null : (
            <IconButton
              variant="secondary"
              label={increase}
              icon={<BaseIcon name={controls.increase.glyph.id} />}
              idle={value >= high}
              onPress={up}
            />
          )}
        </View>
      )}
    </Field>
  )
}
