// Placeholder: the sync UI's dev screen, with a fixture replica.
// Owner: the sync group (Y1). The core left an empty dev screen here; its owner replaces the body and keeps
// `DevScreen` around it, which holds the marker no production bundle may (src/dev/marker.ts).
import { DevScreen } from '../DevScreen.tsx'
import { useSample } from '../sample.ts'

export default function DevSync() {
  const sample = useSample()
  return <DevScreen page="sync" title={sample('Sync')} />
}
