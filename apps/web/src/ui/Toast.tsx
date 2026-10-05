// Toast, with undo (02-components §1, 03-patterns §5): what just happened, in a sentence, and a
// real window in which to take it back. Undo is a button, never a gesture, and it stays for the
// whole dwell (the tokens' `toast-dwell`). Over Radix's toast for what a toast has to do: be
// announced, pause while it is pointed at or focused, and be reached by a key. Escape puts a toast
// away from among the toasts, and from nowhere else: pressed anywhere else the key is for what the
// focus is in, a menu, a modal or a field of the page, and the toast keeps its dwell.
import { controls } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { thresholds } from '@household/tokens'
import * as RadixToast from '@radix-ui/react-toast'
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './Toast.module.css'
import { useTopModal } from './topLayer.ts'

export interface ToastOptions {
  /** What happened, naming what it happened to: "7 checked items cleared from Weekly shop". */
  readonly message: string
  /** Takes it back. With one, the toast carries an Undo button for as long as it shows. */
  readonly undo?: () => void
}

export type ShowToast = (toast: ToastOptions) => void

const ToastContext = createContext<ShowToast | null>(null)

interface Shown extends ToastOptions {
  readonly id: number
}

/**
 * The toasts on the screen, and which run of them this is: one more each time a toast is shown
 * while none is.
 */
interface Run {
  readonly number: number
  readonly toasts: readonly Shown[]
}

/** The key that moves the focus to the toasts, as Radix reads it and as the region's name says it. */
const hotkey = 'F8'

/**
 * The custom property a modal is told the toasts' room by: how much of the foot of the window
 * they take while one is shown inside it. A side panel reads it (Dialog.module.css).
 */
