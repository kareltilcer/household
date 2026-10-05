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
 * Whether `syncing` has gone on long enough to be shown: past the tokens' threshold, and not
 * before (06-clients §5: a progress indication only when it takes longer than a moment).
 */
function useLongEnough(active: boolean): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!active) return undefined
    const timer = setTimeout(() => {
      setElapsed(true)
    }, thresholds['sync-indicate-after'])
    return () => {
      clearTimeout(timer)
      setElapsed(false)
    }
  }, [active])
  return active && elapsed
}

export interface SyncMarkProps {
  readonly state: SyncState
  readonly words?: 'inline' | 'hidden'
  /**
   * Opens what the state is about: the comparison for a conflict, the reason for a rejection.
   * With it the mark is a control, named for what opening it does.
   */
  readonly onOpen?: () => void
  /** The row's name, which a conflict's control says: "Two versions of {name}". */
  readonly name?: string
}

export function SyncMark({ state, words = 'inline', onOpen, name }: SyncMarkProps) {
  const t = useTranslate()
  const shown = useLongEnough(state === 'syncing')
  if (state === 'syncing' && !shown) return null
  if (onOpen === undefined) return <StatusMark status={state} words={words} />
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
