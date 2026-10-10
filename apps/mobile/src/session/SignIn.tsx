// Placeholder: the sign-in screen, with the notice of a sign-in that ended.
// Owner: the session group (S1) for the notice and what it says of a held address, once the
// primitives they are drawn with are merged; plan item 29 builds the screen that signs somebody
// in. What decides them is here already: `useSession().ended` and its sentence
// (`device.session.ended`), and `useHeldDestination()` with its own (`device.links.destination`).
//
// It is a visitor's screen: a member who arrives here is signed in already, and is sent on to
// the address held for them, or to where the app opens.
import { Screen } from '../ui/Screen.tsx'
import { VisitorOnly } from './guards.tsx'

export function SignIn() {
  return (
    <VisitorOnly>
      <Screen testID="route:signIn" />
    </VisitorOnly>
  )
}
