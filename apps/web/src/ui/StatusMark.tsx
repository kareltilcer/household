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

/** What a mark keeps of the time, to say when a sync has gone on for longer than a moment. */
interface Watch {
  /** What it was last told: whether the state is `syncing`, and when the write began. */
  readonly active: boolean
  readonly since: number | undefined
  /** When it first drew the state, and nothing while it draws another. */
  readonly drawn: number | undefined
  /** The latest time it knows has come: what the clock last read, or the time it waited for. */
  readonly reached: number
}

/**
 * Whether `syncing` has gone on long enough to be shown: past the tokens' threshold, and not
 * before (06-clients §5: a progress indication only when it takes longer than a moment). The
 * moment is counted from `since`, and from when the mark first drew the state where nothing
 * dates it.
 */
function useLongEnough(active: boolean, began: number | undefined): boolean {
  // A time that is no time dates nothing: what a date that did not parse comes to. It is equal
  // to no number, itself included, so taken as it is it would look like something new at every
  // draw, be asked about again at every draw, and take the screen down with the mark.
  const since = began !== undefined && Number.isFinite(began) ? began : undefined
  const [watch, setWatch] = useState<Watch>(() => {
    const now = Date.now()
    return { active, since, drawn: active ? now : undefined, reached: now }
  })
  // Told something else, it reads the clock again as it is drawn, and so knows at once whether
  // a sync it is now told of is long already.
  if (watch.active !== active || watch.since !== since) {
    const now = Date.now()
    setWatch({
      active,
      since,
      drawn: active ? (watch.drawn ?? now) : undefined,
      reached: Math.max(watch.reached, now),
    })
  }
  // When the sync has taken longer than a moment.
  const due =
    watch.drawn === undefined
      ? undefined
      : (watch.since ?? watch.drawn) + thresholds['sync-indicate-after']
  useEffect(() => {
    if (due === undefined || due <= watch.reached) return undefined
    const timer = setTimeout(
      () => {
        setWatch((was) => ({ ...was, reached: Math.max(was.reached, due) }))
      },
      Math.max(0, due - Date.now()),
    )
    return () => {
      clearTimeout(timer)
    }
  }, [due, watch.reached])
  // Shown once the time it is due at has come, and that is all that is asked: no flag is put
  // down and raised again when what the mark is told changes. So a mark that is shown stays
  // shown when its owner learns when the write began, and one drawn in the middle of a long sync
  // is shown from the first, under React's strict mode too.
  return due !== undefined && due <= watch.reached
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
    <button
      type="button"
      className={styles.control}
      aria-label={label}
      onClick={() => {
        onOpen()
      }}
    >
      <span className={styles.glyph} style={{ color: cssVar(statusGlyphs[state].token) }}>
        <StatusIcon status={state} />
      </span>
      {words === 'inline' ? <span className={styles.word}>{word}</span> : null}
    </button>
  )
}
