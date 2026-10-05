// The list row (02-components §3), the workhorse: a title, an optional secondary line, an optional
// module chip and member avatar, the sync mark of a row whose own write is not in sync yet, and a
// trailing action. A row in sync carries no mark. Under compact density the secondary line is not
// drawn: its content belongs in a column or the detail pane (01-foundations §6).
import type { ReactNode } from 'react'
import styles from './ListRow.module.css'
import { SyncMark, type SyncState } from './StatusMark.tsx'

export interface ListProps {
  /** What the list is of, for assistive technology. */
  readonly label: string
  readonly children: ReactNode
}

export function List({ label, children }: ListProps) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  )
}

export interface ListRowProps {
  readonly title: string
  readonly secondary?: string | undefined
  readonly avatar?: ReactNode
  readonly chip?: ReactNode
  /** The state of the row's own write, where it is not in sync. */
  readonly mark?: SyncState | undefined
  /**
   * Opens what the mark is about: the comparison for a conflict, the reason for a rejection. A
   * row that is pending or syncing has nothing to open, and its mark stays words.
   */
  readonly onOpenMark?: (() => void) | undefined
  /** When the row's write began to sync, as `Date.now()` counts, where its owner knows. */
  readonly syncingSince?: number | undefined
  /**
   * What can be done to the row. A member who may not write is given none: it is absent, not
   * disabled (03-patterns §2).
   */
  readonly trailing?: ReactNode
}

export function ListRow({
  title,
  secondary,
  avatar,
  chip,
  mark,
  onOpenMark,
  syncingSince,
  trailing,
}: ListRowProps) {
  return (
    <li className={styles.row}>
      {avatar}
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        {secondary === undefined ? null : <span className={styles.secondary}>{secondary}</span>}
        {chip === undefined ? null : <span>{chip}</span>}
      </div>
      {mark === undefined ? null : (
        <SyncMark state={mark} name={title} onOpen={onOpenMark} since={syncingSince} />
      )}
      {trailing}
    </li>
  )
}
