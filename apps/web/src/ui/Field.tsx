// Input, textarea, select and stepper (02-components §1), at default, focus, filled, error,
// disabled and read-only. Every one is labelled, and an error is stated in words beside the field
// and tied to it for assistive technology, never carried by a red border alone (06-clients §4).
import { controls } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useId, useState, type ComponentProps, type ReactNode } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { IconButton } from './Button.tsx'
import styles from './Field.module.css'
import { cx } from './cx.ts'

export interface FieldProps {
  /** The field's name. Always shown: a placeholder is no label. */
  readonly label: string
  /** What to enter, or what the value is for. */
  readonly help?: string | undefined
  /** What is wrong with the value, in a sentence. Its presence is what marks the field invalid. */
  readonly error?: string | undefined
  /** Said in a word beside the label, not by an asterisk's colour. */
  readonly required?: boolean | undefined
}

/** What a control takes from its field: its id, and the ids of the texts that describe it. */
interface Wiring {
  readonly id: string
  readonly 'aria-describedby': string | undefined
  readonly 'aria-invalid': true | undefined
  readonly required: boolean | undefined
}

function Field({
  label,
  help,
  error,
  required,
  children,
}: FieldProps & { readonly children: (wiring: Wiring) => ReactNode }) {
  const t = useTranslate()
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const described = [help === undefined ? '' : helpId, error === undefined ? '' : errorId]
    .filter((part) => part !== '')
    .join(' ')
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required === true ? (
          <span className={styles.required}>{t('ui.field.required')}</span>
        ) : null}
      </label>
      {children({
        id,
        'aria-describedby': described === '' ? undefined : described,
        'aria-invalid': error === undefined ? undefined : true,
        required,
      })}
      {help === undefined ? null : (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className={styles.error}>
          <BaseIcon name="alert-circle" className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

type Native<Tag extends 'input' | 'textarea' | 'select'> = Omit<
  ComponentProps<Tag>,
  'id' | 'required' | 'aria-describedby' | 'aria-invalid' | 'className' | 'children'
>

export interface TextFieldProps extends FieldProps, Native<'input'> {
  /** Set in the mono face with tabular figures: a reading, an amount, a registration. */
  readonly numeric?: boolean
}

export function TextField({
  label,
  help,
  error,
  required,
  numeric = false,
  ...rest
}: TextFieldProps) {
  return (
    <Field label={label} help={help} error={error} required={required}>
      {(wiring) => (
        <input {...rest} {...wiring} className={cx(styles.control, numeric && styles.numeric)} />
      )}
    </Field>
  )
}

export interface TextAreaProps extends FieldProps, Native<'textarea'> {}

export function TextArea({ label, help, error, required, ...rest }: TextAreaProps) {
  return (
    <Field label={label} help={help} error={error} required={required}>
      {(wiring) => (
        <textarea rows={3} {...rest} {...wiring} className={cx(styles.control, styles.area)} />
      )}
    </Field>
  )
}

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectProps extends FieldProps, Native<'select'> {
  readonly options: readonly SelectOption[]
  /** What the control reads while nothing is chosen: an option that cannot be chosen back. */
  readonly placeholder?: string
}

/** The platform's own select: its list is the device's, which a phone and a screen reader know. */
export function Select({
  label,
  help,
  error,
  required,
  options,
  placeholder,
  ...rest
}: SelectProps) {
  // Where nothing says what is chosen, nothing is, and the placeholder is what it reads. Left to
  // the platform, which cannot choose an option that is disabled, the first real option would be
  // chosen without a word, and a required field would pass on a choice nobody made.
  const unchosen =
    placeholder !== undefined && rest.value === undefined && rest.defaultValue === undefined
  return (
    <Field label={label} help={help} error={error} required={required}>
      {(wiring) => (
        <select
          {...(unchosen ? { defaultValue: '' } : {})}
          {...rest}
          {...wiring}
          className={styles.control}
        >
          {placeholder === undefined ? null : (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

export interface StepperProps extends FieldProps {
  readonly value: number
  readonly onChange: (value: number) => void
  /** The least and the most it holds, and how far a button moves it: whole numbers, as it is. */
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly disabled?: boolean
  readonly readOnly?: boolean
}

/**
 * A whole number with a button either side of it, each named for what it does to what. A whole
 * number typed in is given to `onChange` as soon as it is within the bounds. A fraction is no
 * value of it and is given to nobody: when the field is left, what it holds is made the nearest
 * whole number and held to the bounds. Enter settles it as leaving it does, before the form it
 * stands in is submitted, so what is sent is what the field shows.
 */
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
}: StepperProps) {
  const t = useTranslate()
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
  // What the field holds is made a value of it. Between two whole numbers, it is the nearer;
  // outside its bounds, it is held to them. Empty, it is what it was.
  const settle = (field: HTMLInputElement) => {
    const next = field.valueAsNumber
    setTyped(undefined)
    if (!Number.isFinite(next)) return
    const whole = held(Math.round(next))
    if (whole !== value) onChange(whole)
  }
  return (
    <Field label={label} help={help} error={error} required={required}>
      {(wiring) => (
        <div className={styles.stepper}>
          <IconButton
            variant="secondary"
            label={t(controls.decrease.labelKey, { name: label })}
            icon={<BaseIcon name={controls.decrease.glyph.id} />}
            disabled={fixed}
            // At its bound it has nothing to do, and stays where the focus is: a member who
            // steps down to the least by the keyboard is not dropped out of the control.
            aria-disabled={value <= low}
            onClick={() => {
              stepTo(value - step)
            }}
          />
          <input
            {...wiring}
            type="number"
            inputMode="numeric"
            className={cx(styles.control, styles.numeric, styles.count)}
            // As text. React writes a number field only where what it holds is another number
            // than its value, and "007" is the number 7: left with it, the field would keep it.
            value={typed ?? String(value)}
            // The bounds are the field's own too, and `step` is not: the platform would take it
            // for the grid a value must lie on, and refuse a form over a whole number typed
            // between two steps of the buttons, which is a value of this field all the same.
            min={min}
            max={max}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(event) => {
              // Kept as typed until the field is left. The "1" of "12" is under a least of 5,
              // and an emptied field is on its way to any value: held to the bounds at each
              // key, neither could be typed. A fraction is no value of it, and is not given.
              setTyped(event.currentTarget.value)
              const next = event.currentTarget.valueAsNumber
              if (Number.isInteger(next) && next >= low && next <= high) onChange(next)
            }}
            onBlur={(event) => {
              settle(event.currentTarget)
            }}
            onKeyDown={(event) => {
              // Enter submits the form the field stands in, and the field has not been left:
              // what was typed over a bound or between two whole numbers has been given to
              // nobody, and the form would send the number before it while the field showed
              // another. Settled first, what is sent is what the field shows.
              if (event.key === 'Enter') settle(event.currentTarget)
            }}
          />
          <IconButton
            variant="secondary"
            label={t(controls.increase.labelKey, { name: label })}
            icon={<BaseIcon name={controls.increase.glyph.id} />}
            disabled={fixed}
            aria-disabled={value >= high}
            onClick={() => {
              stepTo(value + step)
            }}
          />
        </div>
      )}
    </Field>
  )
}
