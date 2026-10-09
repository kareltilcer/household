// Subscribe (A-27, `/households/{id}/settings/billing/subscribe`; PRD 04 §1, §6, §8; D-30,
// D-131, D-132): the one plan, what it costs paid by the year and by the month, what storage adds
// to it, and the payment, in the processor's own form.
//
// The payer subscribes, once their address is verified. The prices, the allowance and a block's
// size and price are the subscription's own answer and never this page's: a currency with no
// prices of its own is charged another's, on the server (D-132). The allowance and the block's
// price stand beside the base fee, so that an invoice is never the first time anybody learns the
// number (04 §8). The paid period starts when the payment goes through, on a trial too, and
// what is left of the trial is not carried over (D-131), which is said before anything is paid.
//
// Nothing is chosen for its member: how often they pay is asked, and what follows from it, the
// press that goes on to the payment, is absent until it is chosen (D-172). That press asks the
// server for what the form confirms, and not before it: asking makes a customer and an unpaid
// subscription at the processor. Its secret is kept in this screen's state while the form is
// drawn, and nowhere else.
//
// Once the processor has taken the payment the server is asked again, which is how it reads the
// processor itself and settles a household that is paid for. Its answer is not what the screen
// says: `already_subscribed` is a payment that went through and also a bank debit that is on its
// way, so the subscription is read, and the screen says the household is subscribed where that
// names a plan, and otherwise that the payment was sent, which billing then says is on its way
// (D-134). Answered `already_subscribed` the first time it is no error either: a credit covered
// it, or another tab paid.
//
// An owner who does not pay reads the plan and is told whose it is to subscribe; a household
// that is subscribed, or has a payment on its way, is told so with the way to billing; a member
// and a child profile have no billing (FR-BI5). An unverified payer is refused where they press,
// with the link offered again in the control's place (A-4).
//
// What the prototype drew and this does not: a card number typed into the app's own field (the
// form is the processor's), prices and "two months cheaper" as words of the page, and a yearly
// plan chosen before anybody chose it.
//
// A-27's states (ledger preset F) are *loading* and *error*, the subscription's read, and
// *populated*. The rest have nothing to be: nothing is listed to be *empty*; *offline* is the
// plan as this browser kept it, and a press that says it could not reach the server; nothing
// waits *pending* or *syncing*, a subscription being made at the processor or not at all;
// nothing is *conflicted* or *rejected*; *absent* is the neutral screen for everybody but an
// owner; and *read-only* changes nothing here, subscribing being how a household that takes no
// writes takes them again (FR-BI1).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { readState, useNoWithdrawal } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { askedNow } from '../api/query.ts'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import {
  subscriptionQuery,
  useReread,
  useSubscription,
  type Subscription,
} from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { HouseholdSettingsPage, Section } from '../household/settings/Page.tsx'
import { isUnverified, Unverified, useMarkUnverified } from '../household/Unverified.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { RadioGroup } from '../ui/Choice.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useToast } from '../ui/Toast.tsx'
import { intervals, isPayer, priceOf, type BillingIntent, type Interval } from './data.ts'
import {
  Refused,
  StorageTerms,
  useFocusKept,
  useMonthOfYear,
  usePayerName,
  usePriceWords,
  useRefusals,
} from './parts.tsx'
import { PaymentForm } from './PaymentForm.tsx'

function isInterval(value: string): value is Interval {
  return intervals.some((interval) => interval === value)
}

/**
 * What storage adds to the plan, and, for a reader who is not asked how often they pay, what
 * the plan costs each way: the payer reads the prices where they choose between them.
 */
function Plan({
  subscription,
  priced,
}: {
  readonly subscription: Subscription
  readonly priced: boolean
}) {
  const t = useTranslate()
  const prices = usePriceWords()
  const byMonth = useMonthOfYear()
  return (
    <Section title={t('billing.subscribe.plan')}>
      {priced ? (
        <ul className={account.group} role="list">
          {intervals.map((interval) => {
            const price = priceOf(subscription, interval)
            if (price === undefined) return null
            const month = interval === 'year' ? byMonth(price) : undefined
            return (
              <li key={interval}>
                <p className={account.text}>{prices(interval, price)}</p>
                {month === undefined ? null : <p className={account.note}>{month}</p>}
              </li>
            )
          })}
        </ul>
      ) : null}
      <StorageTerms subscription={subscription} />
    </Section>
  )
}

