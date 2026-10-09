// Take over billing (A-29, `/households/{id}/settings/billing/takeover`; PRD 04 FR-BI6; 02
// FR-HH6; D-133): what the owner the payer offered billing to reads of the offer, and accepts or
// declines it by. The email that tells them of the offer opens this address.
//
// Accepting is the second of two steps, and changes nothing by itself where the household has a
// subscription: the server answers what the owner confirms a payment method of their own with,
// in the processor's form, and billing moves once the processor has confirmed it. Until then
// the payer goes on paying, and a method that is not accepted changes nothing. Their own
// subscription then starts when the period already paid for ends, which is the day this screen
// names, so that nobody pays for the same days twice. Where the household has no subscription
// there is no card to confirm: they pay from the moment they accept, and the screen says so
// before they press.
//
// The processor's word is waited for as the billing screen waits for it: the subscription is
// read again for a bounded while, and the screen says billing has moved when the subscription
// names its reader as the payer, and not before; where the reads run out it says that the
// processor has not said yet, and who pays meanwhile.
//
// Declining is told to the payer, and leaves the subscription as it is. Only an owner whose
// address is verified takes billing over: an unverified one is refused where they press, with
// the link offered again in the control's place (A-4).
//
// Everybody else who opens the address is told how it stands and nothing is offered: the payer,
// that there is nothing to take over from themself; another owner, that no offer is waiting for
// them and who pays. A member and a child profile have no billing (FR-BI5).
//
// What the prototype drew and this does not: billing moving the moment a card is typed, and a
// card number typed into the app's own field.
//
// A-29's states (ledger preset F) are *loading* and *error*, the subscription's read, and
// *populated*, each of the three readers' screens. Nothing is listed to be *empty*; *offline* is
// the offer as this browser kept it, and a press that says it could not reach the server;
// nothing waits *pending* or *syncing*; nothing is *conflicted* or *rejected*; *absent* is the
// neutral screen for everybody but an owner; and *read-only* changes nothing here, billing
// being outside the gate (FR-BI1).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { readState, sameId, useNoWithdrawal } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { askedNow } from '../api/query.ts'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import { useReread, useSubscription, type Subscription } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { subscriptionKey } from '../household/households.ts'
import { HouseholdSettingsPage, Section } from '../household/settings/Page.tsx'
import { useTimeZone } from '../household/timezone.ts'
import { isUnverified, Unverified, useMarkUnverified } from '../household/Unverified.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { KeyValue, type Pair } from '../ui/KeyValue.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useToast } from '../ui/Toast.tsx'
import { isMoved, isPayer, useProcessorsWord, type BillingIntent, type Offer } from './data.ts'
import {
  Refused,
  StorageTerms,
  useFocusKept,
  usePayerName,
  usePriceWords,
  useRefusals,
} from './parts.tsx'
import { PaymentForm } from './PaymentForm.tsx'

