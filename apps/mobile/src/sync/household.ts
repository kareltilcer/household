// The household a replica is of, as the sync UI reads it: the one an address names, where that
// is the signed-in member's. The replica's provider stands above whatever guards a household's
// screens (shell/HouseholdLayout.tsx), so it decides for itself whose the household is, and asks
// nothing for anybody who is not signed in. It is the household's own answer that its frame
// reads too (household/data.ts), held to the same rule: a kept answer stands in for a server
// that cannot be asked, never for one that answered that the household is not theirs (F-17).
import { isUuid } from '@household/api'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn } from '../api/problem.ts'
import { householdQuery, type Household } from '../household/data.ts'
import { useSession } from '../session/context.ts'

/** Whose household it is, and the household: both, or neither. */
export interface Own {
  /** The signed-in member's id, as a replica's file is named for it. */
  readonly member: string
  readonly household: Household
}

/**
 * The household `household` names, with whose it is, where it is the signed-in member's by the
 * server's word or by what the device kept of it. Undefined for anybody else, while it is being
 * read, and for an address that names no household at all, which is never asked about.
 */
export function useOwn(household: string): Own | undefined {
  const api = useApi()
  const { state } = useSession()
  const member = state.status === 'member' ? state.me.id.toLowerCase() : null
  const read = useQuery({
    ...householdQuery(api, household),
    enabled: member !== null && isUuid(household),
  })
  if (member === null || read.data === undefined) return undefined
  if (problemIn(read.error)?.status === 404) return undefined
  return { member, household: read.data }
}
