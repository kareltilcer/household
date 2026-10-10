// A household's Home (04-navigation §3): the first of its tabs, and every member's, one who
// holds little among them. What it will hold is the dashboard, widgets from the modules a member
// holds, which is item 38's to build. Until then it says what will be here, and nothing that is
// not so: no widget that shows nothing, no count of modules, no action that leads nowhere.
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { HouseholdScreen } from './HouseholdScreen.tsx'

export function HouseholdHome() {
  const t = useTranslate()
  return (
    <HouseholdScreen title={t('nav.home')} testID="route:household">
      <EmptyState sentence={t('shell.home.empty')} />
    </HouseholdScreen>
  )
}
