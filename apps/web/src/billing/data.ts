// What billing's screens share that draws nothing (PRD 04 §6, FR-BI4 to FR-BI6; 17 §6): the
// invoices their reader paid, who pays, what a plan costs, how a refusal is said, and how the
// processor's word on a confirmation is waited for.
//
// The subscription and the month's usage are read through the household's own data
// (household/data.ts), and everything here is filed under the household's key beside them. Every
// write is asked at once (D-170) and none is queued: billing is no part of a replica.
//
// Nothing here moves on the page's own say-so. The processor holds the subscription's state, and
// the server says it when the processor has (D-134): a screen that has had a payment or a method
// confirmed reads the subscription again, and says what it then reads.
import type { components } from '@household/api'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { sameId } from '../account/common.ts'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { inHousehold } from '../app/paths.ts'
import type { Subscription } from '../household/data.ts'
import { householdKey, subscriptionKey } from '../household/households.ts'
import { useTimeZone } from '../household/timezone.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { confirmationReads } from './cadence.ts'

export type Invoice = components['schemas']['Invoice']
export type InvoicePage = components['schemas']['InvoicePage']
export type BillingIntent = components['schemas']['BillingIntent']
export type Interval = components['schemas']['BillingInterval']['interval']
export type Money = components['schemas']['Money']
/** The payer's offer of billing to another owner, while it is open. */
export type Offer = NonNullable<Subscription['transfer']>
/** The summary of the method a subscription is charged with, which its payer alone reads. */
export type Method = NonNullable<Subscription['payment_method']>

/** The intervals a plan is paid at, in the order they are offered: the year first. */
export const intervals: readonly Interval[] = ['year', 'month']

/**
 * Whether `user` pays for the household, as its subscription names its payer. Billing reads who
 * pays off the subscription it draws, which it reads again by itself while it waits for the
 * processor's word, and not off the household's members (`useReader`, household/data.ts): the
 * two are read at different moments, and the page would say two things of one payer.
 */
export function isPayer(subscription: Pick<Subscription, 'payer'>, user: string): boolean {
  return sameId(subscription.payer?.user_id, user)
}

/** What paying at `interval` costs, as the subscription's own `plans` say it (D-132). */
export function priceOf(
  subscription: Pick<Subscription, 'plans'>,
  interval: Interval,
): Money | undefined {
  return subscription.plans.find((plan) => plan.interval === interval)?.price
}

/**
 * What a year's price comes to each month, where the year divides into twelve whole amounts of
 * the currency's minor unit. Where it does not, nothing: a month's share rounded here would be a
 * price nobody is charged.
 */
export function monthOf(year: Money): Money | undefined {
  if (year.amount_minor % 12 !== 0) return undefined
  return { amount_minor: year.amount_minor / 12, currency: year.currency }
}

/** The billing screen's own address in full: where the processor sends a member back to. */
export function returnAddress(household: string): string {
  return new URL(inHousehold.billing(household), window.location.origin).href
}

/** The invoices a household's reader paid (`getBillingInvoices`), under the household's own key. */
export function invoicesKey(household: string) {
  return [...householdKey(household), 'billing', 'invoices'] as const
}

/**
 * The invoices the caller paid, the newest first, a page at a time. An invoice is its payer's
 * (D-135): an owner who paid none is answered `403`, which is no failure of the read and is
 * drawn as nothing; one who paid some before handing billing on still reads theirs.
 */
export function useInvoices(household: string, { enabled = true } = {}) {
  const api = useApi()
  return useInfiniteQuery({
    queryKey: invoicesKey(household),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/billing/invoices', {
          params: {
            path: { household_id: household },
            query: pageParam === null ? {} : { cursor: pageParam },
          },
          signal,
        }),
      ),
    getNextPageParam: (last) => (last.meta.has_more ? (last.meta.next_cursor ?? null) : null),
    enabled,
  })
}

/**
 * Whether a refused write says the page is no longer how billing stands: its member pays no
 * longer or owns no longer, or the subscription began or ended since it was read. Whoever is
 * told one reads the household again, and the controls that are theirs no longer leave with it.
 */
export function isMoved(error: unknown): boolean {
  switch (problemIn(error)?.code) {
    case 'forbidden':
    case 'not_found':
    case 'not_subscribed':
    case 'already_subscribed':
      return true
    default:
      return false
  }
}

/**
 * What a write of billing's was refused with, said by its `code`: that it is the payer's and its
 * member pays no longer, that billing is an owner's, that there is no subscription to change,
 * that the processor cannot be asked. Anything else is what every screen says of a request that
 * failed, the server not reached among it.
 */
export function useBillingRefusal(): (error: unknown) => string {
  const t = useTranslate()
  const say = useProblemText(useTimeZone())
  return useCallback(
    (error) => {
      switch (problemIn(error)?.code) {
        case 'forbidden':
          return t('billing.refused.not_payer')
        case 'not_found':
          return t('billing.refused.not_owner')
        case 'not_subscribed':
          return t('billing.refused.not_subscribed')
        case 'already_subscribed':
          return t('billing.refused.already_subscribed')
        case 'billing_unavailable':
          return t('billing.refused.unavailable')
        default:
          return say(error)
      }
    },
    [t, say],
  )
}

/** Where a wait for the processor's word stands. */
export type Waiting =
  /** Nothing is waited for. */
  | 'idle'
  /** The subscription is being read again. */
  | 'reading'
  /** It was read as often as it is, and does not say yet: the screen says it does not know. */
  | 'unsaid'

export interface Wait {
  readonly state: Waiting
  /** Begins reading: its caller has just read once. */
  readonly begin: () => void
  /** Ends it: what was waited for was read, or the screen that waited has something else to say. */
  readonly end: () => void
}

/**
 * Reads the household's subscription again, a bounded number of times, for as long as its caller
 * waits. The caller looks at what is read: it ends the wait when the subscription says what it
 * waited for, and where the reads run out it says that the processor has not said yet. `begun`
 * is whether the screen opens waiting: a member the processor sent back to it.
 */
export function useProcessorsWord(household: string, begun = false): Wait {
  const queries = useQueryClient()
  /** The reads still to make, or null while nothing is waited for. */
  const [left, setLeft] = useState<number | null>(begun ? confirmationReads.times : null)
  const reading = left !== null && left > 0
  useEffect(() => {
    if (!reading) return undefined
    const timer = setInterval(() => {
      // A read still on its way is left to land, and not given up for this one: on a connection
      // slower than the reads come, each would otherwise be abandoned for the next, and nothing
      // read until the last.
      void queries.invalidateQueries(
        { queryKey: subscriptionKey(household), exact: true },
        { cancelRefetch: false },
      )
      setLeft((reads) => (reads === null ? null : reads - 1))
    }, confirmationReads.every)
    return () => {
      clearInterval(timer)
    }
  }, [reading, queries, household])
  const begin = useCallback(() => {
    setLeft(confirmationReads.times)
  }, [])
  const end = useCallback(() => {
    setLeft(null)
  }, [])
  return { state: left === null ? 'idle' : left > 0 ? 'reading' : 'unsaid', begin, end }
}
