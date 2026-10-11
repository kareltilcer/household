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
import { useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { IconButton } from './Button.tsx'
import { Field, FieldInput, type FieldInputProps, type FieldProps } from './Field.tsx'
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
  /** The field's own. Its buttons are `<testID>:decrease` and `<testID>:increase`. */
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

/**
 * How the count stands in its box: in the middle of it, between its two buttons, on iOS, and at
 * its start on Android, where centring it costs the page its scroll. In CI's runs a swipe that
 * began on the count scrolled the page no further on Android, where iOS scrolled the same page.
 *
 * Read in React Native's own source: its Android field shuts its parents out of a touch as the
 * finger comes down, and lets them back in at the first move only if it can scroll no way
 * itself (`onTouchEvent`, ReactEditText.kt:296-320); and `textAlign: 'center'` is the field's
 * horizontal gravity (`setTextAlign`, ReactTextInputManager.kt:546-570). Recalled of Android's
 * own `TextView`, whose source is not in this repository, and run on nothing: a field of one
 * line answers that it can scroll sideways unless that gravity is the start's, its line being
 * laid out far wider than the field. So a centred count would keep every touch that begins on
 * it. No property of the field turns that off but `multiline`, which is another control on iOS.
 * A flow that swipes from the count is what shows whether this mends it.
 */
function centredOn(os: typeof Platform.OS): Pick<FieldInputProps, 'align'> {
  return os === 'android' ? {} : { align: 'center' }
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
  const target = useTarget()
  // What the field holds while it is typed in, until it is left.
  const [typed, setTyped] = useState<string | undefined>(undefined)
  const fixed = disabled || readOnly
  // Where nothing says, the bounds are those of the whole numbers a number holds exactly. Past
  // them a number is still "an integer" and no longer the one that was typed: twenty-two
  // digits, typed or pasted, were given to the owner as 1e21, which the field then showed as
  // "1e+21" and could not read back, and a step from there moved nothing.
  const low = min ?? Number.MIN_SAFE_INTEGER
  const high = max ?? Number.MAX_SAFE_INTEGER
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
  const centred = centredOn(Platform.OS)
  return (
    <Field label={label} help={help} error={error} required={required} typed>
      {(wiring) => (
        <View
          // One line wherever there is the room for it, and the room it needs is three targets
          // and two gaps: at 200 % that is 88 + 8 + 88 + 8 + 88 = 280 pt, what a dialog leaves
          // on a phone 360 pt wide (360 less its 16 pt either side and the 24 pt of its own),
          // and a sheet leaves 312. With the count held to 64 pt a scale it was 320, and the
          // second button was cut by 8 pt in a sheet and by 40 in a dialog. Where there is
          // less room still, the row wraps and cuts nothing: the count is the rest of its line
          // by `flex`, which grows and does not shrink, so no line is broken by counting it as
          // nothing (ui/ListRow.tsx), and its least width is what the row breaks by.
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.space['space-1'],
          }}
        >
          {fixed ? null : (
            <IconButton
              testID={testID === undefined ? undefined : `${testID}:decrease`}
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
            {...centred}
            // As wide as the row leaves it, and never narrower than one of its buttons: what
            // is longer than it shows is the field's own to scroll.
            layout={{ flex: 1, minWidth: target }}
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
              testID={testID === undefined ? undefined : `${testID}:increase`}
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
