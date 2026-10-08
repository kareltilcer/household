// Which modules the household has on (C-51). Its title alone, until its screen is built.
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { HouseholdSettingsPage } from './Page.tsx'

export function Modules() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage title={t('household.settings.modules.title')}>
      {null}
    </HouseholdSettingsPage>
  )
}
