// Skeleton (02-components §1): the loading state where the shape is known, matched to what it
// replaces, never a spinner. It says "Loading" to assistive technology once, and its bars are
// decoration. Under reduced motion it is a still shape (01-foundations §7).
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './Skeleton.module.css'

/** A bar of the shape: its width as a percentage of the body's, and its height in rem. */
export type SkeletonBar = readonly [width: number, height: number]

export interface SkeletonProps {
  /** The bars, top to bottom, as the content they stand for is laid out. */
  readonly bars: readonly SkeletonBar[]
}

export function Skeleton({ bars }: SkeletonProps) {
  const t = useTranslate()
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label={t('ui.loading')}>
      {bars.map(([width, height], index) => (
        <span
          // The bars are a fixed shape with no identity of their own: their place is their key.
          key={index}
          className={styles.bar}
          style={{ inlineSize: `${String(width)}%`, blockSize: `${String(height)}rem` }}
        />
      ))}
    </div>
  )
}
