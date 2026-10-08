// The invitation composer (A-23). Its title alone, until its screen is built.
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { HouseholdSettingsPage } from './Page.tsx'

export function Invite() {
  const t = useTranslate()
  return <HouseholdSettingsPage title={t('household.invite.title')}>{null}</HouseholdSettingsPage>
}
