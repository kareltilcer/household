// The key–value detail block (02-components §3): the pane beside every asset, document and
// service. Labels at the start, values at the end, mono for anything numeric. A value that does
// not exist is a dash with a word, never an empty cell: an empty cell reads as a fault.
import type { ReactNode } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './KeyValue.module.css'
import { cx } from './cx.ts'

export interface Pair {
  readonly key: string
  /**
   * Left out, or anything that would be drawn as nothing, null, an empty string or `false`:
   * nothing is recorded, which the block says in a word.
   */
  readonly value?: ReactNode
  readonly numeric?: boolean
}

/** Whether React would draw nothing for `value`: the empty cell the block never shows. */
function drawsNothing(value: ReactNode): boolean {
  return value === undefined || value === null || value === '' || typeof value === 'boolean'
}

export function KeyValue({ pairs }: { readonly pairs: readonly Pair[] }) {
  const t = useTranslate()
  return (
    <dl className={styles.block}>
      {pairs.map((pair, index) => {
        const missing = drawsNothing(pair.value)
        return (
          // A pair is its place in the block: two may carry one label, two phones or two owners.
          <div key={index} className={styles.pair}>
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
