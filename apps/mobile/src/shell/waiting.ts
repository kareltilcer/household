// How many changes wait for the member in this household (F-5): what the tab bar says on More,
// and what More's own row to them counts. The count is the replica's own, each mutation's last
// answer that still asks for attention (sync/ReplicaProvider.tsx), so it is as local as the
// changes it counts. Until the replica is open and has been read nothing is known to wait, and
// nothing is said to: in sync is the absence of an indicator (06-clients §5).
import { useInbox } from '../sync/ReplicaProvider.tsx'

/** The number of changes waiting for the member's answer in the household on screen. */
export function useWaiting(): number {
  return useInbox()?.length ?? 0
}
