// The sidebar's way to what needs the member's attention (F-5): a link drawn only while something
// does, with the count beside its name. With nothing waiting it is absent: in sync is the absence
// of an indicator (06-clients §5), and a link to an empty inbox would be one.
import { inHousehold } from '../app/paths.ts'
import { useHouseholdId } from '../household/HouseholdContext.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useInbox } from '../sync/ReplicaProvider.tsx'
import { NavLink } from './NavLink.tsx'
import styles from './Sidebar.module.css'

export function SyncLink() {
  const t = useTranslate()
  const format = useFormat()
  const household = useHouseholdId()
  const waiting = useInbox()?.length ?? 0
  if (waiting === 0) return null
  return (
    <NavLink
      to={inHousehold.sync(household)}
      trailing={
        // The link's name says what the number counts, in words, for assistive technology.
        <span className={styles.count} aria-hidden="true">
          {format.number(waiting)}
        </span>
      }
    >
      {t('shell.sidebar.attention', { count: waiting })}
    </NavLink>
  )
}
