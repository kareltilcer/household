// What billing's three screens draw alike (PRD 04 §1, §3, §8; FR-BI5): the household's state in a
// word, a glyph and a tone together, what a plan costs and what storage adds to it, how a payment
// method's summary is said, and where a refusal that is no field's is said.
//
// Nothing of the contract's own wording is drawn: a state, a card's brand and a refusal's code
// each have words of the catalog's. And no number is the page's own: a price, the allowance, a
// block's size and its price are the subscription's (`plans`, `included_storage_bytes`,
// `storage_block_bytes`, `price_per_storage_block`), so that what a currency is charged is set
// in one place, on the server (D-132).
import type { BaseId } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { refocus, useSaid, type Said } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { problemIn } from '../api/problem.ts'
import { useReread, type Subscription } from '../household/data.ts'
import type { EntitlementState } from '../household/households.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { useToast } from '../ui/Toast.tsx'
import styles from './Billing.module.css'
import {
  isMoved,
  isPayer,
  monthOf,
  useBillingRefusal,
  type Interval,
  type Method,
  type Money,
} from './data.ts'

/** How a state is toned: which of the status colours its glyph takes, beside its word. */
type Tone = 'positive' | 'info' | 'warning' | 'danger'

const marks: Readonly<Record<EntitlementState, { readonly tone: Tone; readonly glyph: BaseId }>> = {
  trialing: { tone: 'info', glyph: 'clock' },
  active: { tone: 'positive', glyph: 'check' },
  past_due: { tone: 'warning', glyph: 'alert-triangle' },
  grace: { tone: 'warning', glyph: 'alert-triangle' },
  read_only: { tone: 'danger', glyph: 'alert-circle' },
  canceled: { tone: 'danger', glyph: 'alert-circle' },
  restricted: { tone: 'warning', glyph: 'shield' },
  suspended: { tone: 'danger', glyph: 'alert-circle' },
}

/** The household's state in a word of the catalog's: the contract's own name for it is drawn nowhere. */
export function useStateWord(): (state: EntitlementState) => string {
  const t = useTranslate()
  return (state) => {
    switch (state) {
      case 'trialing':
        return t('billing.state.trialing')
      case 'active':
        return t('billing.state.active')
      case 'past_due':
        return t('billing.state.past_due')
      case 'grace':
        return t('billing.state.grace')
      case 'read_only':
        return t('billing.state.read_only')
      case 'canceled':
        return t('billing.state.canceled')
      case 'restricted':
        return t('billing.state.restricted')
      case 'suspended':
        return t('billing.state.suspended')
    }
  }
}

/** The household's state: its colour, its glyph and its word together (N2). */
export function StateWord({ state }: { readonly state: EntitlementState }) {
  const word = useStateWord()
  const mark = marks[state]
  return (
    <p className={styles.state}>
      <span className={styles.stateGlyph} data-tone={mark.tone}>
        <BaseIcon name={mark.glyph} size={24} />
      </span>
      <span className={styles.stateWord}>{word(state)}</span>
    </p>
  )
}

/** What paying at `interval` costs, in a phrase: *EUR 59.88 a year*. */
export function usePriceWords(): (interval: Interval, price: Money) => string {
  const t = useTranslate()
  const format = useFormat()
  return (interval, price) =>
    interval === 'year'
      ? t('billing.plan.year', { price: format.money(price) })
      : t('billing.plan.month', { price: format.money(price) })
}

/**
 * What a year's price comes to each month, in a sentence, where the currency divides it evenly;
 * where it does not, nothing is said of a month (data.ts, `monthOf`).
 */
export function useMonthOfYear(): (year: Money) => string | undefined {
  const t = useTranslate()
  const format = useFormat()
  return (year) => {
    const month = monthOf(year)
    return month === undefined
      ? undefined
      : t('billing.plan.year_by_month', { price: format.money(month) })
  }
}

/**
 * What storage adds to the base fee, said beside it wherever a plan is offered (04 §8): the
 * allowance, the block's size and its price, how the blocks are counted, and the most there can
 * be. An invoice is never the first time a customer learns the number.
 */
export function StorageTerms({ subscription }: { readonly subscription: Subscription }) {
  const t = useTranslate()
  const format = useFormat()
  return (
    <p className={account.text}>
      {t('billing.storage.terms', {
        included: format.bytes(subscription.included_storage_bytes),
        block: format.bytes(subscription.storage_block_bytes),
        price: format.money(subscription.price_per_storage_block),
        most: subscription.max_storage_blocks,
      })}
    </p>
  )
}

/** Who pays, by name, and that it is the reader where it is: null once the payer's account is gone. */
export function usePayerName(subscription: Pick<Subscription, 'payer'>): string | null {
  const t = useTranslate()
  const me = useMe()
  const name = subscription.payer?.label ?? ''
  if (subscription.payer == null || name === '') return null
  return isPayer(subscription, me.id) ? t('household.members.you', { name }) : name
}

