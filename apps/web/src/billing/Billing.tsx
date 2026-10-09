// Manage billing (A-28, which is C-55; `/households/{id}/settings/billing`; PRD 04 §3, §6; 17 §6;
// FR-BI4 to FR-BI6): the subscription as its owners read it, and as its payer manages it.
//
// Every owner reads how the household stands, what the plan costs, who pays, the month's storage
// as it will be billed, and an offer of billing while one is open. The payer alone reads the
// payment method and the invoices, which are theirs (D-135), and alone has a control: changing
// how often they pay, replacing the method, cancelling and taking a cancellation back, and
// offering billing to another owner (Handover.tsx). A member and a child profile have no billing
// at all (FR-BI5): the address draws the neutral *not available*, and the server is asked nothing.
//
// Everything under billing is outside the gate that holds a read-only household's writes
// (FR-BI1): a subscription that could not be paid for because it was not paid for would be a
// trap. So in a household that takes no writes these controls are drawn, and the screen says so
// in the strip that elsewhere says why controls are gone.
//
// Nothing moves on this page's say-so (D-134). A cancellation takes effect when the paid period
// ends and is taken back until then; a change of interval is prorated by the processor, now; a
// method is in use once the processor has confirmed it, which this page reads and does not
// assume. What a bank's own page carried back in the address is taken out of it before anything
// else is done, and is believed for nothing: the subscription is read again.
//
// What the prototype drew and this does not, each because the PRD says otherwise: a cancellation
// that takes effect at once, an interval that changes at the next renewal, *resume* for a
// subscription that has ended (it is subscribed to again, in the payment form), a retry's date
// (the server gives none), a month's total (a yearly plan is not charged by the month), and
// another owner's offer to take billing over (the payer offers). Nor does it draw the method's
// replacement in a sheet: the processor's form is never drawn in a modal (PaymentForm.tsx).
//
// Its states (ledger preset D less five): *loading* and *error* are the subscription's read;
// *populated* is the body; *empty* is the payer's invoices before the first (Invoices.tsx);
// *offline* is the body as this browser kept it, each write saying it could not reach the server;
// *absent* is everybody but an owner, and the method and the invoices for an owner who does not
// pay; *read-only* is the body with its strip, its controls kept. Nothing is *pending* or
// *syncing*, billing being no part of a replica; nothing is *conflicted*, the processor holding
// the one state there is; a failed charge is the household's state and no *rejected* change; and
// an owner who pays no longer reads the other owners' screen, which is no *withdrawn* row.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { readState } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { askedNow } from '../api/query.ts'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import { useFragmentAndQuery } from '../auth/fragment.ts'
import { useReread, useSubscription, writes, type Subscription } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { householdKey, subscriptionKey } from '../household/households.ts'
import { HouseholdSettingsPage, Section } from '../household/settings/Page.tsx'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { KeyValue, type Pair } from '../ui/KeyValue.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'
import { useToast } from '../ui/Toast.tsx'
import styles from './Billing.module.css'
import {
  isMoved,
  isPayer,
  priceOf,
  useBillingRefusal,
  useProcessorsWord,
  type Interval,
} from './data.ts'
import { Handover } from './Handover.tsx'
import { Invoices } from './Invoices.tsx'
import { Method } from './Method.tsx'
import {
  Refused,
  StateWord,
  useFocusKept,
  usePayerName,
  usePriceWords,
  useRefusals,
  useStateWord,
} from './parts.tsx'
import { Usage } from './Usage.tsx'

/**
 * What a bank's own page adds to the address it sends a member back to: the processor's names
 * for what was confirmed, its secret among them. Their presence says somebody came back, and
 * nothing else of them is read.
 */
const returned = [
  'payment_intent',
  'payment_intent_client_secret',
  'setup_intent',
  'setup_intent_client_secret',
  'redirect_status',
] as const

