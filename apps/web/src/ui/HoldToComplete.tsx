// Hold-to-complete (02-components §4.1, 06-clients §3): a 2000 ms press-and-hold, carried from
// `home`, for a completion that is expensive to undo. Its two non-negotiables are both here.
//
// - A visible progress indicator for the whole hold: a ring that fills. Under reduced motion it
//   fills in steps, not in a sweep, since it is the only sign that the gesture is working.
// - An immediate path for the keyboard and for assistive technology, which needs no hold. The
//   control they meet is a plain button, named for what it completes, and activating it completes
//   at once. The ring a pointer holds is hidden from them: a gesture that is the only way to do
//   something is an accessibility failure.
//
// A release before the time is up does nothing and says so. A press that is not a hold never
// reaches the row the control sits in.
import { BaseIcon } from '@household/icons/web'
import { reducedMotion, thresholds } from '@household/tokens'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useDisplay } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import a11y from './a11y.module.css'
import styles from './HoldToComplete.module.css'
import { cx } from './cx.ts'

export type HoldPhase = 'idle' | 'holding' | 'released' | 'completing' | 'completed' | 'failed'

export interface HoldToCompleteProps {
  /** What it completes, by name: "Complete Take out the bins". */
  readonly label: string
  /**
   * Completes it. A promise it returns is waited for: the control says it is completing, then
   * how it went. Anything else it returns is not read.
   */
  readonly onComplete: () => unknown
  readonly className?: string | undefined
}

export function HoldToComplete({ label, onComplete, className }: HoldToCompleteProps) {
  const t = useTranslate()
  const display = useDisplay()
  const [phase, setPhase] = useState<HoldPhase>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])

  const settled = phase === 'completing' || phase === 'completed'

  const complete = useCallback(() => {
    clearTimeout(timer.current)
    setPhase('completing')
    const finish = (next: HoldPhase) => {
      if (mounted.current) setPhase(next)
    }
    let result: unknown
    try {
      result = onComplete()
    } catch {
      finish('failed')
      return
    }
    if (result instanceof Promise) {
      result.then(
        () => {
          finish('completed')
        },
        () => {
          finish('failed')
        },
      )
    } else {
      finish('completed')
    }
  }, [onComplete])

  const press = (event: PointerEvent) => {
    // The press is the control's own: the row it sits in does not open under it.
    event.stopPropagation()
    if (settled || event.button !== 0) return
    clearTimeout(timer.current)
    setPhase('holding')
    timer.current = setTimeout(complete, thresholds['hold-to-complete'])
  }
  const release = () => {
    if (phase !== 'holding') return
    clearTimeout(timer.current)
    setPhase('released')
  }

  const word =
    phase === 'released'
      ? t('ui.hold.keep_holding')
      : phase === 'completing'
        ? t('ui.hold.completing')
        : phase === 'completed'
          ? t('ui.hold.completed')
          : phase === 'failed'
            ? t('ui.hold.failed')
            : undefined

  return (
    <span className={cx(styles.hold, className)} data-phase={phase}>
      <span
        className={styles.target}
        aria-hidden="true"
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onContextMenu={(event) => {
          // A long press on a touch screen is this gesture, not a request for a menu.
          event.preventDefault()
        }}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <svg className={styles.ring} viewBox="0 0 44 44">
          <circle className={styles.track} cx="22" cy="22" r="19" />
          <circle
            className={styles.fill}
            cx="22"
            cy="22"
            r="19"
            pathLength="100"
            style={
              display.reducedMotion
                ? { animationTimingFunction: `steps(${String(reducedMotion.holdSteps)}, end)` }
                : undefined
            }
          />
        </svg>
        <BaseIcon name="check" className={styles.check} />
      </span>
      <button
        type="button"
        className={a11y.visuallyHidden}
        aria-disabled={settled || undefined}
        onClick={(event) => {
          event.stopPropagation()
          if (!settled) complete()
        }}
      >
        {label}
      </button>
      <span className={styles.word} role="status">
        {word}
      </span>
    </span>
  )
}