/** What the form confirms, and the way of paying it was asked for. */
interface Asked {
  readonly interval: Interval
  readonly intent: BillingIntent
}

function Paying({ subscription }: { readonly subscription: Subscription }) {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const me = useMe()
  const household = useHousehold()
  const reread = useReread(household.id)
  const refusals = useRefusals(household.id)
  const markUnverified = useMarkUnverified()
  const prices = usePriceWords()
  const byMonth = useMonthOfYear()
  const { id, name } = household
  // How often they pay: nobody's choice until it is theirs.
  const [often, setOften] = useState<Interval>()
  // The choice as it stands now, for an answer that arrives after it was changed.
  const choice = useRef<Interval | undefined>(undefined)
  const [asked, setAsked] = useState<Asked | null>(null)
  // How many times the server has said this account's address is not verified.
  const [blocked, setBlocked] = useState(0)

  const subscribe = (interval: Interval) =>
    api.POST('/households/{household_id}/billing/subscription', {
      params: { path: { household_id: id } },
      body: { interval },
    })
  /** The household is subscribed, or a payment for it is on its way: billing says which. */
  const already = () => {
    toast({ message: t('billing.subscribe.already.said', { household: name }) })
    void reread()
  }
  const toBilling = () => {
    void navigate(inHousehold.billing(id))
  }

  const begin = useMutation({
    ...askedNow,
    // Its answer is a secret: the query client keeps it no longer than this screen is drawn.
    gcTime: 0,
    mutationFn: async (interval: Interval) => unwrap(await subscribe(interval)),
    onSuccess: (intent, interval) => {
      // Asked for one way of paying and changed to the other meanwhile: what came is for a
      // subscription nobody wants, and is dropped. The press is there again for the other.
      if (choice.current === interval) setAsked({ interval, intent })
    },
    onError: (error) => {
      if (problemIn(error)?.code === 'already_subscribed') already()
      else if (isUnverified(error)) {
        // The server's word on it, whatever this page had read: the block stands where the
        // press was, and lifts when the account is read as verified.
        markUnverified()
        setBlocked((times) => times + 1)
      } else refusals.refuse(error)
    },
  })
  // The processor took the payment: the server is asked again, which reads the processor
  // itself and settles the household where it is paid. Its answer does not say which it is:
  // `already_subscribed` is a household whose payment went through, and also one whose bank
  // debit is on its way and has not cleared, the server making no second subscription beside
  // either. So the subscription is read, and what is said is what it reads.
  const settle = useMutation({
    ...askedNow,
    /** Whether the household is subscribed: the payment went through. */
    mutationFn: async (interval: Interval): Promise<boolean> => {
      try {
        // A secret answered again says the payment is on its way and not through. It is for no
        // form, and is kept nowhere.
        unwrap(await subscribe(interval))
        return false
      } catch (error) {
        if (problemIn(error)?.code !== 'already_subscribed') throw error
      }
      const stands = await queries.query({ ...subscriptionQuery(api, id), staleTime: 0 })
      return stands.interval !== null
    },
    onSuccess: (paid) => {
      toast({
        message: paid
          ? t('billing.subscribe.done', { household: name })
          : t('billing.subscribe.sent', { household: name }),
      })
    },
    onError: () => {
      // Whatever became of asking, the processor has the payment: billing says how it stands.
      toast({ message: t('billing.subscribe.sent', { household: name }) })
    },
    onSettled: () => {
      void reread()
    },
  })

  // The press gives its place to the form, and the form to the press again where the way of
  // paying is changed under it.
  const place = useFocusKept()

  const price = often === undefined ? undefined : priceOf(subscription, often)
  const month = often === 'year' && price !== undefined ? byMonth(price) : undefined
  const lapsed = subscription.state === 'read_only' || subscription.state === 'canceled'
  const found = problemIn(begin.error)?.code === 'already_subscribed'
  return (
    <>
      <Section title={t('billing.subscribe.pay.title')}>
        <RadioGroup
          label={t('billing.subscribe.often')}
          value={often}
          options={intervals.flatMap((interval) => {
            const each = priceOf(subscription, interval)
            return each === undefined ? [] : [{ value: interval, label: prices(interval, each) }]
          })}
          onChange={(value) => {
            if (!isInterval(value)) return
            choice.current = value
            setOften(value)
            refusals.clear()
            // What the form would confirm is a subscription paid the other way: it is put
            // away, its secret with it, and the press asks for the one now chosen.
            if (asked !== null && asked.interval !== value) setAsked(null)
          }}
        />
        {month === undefined ? null : <p className={account.note}>{month}</p>}
        <p className={account.text}>
          {subscription.state === 'trialing'
            ? t('billing.subscribe.starts.trial')
            : lapsed
              ? t('billing.subscribe.starts.lapsed', { household: name })
              : t('billing.subscribe.starts.now')}
        </p>
        <div ref={place} tabIndex={-1} className={account.view}>
          <div className={account.group}>
            {/* What follows from the choice is absent until it is made (D-172). */}
            {often === undefined || price === undefined ? null : asked !== null ? (
              <PaymentForm
                intent={asked.intent}
                submit={
                  often === 'year'
                    ? t('billing.subscribe.pay.year', { price: format.money(price) })
                    : t('billing.subscribe.pay.month', { price: format.money(price) })
                }
                unchanged={t('billing.subscribe.unchanged', { household: name })}
                onConfirmed={() => {
                  settle.mutate(asked.interval, { onSettled: toBilling })
                }}
              />
            ) : blocked > 0 && !me.email_verified ? (
              <Unverified key={blocked} why={t('billing.subscribe.unverified')} announce />
            ) : (
              <div className={account.actions}>
                <Button
                  variant="primary"
                  // Busy, once the household is found subscribed, until billing has come.
                  loading={begin.isPending || found}
                  onClick={() => {
                    refusals.clear()
                    begin.mutate(often, {
                      onError: (error) => {
                        if (problemIn(error)?.code === 'already_subscribed') toBilling()
                      },
                    })
                  }}
                >
                  {t('billing.subscribe.continue')}
                </Button>
              </div>
            )}
            <Refused said={refusals.refused} />
          </div>
        </div>
      </Section>
      <Link className={account.link} to={inHousehold.billing(id)}>
        {t('billing.subscribe.back')}
      </Link>
    </>
  )
}

