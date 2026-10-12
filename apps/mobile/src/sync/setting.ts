// What the sync UI reads of the household it is drawn in (F-5 to F-7): the zone its times are
// read in, whether the household writes, and who its members are. An answer the replica kept
// names the other author by a user's id, and the replica holds no member's name, so the names
// come from the API's list of members (`getMembers`), and an author it cannot name is *another
// member*: offline with nothing kept of the list, or someone who has since left.
//
// A screen asks for it with `useSetting` and hands it to what it draws; the dev screen and a
// test hand over one of their own.
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { householdKey, writes, type Household } from '../household/data.ts'
import { useMe } from '../session/context.ts'

/** Who wrote a version of a row, as far as this device can say. */
export type Author =
  /** The member themself, from another device. */
  | { readonly kind: 'me' }
  | { readonly kind: 'member'; readonly name: string }
  /** A user this device cannot name. */
  | { readonly kind: 'unknown' }

export interface Setting {
  /** The household's id, which the address of a row is made with. */
  readonly household: string
  /**
   * The zone an instant is shown in: the member's own where their account names one, and the
   * household's where it names none (PRD 03 §9). A timezone is never assumed.
   */
  readonly timezone: string
  /**
   * Whether the household writes. One that does not, read-only or restricted, holds what its
   * members change until it does (FR-BI2), so a change is not offered to be sent again there.
   */
  readonly writes: boolean
  /** Who `user` is: a user's id as a row carries it, or anything else, which names nobody. */
  readonly author: (user: unknown) => Author
}

/** The members of a household, as the API lists them: read by key where one joins or leaves. */
export function membersKey(household: string) {
  return [...householdKey(household), 'members'] as const
}

/** The setting of `household`, as the frame its screens stand in read it. */
export function useSetting(household: Household): Setting {
  const api = useApi()
  const account = useMe()
  const me = account.id.toLowerCase()
  const timezone = account.timezone ?? household.timezone
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
  const takesWrites = writes(household)
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
      writes: takesWrites,
      author: (user) => {
        if (typeof user !== 'string') return { kind: 'unknown' }
        const id = user.toLowerCase()
        if (id === me) return { kind: 'me' }
        const name = names.get(id)
        return name === undefined ? { kind: 'unknown' } : { kind: 'member', name }
      },
    }
  }, [household.id, timezone, takesWrites, me, listed])
}
