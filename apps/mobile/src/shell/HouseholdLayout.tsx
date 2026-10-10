// A household's layout, which every route under /households/[household] is drawn in. From the
// outside in: the guard, since everything of a household is a member's; the household's replica,
// the sync group's, opened for the household in the address; the frame, which reads the
// household and draws the bars above its screens (HouseholdFrame.tsx); and the screens
// themselves with the tab bar under them.
//
// The screens stand in a tab navigator, of which the bar draws the destinations a member has
// (tabs.ts) and leaves the other routes to be reached from them: arranging the modules and what
// needs attention are opened from More, and going back from them goes to where their member
// was. A screen that was opened stays as it was left, a list's place in it too.
import { router, useLocalSearchParams } from 'expo-router'
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs'
import { useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { modules } from '../modules/registry.ts'
import { Signed } from '../session/guards.tsx'
import { ReplicaProvider } from '../sync/ReplicaProvider.tsx'
import { useToastsAbove } from '../ui/Toast.tsx'
import { useHouseholdShown } from './HouseholdContext.tsx'
import { HouseholdFrame } from './HouseholdFrame.tsx'
import { TabBar } from './TabBar.tsx'
import { addressOf, placeOf, tabsOf } from './tabs.ts'
import { useWaiting } from './waiting.ts'

/** The bar under a household's screens, drawn from its own answer and this build's registry. */
function Bar({ state, insets }: BottomTabBarProps) {
  const household = useHouseholdShown()
  const { width } = useWindowDimensions()
  const waiting = useWaiting()
  // The bar grows with the reader's text, so how high it stands is measured: a toast is drawn
  // above it (ui/Toast.tsx).
  const [height, setHeight] = useState(0)
  useToastsAbove(height)
  const shown = state.routes[state.index]
  return (
    <TabBar
      slots={tabsOf(household, modules)}
      open={shown === undefined ? null : placeOf(shown.name)}
      onOpen={(place) => {
        const address = addressOf(place, household.id, modules)
        if (address !== undefined) router.navigate(address)
      }}
      // Add opens its sheet over the place that is open, and is never a route. The sheet is
      // item 38's, and it is opened from here. No module of this build has a capture surface,
      // so no bar of this build has the slot (tabs.ts, and a test of the registry holds it so).
      onAdd={() => undefined}
      width={width}
      waiting={waiting}
      insets={insets}
      onHeight={setHeight}
    />
  )
}

export function HouseholdLayout() {
  const theme = useTheme()
  const { household } = useLocalSearchParams<{ household: string }>()
  // An id is written in either case, and is one household in both.
  const id = household.toLowerCase()
  return (
    <Tabs
      // Back from a screen opened from More goes to More, and not to the first tab.
      backBehavior="history"
      screenOptions={{
        // Each screen draws its own bar and title (HouseholdScreen.tsx): the navigator draws none.
        headerShown: false,
        sceneStyle: { backgroundColor: theme.color.surface },
      }}
      tabBar={(props) => <Bar {...props} />}
      // The guard and the frame stand inside the navigator, around what it draws, and not
      // around the navigator itself. A layout that draws no navigator has no route under it,
      // and the router then says the app is at the household's own address, whatever the
      // address was: the guard would hold that for a visitor, and somebody who opened a link
      // to a screen of the household would land on its Home once they had signed in.
      layout={({ children }) => (
        <Signed>
          {/* A household's own, from its first render: a link may change the household in the
              address of a layout that stays (links/Links.tsx), and nothing of the one that was
              open before is kept, a screen's place in its list neither. */}
          <ReplicaProvider key={id} household={id}>
            <HouseholdFrame household={id}>{children}</HouseholdFrame>
          </ReplicaProvider>
        </Signed>
      )}
    />
  )
}
