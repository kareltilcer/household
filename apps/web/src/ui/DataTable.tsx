// The data table (02-components §3): sortable, paged by a cursor and never by page numbers, its
// horizontal scroll contained in a region of its own, and its numeric columns in the mono face,
// right-aligned, with tabular figures. A table defaults to compact (DD-3), which is a change of
// column density and not of row height, and the member's own preference overrides it
// (01-foundations §6).
import { BaseIcon } from '@household/icons/web'
import type { ReactNode } from 'react'
import { useDisplay } from '../display/DisplayProvider.tsx'
import type { DensityPreference } from '../display/modes.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import a11y from './a11y.module.css'
import { Button } from './Button.tsx'
import styles from './DataTable.module.css'
import { SyncMark, type SyncState } from './StatusMark.tsx'
import { cx } from './cx.ts'

export interface Column<Row> {
  readonly id: string
  readonly header: string
  /** Amounts, quantities and dates set in figures: mono, tabular, aligned to the end. */
  readonly numeric?: boolean
  readonly sortable?: boolean
  readonly cell: (row: Row) => ReactNode
}

export interface Sort {
  readonly column: string
  readonly direction: 'ascending' | 'descending'
}

export interface DataTableProps<Row> {
  /** What the table is of: its name to assistive technology, and its scrolling region's. */
  readonly caption: string
  readonly columns: readonly Column<Row>[]
  readonly rows: readonly Row[]
  readonly rowKey: (row: Row) => string
  readonly sort?: Sort
  /** Asked to sort by a column: the same column again turns its direction. */
  readonly onSort?: (sort: Sort) => void
  /** The state of a row's own write, where it is not in sync. */
  readonly mark?: (row: Row) => SyncState | undefined
  /** Fetches the rows after the last one. With it the table ends in a control that asks for them. */
  readonly onMore?: () => void
  /** The density this table is drawn in while the member has chosen none. Compact, as a table is. */
  readonly density?: Exclude<DensityPreference, 'auto'>
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  mark,
  onMore,
  density = 'compact',
}: DataTableProps<Row>) {
  const t = useTranslate()
  const { preferences } = useDisplay()
  const marked = mark !== undefined && rows.some((row) => mark(row) !== undefined)

  return (
    <div className={styles.table}>
      <div
        className={styles.scroll}
        role="region"
        aria-label={caption}
        // A region that scrolls is reached by the keyboard, which scrolls it.
        tabIndex={0}
        // The member's own choice is on the root and reaches here; without one, the table's.
        data-density={preferences.density === 'auto' ? density : undefined}
      >
        <table className={styles.grid}>
          <caption className={a11y.visuallyHidden}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const sorted = sort?.column === column.id ? sort.direction : undefined
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={cx(styles.head, column.numeric === true && styles.numeric)}
                    aria-sort={sorted}
                  >
                    {column.sortable === true && onSort !== undefined ? (
                      <button
                        type="button"
                        // Named by the column's own words, so the head reads as the column's
                        // name; `aria-sort` on the cell says which way it is sorted.
                        className={styles.sort}
                        onClick={() => {
                          onSort({
                            column: column.id,
                            direction: sorted === 'ascending' ? 'descending' : 'ascending',
                          })
                        }}
                      >
                        <span>{column.header}</span>
                        <BaseIcon
                          name={
                            sorted === 'ascending'
                              ? 'chevron-up'
                              : sorted === 'descending'
                                ? 'chevron-down'
                                : 'arrow-up-down'
                          }
                          size={16}
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
              {marked ? (
                <th scope="col" className={styles.head}>
                  <span className={a11y.visuallyHidden}>{t('ui.table.state')}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = mark?.(row)
              return (
                <tr key={rowKey(row)} className={styles.row}>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cx(styles.cell, column.numeric === true && styles.numeric)}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {marked ? (
                    <td className={styles.cell}>
                      {state === undefined ? null : <SyncMark state={state} />}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {onMore === undefined ? null : (
        <div>
          <Button variant="ghost" onClick={onMore}>
            {t('ui.table.more')}
          </Button>
        </div>
      )}
    </div>
  )
}
