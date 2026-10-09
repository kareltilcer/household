// *Verify your email first* (A-4, FR-ID1): what a household's screen draws in the place of what
// an unverified account is refused, where it refuses and no earlier. An unverified account has a
// working household; what waits for a proven address is what reaches beyond it: inviting
// somebody, joining another household, giving a child profile a sign-in of its own. The screen
// says why in its own sentence, and offers the link again (account/VerifyResend.tsx).
//
// The block lifts by itself: the account is read again each time the page is looked at
// (session/SessionProvider.tsx), which is when an address proven in another tab is noticed.
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { VerifyResend } from '../account/VerifyResend.tsx'
import { problemIn } from '../api/problem.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { meKey, useMe, type Me } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import styles from '../account/Settings.module.css'

/** Whether `error` is the server's refusal of an account whose address is not verified. */
export function isUnverified(error: unknown): boolean {
  return problemIn(error)?.code === 'account_unverified'
}

/**
 * Takes the server's word that the account is not verified, whatever this page had read of it:
 * a screen calls it where a write of its own was refused so, and then draws `Unverified` in the
 * write's place, as it does for an account it read as unverified from the first.
 */
export function useMarkUnverified(): () => void {
  const queries = useQueryClient()
  return useCallback(() => {
    queries.setQueryData<Me>(meKey, (was) =>
      was === undefined ? was : { ...was, email_verified: false },
    )
  }, [queries])
}

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
