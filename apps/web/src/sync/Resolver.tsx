// What a row's mark opens (F-8): the comparison for a conflict, the reason for a change that was
// not accepted. The inbox opens it for an entry, and a module's screen for a row whose state
// carries the answer (rowState.ts). A merge's kept loser is a banner and no panel
// (KeptLoser.tsx), and nothing else has anything to open.
import { ConflictResolver, type ResolverProps } from './ConflictResolver.tsx'
import { RejectedResolver } from './RejectedResolver.tsx'

export type { ResolverProps } from './ConflictResolver.tsx'

export function Resolver(props: ResolverProps) {
  switch (props.outcome?.outcome) {
    case 'conflict':
      return <ConflictResolver {...props} />
    case 'rejected':
      return <RejectedResolver {...props} />
    default:
      return null
  }
}