function Offered({
  subscription,
  offer,
  onConfirmed,
}: {
  readonly subscription: Subscription
  readonly offer: Offer
  /** The processor took their payment method: billing moves once it says so. */
  readonly onConfirmed: () => void
}) {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const me = useMe()
  const household = useHousehold()
  const zone = useTimeZone()
  const reread = useReread(household.id)
  const refusals = useRefusals(household.id)
  const markUnverified = useMarkUnverified()
  const prices = usePriceWords()
  const { id, name } = household
  const from = offer.offered_by.label ?? ''
  const path = { household_id: id }
  // What the form confirms their payment method with: kept here, while the form is drawn.
  const [intent, setIntent] = useState<BillingIntent | null>(null)
  // How many times the server has said this account's address is not verified.
  const [blocked, setBlocked] = useState(0)
  const day = (at: string) => format.dayOf(at, zone)

  /** The offer is open no longer: taken back, lapsed, or made to somebody else since. */
  const gone = () => {
    refusals.say(t('billing.takeover.gone'))
    void reread()
  }
  const accept = useMutation({
    ...askedNow,
    // Its answer may be a secret: the query client keeps it no longer than this screen is drawn.
    gcTime: 0,
    mutationFn: async () =>
      unwrap(
        await api.POST('/households/{household_id}/billing/transfer/accept', { params: { path } }),
      ),
    onSuccess: (answer) => {
      if (answer.confirmation !== null) {
        setIntent(answer.confirmation)
        return
      }
      // No subscription, and so no card to confirm: billing has moved already.
      queries.setQueryData(subscriptionKey(id), answer.subscription)
      toast({ message: t('billing.takeover.done', { household: name }) })
      void reread()
    },
    onError: (error) => {
      if (isUnverified(error)) {
        // The server's word on it, whatever this page had read: the block stands where the
        // press was, and lifts when the account is read as verified.
        markUnverified()
        setBlocked((times) => times + 1)
      } else if (problemIn(error)?.code === 'not_found') gone()
      else refusals.refuse(error)
    },
  })
  const decline = useMutation({
    ...askedNow,
    mutationFn: async () => {
      unwrap(await api.DELETE('/households/{household_id}/billing/transfer', { params: { path } }))
    },
    onSuccess: () => {
      toast({ message: t('billing.takeover.declined', { name: from }) })
      void reread()
    },
    onError: (error) => {
      if (isMoved(error)) gone()
      else refusals.refuse(error)
    },
  })

  // The two presses give their place to the form, and the form to them where it is put away.
  const place = useFocusKept()

  const { interval } = subscription
  const price = interval === null ? undefined : (subscription.base_price ?? undefined)
  const pairs: Pair[] = [
    { key: t('billing.takeover.from'), value: from },
    { key: t('billing.takeover.offered'), value: day(offer.offered_at) },
    { key: t('billing.takeover.lapses'), value: day(offer.expires_at) },
    {
      key: t('billing.takeover.pay'),
      value:
        interval === null || price === undefined ? t('billing.plan.none') : prices(interval, price),
    },
    ...(interval === null || subscription.current_period_end === null
      ? []
      : [{ key: t('billing.takeover.starts'), value: day(subscription.current_period_end) }]),
  ]
  return (
    <>
      <Section title={t('billing.offer.yours.title', { name: from })}>
        <KeyValue pairs={pairs} />
        <p className={account.text}>
          {interval === null
            ? t('billing.takeover.no_card', { household: name })
            : t('billing.takeover.with_card', { name: from })}
        </p>
        {interval === null ? null : <StorageTerms subscription={subscription} />}
        <p className={account.text}>{t('billing.takeover.declining', { name: from })}</p>
      </Section>
      <div ref={place} tabIndex={-1} className={account.view}>
        <div className={account.group}>
          {intent !== null ? (
            <PaymentForm
              intent={intent}
              submit={t('billing.takeover.confirm')}
              unchanged={t('billing.takeover.unchanged', { name: from })}
              putAway={t('billing.form.not_now')}
              onPutAway={() => {
                setIntent(null)
              }}
              onConfirmed={() => {
                // The secret has done what it was for, and is kept no longer.
                setIntent(null)
                onConfirmed()
              }}
            />
          ) : blocked > 0 && !me.email_verified ? (
            <Unverified key={blocked} why={t('billing.takeover.unverified')} announce />
          ) : (
            <div className={account.actions}>
              <Button
                variant="primary"
                // Busy, once billing has moved, until the billing screen has come.
                loading={accept.isPending || accept.data?.confirmation === null}
                // The other press's write is on its way: it is answered first.
                aria-disabled={decline.isPending}
                onClick={() => {
                  refusals.clear()
                  accept.mutate(undefined, {
                    onSuccess: (answer) => {
                      if (answer.confirmation === null) void navigate(inHousehold.billing(id))
                    },
                  })
                }}
              >
                {t('billing.takeover.title')}
              </Button>
              <Button
                loading={decline.isPending}
                aria-disabled={accept.isPending}
                onClick={() => {
                  refusals.clear()
                  decline.mutate()
                }}
              >
                {t('billing.takeover.decline')}
              </Button>
            </div>
          )}
          <Refused said={refusals.refused} />
        </div>
      </div>
    </>
  )
}

