// The household's frame: what stands around every screen of the household an address names
// (D-4). It reads the household as its member does, and draws nothing of the shell until it has:
// no tab, no module and no name is drawn for a moment that the answer then takes away.
//
// - While it is read for the first time, a wait. Where it could not be read and nothing is kept
//   of it, that is said, with the way to ask again.
// - Where the server answers that it is not found, *not available* (F-17), over whatever the
//   device kept of it from when it was this member's, and with no word of why: a household they
//   left, one that never was and one the platform suspended read the same. An address that is no
//   household's id asks the server nothing. Item 29 draws the lockout here, for a household the
//   member's own list still names.
// - Once it is read, the screens, and above them the bars that are the household's and no one
//   screen's: the sync group's first (offline, and *not receiving*), then the place for item
//   29's one entitlement banner, then the notice that a link changed the household.
//
// It also remembers the household as the one its member was last in on this device, which is
// where the app opens next (D-162), and reads their arrangement of its modules, so that no
// screen under it has either to wait for.
import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { useTheme } from '../display/DisplayProvider.tsx'
import { rememberHousehold, useHousehold, type Household } from '../household/data.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/context.ts'
import { Unread, Waiting } from '../session/guards.tsx'
import { HouseholdBars } from '../sync/HouseholdBars.tsx'
import { useKeptArrangement } from './arrangement.ts'
import { HouseholdProvider } from './HouseholdContext.tsx'
import type { Arrangement } from './navigation.ts'
import { Switched } from './Switched.tsx'

export interface HouseholdFrameProps {
  /** The household in the address, which may be no household's id at all. */
  readonly household: string
  readonly children: ReactNode
}

interface OpenedProps {
  readonly household: Household
  readonly arrangement: Arrangement
  readonly arrange: (next: Arrangement) => void
  readonly children: ReactNode
}

function Opened({ household, arrangement, arrange, children }: OpenedProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const me = useMe()
  const { id } = household
  useEffect(() => {
    rememberHousehold(me.id, id)
  }, [me.id, id])
  return (
    <HouseholdProvider household={household} arrangement={arrangement} arrange={arrange}>
      <View
        testID="household-frame"
        // The top of the device is the frame's, for the bars; a screen under it keeps clear of
        // the sides alone (HouseholdScreen.tsx), and the tab bar of the foot.
        style={{ flex: 1, paddingTop: insets.top, backgroundColor: theme.color.surface }}
      >
        <View
          style={{
            gap: theme.space['space-1'],
            paddingLeft: insets.left + theme.density['dens-pad-x'],
            paddingRight: insets.right + theme.density['dens-pad-x'],
          }}
        >
          <HouseholdBars household={id} />
          {/* Item 29's entitlement banner stands here, under the offline bar's place. */}
          <Switched household={id} />
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </HouseholdProvider>
  )
}

export function HouseholdFrame({ household, children }: HouseholdFrameProps) {
  const t = useTranslate()
  const me = useMe()
  const read = useHousehold(household)
  // Asked of the device beside the household, and not after it: both are there before the shell.
  const [arrangement, arrange] = useKeptArrangement(me.id, household)
  switch (read.status) {
    case 'reading':
      return <Waiting />
    case 'unread':
      return (
        <Unread
          title={t('shell.household.error.title')}
          body={t('shell.household.error.body')}
          retry={read.retry}
        />
      )
    case 'gone':
      // The way out is the app's own: there is no household here to go home to.
      return <NotAvailable />
    case 'read':
      if (arrangement === undefined) return <Waiting />
      return (
        <Opened household={read.household} arrangement={arrangement} arrange={arrange}>
          {children}
        </Opened>
      )
  }
}