/** What the state the household is in means, in a sentence, with the day it carries where it has one. */
function useStateSentence(): (subscription: Subscription) => string | undefined {
  const t = useTranslate()
  const format = useFormat()
  const zone = useTimeZone()
  return (subscription) => {
    const day = (at: string | null) => (at === null ? undefined : format.dayOf(at, zone))
    switch (subscription.state) {
      case 'trialing':
      case 'active':
        return undefined
      case 'past_due':
        return t('billing.means.past_due')
      case 'grace': {
        const until = day(subscription.grace_ends_at)
        return until === undefined
          ? t('billing.means.grace')
          : t('billing.means.grace_until', { day: until })
      }
      case 'read_only':
      case 'canceled': {
        const until = day(subscription.data_retained_until)
        if (subscription.state === 'canceled') {
          return until === undefined
            ? t('billing.means.canceled')
            : t('billing.means.canceled_until', { day: until })
        }
        return until === undefined
          ? t('billing.means.read_only')
          : t('billing.means.read_only_until', { day: until })
      }
      case 'restricted':
        return t('billing.means.restricted')
      case 'suspended':
        return undefined
    }
  }
}

/** The other way of paying than `interval`. */
function otherThan(interval: Interval): Interval {
  return interval === 'year' ? 'month' : 'year'
}

/**
 * How the household stands and what its subscription is: the state, the plan, the day it is
 * charged next or ends on, and who pays; and for the payer the three things that change it: how
 * often they pay, cancelling, and taking a cancellation back.
 */
