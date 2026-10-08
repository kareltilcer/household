// The invitations the household sent (A-25). Its title alone, until its screen is built.
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { HouseholdSettingsPage } from './Page.tsx'

export function Invitations() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage title={t('household.settings.invitations.title')}>
      {null}
    </HouseholdSettingsPage>
  )
}
