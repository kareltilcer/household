// Toast, with undo (02-components §1, 03-patterns §5; the web's is apps/web/src/ui/Toast.tsx):
// what just happened, in a sentence, and a real window in which to take it back. Undo is a
// button, never a gesture, and it stays for the whole dwell (the tokens' `toast-dwell`): no
// swipe puts a toast away, its own control does. Each is said to a screen reader as it comes,
// once it has finished what it is saying.
//
// Where they are drawn is the one thing a device changes. React Native's `Modal` stands above
// everything else the app draws, so while a dialog or a sheet is open the toasts are drawn
// inside it (ui/Dialog.tsx hosts them, as the web's dialog does for its inert page): under it
// an Undo could not be pressed. They are one list wherever it is drawn, each toast with a dwell
// that runs on through a modal that opens or closes around it.
import { controls } from '@household/icons'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { KeyboardAvoidingView, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDisplay, useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { announce, watchScreenReader } from './announce.ts'
import { BaseIcon } from './Icon.tsx'
import { Text } from './Text.tsx'

export interface ToastOptions {
  /** What happened, naming what it happened to: "7 checked items cleared from Weekly shop". */
  readonly message: string
  /** Takes it back. With one, the toast carries an Undo button for as long as it shows. */
  readonly undo?: () => void
}

export type ShowToast = (toast: ToastOptions) => void

interface Shown extends ToastOptions {
  readonly id: number
}

/** An open modal the toasts can be drawn in, and how many modals it is inside of. */
interface Host {
  readonly depth: number
}

interface Toasts {
  readonly shown: readonly Shown[]
  readonly dismiss: (id: number) => void
  /** Enters an open modal as a place the toasts are drawn in, until the answer's function is called. */
  readonly enter: (host: Host) => () => void
  /** The modal the toasts are drawn in: the innermost one open, which is the one on top. */
  readonly top: Host | null
  readonly setFoot: (height: number) => void
}

const ShowContext = createContext<ShowToast | null>(null)
const ToastsContext = createContext<Toasts | null>(null)
/** How many toast-hosting modals a component is drawn inside of. */
const DepthContext = createContext(0)

function useToasts(): Toasts {
  const toasts = use(ToastsContext)
  if (toasts === null) throw new Error('toasts: no ToastProvider above this component')
  return toasts
}

/**
 * A toast's dwell: over once it has run its whole length, and not running while it is held. It
 * is the provider's and not the drawn toast's, which is drawn anew when a modal opens over it.
 */
function Dwell({
  id,
  held,
  length,
  over,
}: {
  readonly id: number
  readonly held: boolean
  readonly length: number
  readonly over: (id: number) => void
}) {
  useEffect(() => {
    if (held) return undefined
    const timer = setTimeout(() => {
      over(id)
    }, length)
    return () => {
      clearTimeout(timer)
    }
  }, [id, held, length, over])
  return null
}

/** One toast: its sentence, its Undo where it has one, and the control that puts it away. */
function Toast({
  toast,
  dismiss,
}: {
  readonly toast: Shown
  readonly dismiss: (id: number) => void
}) {
  const t = useTranslate()
  const theme = useTheme()
  const target = useTarget()
  const { textScale } = useDisplay()
  const { undo } = toast
  const control = {
    minHeight: target,
    minWidth: target,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii['radius-control'],
  } as const
  return (
    <View
      testID="toast"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['space-1'],
        width: '100%',
        // 32 rem at the most, counted in the reader's text.
        maxWidth: 512 * textScale,
        paddingVertical: theme.space['space-1'],
        paddingLeft: theme.space['space-2'],
        paddingRight: theme.space['space-1'],
        backgroundColor: theme.color['surface-inverse'],
        borderRadius: theme.radii['radius-card'],
        boxShadow: theme.shadows['shadow-2'],
      }}
    >
      {/* Met by a screen reader, it is read as it was announced: after the one word. */}
      <Text
        color="text-inverse"
        accessibilityLabel={`${t('ui.toast.label')}: ${toast.message}`}
        style={{ flex: 1 }}
      >
        {toast.message}
      </Text>
      {undo === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            undo()
            dismiss(toast.id)
          }}
          style={{
            ...control,
            paddingHorizontal: theme.space['space-15'],
            borderWidth: 1,
            // The toast's own ink, on its own ground: the one pair an inverse surface has.
            borderColor: theme.color['text-inverse'],
          }}
        >
          <Text color="text-inverse" weight={500}>
            {t('ui.toast.undo')}
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(controls.dismiss.labelKey)}
        onPress={() => {
          dismiss(toast.id)
        }}
        style={control}
      >
        <BaseIcon name={controls.dismiss.glyph.id} color="text-inverse" />
      </Pressable>
    </View>
  )
}

