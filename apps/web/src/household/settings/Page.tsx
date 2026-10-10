// What every screen of household settings is set in (PRD 17 §1 to §3; C-49 to C-51): the way
// between its screens, the screen's one title, and under it what the member reading it should
// know before anything else: that changing what is here is an owner's. That the household takes
// no writes is the shell's to say, in the banner it draws above every screen of the household
// (shell/EntitlementBanner.tsx), and so is that a change here needs a connection, in the bar it
// draws with none (shell/HouseholdBars.tsx): said here as well, either stood under a sentence
// that said it already, and over the screens the gate exempts, billing, the household's data
// and its exports, it said that nothing could be changed where something can.
//
// Every member may open these screens, whatever they hold on household settings (D-167): the
// profile, the members with what each holds, and the modules are every member's to read. What
// `view` on it unlocks is the invitations and the storage picture, which are listed for those who
// hold it and are absent from this navigation for those who do not. Billing and the clients are
// an owner's to read and are listed for nobody else; the household's data and the reader's own
// sync health are every member's (plan item 27). Every change is an owner's, in a household
// that takes writes, and is made on the server or not at all (data.ts): a control that changes
// something is drawn for a member who may use it, and for nobody else.
import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { Section, SettingsPage } from '../../account/Page.tsx'
import { inHousehold } from '../../app/paths.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { cx } from '../../ui/cx.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { useOwnerNames, writes } from '../data.ts'
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
  /** Whether the storage picture is theirs to read: the same level unlocks it (D-167). */
  readonly storage: boolean
}

export function useStanding(): Standing {
  const household = useHousehold()
  const owner = household.my_role === 'owner'
  const taken = writes(household)
  const level = household.my_grants?.admin
  const sees = level !== undefined && level !== 'none'
  return {
    owner,
    writes: taken,
    changes: owner && taken,
    invitations: sees,
    storage: sees,
  }
}

/**
 * Whether something has been this member's to read at any time while its screen was open,
 * `holds` being whether it is now: the invitations, the storage picture (`useStanding()`). One
 * who never held it is drawn the neutral *not available*, and nothing is asked for them; one who
 * held it and no longer does was here when their access changed, and is told that it did
 * (03-patterns §2).
 */
export function useEverHeld(holds: boolean): boolean {
  const [held, setHeld] = useState(holds)
  if (holds && !held) setHeld(true)
  return held || holds
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
        {standing.storage
          ? link(inHousehold.storage(household.id), t('household.settings.storage.title'))
          : null}
        {standing.owner
          ? link(inHousehold.billing(household.id), t('household.settings.billing.title'))
          : null}
        {link(inHousehold.data(household.id), t('household.settings.data.title'))}
        {link(inHousehold.syncHealth(household.id), t('household.settings.sync.title'))}
        {standing.owner
          ? link(inHousehold.clients(household.id), t('household.settings.clients.title'))
          : null}
      </ul>
    </nav>
  )
}

/**
 * What a member should know of where they stand before they read on: that changing what is here
 * is an owner's, to a member who is none. It holds whatever the household's state, which the
 * banner above the screen says. Read in its place, and never announced: it was so when the
 * screen opened.
 */
function StandingNote() {
  const t = useTranslate()
  const format = useFormat()
  const household = useHousehold()
  const standing = useStanding()
  const owners = useOwnerNames(household.id)
  if (standing.owner) return null
  return (
    <Banner tone="neutral">
      {owners.length === 0
        ? t('household.settings.note.owner_only')
        : t('household.settings.note.owners', { owners: format.list(owners) })}
    </Banner>
  )
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