function Read() {
  const t = useTranslate()
  const navigate = useNavigate()
  const toast = useToast()
  const online = useOnline()
  const me = useMe()
  const household = useHousehold()
  const withdrawn = useNoWithdrawal()
  const reread = useReread(household.id)
  const read = useSubscription(household.id)
  const subscription = read.data
  const payerName = usePayerName(subscription ?? { payer: null })
  const wait = useProcessorsWord(household.id)
  // Whether the processor has taken this reader's payment method: billing moves once it says so.
  const [confirmed, setConfirmed] = useState(false)
  const { id, name } = household
  const pays = subscription !== undefined && isPayer(subscription, me.id)

  // The subscription names its reader as the payer: billing has moved, and is said to have,
  // once.
  const moved = confirmed && pays
  const told = useRef(false)
  const { end } = wait
  useEffect(() => {
    if (!moved || told.current) return
    told.current = true
    end()
    toast({ message: t('billing.takeover.done', { household: name }) })
    void navigate(inHousehold.billing(id))
  }, [moved, end, toast, t, name, navigate, id])

  // Where the focus goes once the offer's presses, or the form's, have left with the offer
  // itself: the screen's own place, where what stands in the offer's place is drawn.
  const view = useFocusKept()

  const billing = (
    <Link className={account.link} to={inHousehold.billing(id)}>
      {t('household.settings.billing.title')}
    </Link>
  )
  const offer = subscription?.transfer ?? null
  return (
    <HouseholdSettingsPage title={t('billing.takeover.title')} note={false}>
      <div ref={view} tabIndex={-1} className={account.view}>
        <StateFrame
          state={readState(read, online)}
          skeleton={
            <Skeleton
              bars={[
                [50, 1.25],
                [80, 1],
                [60, 1],
                [90, 1],
                [40, 2.75],
              ]}
            />
          }
          // Nothing is listed here: an offer is one, or none.
          empty={null}
          texts={{
            error: {
              title: t('billing.takeover.error.title'),
              text: t('billing.takeover.error.body'),
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
            if (confirmed) {
              return (
                <Section title={t('billing.takeover.confirmed.title')}>
                  {/* A status from the press on: one element, whose words change in place. */}
                  <p role="status" className={account.text}>
                    {wait.state === 'unsaid' && !pays
                      ? payerName === null
                        ? t('billing.takeover.unsaid')
                        : t('billing.takeover.unsaid_pays', { name: payerName })
                      : t('billing.takeover.confirming')}
                  </p>
                  {billing}
                </Section>
              )
            }
            if (pays) {
              return (
                <Section title={t('billing.takeover.yours.title')}>
                  <p className={account.text}>
                    {t('billing.takeover.yours.body', { household: name })}
                  </p>
                  {offer === null ? null : (
                    <p className={account.text}>
                      {t('billing.offer.others', { name: offer.offered_to.label ?? '' })}
                    </p>
                  )}
                  {billing}
                </Section>
              )
            }
            if (offer !== null && sameId(offer.offered_to.user_id, me.id)) {
              return (
                <Offered
                  subscription={subscription}
                  offer={offer}
                  onConfirmed={() => {
                    setConfirmed(true)
                    wait.begin()
                    void reread()
                  }}
                />
              )
            }
            return (
              <Section title={t('billing.takeover.none.title')}>
                {payerName === null ? null : (
                  <p className={account.text}>{t('billing.payer.pays', { name: payerName })}</p>
                )}
                {billing}
              </Section>
            )
          }}
        </StateFrame>
      </div>
    </HouseholdSettingsPage>
  )
}

export function Takeover() {
  const household = useHousehold()
  // Absent: no screen, no reason, and nothing asked of the server (FR-BI5).
  if (household.my_role !== 'owner') return <NotAvailable home={inHousehold.home(household.id)} />
  return <Read />
}
