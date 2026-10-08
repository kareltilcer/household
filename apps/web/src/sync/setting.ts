// What the sync UI reads of the household it is drawn in (F-5 to F-7): the zone its times are
// read in, whether the household writes, and who its members are. An answer the replica kept
// names the other author by a user's id, and the replica holds no member's name, so the names
// come from the API's list of members (`getMembers`), and an author it cannot name is *another
// member*: offline with nothing kept of the list, or someone who has since left.
//
// A screen asks for it with `useSetting` and hands it to what it draws; the dev page and a test
// hand over one of their own.
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { membersKey } from '../household/households.ts'
import { useTimeZone } from '../household/timezone.ts'
import { useMe } from '../session/SessionProvider.tsx'

/** Who wrote a version of a row, as far as this browser can say. */
export type Author =
  /** The member themself, from another device or another browser. */
  | { readonly kind: 'me' }
  | { readonly kind: 'member'; readonly name: string }
  /** A user this browser cannot name. */
  | { readonly kind: 'unknown' }

export interface Setting {
  /** The household's id, which the address of a row is made with. */
  readonly household: string
  /** The zone an instant is shown in: the member's own, or the household's (household/timezone.ts). */
  readonly timezone: string
  /**
   * Whether the household writes. One that does not, read-only or restricted, holds what its
   * members change until it does (FR-BI2), so a change is not offered to be sent again there.
   */
  readonly writes: boolean
  /** Who `user` is: a user's id as a row carries it, or anything else, which names nobody. */
  readonly author: (user: unknown) => Author
}

/** The setting of the household this screen is in. */
export function useSetting(): Setting {
  const api = useApi()
  const household = useHousehold()
  const me = useMe().id.toLowerCase()
  const timezone = useTimeZone()
  const members = useQuery({
    queryKey: membersKey(household.id),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/members', {
          params: { path: { household_id: household.id } },
          signal,
        }),
      ).items ?? [],
  })
  const listed = members.data
  const writes = household.entitlement?.can_write !== false
  return useMemo<Setting>(() => {
    const names = new Map<string, string>()
    for (const member of listed ?? []) {
      if (member.user_id !== undefined && member.display_name !== undefined) {
        names.set(member.user_id.toLowerCase(), member.display_name)
      }
    }
    return {
      household: household.id,
      timezone,
      writes,
      author: (user) => {
        if (typeof user !== 'string') return { kind: 'unknown' }
        const id = user.toLowerCase()
        if (id === me) return { kind: 'me' }
        const name = names.get(id)
        return name === undefined ? { kind: 'unknown' } : { kind: 'member', name }
      },
    }
  }, [household.id, timezone, writes, me, listed])
}