function Standing({ subscription }: { readonly subscription: Subscription }) {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const me = useMe()
  const household = useHousehold()
  const zone = useTimeZone()
  const reread = useReread(household.id)
  const refusals = useRefusals(household.id)
  const refusal = useBillingRefusal()
  const sentence = useStateSentence()
  const prices = usePriceWords()
  const payerName = usePayerName(subscription)
  const payer = isPayer(subscription, me.id)
  const { interval } = subscription
  const { id, name } = household
  const path = { household_id: id }
  const [asking, setAsking] = useState<'interval' | 'cancel' | null>(null)
  // *Cancel* gives its place to *Resume*, and *Resume* to *Cancel*, each with the focus a press
  // or a question left on it: it goes to the section's own place.
  const place = useFocusKept()

  const kept = (answer: Subscription) => {
    queries.setQueryData(subscriptionKey(id), answer)
    setAsking(null)
    void reread()
  }
  /**
   * A refusal that says the page is no longer how billing stands closes the question it was
   * asked from, and is said on the page; any other is the question's own to say, and it stays.
   */
  const refused = (error: unknown) => {
    if (!isMoved(error)) return
    refusals.refuse(error)
    setAsking(null)
  }
  const change = useMutation({
    ...askedNow,
    mutationFn: async (to: Interval) =>
      unwrap(
        await api.PATCH('/households/{household_id}/billing/subscription', {
          params: { path },
          body: { interval: to },
        }),
      ),
    onSuccess: (answer, to) => {
      kept(answer)
      toast({
        message: to === 'year' ? t('billing.interval.done.year') : t('billing.interval.done.month'),
      })
    },
    onError: refused,
  })
  const cancel = useMutation({
    ...askedNow,
    mutationFn: async () =>
      unwrap(await api.POST('/households/{household_id}/billing/cancel', { params: { path } })),
    onSuccess: (answer) => {
      kept(answer)
      toast({
        message:
          answer.current_period_end === null
            ? t('billing.cancel.done', { household: name })
            : t('billing.cancel.done_on', {
                household: name,
                day: format.dayOf(answer.current_period_end, zone),
              }),
      })
    },
    onError: refused,
  })
  const resume = useMutation({
    ...askedNow,
    mutationFn: async () =>
      unwrap(await api.POST('/households/{household_id}/billing/resume', { params: { path } })),
    onSuccess: (answer) => {
      kept(answer)
      toast({ message: t('billing.resume.done', { household: name }) })
    },
    onError: (error) => {
      refusals.refuse(error)
    },
  })
  const asked = asking === 'interval' ? change : cancel
  const close = () => {
    if (!asked.isPending) setAsking(null)
  }

  const day = (at: string | null) => (at === null ? undefined : format.dayOf(at, zone))
  const price = interval === null ? undefined : (subscription.base_price ?? undefined)
  const ends = day(subscription.current_period_end)
  const pairs: Pair[] = [
    {
      key: t('billing.plan.label'),
      value:
        interval === null || price === undefined ? t('billing.plan.none') : prices(interval, price),
    },
    ...(interval === null
      ? []
      : [
          subscription.cancel_at_period_end
            ? { key: t('billing.period.ends'), value: ends }
            : { key: t('billing.period.next'), value: ends },
        ]),
    { key: t('billing.payer.label'), value: payerName },
    ...(subscription.trial_ends_at === null
      ? []
      : [{ key: t('billing.trial.ends'), value: day(subscription.trial_ends_at) }]),
  ]
  const means = sentence(subscription)
  const other = interval === null ? undefined : otherThan(interval)
  const otherPrice = other === undefined ? undefined : priceOf(subscription, other)
  const failure = asked.isError ? refusal(asked.error) : undefined

  return (
    <Section title={t('billing.subscription.title')}>
      <div ref={place} tabIndex={-1} className={styles.place}>
        <StateWord state={subscription.state} />
        {means === undefined ? null : <p className={account.text}>{means}</p>}
        {subscription.state === 'restricted' ? (
          <Link className={account.link} to={inHousehold.data(id)}>
            {t('household.settings.data.title')}
          </Link>
        ) : null}
        <KeyValue pairs={pairs} />
        {subscription.payment_pending ? (
          // So when the screen opened: read in its place.
          <Banner tone="info">{t('billing.pending')}</Banner>
        ) : null}
        {interval === null && !subscription.payment_pending ? (
          payer ? (
            <Link className={account.link} to={inHousehold.subscribe(id)}>
              {t('billing.subscribe.title')}
            </Link>
          ) : payerName === null ? null : (
            <p className={account.text}>{t('billing.subscribe.payers', { name: payerName })}</p>
          )
        ) : null}
        {interval !== null && subscription.cancel_at_period_end ? (
          <p className={account.text}>
            {ends === undefined
              ? t('billing.cancel.pending')
              : t('billing.cancel.pending_on', { day: ends })}
          </p>
        ) : null}
        {payer && interval !== null ? (
          <div className={account.actions}>
            {subscription.cancel_at_period_end ? (
              <Button
                variant="primary"
                loading={resume.isPending}
                onClick={() => {
                  refusals.clear()
                  resume.mutate()
                }}
              >
                {t('billing.resume.action')}
              </Button>
            ) : null}
            {other === undefined || otherPrice === undefined ? null : (
              <Button
                onClick={() => {
                  refusals.clear()
                  change.reset()
                  setAsking('interval')
                }}
              >
                {other === 'year' ? t('billing.interval.to_year') : t('billing.interval.to_month')}
              </Button>
            )}
            {subscription.cancel_at_period_end ? null : (
              <Button
                variant="danger"
                onClick={() => {
                  refusals.clear()
                  cancel.reset()
                  setAsking('cancel')
                }}
              >
                {t('billing.cancel.action')}
              </Button>
            )}
          </div>
        ) : null}
        {asking === null ? <Refused said={refusals.refused} /> : null}

        {asking === 'interval' && other !== undefined && otherPrice !== undefined ? (
          <Dialog
            open
            onClose={close}
            title={
              other === 'year'
                ? t('billing.interval.title.year')
                : t('billing.interval.title.month')
            }
            description={
              other === 'year'
                ? t('billing.interval.body.year', { price: format.money(otherPrice) })
                : t('billing.interval.body.month', { price: format.money(otherPrice) })
            }
            actions={
              <>
                <Button onClick={close}>
                  {other === 'year'
                    ? t('billing.interval.keep.month')
                    : t('billing.interval.keep.year')}
                </Button>
                <Button
                  variant="primary"
                  loading={change.isPending}
                  onClick={() => {
                    change.mutate(other)
                  }}
                >
                  {other === 'year'
                    ? t('billing.interval.to_year')
                    : t('billing.interval.to_month')}
                </Button>
              </>
            }
          >
            {failure === undefined ? undefined : (
              <Banner key={change.submittedAt} tone="danger" announce>
                {failure}
              </Banner>
            )}
          </Dialog>
        ) : null}
        {asking === 'cancel' ? (
          <Dialog
            open
            onClose={close}
            title={t('billing.cancel.title', { household: name })}
            description={
              ends === undefined
                ? t('billing.cancel.body', { household: name })
                : t('billing.cancel.body_on', { household: name, day: ends })
            }
            actions={
              <>
                <Button onClick={close}>{t('billing.cancel.keep')}</Button>
                <Button
                  variant="danger"
                  loading={cancel.isPending}
                  onClick={() => {
                    cancel.mutate()
                  }}
                >
                  {t('billing.cancel.confirm', { household: name })}
                </Button>
              </>
            }
          >
            {failure === undefined ? undefined : (
              <Banner key={cancel.submittedAt} tone="danger" announce>
                {failure}
              </Banner>
            )}
          </Dialog>
        ) : null}
      </div>
    </Section>
  )
}

