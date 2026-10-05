// Banner (02-components §2): a state of the household or of a screen, said in words above or in
// place of what it is about, with the action that answers it. Its tone is a colour, a glyph and
// the sentence itself; nothing here is told by the colour alone. The same shape carries a screen's
// error, a rejected write's reason, a withdrawn row's sentence and the read-only notice; which
// entitlement states have a banner is billing's to say (item 27).
import { controls } from '@household/icons'
import { BaseIcon, StatusIcon } from '@household/icons/web'
import { useEffect, useState, type ReactNode } from 'react'
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
   * One that was there when the screen opened is read in its place and is not announced. A
   * failure is announced at once, as an alert; any other tone politely, its words drawn a moment
   * after the banner itself.
   */
  readonly announce?: boolean
}

/**
 * Whether a region that is announced politely may hold its words yet. Assistive technology says
 * what is put into a polite region that is in the document already, and need not say a region
 * that arrives with its words in it; an alert it says as it arrives. So such a region is drawn
 * first and its words once it has been, two frames later, which is how Radix has a toast said.
 */
function useDrawnFirst(waits: boolean): boolean {
  const [drawn, setDrawn] = useState(!waits)
  useEffect(() => {
    if (!waits) return undefined
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setDrawn(true)
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [waits])
  return drawn || !waits
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
  const urgent = tone === 'danger'
  const worded = useDrawnFirst(announce && !urgent)
  return (
    <div
      className={cx(styles.banner, styles[tone])}
      role={announce ? (urgent ? 'alert' : 'status') : undefined}
    >
      <BaseIcon name={glyphs[tone]} className={styles.glyph} />
      <div className={styles.text}>
        {worded ? (
          <>
            {title === undefined ? null : <p className={styles.title}>{title}</p>}
            <div>{children}</div>
            {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
          </>
        ) : null}
      </div>
      {onDismiss === undefined ? null : (
        <IconButton
          label={t(controls.dismiss.labelKey)}
          icon={<BaseIcon name={controls.dismiss.glyph.id} />}
          onClick={onDismiss}
        />
      )}
    </div>
  )
}

/**
 * The offline bar (02-components §2, 06-clients §5): persistent, unobtrusive, and never in the
 * way of what it sits above. A read looks the same with it as without. It is drawn when the
 * connection goes and is said politely then, so it is drawn before its sentence, as a banner
 * that is announced is.
 */
export function OfflineBar() {
  const t = useTranslate()
  const worded = useDrawnFirst(true)
  return (
    <div className={styles.offline} role="status">
      <span className={styles.offlineGlyph}>
        <StatusIcon status="offline" />
      </span>
      {worded ? <span>{t('ui.offline.bar')}</span> : null}
    </div>
  )
}
