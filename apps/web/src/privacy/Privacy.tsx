// The privacy centre (A-34): the place the foundation of plan item 27 keeps for the screen,
// which takes this file's place. It draws the account's frame and the screen's title.
import { SettingsPage } from '../account/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'

export function Privacy() {
  const t = useTranslate()
  return <SettingsPage title={t('privacy.title')}>{null}</SettingsPage>
}
