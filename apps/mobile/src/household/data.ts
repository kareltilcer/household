// What every screen reads of a household through the API: the households a member is in, and
// the one an address names, as its member reads it, with what they hold on each module
// (`my_grants`), its entitlement and its flags. Every household-scoped screen reads the
// household through here, by the id in its address (D-4): there is no current household kept
// anywhere but there.
//
// Each is a query of TanStack's, kept on the device for its member (api/keep.ts), so that what
// was kept is drawn where the server cannot be asked. A kept read stands in for a server that
// cannot be asked, never for one that answered: a household the server says is not found is
// *not available* whatever the device kept of it (F-17).
//
// Nothing here is written offline, and nothing here is a replica's: a module's rows are read
// from the household's replica (sync/).
import { isUuid, type ApiClient, type components } from '@household/api'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  queryOptions,
  useQuery,
  type FetchStatus,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { couldNotBeRead } from '../api/query.ts'
import { sameId, useSession } from '../session/context.ts'
import type { DataState } from '../ui/states.ts'

export type HouseholdSummary = components['schemas']['HouseholdSummary']
export type Household = components['schemas']['Household']
export type HouseholdRole = components['schemas']['HouseholdRole']
export type AccessLevel = components['schemas']['AccessLevel']
export type EntitlementState = components['schemas']['EntitlementState']
export type ModuleKey = components['schemas']['ModuleKeyValue']

/**
 * `values`, held to the contract's modules in both directions: a key the contract has not fails
 * the build, and so does one this list leaves out, which makes the argument `never`.
 */
export function everyModule<const T extends readonly ModuleKey[]>(
  values: T & ([Exclude<ModuleKey, T[number]>] extends [never] ? unknown : never),
): readonly ModuleKey[] {
  return values
}

/**
 * The modules in the product's own order, which is the contract's (`ModuleKeyValue`): the order
 * a member's list is in until they give it one of their own (D-38).
 */
export const moduleKeys = everyModule([
  'dashboard',
  'tasks',
  'reminders',
  'calendar',
  'shopping',
  'chores',
  'notes',
  'documents',
  'finance',
  'utilities',
  'garden',
  'property',
  'vehicles',
  'pets',
  'chat',
  'activity',
  'admin',
])

/** The list of a member's households: read by key where a membership is made or ended. */
export const householdsKey = ['households'] as const

/** One household, as its own representation: its grants, its flags, its entitlement. */
export function householdKey(household: string) {
  return ['households', household.toLowerCase()] as const
}

/** The households the member belongs to, a `suspended` one among them, in the server's order. */
export function useHouseholds(): UseQueryResult<HouseholdSummary[]> {
  const api = useApi()
  return useQuery({
    queryKey: householdsKey,
    queryFn: async ({ signal }) => unwrap(await api.GET('/households', { signal })).items ?? [],
  })
}

/**
 * The household `household` names, as its member reads it. A household the member is not in, one
 * that is `suspended`, and an id that is none answer `404` alike, and read the same here. It is
 * asked through `useHousehold` alone, which says for whom.
 */
function householdQuery(api: ApiClient, household: string) {
  return queryOptions({
    queryKey: householdKey(household),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}', {
          params: { path: { household_id: household } },
          signal,
        }),
      ),
  })
}

/** Whether the household takes writes: one that is read-only or restricted draws none (FR-BI2). */
export function writes(household: Pick<Household, 'entitlement'>): boolean {
  return household.entitlement?.can_write !== false
}

/** A household as the address that names it comes to, for the frame its screens are drawn in. */
export type HouseholdRead =
  /** Asked for the first time, with nothing kept: nothing of the shell is drawn yet. */
  | { readonly status: 'reading' }
  /** It could not be read and nothing is kept of it: said, with the way to ask again. */
  | { readonly status: 'unread'; readonly retry: () => void }
  /**
   * The address opens nothing for this member: the server answered that it is not found, over
   * whatever the device kept, or the address names no household at all. *Not available*.
   */
  | { readonly status: 'gone' }
  /** As it was last read: with no connection, as the device kept it. */
  | { readonly status: 'read'; readonly household: Household }

