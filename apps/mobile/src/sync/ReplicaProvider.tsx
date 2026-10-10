// Placeholder: the replica of the household on screen. Owner: the sync group (Y1).
// It opens one replica for the member and the household (src/sync/open.ts), gives it to the
// screens (`useSync`, `useReplica`, `useInbox`), and closes it as the household leaves the
// screen. Today it opens nothing and passes its children through.
import type { ReactNode } from 'react'

export interface ReplicaProviderProps {
  /** The household in the address, which may be no household's id at all. */
  readonly household: string
  readonly children: ReactNode
}

export function ReplicaProvider({ children }: ReplicaProviderProps) {
  return children
}
