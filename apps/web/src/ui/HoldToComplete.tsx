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
// A release before the time is up does nothing and says so, for as long as a toast would stay,
// and the control is then idle again, as it was. A press that is not a hold never reaches the row
// the control sits in.
//
// Completed, it stays so for as long as it is drawn, and takes no second completion: what it
// knows is what it did, and not what became of it. A row that is to be completed again, after an
// undo or a write the server refused, draws a control of its own for it, by a `key` that changes
// with what is to be completed. Whether the control should take its owner's word for what is
// complete is its first screen's to say (ADR 0025).
import { BaseIcon } from '@household/icons/web'
import { reducedMotion, thresholds } from '@household/tokens'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
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
  // The phase as it is now, which is what a pointer's handler asks. The hold's timer fires
  // between two draws, and a pointer let go in that instant, as the ring fills, would be told by
  // the last draw that it is held still: the release would be taken for an early one, its word
  // put over a completion that has run, and the control made idle again to complete it twice.
  const now = useRef<HoldPhase>('idle')
  const turn = (next: HoldPhase) => {
    now.current = next
    setPhase(next)
  }
  // The one timer the control has: the hold's while it is held, and the word's after a release.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mounted = useRef(true)
  // What completes it, as its owner last said. The hold's timer is set two seconds before it
  // fires, and a row drawn again in between, by a sync that brought it a newer version, has
  // handed down another: the completion is the one asked at the end of the hold.
  const latest = useRef(onComplete)
  useLayoutEffect(() => {
    latest.current = onComplete
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])

  /** Whether a phase is one that takes no hold and no second completion. */
  const settled = (at: HoldPhase) => at === 'completing' || at === 'completed'

  const complete = () => {
    clearTimeout(timer.current)
    turn('completing')
    const finish = (next: HoldPhase) => {
      if (mounted.current) turn(next)
    }
    let result: unknown
    try {
      result = latest.current()
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
  }

  const press = (event: PointerEvent) => {
    // The press is the control's own: the row it sits in does not open under it.
    event.stopPropagation()
    if (settled(now.current) || event.button !== 0) return
    clearTimeout(timer.current)
    turn('holding')
    timer.current = setTimeout(complete, thresholds['hold-to-complete'])
  }
  const release = () => {
    // Let go of a hold, and of nothing else: once the time is up the hold is over, and the
    // pointer's going is no early release, whether or not the control has been drawn since.
    if (now.current !== 'holding') return
    clearTimeout(timer.current)
    turn('released')
    // It says to keep holding for as long as a toast would say it, and is then as it was
    // (02-components §4.1: released early, it returns to idle). A row touched once is not left
    // saying it.
    timer.current = setTimeout(() => {
      turn('idle')
    }, thresholds['toast-dwell'])
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
        aria-disabled={settled(phase) || undefined}
        onClick={(event) => {
          event.stopPropagation()
          if (!settled(now.current)) complete()
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
