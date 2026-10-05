// The teaching empty state (03-patterns §4, 06-clients §3): one sentence that says what the place
// is for, one example that is marked as one, and one action. The illustration is decoration: the
// sentence says everything it shows, and at 200 % text it is not drawn at all (the kit's first
// rule, which leaves the hiding to the screen, which knows the text scale).
import type { CompositionId } from '@household/icons'
import { Illustration } from '@household/icons/web'
import type { ReactNode } from 'react'
import { useDisplay } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './EmptyState.module.css'

/** The text scale from which the illustration gives its room to the sentence. */
const illustrationUntil = 2

export interface EmptyStateProps {
  /** What this is for, in the member's own words. */
  readonly sentence: string
  /** One real-looking example: a row, a sentence. It is drawn inside a frame that says "Example". */
  readonly example?: ReactNode
  /** The one action. A member who may not write here is given none (03-patterns §2). */
  readonly action?: ReactNode
  readonly composition?: CompositionId
}

export function EmptyState({ sentence, example, action, composition }: EmptyStateProps) {
  const t = useTranslate()
  const { textScale } = useDisplay()
  return (
    <div className={styles.empty}>
      {composition !== undefined && textScale < illustrationUntil ? (
        <Illustration composition={composition} className={styles.illustration} />
      ) : null}
      <p className={styles.sentence}>{sentence}</p>
      {example === undefined ? null : (
        <div className={styles.example}>
          <span className={styles.tag}>{t('ui.empty.example')}</span>
          <div>{example}</div>
        </div>
      )}
      {action === undefined ? null : <div>{action}</div>}
    </div>
  )
}
