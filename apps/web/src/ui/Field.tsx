// Input, textarea, select and stepper (02-components §1), at default, focus, filled, error,
// disabled and read-only. Every one is labelled, and an error is stated in words beside the field
// and tied to it for assistive technology, never carried by a red border alone (06-clients §4).
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
  return (
    <Field label={label} help={help} error={error} required={required}>
      {(wiring) => (
        <select {...rest} {...wiring} className={styles.control}>
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
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly disabled?: boolean
  readonly readOnly?: boolean
}

/**
 * A whole number with a button either side of it, each named for what it does to what. A value
 * typed in is given to `onChange` as soon as it is within the bounds, and held to them when the
 * field is left.
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
  return (
    <Field label={label} help={help} error={error} required={required}>
      {(wiring) => (
        <div className={styles.stepper}>
          <IconButton
            variant="secondary"
            label={t('ui.stepper.decrease', { name: label })}
            icon={<BaseIcon name="minus" />}
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
            value={typed ?? value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(event) => {
              // Kept as typed until the field is left. The "1" of "12" is under a least of 5,
              // and an emptied field is on its way to any value: held to the bounds at each
              // key, neither could be typed.
              setTyped(event.currentTarget.value)
              const next = event.currentTarget.valueAsNumber
              if (Number.isFinite(next) && next >= low && next <= high) onChange(next)
            }}
            onBlur={(event) => {
              // Left outside its bounds, it is held to them. Left empty, it is what it was.
              const next = event.currentTarget.valueAsNumber
              setTyped(undefined)
              if (Number.isFinite(next) && next !== value) onChange(held(next))
            }}
          />
          <IconButton
            variant="secondary"
            label={t('ui.stepper.increase', { name: label })}
            icon={<BaseIcon name="plus" />}
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
