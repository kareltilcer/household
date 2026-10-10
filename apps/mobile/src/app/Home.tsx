// Placeholder: where the app opens. No screen of its own: it leads to sign-in or to a household, and draws a wait or an unread meanwhile.
// Owner: the session group (S1). The core (plan item 28, brief C1) left an empty screen here so that the route
// exists and the table of routes holds; its owner replaces this file whole and keeps its name.
import { Screen } from '../ui/Screen.tsx'

export function Home() {
  return <Screen testID="route:home" />
}
