// Storage (C-54): the place the foundation of plan item 27 keeps for the screen,
// which takes this file's place. It draws the settings' frame and the screen's one sentence.
import { HouseholdSettingsPage } from '../household/settings/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'

export function Storage() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage
      title={t('household.settings.storage.title')}
      lead={t('storage.lead')}
      note={false}
    >
      {null}
    </HouseholdSettingsPage>
  )
}