/**
 * The toasts, one under another, each apart, clear of the device's own foot and of `foot`,
 * what else stands there. Nothing at all while there is none.
 */
function Region({ foot }: { readonly foot: number }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { shown, dismiss } = useToasts()
  if (shown.length === 0) return null
  return (
    <View
      // The space between toasts is the screen's: only a toast takes a press.
      pointerEvents="box-none"
      style={{
        alignItems: 'center',
        gap: theme.space['space-1'],
        padding: theme.space['space-2'],
        paddingBottom: theme.space['space-2'] + insets.bottom + foot,
      }}
    >
      {shown.map((toast) => (
        <Toast key={toast.id} toast={toast} dismiss={dismiss} />
      ))}
    </View>
  )
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const t = useTranslate()
  const theme = useTheme()
  const [shown, setShown] = useState<readonly Shown[]>([])
  const [hosts, setHosts] = useState<readonly Host[]>([])
  /** How much of the foot of the screen the shell's bar takes: the toasts stand above it. */
  const [foot, setFoot] = useState(0)
  const nextId = useRef(0)

  // React Native says whether a screen reader is on, and not where its focus is. A toast is
  // gone in five seconds, and a member who has to find it by ear has not reached its Undo by
  // then: while a screen reader is on no dwell runs, and a toast stays until it is put away or
  // taken back.
  const [reader, setReader] = useState(false)
  useEffect(() => watchScreenReader(setReader), [])

  const label = t('ui.toast.label')
  const show = useCallback<ShowToast>(
    (toast) => {
      const id = nextId.current
      nextId.current += 1
      setShown((current) => [...current, { ...toast, id }])
      announce(`${label}: ${toast.message}`)
    },
    [label],
  )
  const dismiss = useCallback((id: number) => {
    setShown((current) => current.filter((toast) => toast.id !== id))
  }, [])
  const enter = useCallback((host: Host) => {
    setHosts((current) => [...current, host])
    return () => {
      setHosts((current) => current.filter((each) => each !== host))
    }
  }, [])

  const top = hosts.reduce<Host | null>(
    (inner, host) => (inner === null || host.depth >= inner.depth ? host : inner),
    null,
  )
  const toasts = useMemo<Toasts>(
    () => ({ shown, dismiss, enter, top, setFoot }),
    [shown, dismiss, enter, top],
  )

  return (
    <ShowContext value={show}>
      <ToastsContext value={toasts}>
        <View style={{ flex: 1 }}>
          {children}
          {shown.map((toast) => (
            <Dwell
              key={toast.id}
              id={toast.id}
              held={reader}
              length={theme.thresholds['toast-dwell']}
              over={dismiss}
            />
          ))}
          {top !== null || shown.length === 0 ? null : (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {/* Over the foot of the screen, and above the keyboard where one is up. */}
              <KeyboardAvoidingView
                behavior="padding"
                pointerEvents="box-none"
                style={{ flex: 1, justifyContent: 'flex-end' }}
              >
                <Region foot={foot} />
              </KeyboardAvoidingView>
            </View>
          )}
        </View>
      </ToastsContext>
    </ShowContext>
  )
}

/** Shows a toast. */
export function useToast(): ShowToast {
  const show = use(ShowContext)
  if (show === null) throw new Error('useToast: no ToastProvider above this component')
  return show
}

/**
 * Says how much of the foot of the screen is taken, for as long as its caller is drawn: the
 * shell's tab bar, which the toasts stand above. Its height is the bar's to know, since it
 * grows with the reader's text.
 */
export function useToastsAbove(height: number): void {
  const { setFoot } = useToasts()
  useEffect(() => {
    setFoot(height)
    return () => {
      setFoot(0)
    }
  }, [setFoot, height])
}

/**
 * What an open modal draws its content in (ui/Dialog.tsx): the toasts are drawn at its foot
 * while it is the modal on top, in a row of their own under `children`, so that nothing of the
 * modal is beneath a toast: under one, a press meant for Save would land on the toast's Undo.
 */
export function ToastHost({ children }: { readonly children: ReactNode }) {
  const toasts = useToasts()
  const depth = use(DepthContext) + 1
  const [self] = useState<Host>(() => ({ depth }))
  const { enter } = toasts
  // Before anything is painted: there is no frame in which the toasts are drawn under it.
  useLayoutEffect(() => enter(self), [enter, self])
  return (
    <DepthContext value={depth}>
      {children}
      {toasts.top === self ? <Region foot={0} /> : null}
    </DepthContext>
  )
}
