// Banner (02-components §2): a state of the household or of a screen, said in words above or in
// place of what it is about, with the action that answers it. Its tone is a colour, a glyph and
// the sentence itself; nothing here is told by the colour alone. The same shape carries a screen's
// error, a rejected write's reason, a withdrawn row's sentence and the read-only notice; which
// entitlement states have a banner is billing's to say (item 27).
import { BaseIcon, StatusIcon } from '@household/icons/web'
import type { ReactNode } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './Banner.module.css'
import { IconButton } from './Button.tsx'
import { cx } from './cx.ts'

export type BannerTone = 'neutral' | 'info' | 'warning' | 'danger'

const glyphs = {
  neutral: 'info',
  info: 'info',
  warning: 'alert-triangle',
  danger: 'alert-circle',
} as const

export interface BannerProps {
  readonly tone: BannerTone
  /** What the state is, in two or three words, where the sentence alone would not say. */
  readonly title?: string | undefined
  /** The sentence: what happened, and what was not lost. */
  readonly children: ReactNode
  /** What answers it: one action for an error, retry, edit and discard for a rejected write. */
  readonly actions?: ReactNode
  /** Lets the member put it away. A banner that must stay has none. */
  readonly onDismiss?: () => void
  /**
   * Whether it is announced when it appears: a state that arrived while the member was here.
   * One that was there when the screen opened is read in its place and is not announced.
   */
  readonly announce?: boolean
}

export function Banner({
  tone,
  title,
  children,
  actions,
  onDismiss,
  announce = false,
}: BannerProps) {
  const t = useTranslate()
  return (
    <div
      className={cx(styles.banner, styles[tone])}
      role={announce ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      <BaseIcon name={glyphs[tone]} className={styles.glyph} />
      <div className={styles.text}>
        {title === undefined ? null : <p className={styles.title}>{title}</p>}
        <div>{children}</div>
        {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
      </div>
      {onDismiss === undefined ? null : (
        <IconButton label={t('ui.dismiss')} icon={<BaseIcon name="x" />} onClick={onDismiss} />
      )}
    </div>
  )
}

/**
 * The offline bar (02-components §2, 06-clients §5): persistent, unobtrusive, and never in the
 * way of what it sits above. A read looks the same with it as without.
 */
export function OfflineBar() {
  const t = useTranslate()
  return (
    <div className={styles.offline} role="status">
      <span className={styles.offlineGlyph}>
        <StatusIcon status="offline" />
      </span>
      <span>{t('ui.offline.bar')}</span>
    </div>
  )
}