const toastsRoom = '--toasts-room'

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const t = useTranslate()
  const [run, setRun] = useState<Run>({ number: 0, toasts: [] })
  const nextId = useRef(0)
  const list = useRef<HTMLOListElement>(null)
  /** Whether the toasts' region held the focus when the last toast was asked for. */
  const focused = useRef(false)
  /** Whether the last thing done to a toast was a press of a pointer on it, and not a key. */
  const pressed = useRef(false)
  /** The last Escape Radix asked a toast to close by: it says so before it asks. */
  const escape = useRef<KeyboardEvent | null>(null)

  const show = useCallback<ShowToast>((toast) => {
    const id = nextId.current
    nextId.current += 1
    focused.current = list.current?.contains(document.activeElement) ?? false
    setRun((current) => ({
      number: current.toasts.length === 0 ? current.number + 1 : current.number,
      toasts: [...current.toasts, { ...toast, id }],
    }))
  }, [])
  const remove = useCallback((id: number) => {
    setRun((current) => ({
      number: current.number,
      toasts: current.toasts.filter((toast) => toast.id !== id),
    }))
    // Radix hands the focus of a toast that closes to the region, so that a member who closed
    // it by a key is not dropped out of the toasts, and holds every toast's dwell for as long as
    // the focus is there. A member who closed it by a press of the pointer is not there at all:
    // left in the region, the focus would hold the toasts that remain, and one raised by the
    // very Undo that was pressed, until the next press somewhere else. It is let go, and their
    // dwell runs on once the pointer has left them.
    if (pressed.current && document.activeElement === list.current) list.current?.blur()
    pressed.current = false
  }, [])
  const region = useMemo(() => t('ui.toast.region', { hotkey }), [t])

  // A run of toasts is drawn in a region of its own (below). A member who closed the last toast
  // from the keyboard is in the region still, where Radix put the focus, and is in it still when
  // the next toast comes: the focus is not dropped with the region that held it.
  useLayoutEffect(() => {
    if (focused.current) list.current?.focus()
    focused.current = false
  }, [run.number])

  // While a modal is open the toasts are drawn inside it, and announced from inside it: the page
  // outside it is inert, where an Undo could not be pressed and a toast would not be read out.
  const modal = useTopModal()

  // They are drawn over the foot of the window there as on the page, in the same place, so that
  // a pointer on a toast is on it still when the modal goes. A side panel keeps its actions at
  // its foot: under a toast, a press meant for Save would land on the toast's Undo. So the modal
  // is told how much room the toasts take for as long as one is shown, and keeps its own foot
  // above them.
  const shown = run.toasts.length > 0
  useLayoutEffect(() => {
    const viewport = list.current
    if (modal === null || viewport === null || !shown) return undefined
    // A toast is as tall as its words, which wrap as the window narrows and as toasts come and
    // go: the room is measured whenever it changes, and first as the watch begins.
    const measured = new ResizeObserver(() => {
      modal.style.setProperty(toastsRoom, `${String(viewport.offsetHeight)}px`)
    })
    measured.observe(viewport)
    return () => {
      measured.disconnect()
      modal.style.removeProperty(toastsRoom)
    }
    // Each modal, and each run of toasts, has a region of its own to measure.
  }, [modal, run.number, shown])
  const viewport = (
    <RadixToast.Viewport
      ref={list}
      className={styles.viewport}
      hotkey={[hotkey]}
      label={region}
      data-third-party=""
    />
  )

  return (
    <ToastContext value={show}>
      {children}
      {/* Radix holds every toast's dwell while one of them is pointed at or holds the focus, and
          lets go when the pointer or the focus leaves them, which it listens for only while a
          toast is shown. A toast closed by a press on its own Undo is gone before the pointer has
          left it, so the hold would stand, and every toast after it would stay until it was
          pointed at and left. Each run of toasts, from the first shown while none is to the last
          one's leaving, is therefore Radix's provider afresh, which holds nothing yet. */}
      <RadixToast.Provider
        key={run.number}
        duration={thresholds['toast-dwell']}
        // What Radix says before each toast as it reads it out: the one word, and not the
        // region's name, which the viewport carries.
        label={t('ui.toast.label')}
        {...(modal === null ? {} : { announcerContainer: modal })}
      >
        {run.toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            // Open for as long as it is listed: Radix asks for it to be closed, and whether it
            // is is decided below.
            open
            className={styles.toast}
            onPointerDown={() => {
              pressed.current = true
            }}
            onKeyDown={() => {
              pressed.current = false
            }}
            onEscapeKeyDown={(event) => {
              escape.current = event
            }}
            onOpenChange={(open) => {
              if (open) return
              // One Escape does one thing. Radix closes the newest toast for the key wherever
              // the focus is, and tells the platform nothing of it, so the dialog the toasts
              // are drawn in is asked to close by the same key: left to the two of them, a
              // panel closed by Escape would take an Undo with it, and Escape on a toast would
              // close the editor around it.
              const key = escape.current
              // Still on its way through the page: this close is that key's doing.
              if (key !== null && key.eventPhase !== Event.NONE) {
                // Pressed anywhere but among the toasts, it is not theirs, and a toast is no
                // layer a member opened: the key is for what the focus is in. A menu closes by
                // it and spends it (Menu), though Radix handed it to a toast it layered later;
                // under a modal the platform asks the modal with it; in a field of the page it
                // is the field's. The toast stays for its dwell, its Undo with it.
                if (list.current?.contains(document.activeElement) !== true) return
                // Pressed among the toasts, it puts the toast away and is spent there: the
                // platform is not left the key to ask the dialog with. And it is a key that
                // closes this toast, whatever a pointer pressed on one before it.
                key.preventDefault()
                pressed.current = false
              }
              remove(toast.id)
            }}
          >
            <RadixToast.Description className={styles.message}>
              {toast.message}
            </RadixToast.Description>
            {toast.undo === undefined ? null : (
              <RadixToast.Action
                className={styles.action}
                altText={t('ui.toast.undo')}
                onClick={toast.undo}
              >
                {t('ui.toast.undo')}
              </RadixToast.Action>
            )}
            <RadixToast.Close className={styles.close} aria-label={t(controls.dismiss.labelKey)}>
              <BaseIcon name={controls.dismiss.glyph.id} />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        {modal === null ? viewport : createPortal(viewport, modal)}
      </RadixToast.Provider>
    </ToastContext>
  )
}

/** Shows a toast. */
export function useToast(): ShowToast {
  const show = use(ToastContext)
  if (show === null) throw new Error('useToast: no ToastProvider above this component')
  return show
}
