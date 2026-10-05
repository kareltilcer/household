// Modal and side panel (02-components §1): focus trapped, escapable, focus restored. The web
// prefers a side panel for an editor and a modal only for a confirmation. Both are the platform's
// own <dialog>, opened modally: the browser makes the page behind it inert, keeps the focus
// inside, closes on Escape and hands the focus back to what opened it. Nothing here injects a
// style, which the policy would refuse (ADR 0025).
import { controls } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useEffect, useId, useRef, type ReactNode } from 'react'
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
}

function Surface({
  open,
  onClose,
  title,
  description,
  children,
  actions,
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
    if (!element.open) element.showModal()
    // A menu and the toasts are drawn inside it while it is open: outside it they are inert.
    const leave = enterTopLayer(element)
    return () => {
      leave()
      // Closed by its owner, or with the screen that held it, so the page is not left inert.
      if (element.open) element.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialog}
      className={cx(styles.dialog, panel ? styles.panel : styles.modal)}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        // Escape asks; the owner decides, and closes it by its `open`.
        event.preventDefault()
        onClose()
      }}
      onClose={(event) => {
        // The platform closed it behind its owner's back, and the owner is told. A close this
        // component asked for itself is none of that: its event comes later, when `open` is
        // false, or when the dialog is open again, as it is between the two runs of an effect
        // that React's strict mode makes of one.
        if (open && !event.currentTarget.open) onClose()
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
