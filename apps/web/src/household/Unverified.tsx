// *Verify your email first* (A-4, FR-ID1): what a household's screen draws in the place of what
// an unverified account is refused, where it refuses and no earlier. An unverified account has a
// working household; what waits for a proven address is what reaches beyond it: inviting
// somebody, joining another household, giving a child profile a sign-in of its own. The screen
// says why in its own sentence, and offers the link again (account/VerifyResend.tsx).
//
// The block lifts by itself: the account is read again each time the page is looked at
// (session/SessionProvider.tsx), which is when an address proven in another tab is noticed.
//
// Whether a refusal is this one, and the server's word on it taken, are the account's
// (account/unverified.ts), which its own screens import with no word of a household's.
import { VerifyResend } from '../account/VerifyResend.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import styles from '../account/Settings.module.css'

export { isUnverified, useMarkUnverified } from '../account/unverified.ts'

export interface UnverifiedProps {
  /** Why this, of all things, waits for a verified address: the screen's own sentence. */
  readonly why: string
  /**
   * Whether it is said as it arrives: where it is the server's answer to a press on this screen.
   * One the screen opened with is read in its place.
   */
  readonly announce?: boolean
}

export function Unverified({ why, announce = false }: UnverifiedProps) {
  const t = useTranslate()
  const email = useMe().email ?? null
  return (
    <div className={styles.group}>
      <Banner tone="warning" title={t('household.unverified.title')} announce={announce}>
        {why} {t('household.unverified.rest')}
      </Banner>
      {email === null ? null : <VerifyResend email={email} />}
    </div>
  )
}
