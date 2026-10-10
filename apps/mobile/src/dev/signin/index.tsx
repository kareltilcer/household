// Placeholder: the dev-only sign-in form.
// Owner: the session group (S1). The core left an empty dev screen here; its owner replaces the body and keeps
// `DevScreen` around it, which holds the marker no production bundle may (src/dev/marker.ts).
import { DevScreen } from '../DevScreen.tsx'
import { useSample } from '../sample.ts'

export default function DevSignIn() {
  const sample = useSample()
  return <DevScreen page="sign-in" title={sample('Sign in')} />
}
