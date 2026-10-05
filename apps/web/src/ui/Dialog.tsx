// Modal and side panel (02-components §1): focus trapped, escapable, focus restored. The web
// prefers a side panel for an editor and a modal only for a confirmation. Both are the platform's
// own <dialog>, opened modally: the browser makes the page behind it inert, keeps the focus
// inside, closes on Escape and hands the focus back to what opened it. Nothing here injects a
// style, which the policy would refuse (ADR 0025).
import { controls } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { IconButton } from './Button.tsx'
import styles from './Dialog.module.css'
import { cx } from './cx.ts'
import { enterTopLayer } from './topLayer.ts'

export interface DialogProps {
  readonly open: boolean
  /** Asked to close: Escape, the ground behind it, or the panel's close control. */
  readonly onClose: () => void
  /** Its name. A destructive confirmation's names the object it destroys (06-clients §3). */
  readonly title: string
  /** What will happen, in a plain sentence: what is lost, and what is kept. */
  readonly description?: string
  readonly children?: ReactNode
  /** The choices, the safe one first. */
  readonly actions?: ReactNode
  /**
   * What takes the focus as it opens, where that is not its first control: an editor's first
   * field. A field's own `autoFocus` cannot say it. React focuses such a field as it mounts,
   * which is before the dialog is open, and writes no attribute for the platform to read.
   */
  readonly initialFocus?: RefObject<HTMLElement | null>
}

function Surface({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  initialFocus,
  panel,
}: DialogProps & { readonly panel: boolean }) {
  const t = useTranslate()
  const dialog = useRef<HTMLDialogElement>(null)
  const pressedGround = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const element = dialog.current
    if (element === null || !open) return undefined
    if (!element.open) {
      // The platform puts the focus on the first control; its owner may name another.
      element.showModal()
      initialFocus?.current?.focus()
    }
    // A menu and the toasts are drawn inside it while it is open: outside it they are inert.
    const leave = enterTopLayer(element)
    return () => {
      leave()
      // Closed by its owner, or with the screen that held it, so the page is not left inert.
      if (element.open) element.close()
    }
    // What takes the focus is asked as it opens, and not again while it stays open.
  }, [open])

  return (
    <dialog
      ref={dialog}
      className={cx(styles.dialog, panel ? styles.panel : styles.modal)}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        // Its own alone. React hands a `cancel` up its tree, as the platform does not: a
        // confirmation drawn inside a side panel is asked to close by Escape, and the panel
        // around it is not. And the platform itself lets a file input's `cancel` rise, for a
        // picker put away, which asks nothing of the dialog the input stands in.
        if (event.target !== event.currentTarget) return
        // Escape asks; the owner decides, and closes it by its `open`.
        event.preventDefault()
        onClose()
      }}
      onClose={(event) => {
        // The platform closed it behind its owner's back, and the owner is told. A close this
        // component asked for itself is none of that: its event comes later, when `open` is
        // false, or when the dialog is open again, as it is between the two runs of an effect
        // that React's strict mode makes of one. Nor is the close of a dialog drawn inside it.
        if (event.target === event.currentTarget && open && !event.currentTarget.open) onClose()
      }}
      onPointerDown={(event) => {
        pressedGround.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        // The dialog's own box is all padding-free content: a press that lands on the element
        // itself landed on the ground behind it. One that began inside, a selection dragged
        // out of a field, did not.
        if (pressedGround.current && event.target === event.currentTarget) onClose()
        pressedGround.current = false
      }}
    >
      {open ? (
        <div className={styles.content}>
          <header className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {panel ? (
              <IconButton
                label={t(controls.close_sheet.labelKey)}
                icon={<BaseIcon name={controls.close_sheet.glyph.id} />}
                onClick={onClose}
              />
            ) : null}
          </header>
          {description === undefined ? null : (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
          {children === undefined ? null : <div className={styles.body}>{children}</div>}
          {actions === undefined ? null : <footer className={styles.actions}>{actions}</footer>}
        </div>
      ) : null}
    </dialog>
  )
}

/** A modal, for a confirmation. */
export function Dialog(props: DialogProps) {
  return <Surface {...props} panel={false} />
}

/** A side panel, for an editor: the page stays where it was beneath it. */
export function Sheet(props: DialogProps) {
  return <Surface {...props} panel />
}
