// Clients and versions (C-57): the place the foundation of plan item 27 keeps for the screen,
// which takes this file's place. It draws the settings' frame and the screen's one sentence.
import { HouseholdSettingsPage } from '../household/settings/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'

export function Clients() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage
      title={t('household.settings.clients.title')}
      lead={t('clients.lead')}
      note={false}
    >
      {null}
    </HouseholdSettingsPage>
  )
}
