// Everybody's access, visible to everybody (C-50). Its title alone, until its screen is built.
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { HouseholdSettingsPage } from './Page.tsx'

export function Members() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage title={t('household.settings.members.title')}>
      {null}
    </HouseholdSettingsPage>
  )
}