/** The names of the brands and kinds of method the catalog has a word for. */
function brandWord(t: ReturnType<typeof useTranslate>, brand: string): string | undefined {
  switch (brand) {
    case 'visa':
      return t('billing.method.brand.visa')
    case 'mastercard':
      return t('billing.method.brand.mastercard')
    case 'amex':
      return t('billing.method.brand.amex')
    case 'diners':
      return t('billing.method.brand.diners')
    case 'discover':
      return t('billing.method.brand.discover')
    case 'jcb':
      return t('billing.method.brand.jcb')
    case 'unionpay':
      return t('billing.method.brand.unionpay')
    case 'cartes_bancaires':
      return t('billing.method.brand.cartes_bancaires')
    default:
      return undefined
  }
}

/**
 * A payment method's summary in a sentence: a card by its brand, its last four digits and when
 * it expires; a bank debit by its account's last four, where it has them; and a kind this build
 * has no word for by what it is known by. The processor's own word for a brand is not drawn.
 */
export function useMethodWords(): (method: Method) => string {
  const t = useTranslate()
  const format = useFormat()
  return (method) => {
    const last4 = method.last4 ?? ''
    if (method.brand === 'sepa_debit') {
      return last4 === '' ? t('billing.method.debit') : t('billing.method.debit_ending', { last4 })
    }
    const brand = brandWord(t, method.brand) ?? t('billing.method.brand.other')
    if (last4 === '') return brand
    if (method.exp_month === null || method.exp_year === null) {
      return t('billing.method.card_ending', { brand, last4 })
    }
    return t('billing.method.card_expiring', {
      brand,
      last4,
      month: format.number(method.exp_month, { minimumIntegerDigits: 2 }),
      year: format.number(method.exp_year, { useGrouping: false }),
    })
  }
}

/**
 * Where the focus goes when a control of one part of a screen has left the page with the focus
 * on it: to the part's own place, which takes the ref this answers and a `tabIndex` of -1. A
 * button gives its place to the payment form, the form to a sentence, *Cancel* to *Resume*, a
 * question closes over a control that is gone: each took the focus with it, and nothing else
 * says where its member is (D-166).
 *
 * It is moved only where it was last on something inside the part that is on the page no
 * longer. A focus that went anywhere else meanwhile is its member's and is left alone, and so
 * is one that was never here: what changes under a member who is reading moves nothing. The
 * look is taken after every drawing of the part, since a control may leave under a question
 * that is still open and be missed only when the question closes.
 *
 * It is one part that is watched, of a screen that has several, each with a place of its own. A
 * screen with one place for its whole page, whose controls leave together, keeps the focus by
 * whether they are drawn (account/common.ts, `useFocusKept`): the two are not one hook, since
 * that one watches the whole page and would move the focus to the wrong part here.
 */
export function useFocusKept(): RefObject<HTMLDivElement | null> {
  const place = useRef<HTMLDivElement>(null)
  /** The control inside the part that took the focus last, until the focus goes elsewhere. */
  const held = useRef<Element | null>(null)
  useEffect(() => {
    const note = (event: FocusEvent) => {
      const part = place.current
      const target = event.target instanceof Element ? event.target : null
      held.current = target !== null && target !== part && part?.contains(target) ? target : null
    }
    document.addEventListener('focusin', note)
    return () => {
      document.removeEventListener('focusin', note)
    }
  }, [])
  useEffect(() => {
    if (held.current?.isConnected !== false) return
    held.current = null
    refocus(place.current)
  })
  return place
}

export interface Refusals {
  /** What the last write was refused with, until the next is asked. */
  readonly refused: Said | null
  /**
   * Says what `error` refused a write with, and reads the household again where the refusal says
   * the page is no longer how billing stands. It answers whether it is: its caller then closes
   * what the write was asked from. A reader who owns the household no longer is told in a toast:
   * the screen is about to be the neutral *not available*, and a banner would go with it.
   */
  readonly refuse: (error: unknown) => boolean
  /** Says `text` as a refusal: what a write came to that no problem of the server's says. */
  readonly say: (text: string) => void
  readonly clear: () => void
}

/** What the writes of one part of a billing screen are refused with. */
export function useRefusals(household: string): Refusals {
  const [refused, say] = useSaid()
  const refusal = useBillingRefusal()
  const reread = useReread(household)
  const toast = useToast()
  const refuse = useCallback(
    (error: unknown) => {
      if (problemIn(error)?.code === 'not_found') {
        say(null)
        toast({ message: refusal(error) })
      } else say(refusal(error))
      const moved = isMoved(error)
      if (moved) void reread()
      return moved
    },
    [say, refusal, reread, toast],
  )
  const clear = useCallback(() => {
    say(null)
  }, [say])
  return { refused, refuse, say, clear }
}

/** A refusal that is no field's: a banner of its own for each, so that a second is said again. */
export function Refused({ said }: { readonly said: Said | null }) {
  if (said === null) return null
  return (
    <Banner key={said.id} tone="danger" announce>
      {said.text}
    </Banner>
  )
}
