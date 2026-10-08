// One member: what they hold, their role, and a child profile's own controls. Its title alone, until its screen is built.
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { HouseholdSettingsPage } from './Page.tsx'

export function Member() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage title={t('household.settings.members.title')}>
      {null}
    </HouseholdSettingsPage>
  )
}
