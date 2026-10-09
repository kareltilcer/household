// What the screens of a household's sync draw alike (A-32, C-57): how a row stands, said three
// ways at once, and the sentence of a tab that holds no replica to speak for this browser.
import type { StatusId } from '@household/icons'
import { StatusIcon } from '@household/icons/web'
import { useState } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { cx } from '../ui/cx.ts'
import type { Own } from './data.ts'
import styles from './Health.module.css'

/** The statuses these screens draw: each a glyph of the status set, in its own token's colour. */
export type Mark = Extract<
  StatusId,
  'synced' | 'pending' | 'syncing' | 'conflict' | 'offline' | 'stale' | 'blocked'
>

/**
 * How a row stands: the status's colour, its glyph and the words, together (N2). The words are
 * the screen's own and say all of it: the status set's own word for `syncing` is *Sending*,
 * which a copy being downloaded again is not.
 */
export function Standing({ mark, words }: { readonly mark: Mark; readonly words: string }) {
  return (
    <p className={styles.standing}>
      <span className={cx(styles.glyph, styles[mark])}>
        <StatusIcon status={mark} />
      </span>
      <span>{words}</span>
    </p>
  )
}

/**
 * What a tab that holds no replica says where a row would be marked as this browser's. One tab
 * keeps a household's replica at a time (sync/ReplicaProvider.tsx), and only that tab can say
 * which row is its own and what it holds now. Where the tab came to this while its member was
 * here it is announced; where the screen opened so, it is read in its place.
 */
export function NoReplica({ own }: { readonly own: Own }) {
  const t = useTranslate()
  // Where the tab first stood once that was known: asking for the household's lock is answered
  // at once, and is no state the screen opened in.
  const stands = own.at === 'opening' ? null : own.at
  const [first, setFirst] = useState(stands)
  if (first === null && stands !== null) setFirst(stands)
  const [moved, setMoved] = useState(false)
  if (!moved && first !== null && stands !== null && stands !== first) setMoved(true)
  if (own.at === 'elsewhere') {
    return (
      <Banner tone="info" title={t('health.elsewhere.title')} announce={moved}>
        {t('health.elsewhere.text')}
      </Banner>
    )
  }
  if (own.at === 'unavailable') {
    return (
      <Banner tone="neutral" title={t('health.unavailable.title')} announce={moved}>
        {t('health.unavailable.text')}
      </Banner>
    )
  }
  return null
}
