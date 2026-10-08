// What one member's page shares that draws nothing (PRD 17 §2): the read of the member, what a
// change of their levels comes to before it is saved, what a refused write is said to have been
// refused with, and where the focus goes when the control that held it leaves the page.
//
// The member is read by their own address, which answers their membership's version, the
// `If-Match` of every change of it. The read is filed under the household's members
// (households.ts), so that whatever reads the members again reads this one again too.
import type { ApiClient } from '@household/api'
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { problemIn, unwrap } from '../../api/problem.ts'
import { useApi } from '../../api/ApiProvider.tsx'
import { useProblemText } from '../../api/problemText.ts'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useReread, type Membership } from '../data.ts'
import { changedModules, isLowered, type Levels } from '../grants.ts'
import { membersKey, type HouseholdRole, type ModuleKey } from '../households.ts'
import { useTimeZone } from '../timezone.ts'

/** One member of a household, under the household's members. */
export function memberKey(household: string, user: string) {
  return [...membersKey(household), user.toLowerCase()] as const
}

/**
 * The member `user` names, as the caller reads them. An id that is no member's, and one that is
 * no id at all, answer `404` alike.
 */
export function memberQuery(api: ApiClient, household: string, user: string) {
  return queryOptions({
    queryKey: memberKey(household, user),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/members/{user_id}', {
          params: { path: { household_id: household, user_id: user } },
          signal,
        }),
      ),
  })
}

export function useMember(household: string, user: string): UseQueryResult<Membership> {
  return useQuery(memberQuery(useApi(), household, user))
}

/**
 * The member a page is about, as its parts read them: the answer, with what the contract leaves
 * optional settled once, and whether the reader is looking at themself.
 */
export interface Subject {
  /** Their id, as the page's address names them. */
  readonly id: string
  readonly name: string
  readonly role: HouseholdRole
  /** Their membership's version: the `If-Match` of a change of it. */
  readonly version: number
  /** Whether they pay for the household: the payer stays an owner, and in it, until billing moves. */
  readonly payer: boolean
  /** Whether the page is the reader's own. */
  readonly own: boolean
  readonly membership: Membership
}

export function subjectOf(membership: Membership, user: string, reader: string): Subject {
  const id = membership.user_id ?? user
  return {
    id,
    name: membership.display_name ?? '',
    role: membership.role ?? 'member',
    version: membership.version ?? 0,
    payer: membership.is_billing_payer === true,
    own: id.toLowerCase() === reader.toLowerCase(),
    membership,
  }
}

/** What a change of somebody's levels comes to, by module, in the matrix's order. */
export interface GrantChange {
  readonly raised: readonly ModuleKey[]
  /** Every module lowered, the ones lowered to *Off* among them. */
  readonly lowered: readonly ModuleKey[]
  /** The modules lowered to *Off*: the ones that leave the member's app, and their devices. */
  readonly off: readonly ModuleKey[]
}

export function grantChange(from: Levels, next: Levels): GrantChange {
  const changed = changedModules(from, next)
  const lowered = changed.filter((module) => isLowered(from[module], next[module]))
  return {
    raised: changed.filter((module) => !lowered.includes(module)),
    lowered,
    off: lowered.filter((module) => next[module] === 'none'),
  }
}

/**
 * Whether `error` says the page is no longer how things stand: somebody changed the member
 * meanwhile, the member is gone, or the reader is no longer an owner. What the page shows is
 * then read again.
 */
export function isStale(error: unknown): boolean {
  switch (problemIn(error)?.code) {
    case 'version_conflict':
    case 'forbidden':
    case 'not_found':
    case 'last_owner':
    case 'billing_payer':
      return true
    default:
      return false
  }
}

/** A refusal that is no field's, as its banner says it: a new one for each refusal. */
export interface Refusal {
  readonly key: number
  readonly text: string
}

export interface Refusals {
  /** What the last write was refused with, until the next is asked. */
  readonly refusal: Refusal | undefined
  /**
   * Says what `error` refused a write with, in `own` words where the screen has them for it, and
   * reads the page again where the refusal says it is stale. It answers whether it was: its
   * caller then closes what the write was asked from, a question whose ground has moved.
   */
  readonly refuse: (error: unknown, own?: string) => boolean
  readonly clear: () => void
}

/**
 * What the writes of one part of the page are refused with. A member who is gone is said in a
 * toast, and nowhere on the page: the page is about to be the neutral *not available*, or a
 * child profile's controls to leave it, and a banner would go with what it stood beside.
 */
export function useRefusals(household: string): Refusals {
  const t = useTranslate()
  const toast = useToast()
  const say = useProblemText(useTimeZone())
  const reread = useReread(household)
  const [refusal, setRefusal] = useState<Refusal>()
  const refuse = useCallback(
    (error: unknown, own?: string) => {
      const said = (text: string) => {
        setRefusal((last) => ({ key: (last?.key ?? 0) + 1, text }))
      }
      switch (problemIn(error)?.code) {
        case 'not_found':
          setRefusal(undefined)
          toast({ message: t('household.settings.refused.gone') })
          break
        case 'version_conflict':
          said(t('household.settings.refused.conflict'))
          break
        case 'forbidden':
          said(t('household.settings.refused.not_owner'))
          break
        case 'entitlement_read_only':
        case 'entitlement_restricted':
          said(own ?? t('household.settings.refused.read_only'))
          break
        default:
          said(own ?? say(error))
      }
      const stale = isStale(error)
      if (stale) void reread()
      return stale
    },
    [t, toast, say, reread],
  )
  const clear = useCallback(() => {
    setRefusal(undefined)
  }, [])
  return { refusal, refuse, clear }
}

/**
 * Hands the focus on when what held it leaves the page. A control drawn only while `held`, the
 * buttons under a changed form or the action of a banner, takes the focus with it when it goes,
 * and nothing else says where the member is: the focus is put on `target`, which stays. A focus
 * that is anywhere else by then is its member's, and is left alone.
 */
export function useFocusHandedOn(held: boolean, target: RefObject<HTMLElement | null>): void {
  const was = useRef(held)
  useEffect(() => {
    if (was.current && !held) {
      const focused = document.activeElement
      if (focused === null || focused === document.body) target.current?.focus()
    }
    was.current = held
  }, [held, target])
}
