// What every screen of household settings is set in (PRD 17 §1 to §3; C-49 to C-51): the way
// between its screens, the screen's one title, and under it what the member reading it should
// know before anything else: that the household is read-only, or that changing what is here is
// an owner's. That a change here needs a connection is the shell's to say, in the bar it draws
// with none (shell/HouseholdBars.tsx): said here as well, it stood under a bar that said the
// opposite.
//
// Every member may open these screens, whatever they hold on household settings (D-167): the
// profile, the members with what each holds, and the modules are every member's to read. What
// `view` on it unlocks is the invitations, which are listed for those who hold it and are
// absent from this navigation for those who do not. Every change is an owner's, in a household
// that takes writes, and is made on the server or not at all (data.ts): a control that changes
// something is drawn for a member who may use it, and for nobody else.
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { Section, SettingsPage } from '../../account/Page.tsx'
import { inHousehold } from '../../app/paths.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { cx } from '../../ui/cx.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { useMembers, writes } from '../data.ts'
import styles from './Settings.module.css'

export { Section }

/** Where the member stands towards the household's settings. */
export interface Standing {
  /** An owner: the only role that changes anything here. */
  readonly owner: boolean
  /** Whether the household takes writes: one that is read-only or restricted does not. */
  readonly writes: boolean
  /** Whether a control that changes something is drawn for this member: an owner's, where writes are taken. */
  readonly changes: boolean
  /** Whether the invitations are theirs to read: at least `view` on household settings. */
  readonly invitations: boolean
}

export function useStanding(): Standing {
  const household = useHousehold()
  const owner = household.my_role === 'owner'
  const taken = writes(household)
  const level = household.my_grants?.admin
  return {
    owner,
    writes: taken,
    changes: owner && taken,
    invitations: level !== undefined && level !== 'none',
  }
}

/** The way between the settings' screens: each a link, the open one said to be. */
function SettingsNavigation() {
  const t = useTranslate()
  const household = useHousehold()
  const standing = useStanding()
  const link = (to: string, name: string, end = false) => (
    <li>
      <NavLink to={to} end={end} className={cx(styles.destination)}>
        {name}
      </NavLink>
    </li>
  )
  return (
    <nav aria-label={t('module.admin.name')}>
      <ul className={styles.destinations} role="list">
        {link(inHousehold.settings(household.id), t('household.settings.profile.title'), true)}
        {link(inHousehold.members(household.id), t('household.settings.members.title'))}
        {standing.invitations
          ? link(inHousehold.invitations(household.id), t('household.settings.invitations.title'))
          : null}
        {link(inHousehold.modules(household.id), t('household.settings.modules.title'))}
      </ul>
    </nav>
  )
}

/**
 * What a member should know of where they stand before they read on: one sentence, the first
 * that holds. Read in its place, and never announced: it was so when the screen opened.
 */
function StandingNote() {
  const t = useTranslate()
  const format = useFormat()
  const household = useHousehold()
  const standing = useStanding()
  const members = useMembers(household.id)
  if (!standing.writes) {
    return (
      <Banner tone="warning">
        {household.entitlement?.state === 'restricted'
          ? t('household.settings.note.restricted')
          : t('household.settings.note.read_only')}
      </Banner>
    )
  }
  if (!standing.owner) {
    const owners = (members.data ?? [])
      .filter((member) => member.role === 'owner')
      .map((member) => member.display_name ?? '')
      .filter((name) => name !== '')
    return (
      <Banner tone="neutral">
        {owners.length === 0
          ? t('household.settings.note.owner_only')
          : t('household.settings.note.owners', { owners: format.list(owners) })}
      </Banner>
    )
  }
  return null
}

export interface HouseholdSettingsPageProps {
  /** The screen's name: the page's one `<h1>`. */
  readonly title: string
  /** A sentence under it, where the title alone would not say what the screen is for. */
  readonly lead?: string | undefined
  /**
   * Whether the sentence that says where the member stands is drawn. A screen that says it in
   * its own words, or has nothing a member could change, leaves it out.
   */
  readonly note?: boolean
  readonly children: ReactNode
}

export function HouseholdSettingsPage({
  title,
  lead,
  note = true,
  children,
}: HouseholdSettingsPageProps) {
  return (
    <SettingsPage title={title} lead={lead} above={<SettingsNavigation />}>
      {note ? <StandingNote /> : null}
      {children}
    </SettingsPage>
  )
}
