// What the storage screen reads of a household through the API (C-54; PRD 17 §5, FR-HA14): the
// storage picture, `getStorage`. It is a query of TanStack's filed under the household's own key,
// as every read of a household is (household/households.ts): what this browser kept of it is
// drawn where the server cannot be asked, and what clears the household clears it too. An owner
// reads two more answers beside it, the month as it will be billed and the plan's own figures
// (household/data.ts), and the three are drawn as one body.
import type { ApiClient, components } from '@household/api'
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { Read } from '../account/common.ts'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { householdKey } from '../household/households.ts'

export type StorageReport = components['schemas']['StorageReport']
export type ActorRef = components['schemas']['ActorRef']

/** A household's storage picture (`getStorage`), under the household's own key. */
export function pictureKey(household: string) {
  return [...householdKey(household), 'storage'] as const
}

/**
 * What the household stores against its allowance, by module and by member, its largest items
 * and the trend of its daily samples. A member who holds `none` on household settings is
 * answered `404`: the picture is what `view` on it unlocks (FR-AC3).
 */
export function pictureQuery(api: ApiClient, household: string) {
  return queryOptions({
    queryKey: pictureKey(household),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/storage', {
          params: { path: { household_id: household } },
          signal,
        }),
      ),
  })
}

export function usePicture(
  household: string,
  { enabled = true }: { readonly enabled?: boolean } = {},
): UseQueryResult<StorageReport> {
  return useQuery({ ...pictureQuery(useApi(), household), enabled })
}

/**
 * Several reads that one body is drawn from, as the one read the body's state is told by
 * (`readState`, account/common.ts): read once every one of them is, and until then failed or
 * waiting for a connection where any of those still unread is. One that was read and could not
 * be read again says nothing here: what this browser kept of it is drawn.
 */
export function together(reads: readonly Read[]): Read {
  const unread = reads.filter((read) => read.data === undefined)
  return {
    data: unread.length === 0 ? reads : undefined,
    isError: unread.some((read) => read.isError),
    fetchStatus: unread.some((read) => read.fetchStatus === 'paused') ? 'paused' : 'idle',
  }
}
