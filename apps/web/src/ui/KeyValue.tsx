// The key–value detail block (02-components §3): the pane beside every asset, document and
// service. Labels at the start, values at the end, mono for anything numeric. A value that does
// not exist is a dash with a word, never an empty cell: an empty cell reads as a fault.
import type { ReactNode } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './KeyValue.module.css'
import { cx } from './cx.ts'

export interface Pair {
  readonly key: string
  /** Left out, or null: nothing is recorded, which the block says in a word. */
  readonly value?: ReactNode
  readonly numeric?: boolean
}

export function KeyValue({ pairs }: { readonly pairs: readonly Pair[] }) {
  const t = useTranslate()
  return (
    <dl className={styles.block}>
      {pairs.map((pair) => {
        const missing = pair.value === undefined || pair.value === null
        return (
          <div key={pair.key} className={styles.pair}>
            <dt className={styles.key}>{pair.key}</dt>
            <dd
              className={cx(
                styles.value,
                pair.numeric === true && !missing && styles.numeric,
                missing && styles.missing,
              )}
            >
              {missing ? (
                <>
                  <span aria-hidden="true">—</span> {t('ui.kv.none')}
                </>
              ) : (
                pair.value
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
