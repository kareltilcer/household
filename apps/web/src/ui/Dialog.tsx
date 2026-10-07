// Modal and side panel (02-components §1): focus trapped, escapable, focus restored. The web
// prefers a side panel for an editor and a modal only for a confirmation. Both are the platform's
// own <dialog>, opened modally: the browser makes the page behind it inert, keeps the focus
// inside, closes on Escape and hands the focus back to what opened it. Nothing here injects a
// style, which the policy would refuse (ADR 0025).
import { controls } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import {
  createContext,
  use,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { IconButton } from './Button.tsx'
import styles from './Dialog.module.css'
import { cx } from './cx.ts'
import { enterTopLayer } from './topLayer.ts'

/**
 * Whether the dialog a component is drawn inside is shown: true where it is drawn inside none. A
 * dialog drawn inside another, a confirmation inside a side panel, opens after the one around it.
 * The platform stacks modals in the order they open, and React runs a child's effect before its
 * parent's, so two that become open together would be opened inside out, the panel over its own
 * confirmation.
 */
const AroundShown = createContext(true)

export interface DialogProps {
  readonly open: boolean
  /**
   * Asked to close: Escape, the ground behind it, or the panel's close control. Its owner decides,
   * and closes it by `open`. One that keeps it open has it open, a save under way or an editor
   * that asks before it discards: closed by the platform all the same, it is shown again.
   */
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
  const aroundShown = use(AroundShown)
  /** Whether it is shown, which is what a dialog drawn inside it waits for. */
  const [shown, setShown] = useState(false)
  /** How many times the platform has closed it behind its owner's back. */
  const [closedBehind, setClosedBehind] = useState(0)

  useLayoutEffect(() => {
    const element = dialog.current
    if (element === null || !open || !aroundShown) return undefined
    if (!element.open) {
      // The platform puts the focus on the first control; its owner may name another.
      element.showModal()
      initialFocus?.current?.focus()
    }
    // A menu and the toasts are drawn inside it while it is open: outside it they are inert.
    const leave = enterTopLayer(element)
    setShown(true)
    return () => {
      leave()
      setShown(false)
      // Closed by its owner, or with the screen that held it, so the page is not left inert.
      // This is a layout effect for the second of those: React undoes one before it takes the
      // dialog out of the document, and the platform gives the focus back to what opened a
      // dialog only from one that is in it still. A dialog open inside this one goes first.
      // Taken away with it, React would close it after, and until it is closed it holds what
      // opened this one inert, where no focus can be given.
      const inside = element.querySelectorAll<HTMLDialogElement>('dialog[open]')
      for (const nested of [...inside].reverse()) nested.close()
      if (element.open) element.close()
    }
    // What takes the focus is asked as it opens, and not again while it stays open. Closed by
    // the platform and kept open by its owner, it opens again.
  }, [open, aroundShown, closedBehind])

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
        // One the page may not refuse is followed by the dialog's close, whatever is done here.
        // The owner is asked then, below, and once: asked here as well, an owner that answers
        // with a question would open it inside a dialog the platform is about to close.
        if (!event.cancelable) return
        // Escape asks; the owner decides, and closes it by its `open`.
        event.preventDefault()
        onClose()
      }}
      onClose={(event) => {
        // A close this component asked for itself is nothing to tell of: its event comes later,
        // when `open` is false, or when the dialog is open again, as it is between the two runs
        // of an effect that React's strict mode makes of one. Nor is the close of a dialog drawn
        // inside it.
        if (event.target !== event.currentTarget || !open || event.currentTarget.open) return
        // The platform closed it behind its owner's back: a browser lets a page refuse Escape
        // only so many times in a row, and then closes the dialog whatever the page says. The
        // owner is told, and decides as it does when Escape asks. One that keeps it open, a
        // save still under way or an editor that asks before it discards, has it open: it is
        // shown again, and what is drawn inside it after it.
        setShown(false)
        setClosedBehind((times) => times + 1)
        onClose()
      }}
      onPointerDown={(event) => {
        pressedGround.current = event.target === event.currentTarget
      }}
      onPointerUp={(event) => {
        // Let go inside, a press that began on the ground did not land there either: its click
        // is still the dialog's, the one element that holds both of its ends.
        if (event.target !== event.currentTarget) pressedGround.current = false
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
                onClick={() => {
                  onClose()
                }}
              />
            ) : null}
          </header>
          {description === undefined ? null : (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
          <AroundShown value={shown}>
            {children === undefined ? null : <div className={styles.body}>{children}</div>}
            {actions === undefined ? null : <footer className={styles.actions}>{actions}</footer>}
          </AroundShown>
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
