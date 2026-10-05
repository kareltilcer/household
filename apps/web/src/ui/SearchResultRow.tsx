// The search result row (02-components §3): one shape for a result of any module, as the
// contract's SearchHit gives it. The entity type is what tells a board from a card, and this row
// is the only place that can be shown. A snippet and a path may each be null, and the row reads
// as a result without either.
import type { ModuleId } from '@household/tokens'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { ModuleChip } from './Chip.tsx'
import styles from './SearchResultRow.module.css'

export interface SearchResultRowProps {
  readonly module: ModuleId
  /** The kind of thing it is, in words: "Document", "Card". */
  readonly entityType: string
  readonly title: string
  readonly snippet?: string | null | undefined
  /** Where it is kept: "Documents / House / Insurance". */
  readonly path?: string | null | undefined
  /** When it was last changed: the instant the contract's `updated_at` carries. */
  readonly updatedAt: string
  /** The zone the day of that instant is told in: the household's. */
  readonly timeZone: string
}

export function SearchResultRow({
  module,
  entityType,
  title,
  snippet,
  path,
  updatedAt,
  timeZone,
}: SearchResultRowProps) {
  const t = useTranslate()
  const format = useFormat()
  return (
    <div className={styles.result}>
      <p className={styles.kind}>
        <ModuleChip module={module} />
        <span>{entityType}</span>
      </p>
      <p className={styles.title}>{title}</p>
      {snippet === undefined || snippet === null ? null : (
        <p className={styles.snippet}>{snippet}</p>
      )}
      <p className={styles.meta}>
        {path === undefined || path === null ? null : <span>{path}</span>}
        <span>{t('ui.search.updated', { day: format.dayOf(updatedAt, timeZone) })}</span>
      </p>
    </div>
  )
}