function Read() {
  const t = useTranslate()
  const online = useOnline()
  const me = useMe()
  const household = useHousehold()
  const withdrawn = useNoWithdrawal()
  const read = useSubscription(household.id)
  const subscription = read.data
  const payerName = usePayerName(subscription ?? { payer: null })
  const billing = (
    <Link className={account.link} to={inHousehold.billing(household.id)}>
      {t('household.settings.billing.title')}
    </Link>
  )
  return (
    <HouseholdSettingsPage
      title={t('billing.subscribe.title')}
      lead={t('billing.subscribe.lead', { household: household.name })}
      note={false}
    >
      <StateFrame
        state={readState(read, online)}
        skeleton={
          <Skeleton
            bars={[
              [45, 1.25],
              [70, 1],
              [70, 1],
              [90, 1],
              [40, 2.75],
            ]}
          />
        }
        // Nothing is listed here: the plan is one.
        empty={null}
        texts={{
          error: {
            title: t('billing.subscribe.error.title'),
            text: t('billing.subscribe.error.body'),
            actions: (
              <Button
                onClick={() => {
                  void read.refetch()
                }}
              >
                {t('ui.retry')}
              </Button>
            ),
          },
          withdrawn,
        }}
      >
        {() => {
          if (subscription === undefined) return null
          if (subscription.interval !== null) {
            return (
              <Section title={t('billing.subscribe.already.title')}>
                <p className={account.text}>{t('billing.subscribe.already.body')}</p>
                {billing}
              </Section>
            )
          }
          if (subscription.payment_pending) {
            return (
              <Section title={t('billing.subscribe.pending.title')}>
                <p className={account.text}>{t('billing.pending')}</p>
                {billing}
              </Section>
            )
          }
          const payer = isPayer(subscription, me.id)
          return (
            <>
              <Plan subscription={subscription} priced={!payer} />
              {payer ? (
                <Paying subscription={subscription} />
              ) : (
                <Section title={t('billing.payer.title')}>
                  {payerName === null ? null : (
                    <p className={account.text}>
                      {t('billing.subscribe.payers', { name: payerName })}
                    </p>
                  )}
                  {billing}
                </Section>
              )}
            </>
          )
        }}
      </StateFrame>
    </HouseholdSettingsPage>
  )
}

export function Subscribe() {
  const household = useHousehold()
  // Absent: no screen, no reason, and nothing asked of the server (FR-BI5).
  if (household.my_role !== 'owner') return <NotAvailable home={inHousehold.home(household.id)} />
  return <Read />
}