/**
 * The household an address names, as its member reads it: the app's one reading of it. The
 * frame its screens stand in draws by it and hands it on, to the screens under it and to the
 * bar above them (shell/HouseholdFrame.tsx). The replica's provider stands above the frame and
 * opens nothing on an address's word, so it reads it here too, by the same key and as the frame
 * does, and the household is asked for once. Whatever else needs it is handed it: a reader that
 * arrived after the answer would ask for it again.
 *
 * It is asked for a member, of an id that can be a household's. Anybody else is answered
 * nothing but a refusal, so nothing is asked for them and nothing kept is theirs: it is being
 * read, for as long as nobody is signed in. An id that is no UUID asks the server nothing
 * either: no household has such an address.
 *
 * The server's `404` is its last word, whether or not the device kept the household from when
 * it was its member's, and it stands while the household is asked for again with nothing kept
 * of it, as it is each time the app is looked at again: the query client puts the answer away
 * as it asks, and what stood in the household's place would be taken down and built again
 * around a wait, the focus on it lost. Only an answer that is no `404` ends it.
 */
export function useHousehold(household: string): HouseholdRead {
  const api = useApi()
  const { state } = useSession()
  const member = state.status === 'member'
  const named = isUuid(household)
  const read = useQuery({ ...householdQuery(api, household), enabled: member && named })
  const refused = problemIn(read.error)?.status === 404
  const [wasRefused, setWasRefused] = useState(false)
  const asking = read.data === undefined && read.status === 'pending'
  if (refused !== wasRefused && !asking) setWasRefused(refused)
  const { refetch } = read
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])
  if (!named || refused || (wasRefused && asking)) return { status: 'gone' }
  if (!member) return { status: 'reading' }
  if (read.data !== undefined) return { status: 'read', household: read.data }
  return couldNotBeRead(read) ? { status: 'unread', retry } : { status: 'reading' }
}

/** Where the household a member was last in is kept, on this device, for each member. */
function lastKey(member: string): string {
  return `household.last.${member.toLowerCase()}`
}

/** The household `member` was last in on this device, where they were in one. */
export async function lastHousehold(member: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(lastKey(member))
  } catch {
    return null
  }
}

/** Remembers that `member` is in `household` now: where the app opens for them next. */
export function rememberHousehold(member: string, household: string): void {
  // The app opens at their first household, where the device will not keep it.
  AsyncStorage.setItem(lastKey(member), household.toLowerCase()).catch(() => undefined)
}

/** What the device says of where `member` was last, once it has been asked. */
export type Last =
  { readonly read: false } | { readonly read: true; readonly household: string | null }

/** The household `member` was last in on this device, read as the app opens. */
export function useLastHousehold(member: string): Last {
  const [last, setLast] = useState<Last & { readonly member?: string }>({ read: false })
  useEffect(() => {
    let wanted = true
    void lastHousehold(member).then((household) => {
      if (wanted) setLast({ read: true, household, member })
    })
    return () => {
      wanted = false
    }
  }, [member])
  // What was read for another member is not this one's.
  return last.read && last.member === member ? last : { read: false }
}

/**
 * The household the app opens at (D-162): the one its member was last in on this device where
 * they are in it still and it opens, else the first of theirs that opens. A household the
 * platform suspended is passed over while another opens: its own address answers `404` (D-115),
 * and a suspension is no reason to hold a member at a screen that shows nothing, away from a
 * household of theirs that works. A member in none but suspended ones is opened at the first of
 * them, where what there is to say of it is said. Undefined for a member in none.
 */
export function opening(
  households: readonly HouseholdSummary[],
  last: string | null,
): HouseholdSummary | undefined {
  const open = households.filter((household) => household.entitlement?.state !== 'suspended')
  return open.find((household) => sameId(household.id, last)) ?? open[0] ?? households[0]
}

/** What a read tells of itself, as TanStack Query holds it. */
export interface Read {
  readonly data: unknown
  readonly isError: boolean
  readonly fetchStatus: FetchStatus
}

/**
 * The state of a body that is read from the server (02-components §0). With nothing kept, a
 * read that failed and one that cannot be made for want of a connection are the same to a
 * member: the body could not be read, and no skeleton says otherwise. With something kept it
 * is drawn, and `offline` where it is as it was last read. `online` is the device's own word
 * for it (`useOnline`, api/query.ts).
 */
export function readState(read: Read, online: boolean, empty = false): DataState {
  if (read.data === undefined) return couldNotBeRead(read) ? 'error' : 'loading'
  if (empty) return 'empty'
  return online ? 'populated' : 'offline'
}

/**
 * Several reads that one body is drawn from, as the one read the body's state is told by
 * (`readState`): read once every one of them is, and until then failed or waiting for a
 * connection where any of those still unread is. One that was read and could not be read again
 * says nothing here: what the device kept of it is drawn.
 */
export function together(reads: readonly Read[]): Read {
  const unread = reads.filter((read) => read.data === undefined)
  return {
    data: unread.length === 0 ? reads : undefined,
    isError: unread.some((read) => read.isError),
    fetchStatus: unread.some((read) => read.fetchStatus === 'paused') ? 'paused' : 'idle',
  }
}
