// Placeholder: the sign-in screen, with the notice of a sign-in that ended.
// Owner: the session group (S1); item 29 builds the real screen. The core (plan item 28, brief C1) left an empty screen here so that the route
// exists and the table of routes holds; its owner replaces this file whole and keeps its name.
import { Screen } from '../ui/Screen.tsx'

export function SignIn() {
  return <Screen testID="route:signIn" />
}
