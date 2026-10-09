// A household's exports (A-35): the place the foundation of plan item 27 keeps for the screen,
// which takes this file's place. It draws the settings' frame and the screen's one sentence.
import { HouseholdSettingsPage } from '../household/settings/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'

export function Exports() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage title={t('data.exports.title')} note={false}>
      {null}
    </HouseholdSettingsPage>
  )
}
