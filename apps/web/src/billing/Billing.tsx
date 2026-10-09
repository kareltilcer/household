// Manage billing (A-28, C-55): the place the foundation of plan item 27 keeps for the screen,
// which takes this file's place. It draws the settings' frame and the screen's one sentence.
import { HouseholdSettingsPage } from '../household/settings/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'

export function Billing() {
  const t = useTranslate()
  return (
    <HouseholdSettingsPage
      title={t('household.settings.billing.title')}
      lead={t('billing.lead')}
      note={false}
    >
      {null}
    </HouseholdSettingsPage>
  )
}
