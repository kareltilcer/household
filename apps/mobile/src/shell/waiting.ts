// stub: Y1. How many changes wait for the member in this household (F-5): what the tab bar says
// on More, and what More's own row to them counts. The count is the sync group's, which reads
// it from the household's replica (`useInbox`, src/sync/ReplicaProvider.tsx); until that hook
// is there to read, nothing waits. The one line below is replaced by
// `useInbox()?.length ?? 0`, and nothing else of the shell changes.

/** The number of changes waiting for the member's answer in the household on screen. */
export function useWaiting(): number {
  return 0
}
