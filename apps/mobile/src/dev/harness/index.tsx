// Placeholder: the twelve-state harness: eight bodies, twelve states, two themes, the scale held at 2.
// Owner: the status group (P2). The core left an empty dev screen here; its owner replaces the body and keeps
// `DevScreen` around it, which holds the marker no production bundle may (src/dev/marker.ts).
import { DevScreen } from '../DevScreen.tsx'
import { useSample } from '../sample.ts'

export default function Harness() {
  const sample = useSample()
  return <DevScreen page="harness" title={sample('Twelve states')} />
}
