// Placeholder: the neutral *not available* screen (F-17), outside a household and inside one.
// Owner: the shell group (H1). The core (plan item 28, brief C1) left two empty screens here so
// that every address the app has no screen for has a route; a dev screen's route draws the
// first where the dev screens are not in the build. Its owner replaces this file whole, and
// keeps both names.
import { Screen } from '../ui/Screen.tsx'

/** Whatever no route matches, and a dev screen's address in a build that holds none. */
export function NotAvailable() {
  return <Screen testID="route:notFound" />
}

/** Whatever else is asked of a household: drawn in its frame, with that household's Home as the way out. */
export function HouseholdNotAvailable() {
  return <Screen testID="route:householdNotFound" />
}