function Read({ cameBack }: { readonly cameBack: boolean }) {
  const t = useTranslate()
  const queries = useQueryClient()
  const online = useOnline()
  const me = useMe()
  const household = useHousehold()
  const word = useStateWord()
  const read = useSubscription(household.id)
  const subscription = read.data

  // The read's own `404` says its reader owns the household no longer, whatever this page had
  // read of it: the household alone is read again, which is what tells the rest of the app.
  const lowered = problemIn(read.error)?.status === 404
  useEffect(() => {
    if (!lowered) return
    void queries.invalidateQueries({ queryKey: householdKey(household.id), exact: true })
  }, [lowered, queries, household.id])

  // Back from a bank's own page: the processor may take a moment to say how it went, so the
  // subscription is read again a few times, and what it then says is all this page says.
  const back = useProcessorsWord(household.id, cameBack)
  const { state: backState, end: endBack } = back
  useEffect(() => {
    if (backState === 'unsaid') endBack()
  }, [backState, endBack])

  // What moves the subscription moves the household's entitlement, which every screen of the
  // household draws by: where the two are read apart, everything of the household is read again.
  const stands = subscription?.state
  const stood = household.entitlement?.state
  const reread = useReread(household.id)
  useEffect(() => {
    if (stands !== undefined && stands !== stood) void reread()
  }, [stands, stood, reread])

  const base = readState(read, online)
  // A household that takes no writes draws this screen's controls all the same (FR-BI1): the
  // strip says so, and what the frame says of writes is not asked.
  const state: DataState =
    !writes(household) && (base === 'populated' || base === 'offline') ? 'readonly' : base

  return (
    <HouseholdSettingsPage
      title={t('household.settings.billing.title')}
      lead={t('billing.lead')}
      note={false}
    >
      <StateFrame
        state={state}
        skeleton={
          <Skeleton
            bars={[
              [35, 2],
              [80, 1],
              [60, 1],
              [60, 1],
              [45, 2.75],
            ]}
          />
        }
        // Nothing is listed here that could be none: the invoices say so themselves.
        empty={null}
        texts={{
          error: {
            title: t('billing.error.title'),
            text: t('billing.error.body'),
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
          withdrawn: { text: t('household.settings.withdrawn') },
          readonly: {
            title: word(household.entitlement?.state ?? 'read_only'),
            text: t('billing.exempt'),
          },
        }}
      >
        {() =>
          subscription === undefined ? null : (
            <div className={styles.stack}>
              {cameBack ? <Banner tone="info">{t('billing.returned')}</Banner> : null}
              <Standing subscription={subscription} />
              {isPayer(subscription, me.id) && subscription.interval !== null ? (
                <Method subscription={subscription} />
              ) : null}
              <Usage subscription={subscription} />
              <Invoices payer={isPayer(subscription, me.id)} />
              <Handover subscription={subscription} />
            </div>
          )
        }
      </StateFrame>
    </HouseholdSettingsPage>
  )
}

function Arrived() {
  // What a bank's own page sent back with is taken out of the address before anything else is
  // done, as a link's token is (auth/fragment.ts), and each arrival is a screen of its own.
  const carried = useFragmentAndQuery()
  const cameBack = returned.some((name) => carried.query.has(name))
  return <Read key={carried.arrival} cameBack={cameBack} />
}

export function Billing() {
  const household = useHousehold()
  // Absent: no screen, no reason, and nothing asked of the server (FR-BI5).
  if (household.my_role !== 'owner') return <NotAvailable home={inHousehold.home(household.id)} />
  return <Arrived />
}
