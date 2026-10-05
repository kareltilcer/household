// A status, said three ways at once (N2, 06-accessibility §1): its colour token, its glyph and its
// word, in the member's language. The word is drawn where there is room and is in the accessible
// tree where there is not: a glyph is never left to say it alone.
//
// The sync mark (02-components §4.2) is the status of a row that is pending, syncing, in conflict
// or rejected. A row in sync carries no mark: the absence of one is that state.
import { controls, statusGlyphs, type StatusId } from '@household/icons'
import { StatusIcon } from '@household/icons/web'
import { cssVar, thresholds } from '@household/tokens'
import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import a11y from './a11y.module.css'
import styles from './StatusMark.module.css'
import { cx } from './cx.ts'

export interface StatusMarkProps {
  readonly status: StatusId
  /** Whether the word is drawn beside the glyph (the default) or only said. */
  readonly words?: 'inline' | 'hidden'
  readonly className?: string | undefined
}

export function StatusMark({ status, words = 'inline', className }: StatusMarkProps) {
  const t = useTranslate()
  const glyph = statusGlyphs[status]
  return (
    <span className={cx(styles.mark, className)} data-status={status}>
      <span className={styles.glyph} style={{ color: cssVar(glyph.token) }}>
        <StatusIcon status={status} />
      </span>
      <span className={words === 'inline' ? styles.word : a11y.visuallyHidden}>
        {t(glyph.labelKey)}
      </span>
    </span>
  )
}

/** The states a row's own write can be in, other than in sync. */
export const syncStates = ['pending', 'syncing', 'conflict', 'rejected'] as const
export type SyncState = (typeof syncStates)[number]

/**
 * The states whose mark opens something: a conflict its comparison, a rejection its reason. A
 * write that is pending or syncing has nothing to open (02-components §0).
 */
const opens: ReadonlySet<SyncState> = new Set(['conflict', 'rejected'])

/**
 * How long until a sync that began at `since` has taken longer than a moment, the tokens'
 * threshold: nothing or less once it has. One that nothing dates begins now.
 */
function untilShown(since: number | undefined): number {
  return since === undefined
    ? thresholds['sync-indicate-after']
    : since + thresholds['sync-indicate-after'] - Date.now()
}

/**
 * Whether `syncing` has gone on long enough to be shown: past the tokens' threshold, and not
 * before (06-clients §5: a progress indication only when it takes longer than a moment).
 */
function useLongEnough(active: boolean, since: number | undefined): boolean {
  // Drawn in the middle of a sync that is already long, it is long enough from the first.
  const [elapsed, setElapsed] = useState(() => active && untilShown(since) <= 0)
  useEffect(() => {
    if (!active) return undefined
    const timer = setTimeout(
      () => {
        setElapsed(true)
      },
      Math.max(0, untilShown(since)),
    )
    return () => {
      clearTimeout(timer)
      setElapsed(false)
    }
  }, [active, since])
  return active && elapsed
}

export interface SyncMarkProps {
  readonly state: SyncState
  readonly words?: 'inline' | 'hidden'
  /**
   * Opens what the state is about: the comparison for a conflict, the reason for a rejection.
   * With it the mark of such a state is a control, named for what opening it does. The mark of
   * a write that is pending or syncing stays words, whatever it is given: there is nothing of
   * it to open.
   */
  readonly onOpen?: (() => void) | undefined
  /** The row's name, which a conflict's control says: "Two versions of {name}". */
  readonly name?: string
  /**
   * When the write began to sync, as `Date.now()` counts: the moment a sync is given before it
   * is shown is measured from then. Where nothing says, it is measured from when this mark
   * first drew the state, and a row drawn again in the middle of a long sync waits it out again.
   */
  readonly since?: number | undefined
}

export function SyncMark({ state, words = 'inline', onOpen, name, since }: SyncMarkProps) {
  const t = useTranslate()
  const shown = useLongEnough(state === 'syncing', since)
  if (state === 'syncing' && !shown) return null
  if (onOpen === undefined || !opens.has(state)) {
    return <StatusMark status={state} words={words} />
  }
  const word = t(statusGlyphs[state].labelKey)
  const label =
    state === 'conflict' && name !== undefined
      ? t(controls.conflict.labelKey, { name })
      : t(controls.sync_state.labelKey, { state: word })
  return (
    <button type="button" className={styles.control} aria-label={label} onClick={onOpen}>
      <span className={styles.glyph} style={{ color: cssVar(statusGlyphs[state].token) }}>
        <StatusIcon status={state} />
      </span>
      {words === 'inline' ? <span className={styles.word}>{word}</span> : null}
    </button>
  )
}
