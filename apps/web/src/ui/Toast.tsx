// Toast, with undo (02-components §1, 03-patterns §5): what just happened, in a sentence, and a
// real window in which to take it back. Undo is a button, never a gesture, and it stays for the
// whole dwell (the tokens' `toast-dwell`). Over Radix's toast for what a toast has to do: be
// announced, pause while it is pointed at or focused, and be reached by a key.
import { BaseIcon } from '@household/icons/web'
import { thresholds } from '@household/tokens'
import * as RadixToast from '@radix-ui/react-toast'
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
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

/** The key that moves the focus to the toasts, as Radix reads it and as the region's name says it. */
const hotkey = 'F8'

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const t = useTranslate()
  const [shown, setShown] = useState<readonly Shown[]>([])
  const nextId = useRef(0)

  const show = useCallback<ShowToast>((toast) => {
    const id = nextId.current
    nextId.current += 1
    setShown((current) => [...current, { ...toast, id }])
  }, [])
  const remove = useCallback((id: number) => {
    setShown((current) => current.filter((toast) => toast.id !== id))
  }, [])
  const region = useMemo(() => t('ui.toast.region', { hotkey }), [t])

  // While a modal is open the toasts are drawn inside it, and announced from inside it: the page
  // outside it is inert, where an Undo could not be pressed and a toast would not be read out.
  const modal = useTopModal()
  const viewport = (
    <RadixToast.Viewport
      className={styles.viewport}
      hotkey={[hotkey]}
      label={region}
      data-third-party=""
    />
  )

  return (
    <ToastContext value={show}>
      <RadixToast.Provider
        duration={thresholds['toast-dwell']}
        label={region}
        {...(modal === null ? {} : { announcerContainer: modal })}
      >
        {children}
        {shown.map((toast) => (
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
