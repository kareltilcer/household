// Button and icon button (02-components §1): primary, secondary, ghost and danger, each at
// default, hover, focus-visible, pressed, loading and disabled, never under 44 × 44 pt. An icon
// button has a label, with no exception for an obvious glyph: its type has no way to leave one out.
// A row's own action is a button named in full for what it acts on, and drawn as one word.
import { StatusIcon } from '@household/icons/web'
import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import a11y from './a11y.module.css'
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
  /**
   * There is nothing for it to do just now, and it stays where the focus is: a stepper's button
   * at its bound. Drawn as disabled, said as disabled, and takes no press. `disabled` is for a
   * control that is out of its form altogether, and drops out of the tab order.
   */
  readonly 'aria-disabled'?: boolean | undefined
}

export interface ButtonProps extends Shared {
  /** A glyph before the words: decoration, since the words say it. */
  readonly icon?: ReactNode
  readonly children: ReactNode
}

/**
 * A press that does nothing, its default action included: a submit button's press is its form's
 * submission, and Enter in one of the form's fields presses it too.
 */
function refuse(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

/**
 * What a press is heard by before the click it ends in. A button that takes no press hands none
 * of them on: what opens on the press itself or on a key, as the menu a trigger opens does
 * (Radix listens for the pointer going down and for the key, and for no click), would open from
 * a button drawn and said to be busy.
 */
const unheard = {
  onPointerDown: undefined,
  onMouseDown: undefined,
  onTouchStart: undefined,
  onKeyDown: undefined,
} as const satisfies Partial<Shared>

function pressable({
  loading = false,
  'aria-disabled': idle = false,
  onClick,
  type = 'button',
  ...rest
}: Shared) {
  const held = loading || idle
  return {
    ...rest,
    ...(held ? unheard : {}),
    type,
    'aria-busy': loading || undefined,
    // Not `disabled`: a disabled button drops out of the tab order, and the focus with it.
    'aria-disabled': held || undefined,
    onClick: held ? refuse : onClick,
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

export interface RowActionProps {
  /** What it does and to what, for assistive technology: *Sign out Firefox on Linux*. */
  readonly name: string
  /** The one word that is drawn: *Sign out*. */
  readonly word: string
  readonly loading?: boolean
  readonly onPress: () => void
}

/** A row's own control, named for what it acts on and drawn as the one word. */
export function RowAction({ name, word, loading = false, onPress }: RowActionProps) {
  return (
    <Button
      loading={loading}
      onClick={() => {
        onPress()
      }}
    >
      <span className={a11y.visuallyHidden}>{name}</span>
      <span aria-hidden="true">{word}</span>
    </Button>
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
