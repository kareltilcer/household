// The neutral *not available* screen (F-17, 04-navigation §8, 03-patterns §2): what an address
// that opens nothing shows, whoever asks and whatever the reason. It names no entity, gives no
// cause and offers no retry: an address that never existed, a row that is gone, a module the
// member does not hold and a household they are not in read the same, since telling them apart
// would answer a question the member is not entitled to ask. Every link to something in a
// household came from inside it, there being no public sharing, so it may say to ask whoever
// sent it.
//
// It has one way out. Inside a household that is the household's own Home, and the screen is
// drawn in the household's frame, under its name; anywhere else it is where the app opens.
import { router } from 'expo-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useHouseholdShown } from '../shell/HouseholdContext.tsx'
import { HouseholdScreen } from '../shell/HouseholdScreen.tsx'
import { Button } from '../ui/Button.tsx'
import { Screen } from '../ui/Screen.tsx'
import { Text } from '../ui/Text.tsx'
import { inHousehold, paths } from './paths.ts'

export interface NotAvailableBodyProps {
  /** Where its one way out leads: the household the member is in, or where the app opens. */
  readonly home: string
}

/** What stands under the title: the one sentence, and the one way out. */
export function NotAvailableBody({ home }: NotAvailableBodyProps) {
  const t = useTranslate()
  return (
    <>
      <Text color="text-muted">{t('ui.not_available.body')}</Text>
      <Button
        testID="not-available:home"
        variant="primary"
        onPress={() => {
          // In the place of the address that opened nothing: going back does not return to it.
          router.replace(home)
        }}
      >
        {t('ui.not_available.home')}
      </Button>
    </>
  )
}

/**
 * Whatever no route matches, a household the member may not open, and a dev screen's address in
 * a build that holds none.
 */
export function NotAvailable() {
  const t = useTranslate()
  return (
    <Screen title={t('ui.not_available.title')} testID="route:notFound">
      <NotAvailableBody home={paths.home.path} />
    </Screen>
  )
}

/** Whatever else is asked of a household: drawn in its frame, with that household's Home as the way out. */
export function HouseholdNotAvailable() {
  const t = useTranslate()
  const household = useHouseholdShown()
  return (
    <HouseholdScreen title={t('ui.not_available.title')} testID="route:householdNotFound">
      <NotAvailableBody home={inHousehold.home(household.id)} />
    </HouseholdScreen>
  )
}
