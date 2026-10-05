// The display modes as the app holds them (06-clients §3): light, dark and system themes,
// comfortable and compact density, text scale and reduced motion. A change is written to this
// browser and to the root at once, and a change made in another tab arrives here.
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { storageKey, type DisplayPreferences } from './modes.ts'
import { applyPreferences, measureTextScale, readPreferences, writePreferences } from './store.ts'

export interface Display {
  readonly preferences: DisplayPreferences
  /** Changes one or more modes, here and in this browser's other tabs. */
  readonly set: (change: Partial<DisplayPreferences>) => void
  /**
   * Whether motion is reduced: by the member's choice here, or by their device's. A component
   * that animates through the duration tokens needs no more than the stylesheet; one that times
   * its own motion asks this.
   */
  readonly reducedMotion: boolean
  /** How large text is drawn: 1 at 100 %, 2 at 200 % (store.ts). */
  readonly textScale: number
  /**
   * Holds modes over the member's own until the function it returns is called, without keeping
   * them: the harness draws at 200 % text whatever this browser was last set to.
   */
  readonly hold: (modes: Partial<DisplayPreferences>) => () => void
}

const DisplayContext = createContext<Display | null>(null)

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function subscribeToMotion(notify: () => void): () => void {
  const query = window.matchMedia(reducedMotionQuery)
  query.addEventListener('change', notify)
  return () => {
    query.removeEventListener('change', notify)
  }
}

function deviceReducesMotion(): boolean {
  return window.matchMedia(reducedMotionQuery).matches
}

export function DisplayProvider({ children }: { readonly children: ReactNode }) {
  const [stored, setStored] = useState(readPreferences)
  const [held, setHeld] = useState<Partial<DisplayPreferences> | null>(null)
  const preferences = useMemo(() => ({ ...stored, ...held }), [stored, held])
  const deviceReduced = useSyncExternalStore(subscribeToMotion, deviceReducesMotion)
  const [textScale, setTextScale] = useState(() => measureTextScale(document.documentElement))

  useEffect(() => {
    applyPreferences(document.documentElement, preferences)
    setTextScale(measureTextScale(document.documentElement))
  }, [preferences])

  useEffect(() => {
    // The browser's own text size changes the root's font size with no event of its own: a
    // resize is what a member's change of it, or of the window, raises.
    const measure = () => {
      setTextScale(measureTextScale(document.documentElement))
    }
    const follow = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setStored(readPreferences())
    }
    window.addEventListener('resize', measure)
    window.addEventListener('storage', follow)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('storage', follow)
    }
  }, [])

  // Written once the change has been taken, and only a change made here: what another tab wrote
  // is already in storage.
  const changed = useRef(false)
  const set = useCallback((change: Partial<DisplayPreferences>) => {
    changed.current = true
    setStored((current) => ({ ...current, ...change }))
  }, [])
  useEffect(() => {
    if (!changed.current) return
    changed.current = false
    writePreferences(stored)
  }, [stored])

  const hold = useCallback((modes: Partial<DisplayPreferences>) => {
    setHeld(modes)
    return () => {
      setHeld((current) => (current === modes ? null : current))
    }
  }, [])

  const value = useMemo<Display>(
    () => ({
      preferences,
      set,
      reducedMotion: preferences.motion === 'reduced' || deviceReduced,
      textScale,
      hold,
    }),
    [preferences, set, deviceReduced, textScale, hold],
  )
  return <DisplayContext value={value}>{children}</DisplayContext>
}

export function useDisplay(): Display {
  const display = use(DisplayContext)
  if (display === null) throw new Error('useDisplay: no DisplayProvider above this component')
  return display
}
