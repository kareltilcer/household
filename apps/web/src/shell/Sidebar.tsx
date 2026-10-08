// The web sidebar (F-13, 04-navigation §4): the household's switcher at its head, the place for
// the search field, then the member's modules in their own order, and at its foot what is the
// member's own: arranging the list, what needs their attention, their account.
//
// The module list is derived and never authored (navigation.ts): the modules the household's own
// answer grants this member, of those this build has screens for, in the order the member put
// them. A module they do not hold is not in it, nor anywhere else in the shell.
import { ModuleIcon } from '@household/icons/web'
import { inHousehold, paths } from '../app/paths.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { modules } from '../modules/registry.ts'
import { useMe } from '../session/SessionProvider.tsx'
import { useArrangement } from './arrangement.ts'
import { NavLink } from './NavLink.tsx'
import { navigationOf } from './navigation.ts'
import { SearchSlot } from './SearchSlot.tsx'
import styles from './Sidebar.module.css'
import { Switcher } from './Switcher.tsx'
import { SyncLink } from './SyncLink.tsx'

export function Sidebar() {
  const t = useTranslate()
  const me = useMe()
  const household = useHousehold()
  const [arrangement] = useArrangement(me.id, household.id)
  const navigation = navigationOf(household, modules, arrangement)
  const link = (module: (typeof navigation.listed)[number]) => (
    <NavLink
      key={module}
      to={inHousehold.module(household.id, module)}
      icon={<ModuleIcon module={module} />}
    >
      {t(`module.${module}.name`)}
    </NavLink>
  )
  return (
    <>
      <Switcher />
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
        {navigation.pinned.length + navigation.listed.length + navigation.hidden.length ===
        0 ? null : (
          <NavLink to={inHousehold.arrange(household.id)}>{t('shell.sidebar.arrange')}</NavLink>
        )}
        <SyncLink />
        <NavLink to={paths.account.path}>{t('shell.sidebar.account')}</NavLink>
      </div>
    </>
  )
}
