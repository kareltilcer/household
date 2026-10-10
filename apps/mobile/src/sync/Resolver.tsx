// What a row's mark opens (F-8): the comparison for a conflict, the reason for a change that was
// not accepted. The inbox opens it for an entry, and a module's screen for a row whose state
// carries the answer (rowState.ts). A merge's kept loser is a banner and no sheet
// (KeptLoser.tsx), and nothing else has anything to open.
//
// A sheet is closed by being told it is, and says when it has gone from the screen, which on
// iOS is some time after. So what a resolver last showed is kept while it leaves: its owner
// hands it no answer any more, and the sheet is drawn closed, over the same answer, until the
// platform says it is gone. A sheet of its own for each answer: what was decided about one
// says nothing of the next.
import { useState } from 'react'
import { ConflictSheet, type ResolverProps, type SheetProps } from './ConflictResolver.tsx'
import { describers as appDescribers } from './describe.ts'
import { RejectedSheet } from './RejectedResolver.tsx'
import { useReplica } from './ReplicaProvider.tsx'

export type { ResolverProps } from './ConflictResolver.tsx'

export function Resolver({
  outcome,
  onClose,
  onClosed,
  setting,
  describers,
  opener,
}: ResolverProps) {
  const replica = useReplica()
  const [shown, setShown] = useState(outcome)
  if (outcome !== undefined && outcome !== shown) setShown(outcome)
  const about = outcome ?? shown
  if (about === undefined || replica === undefined) return null
  const sheet: SheetProps = {
    outcome: about,
    open: outcome !== undefined,
    replica,
    onClose,
    onClosed: () => {
      setShown(undefined)
      onClosed?.()
    },
    setting,
    describers: describers ?? appDescribers,
    opener,
  }
  switch (about.outcome) {
    case 'conflict':
      return <ConflictSheet key={about.mutation_id} {...sheet} />
    case 'rejected':
      return <RejectedSheet key={about.mutation_id} {...sheet} />
    default:
      return null
  }
}
