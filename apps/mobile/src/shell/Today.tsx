// Today (04-navigation §3, F-3): one list of what today asks for, across everything a member
// holds, and no module's own. It is every member's, short for one who holds little and never
// absent. The agenda itself is item 38's, computed from the household's replica; until then the
// screen says what will be here in one sentence, and lists nothing.
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { HouseholdScreen } from './HouseholdScreen.tsx'

export function Today() {
  const t = useTranslate()
  return (
    <HouseholdScreen title={t('nav.today')} testID="route:today">
      <EmptyState sentence={t('device.shell.today.empty')} />
    </HouseholdScreen>
  )
}
