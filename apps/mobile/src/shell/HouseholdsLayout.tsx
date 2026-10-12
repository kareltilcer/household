// What stands around every household's layout: a stack of the households that were opened, one
// screen a household. It draws nothing of its own. It is here for what the router makes of an
// address: with the household a route of its own in this stack, an address that names another
// household opens that household, on top of the one that was open, and going back returns to
// it (04-navigation §8, the wrong household). Without it the router takes the household for a
// part of one route's name, finds no difference between two households' addresses until it
// reaches their screens, and opens the other household's screen inside the first one's frame.
//
// Where motion is reduced, by the member's choice or the device's, a household takes another's
// place at once, as every screen of the root's stack does (app/Root.tsx).
import { Stack } from 'expo-router'
import { useDisplay } from '../display/DisplayProvider.tsx'

export function HouseholdsLayout() {
  const { reducedMotion } = useDisplay()
  return (
    <Stack
      screenOptions={{ headerShown: false, ...(reducedMotion ? { animation: 'none' } : {}) }}
    />
  )
}
