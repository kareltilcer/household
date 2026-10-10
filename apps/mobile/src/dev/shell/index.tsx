// Placeholder: the shell's dev screen: the bar in each drawing, More, arrange, the panes.
// Owner: the shell group (H1). The core left an empty dev screen here; its owner replaces the body and keeps
// `DevScreen` around it, which holds the marker no production bundle may (src/dev/marker.ts).
import { DevScreen } from '../DevScreen.tsx'
import { useSample } from '../sample.ts'

export default function DevShell() {
  const sample = useSample()
  return <DevScreen page="shell" title={sample('Shell')} />
}
