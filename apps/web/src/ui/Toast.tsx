// Toast, with undo (02-components §1, 03-patterns §5): what just happened, in a sentence, and a
// real window in which to take it back. Undo is a button, never a gesture, and it stays for the
// whole dwell (the tokens' `toast-dwell`). Over Radix's toast for what a toast has to do: be
// announced, pause while it is pointed at or focused, and be reached by a key.
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

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const t = useTranslate()
  const [run, setRun] = useState<Run>({ number: 0, toasts: [] })
  const nextId = useRef(0)
  const list = useRef<HTMLOListElement>(null)
  /** Whether the toasts' region held the focus when the last toast was asked for. */
  const focused = useRef(false)

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
        label={region}
        {...(modal === null ? {} : { announcerContainer: modal })}
      >
        {run.toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            className={styles.toast}
            onOpenChange={(open) => {
              if (!open) remove(toast.id)
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
            <RadixToast.Close className={styles.close} aria-label={t('ui.dismiss')}>
              <BaseIcon name="x" />
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
