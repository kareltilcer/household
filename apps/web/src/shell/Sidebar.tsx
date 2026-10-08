// The web sidebar (F-13, 04-navigation §4): the household's switcher at its head, the place for
// the search field, then the member's modules in their own order, and at its foot what is the
// member's own: arranging the list, what needs their attention, their account.
//
// The module list is derived and never authored (navigation.ts): the modules the household's own
// answer grants this member, of those this build has screens for, in the order the member put
// them. A module they do not hold is not in it, nor anywhere else in the shell. It is a list and
// no tree, and nothing is written from it: it has no pending, syncing, conflicted or rejected
// state to be in (ledger F-13). While the household is being read the shell around it is not
// drawn at all (HouseholdShell.tsx), so no module is drawn for a moment that the member does not
// hold; a household's read-only state changes nothing here, navigation being a read.
import { ModuleIcon } from '@household/icons/web'
import type { ReactNode } from 'react'
import { inHousehold, paths } from '../app/paths.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import type { Household, ModuleKey } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { modules, type ModuleRegistry } from '../modules/registry.ts'
import { useMe } from '../session/SessionProvider.tsx'
import { useArrangement } from './arrangement.ts'
import { NavLink } from './NavLink.tsx'
import { navigationOf } from './navigation.ts'
import { SearchSlot } from './SearchSlot.tsx'
import styles from './Sidebar.module.css'
import { Switcher } from './Switcher.tsx'
import { SyncLink } from './SyncLink.tsx'

export interface SidebarViewProps {
  readonly household: Pick<Household, 'id' | 'my_grants'>
  /** The member whose arrangement of this household's modules it is drawn in. */
  readonly user: string
  /** The modules this build has screens for. */
  readonly registry: ModuleRegistry
  /** The switcher, at its head. */
  readonly switcher: ReactNode
}

export function SidebarView({ household, user, registry, switcher }: SidebarViewProps) {
  const t = useTranslate()
  const [arrangement] = useArrangement(user, household.id)
  const navigation = navigationOf(household, registry, arrangement)
  const link = (module: ModuleKey) => (
    <NavLink
      key={module}
      to={inHousehold.module(household.id, module)}
      icon={<ModuleIcon module={module} />}
    >
      {t(`module.${module}.name`)}
    </NavLink>
  )
  const arrangeable =
    navigation.pinned.length + navigation.listed.length + navigation.hidden.length > 0
  return (
    <>
      {switcher}
      <SearchSlot />
      <div className={styles.group}>
        <NavLink to={inHousehold.home(household.id)} end>
          {t('nav.home')}
        </NavLink>
      </div>
      {navigation.pinned.length === 0 ? null : (
        <div className={styles.group}>
          <p className={styles.label}>{t('shell.sidebar.pinned')}</p>
          {navigation.pinned.map(link)}
        </div>
      )}
      {navigation.listed.length === 0 ? null : (
        <div className={styles.group}>
          <p className={styles.label}>{t('shell.sidebar.modules')}</p>
          {navigation.listed.map(link)}
        </div>
      )}
      <div className={styles.foot}>
        {/* Arranging needs something to arrange: with no module to list, its way in is absent. */}
        {arrangeable ? (
          <NavLink to={inHousehold.arrange(household.id)}>{t('shell.sidebar.arrange')}</NavLink>
        ) : null}
        <SyncLink />
        <NavLink to={paths.account.path}>{t('shell.sidebar.account')}</NavLink>
      </div>
    </>
  )
}

export function Sidebar() {
  const me = useMe()
  const household = useHousehold()
  return (
    <SidebarView household={household} user={me.id} registry={modules} switcher={<Switcher />} />
  )
}
