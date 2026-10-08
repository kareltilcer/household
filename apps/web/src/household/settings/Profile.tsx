// The household's profile (C-49). Its title alone, until its screen is built.
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { HouseholdSettingsPage } from './Page.tsx'

export function Profile() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage title={t('household.settings.profile.title')}>
      {null}
    </HouseholdSettingsPage>
  )
}
