// A household's Home, where the app opens for its member. The dashboard, widgets the modules
// contribute and the member arranges, is the landing route's content (04-navigation §4), and is
// item 37's. Until it stands here, Home is the way into what the member holds: their modules, in
// their own order, as the sidebar lists them. A module they do not hold is not here either.
import { ModuleIcon } from '@household/icons/web'
import { inHousehold } from '../app/paths.ts'
import { usePageTitle } from '../app/title.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { modules } from '../modules/registry.ts'
import { useMe } from '../session/SessionProvider.tsx'
import styles from '../shell/Arrange.module.css'
import { useArrangement } from '../shell/arrangement.ts'
import { NavLink } from '../shell/NavLink.tsx'
import { navigationOf } from '../shell/navigation.ts'
import { EmptyState } from '../ui/EmptyState.tsx'
import { useHousehold } from './HouseholdContext.tsx'

export function HouseholdHome() {
  const t = useTranslate()
  const me = useMe()
  const household = useHousehold()
  const [arrangement] = useArrangement(me.id, household.id)
  const navigation = navigationOf(household, modules, arrangement)
  const open = [...navigation.pinned, ...navigation.listed]
  usePageTitle(t('nav.home'))
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('nav.home')}</h1>
      {open.length === 0 ? (
        <EmptyState sentence={t('shell.home.empty')} />
      ) : (
        <ul className={styles.links} role="list">
          {open.map((module) => (
            <li key={module}>
              <NavLink
                to={inHousehold.module(household.id, module)}
                icon={<ModuleIcon module={module} />}
              >
                {t(`module.${module}.name`)}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
