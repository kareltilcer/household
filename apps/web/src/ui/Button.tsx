// Button and icon button (02-components §1): primary, secondary, ghost and danger, each at
// default, hover, focus-visible, pressed, loading and disabled, never under 44 × 44 pt. An icon
// button has a label, with no exception for an obvious glyph: its type has no way to leave one out.
import { StatusIcon } from '@household/icons/web'
import type { ComponentProps, ReactNode } from 'react'
import styles from './Button.module.css'
import { cx } from './cx.ts'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface Shared extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  readonly variant?: ButtonVariant
  /**
   * The action is under way: the button keeps its place, its words and its focus, says it is
   * busy, and takes no second press.
   */
  readonly loading?: boolean
}

export interface ButtonProps extends Shared {
  /** A glyph before the words: decoration, since the words say it. */
  readonly icon?: ReactNode
  readonly children: ReactNode
}

function pressable({ loading = false, onClick, type = 'button', ...rest }: Shared) {
  return {
    ...rest,
    type,
    'aria-busy': loading || undefined,
    // Not `disabled`: a disabled button drops out of the tab order, and the focus with it.
    'aria-disabled': loading || undefined,
    onClick: loading ? undefined : onClick,
  }
}

function Busy() {
  return <StatusIcon status="syncing" className={styles.busy} />
}

export function Button({ variant = 'secondary', icon, children, className, ...rest }: ButtonProps) {
  return (
    <button {...pressable(rest)} className={cx(styles.button, styles[variant], className)}>
      {rest.loading === true ? <Busy /> : icon}
      <span className={styles.words}>{children}</span>
    </button>
  )
}

export interface IconButtonProps extends Shared {
  /** The control's name, translated: what a screen reader says, since nothing is written. */
  readonly label: string
  readonly icon: ReactNode
}

export function IconButton({
  variant = 'ghost',
  label,
  icon,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...pressable(rest)}
      aria-label={label}
      className={cx(styles.button, styles.iconOnly, styles[variant], className)}
    >
      {rest.loading === true ? <Busy /> : icon}
    </button>
  )
}
