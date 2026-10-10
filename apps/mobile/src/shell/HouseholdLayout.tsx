// Placeholder: a household's layout, which every route under /households/[household] is drawn in.
// Owner: the shell group (H1), which replaces `Tabs` below with its tab bar and its panes and
// fills `HouseholdFrame`. What stands around them is fixed here so that two groups never edit
// one file: the replica is the sync group's provider (src/sync/ReplicaProvider.tsx), opened for
// the household in the address, and the frame is the shell's (src/shell/HouseholdFrame.tsx),
// which draws the sync group's bars above the screen.
import { Slot, useLocalSearchParams } from 'expo-router'
import { ReplicaProvider } from '../sync/ReplicaProvider.tsx'
import { HouseholdFrame } from './HouseholdFrame.tsx'

/** The tabs' own navigator. A placeholder: whichever route is open, with no bar. */
function Tabs() {
  return <Slot />
}

export function HouseholdLayout() {
  const { household } = useLocalSearchParams<{ household: string }>()
  return (
    <ReplicaProvider household={household}>
      <HouseholdFrame household={household}>
        <Tabs />
      </HouseholdFrame>
    </ReplicaProvider>
  )
}
