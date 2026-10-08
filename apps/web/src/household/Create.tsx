// Creating a household (A-22). Its title alone, until its screen is built.
import { SettingsPage } from '../account/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'

export function Create() {
  const t = useTranslate()
  return <SettingsPage title={t('household.create.title')}>{null}</SettingsPage>
}
