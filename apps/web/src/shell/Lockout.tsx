// The suspended lockout (A-31; PRD 04 §3; DD-15, D-115, D-147, D-162; 03-patterns §3): what a
// member is drawn at the address of a household the platform suspended. It is the one screen of
// the product that shows nothing of a household: every route of a suspended household answers
// `404` (D-115), so there is nothing to show, and what is said here is what the member's own
// list of households still names it by, its name, the day it was suspended and the notice that
// went with it. The notice is the platform's own words to the household, shown as written.
//
// It says that the suspension is the platform's, since when, what the owners were told and that
// each of them was emailed it, that nothing was deleted, and that nothing can be exported while
// it lasts: said, and no button that could only fail (DD-15). From here a member goes to another
// household of theirs, where they have one that opens, or signs out. Every member reads the
// same, whatever they were in the household.
//
// What the prototype drew and this does not: a cause it guessed at (*while a report is looked
// into*), where the notice itself is shown; *everybody was emailed*, where it is the owners
// (D-147); the activity log, which nobody can read while this lasts; and *write to support*,
// there being no address in the product to write to yet, so support is named and not linked.
//
// A-31 has one state, *populated*. The list that names the household is the shell's to read
// (HouseholdShell.tsx), which draws its loading and its failure; nothing here is written, so
// nothing is pending, refused or in conflict, and with no household drawn there is no offline
// bar and no banner above it.
import { Link } from 'react-router'
import { useOwnZone } from '../account/common.ts'
import { inHousehold } from '../app/paths.ts'
import page from '../app/Root.module.css'
import { usePageTitle } from '../app/title.ts'
import type { HouseholdSummary } from '../household/households.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { cx } from '../ui/cx.ts'
import { SignOut } from './AccountNavigation.tsx'
import styles from './Entitlement.module.css'
import { switchedByMember } from './Switcher.tsx'

export interface LockoutProps {
  /** The suspended household, as the member's list of households names it. */
  readonly household: HouseholdSummary
  /** The member's other households that open, in the server's order. */
  readonly others: readonly HouseholdSummary[]
}

export interface LockoutViewProps extends LockoutProps {
  /** The zone the day of the suspension is said in: the member's own, there being no household. */
  readonly zone: string
  /**
   * Whether it is drawn under a title that is not its own, a dev page's: its heading is then no
   * `<h1>`, a page having one.
   */
  readonly nested?: boolean
}

/** The lockout under whatever names the page: the shell's own, or a dev page's fixture. */
export function LockoutView({ household, others, zone, nested = false }: LockoutViewProps) {
  const t = useTranslate()
  const format = useFormat()
  const Heading = nested ? 'h3' : 'h1'
  const since = household.entitlement?.suspended_at ?? null
  const notice = household.entitlement?.suspension_notice ?? ''
  return (
    <div className={page.page}>
      <Heading className={page.title}>
        {t('entitlement.suspended.title', { household: household.name ?? '' })}
      </Heading>
      {since === null ? null : (
        <p className={page.lead}>
          {t('entitlement.suspended.since', { day: format.dayOf(since, zone) })}
        </p>
      )}
      {notice.trim() === '' ? null : (
        <div className={styles.block}>
          {/* Read in its place: it was so when the address was opened. */}
          <Banner tone="danger" title={t('entitlement.suspended.notice')}>
            <p className={styles.written}>{notice}</p>
          </Banner>
        </div>
      )}
      <p className={styles.text}>{t('entitlement.suspended.kept')}</p>
      <p className={styles.text}>{t('entitlement.suspended.owners')}</p>
      <div className={cx(styles.block, styles.ways)}>
        {others.map((other) => (
          <Link
            key={other.id}
            to={inHousehold.home(other.id)}
            // The member chose it themselves: nothing is said of a switch (Switched.tsx).
            state={switchedByMember}
            className={styles.way}
          >
            {t('entitlement.suspended.go', { household: other.name ?? '' })}
          </Link>
        ))}
        <SignOut />
      </div>
    </div>
  )
}

export function Lockout({ household, others }: LockoutProps) {
  const t = useTranslate()
  const zone = useOwnZone()
  usePageTitle(t('entitlement.suspended.title', { household: household.name ?? '' }))
  return <LockoutView household={household} others={others} zone={zone} />
}
