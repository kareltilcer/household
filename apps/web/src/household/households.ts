// The households a member is in, and the one an address names, as the API answers them. Every
// household-scoped screen reads the household through here, by the id in its address (D-4): there
// is no current household kept anywhere but there.
import type { ApiClient, components } from '@household/api'
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'

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

/** The word for a member's role in a household. */
export function useRoleWord(): (role: HouseholdRole | undefined) => string {
  const t = useTranslate()
  return (role) => {
    switch (role) {
      case 'owner':
        return t('shell.role.owner')
      case 'child':
        return t('shell.role.child')
      case 'member':
      case undefined:
        return t('shell.role.member')
    }
  }
}

/** The list of a member's households: read by key where a membership is made or ended. */
export const householdsKey = ['households'] as const

/** One household, as its own representation: its grants, its flags, its entitlement. */
export function householdKey(household: string) {
  return ['households', household.toLowerCase()] as const
}

/**
 * A household's members, as the API lists them (`getMembers`): under the household's own key, so
 * that what clears the household's representation clears its members with it.
 */
export function membersKey(household: string) {
  return [...householdKey(household), 'members'] as const
}

/** The invitations a household sent (`getInvitations`), under the household's own key too. */
export function invitationsKey(household: string) {
  return [...householdKey(household), 'invitations'] as const
}

/** Which modules a household has on (`getModules`), under the household's own key too. */
export function moduleStatesKey(household: string) {
  return [...householdKey(household), 'modules'] as const
}

/**
 * A household's subscription (`getBillingSubscription`), under the household's own key too: what
 * moves the household's entitlement moves this, and the two are read again together.
 */
export function subscriptionKey(household: string) {
  return [...householdKey(household), 'billing', 'subscription'] as const
}

/** The month's storage as it will be billed (`getBillingUsage`), under the household's own key. */
export function usageKey(household: string) {
  return [...householdKey(household), 'billing', 'usage'] as const
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
 * that is `suspended`, and an id that is none answer `404` alike, and read the same here.
 */
export function householdQuery(api: ApiClient, household: string) {
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

export function useHouseholdQuery(household: string): UseQueryResult<Household> {
  return useQuery(householdQuery(useApi(), household))
}

/** Where the household a member was last in is kept, in this browser, for each member. */
function lastKey(user: string): string {
  return `household.last.${user}`
}

/** The household `user` was last in on this browser, where they were in one. */
export function lastHousehold(user: string): string | null {
  try {
    return window.localStorage.getItem(lastKey(user))
  } catch {
    return null
  }
}

/** Remembers that `user` is in `household` now: where the app opens for them next. */
export function rememberHousehold(user: string, household: string): void {
  try {
    window.localStorage.setItem(lastKey(user), household)
  } catch {
    // The app opens at their first household.
  }
}
