// Checkbox, radio and switch (02-components §1): the platform's own inputs, each inside its label,
// so the whole 44 pt row is the target and the words are the name. A switch says what turning it
// on does in its label, not in a caption beside it.
import { useCallback, useEffect, useId, useRef, type ComponentProps } from 'react'
import styles from './Choice.module.css'

type Native = Omit<ComponentProps<'input'>, 'type' | 'role' | 'className' | 'children'>

export interface CheckboxProps extends Native {
  readonly label: string
  /** Neither on nor off: some of what it stands for is chosen. A property, with no attribute. */
  readonly indeterminate?: boolean
}

export function Checkbox({ label, indeterminate = false, ref, onChange, ...rest }: CheckboxProps) {
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (input.current !== null) input.current.indeterminate = indeterminate
  }, [indeterminate])
  // The input is this component's, to set what has no attribute, and its caller's too: a form
  // that moves the focus to its first invalid control asks for it by a ref.
  const attach = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element
      if (typeof ref === 'function') return ref(element)
      if (ref !== undefined && ref !== null) ref.current = element
      return undefined
    },
    [ref],
  )
  return (
    <label className={styles.choice}>
      <input
        {...rest}
        ref={attach}
        type="checkbox"
        className={styles.input}
        onChange={(event) => {
          onChange?.(event)
          // The platform makes a box that is pressed plainly on or off, whatever it stood for.
          // It stands for what its owner says: one that is still neither after the press, some
          // of its rows chosen and some not, is drawn as neither. An owner that now says
          // otherwise is drawn again, and the effect above follows it.
          event.currentTarget.indeterminate = indeterminate
        }}
      />
      <span>{label}</span>
    </label>
  )
}

export interface SwitchProps extends Native {
  readonly label: string
}

export function Switch({ label, ...rest }: SwitchProps) {
  return (
    <label className={styles.choice}>
      <input {...rest} type="checkbox" role="switch" className={styles.input} />
      <span>{label}</span>
    </label>
  )
}

export interface RadioOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface RadioGroupProps {
  /** What is being chosen: the group's name. */
  readonly label: string
  readonly options: readonly RadioOption[]
  readonly value: string | undefined
  readonly onChange: (value: string) => void
}

export function RadioGroup({ label, options, value, onChange }: RadioGroupProps) {
  const name = useId()
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={styles.choice}>
          <input
            type="radio"
            name={name}
            className={styles.input}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => {
              onChange(option.value)
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  )
}
