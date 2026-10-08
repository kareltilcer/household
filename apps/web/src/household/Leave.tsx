// Leaving the household (A-26). Its title alone, until its screen is built.
import { SettingsPage } from '../account/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useHousehold } from './HouseholdContext.tsx'

export function Leave() {
  const t = useTranslate()
  const household = useHousehold()
  return (
    <SettingsPage title={t('household.leave.title', { household: household.name })}>
      {null}
    </SettingsPage>
  )
}
