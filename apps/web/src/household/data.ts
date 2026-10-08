// What a household's own screens read of it through the API (PRD 17 §1 to §3): its members with
// what each holds, the invitations it sent, which modules it has on, and the countries a
// household can be set in. Each is a query of TanStack's, so that what this browser kept is
// drawn where the server cannot be asked, and each is filed under the household's own key, so
// that what clears the household clears it too (households.ts).
//
// Nothing here is written offline. A household's settings, its memberships, its modules and its
// invitations are never a queued change (PRD 17, Sync; D-80): a member may not come to believe
// they changed who holds what with no connection. Every write of these screens is asked at once
// (`askedNow`, api/query.ts), and says so where the server could not be reached.
import type { ApiClient, components } from '@household/api'
import { queryOptions, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { catalogLocale, pseudoLocale, pseudolocalize } from '@household/i18n/lazy'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useFormat, useI18n } from '../i18n/I18nProvider.tsx'
import {
  householdKey,
  householdsKey,
  invitationsKey,
  membersKey,
  moduleStatesKey,
  type Household,
  type ModuleKey,
} from './households.ts'

export type Membership = components['schemas']['Membership']
export type Invitation = components['schemas']['Invitation']
export type InvitationForInvitee = components['schemas']['InvitationForInvitee']
export type ModuleState = components['schemas']['ModuleState']
export type Country = components['schemas']['Country']
export type LocalizedText = components['schemas']['LocalizedText']

/** A household's members, in the order they joined, each with what they hold. */
export function membersQuery(api: ApiClient, household: string) {
  return queryOptions({
    queryKey: membersKey(household),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/members', {
          params: { path: { household_id: household } },
          signal,
        }),
      ).items ?? [],
  })
}

export function useMembers(household: string): UseQueryResult<Membership[]> {
  return useQuery(membersQuery(useApi(), household))
}

/**
 * The names of the household's owners, in the order they joined: whose it is to change what a
 * member may only read. Nobody's while the members are unread.
 */
export function useOwnerNames(household: string): string[] {
  return (useMembers(household).data ?? [])
    .filter((member) => member.role === 'owner')
    .map((member) => member.display_name ?? '')
    .filter((name) => name !== '')
}

/**
 * The invitations a household sent, newest first, in every status. A member who holds `none` on
 * household settings is answered `404`: the invitations are what `view` on it unlocks.
 */
export function invitationsQuery(api: ApiClient, household: string) {
  return queryOptions({
    queryKey: invitationsKey(household),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/invitations', {
          params: { path: { household_id: household } },
          signal,
        }),
      ).items ?? [],
  })
}

export function useInvitations(
  household: string,
  { enabled = true }: { readonly enabled?: boolean } = {},
): UseQueryResult<Invitation[]> {
  return useQuery({ ...invitationsQuery(useApi(), household), enabled })
}

/** Every module with whether the household has it on, in the contract's order. */
export function moduleStatesQuery(api: ApiClient, household: string) {
  return queryOptions({
    queryKey: moduleStatesKey(household),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/modules', {
          params: { path: { household_id: household } },
          signal,
        }),
      ).items ?? [],
  })
}

export function useModuleStates(household: string): UseQueryResult<ModuleState[]> {
  return useQuery(moduleStatesQuery(useApi(), household))
}

/**
 * The modules the household has off, whatever anybody holds on them. Until they are read none
 * is said to be: a level on a module that is off holds for when it is turned on.
 */
export function useOff(household: string): ReadonlySet<ModuleKey> {
  const states = useModuleStates(household).data
  return useMemo(
    () =>
      new Set(
        (states ?? []).flatMap((state) =>
          state.enabled === false && state.module !== undefined ? [state.module] : [],
        ),
      ),
    [states],
  )
}

/** The countries Household has a profile of: the ones a household can be set in. */
export const countriesKey = ['reference', 'countries'] as const

export function useCountries(): UseQueryResult<Country[]> {
  const api = useApi()
  return useQuery({
    queryKey: countriesKey,
    queryFn: async ({ signal }) => unwrap(await api.GET('/reference/countries', { signal })).items,
  })
}

/**
 * A text of the reference data, a country's name, in the language the app is shown in. The
 * pseudo-locale reads English's, pseudo-localised as every word of the app's is there, so that
 * its pass tells a name the reference data gave from a word nobody translated.
 */
export function useLocalized(): (text: LocalizedText) => string {
  const { locale } = useI18n()
  return useCallback(
    (text) => (locale === pseudoLocale ? pseudolocalize(text.en) : text[catalogLocale(locale)]),
    [locale],
  )
}

/**
 * `countries` as a list to choose from: by name, in the language the app is shown in, as a list
 * of countries is looked through.
 */
export function useCountryChoices(
  countries: readonly Country[],
): { readonly value: string; readonly label: string }[] {
  const localized = useLocalized()
  const { locale } = useFormat()
  return useMemo(() => {
    const collator = new Intl.Collator(locale)
    return countries
      .map((country) => ({ value: country.code, label: localized(country.name) }))
      .sort((one, other) => collator.compare(one.label, other.label))
  }, [countries, localized, locale])
}

/**
 * The invitations waiting for the member who is signed in: the ones sent to their address, once
 * it is verified, to households they are not in. Filed under the account's key, as everything
 * of a member's own is, and gone with it when their session ends.
 */
export const waitingInvitationsKey = ['me', 'invitations'] as const

export function useWaitingInvitations({
  enabled = true,
}: { readonly enabled?: boolean } = {}): UseQueryResult<InvitationForInvitee[]> {
  const api = useApi()
  return useQuery({
    queryKey: waitingInvitationsKey,
    queryFn: async ({ signal }) => unwrap(await api.GET('/me/invitations', { signal })).items ?? [],
    enabled,
  })
}

/** Whether the household takes writes: one that is read-only or restricted draws none (FR-BI2). */
export function writes(household: Pick<Household, 'entitlement'>): boolean {
  return household.entitlement?.can_write !== false
}

/**
 * What a write to a household leaves to be read again: the household as its member reads it,
 * their own grants among it, and everything filed under it, its members, its invitations and
 * its modules; and the list of the member's households, which names it and counts its members.
 * A screen calls it once its write is answered, and waits on it where what it draws next is
 * what was read.
 */
export function useReread(household: string): () => Promise<void> {
  const queries = useQueryClient()
  return useCallback(async () => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: householdKey(household) }),
      queries.invalidateQueries({ queryKey: householdsKey, exact: true }),
    ])
  }, [queries, household])
}
