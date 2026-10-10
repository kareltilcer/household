// Handing billing over, as the billing screen draws it (PRD 04 FR-BI6; 02 FR-HH6; D-133): the
// payer's offer of billing to one other owner, its taking back, and what an owner who does not
// pay reads of who does and of an offer made to them.
//
// Two steps, deliberately: the payer offers, and the other owner accepts and confirms a payment
// method of their own (Takeover.tsx). Nothing about the subscription changes in between, and the
// payer goes on paying until the other's method is confirmed. Only the payer offers; an offer
// goes to one owner, lapses fourteen days after it is made, on the day the server names once it
// is, and may be taken back until it is accepted. A household with no subscription has no card
// to hand over: the owner who accepts pays from then on.
//
// Billing moves only between owners (FR-HH6). Where the payer is the household's only owner,
// what has to happen first is said, with the way to the members where somebody is made one; and
// where the household takes no writes, that making an owner is not possible until it does, which
// the gate refuses (FR-BI1): no way that could only be refused.
//
// The payer's refusal on the screen that leaves a household, and on their own page among the
// members, leads here (FR-HH4).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Link } from 'react-router'
import { sameId } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { askedNow } from '../api/query.ts'
import { inHousehold } from '../app/paths.ts'
import { fieldCodes, useRefusedField } from '../auth/fields.tsx'
import {
  subscriptionQuery,
  useMembers,
  useReread,
  writes,
  type Membership,
  type Subscription,
} from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { subscriptionKey } from '../household/households.ts'
import { Section } from '../household/settings/Page.tsx'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Sheet } from '../ui/Dialog.tsx'
import { Select } from '../ui/Field.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { useToast } from '../ui/Toast.tsx'
import { isMoved, isPayer, useBillingRefusal } from './data.ts'
import styles from './Billing.module.css'
import { Refused, useFocusKept, usePayerName, useRefusals } from './parts.tsx'

/** An owner billing could be offered to: their id and their name. */
interface Owner {
  readonly id: string
  readonly name: string
}

/** The household's owners but `user`: whom its payer could offer billing to. */
function otherOwners(members: readonly Membership[], user: string): Owner[] {
  return members.flatMap((member) =>
    member.role === 'owner' && member.user_id !== undefined && !sameId(member.user_id, user)
      ? [{ id: member.user_id, name: member.display_name ?? '' }]
      : [],
  )
}

function Offer({
  owners,
  subscribed,
  onClose,
  onMoved,
}: {
  readonly owners: readonly Owner[]
  /** Whether the household has a subscription: where it has none, no card is asked for. */
  readonly subscribed: boolean
  /** Put away: by its member, or once the offer is made. */
  readonly onClose: () => void
  /** Refused because the page is no longer how billing stands: its screen says so. */
  readonly onMoved: (error: unknown) => void
}) {
  const t = useTranslate()
  const api = useApi()
  const toast = useToast()
  const household = useHousehold()
  const reread = useReread(household.id)
  const refusal = useBillingRefusal()
  const form = useId()
  const [to, setTo] = useState('')
  // Set, anew, each time the offer is asked for with nobody chosen: it is not sent.
  const [missing, setMissing] = useState<object>()
  const chosen = owners.find((owner) => owner.id === to)

  const offer = useMutation({
    ...askedNow,
    mutationFn: async (owner: Owner) => {
      unwrap(
        await api.POST('/households/{household_id}/billing/transfer', {
          params: { path: { household_id: household.id } },
          body: { user_id: owner.id },
        }),
      )
    },
    onSuccess: (_answer, owner) => {
      toast({ message: t('billing.handover.done', { name: owner.name }) })
      void reread()
    },
    onError: (error) => {
      // Somebody the server will not take: who owns the household is read again.
      if (fieldCodes(error).has('/user_id')) void reread()
    },
  })
  const refused = useRefusedField(missing ?? offer.error)
  const invalid = fieldCodes(offer.error).has('/user_id')
  const close = () => {
    if (!offer.isPending) onClose()
  }
  return (
    <Sheet
      open
      onClose={close}
      title={t('billing.handover.action')}
      description={t('billing.handover.steps')}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button type="submit" form={form} variant="primary" loading={offer.isPending}>
            {/* Named for whom it is offered to, once that is chosen. */}
            {chosen === undefined
              ? t('billing.handover.offer')
              : t('billing.handover.offer_to', { name: chosen.name })}
          </Button>
        </>
      }
    >
      <form
        id={form}
        ref={refused}
        className={account.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (chosen === undefined) {
            offer.reset()
            setMissing({})
            return
          }
          setMissing(undefined)
          offer.mutate(chosen, {
            onSuccess: onClose,
            onError: (error) => {
              if (isMoved(error)) onMoved(error)
            },
          })
        }}
      >
        <Select
          label={t('billing.handover.to')}
          placeholder={t('billing.handover.choose')}
          value={to}
          options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
          error={
            missing !== undefined
              ? t('billing.handover.missing')
              : invalid
                ? t('billing.handover.invalid')
                : undefined
          }
          onChange={(event) => {
            setTo(event.currentTarget.value)
          }}
        />
        {subscribed ? null : <p className={account.text}>{t('billing.handover.no_card')}</p>}
        {offer.isError && !invalid && !isMoved(offer.error) ? (
          <Banner key={offer.submittedAt} tone="danger" announce>
            {refusal(offer.error)}
          </Banner>
        ) : null}
      </form>
    </Sheet>
  )
}

export interface HandoverProps {
  readonly subscription: Subscription
}

export function Handover({ subscription }: HandoverProps) {
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
  const payerName = usePayerName(subscription)
  const members = useMembers(household.id)
  const [offering, setOffering] = useState(false)
  // The control that offers gives its place to the one that takes the offer back, and that one
  // to the first again, each with the focus a press or the panel left on it: it goes to the
  // section's own place.
  const place = useFocusKept()
  const offer = subscription.transfer
  const payer = isPayer(subscription, me.id)
  const day = (at: string) => format.dayOf(at, zone)

  const withdraw = useMutation({
    ...askedNow,
    // Asked with the name of whom the offer was made to, which its success says. The server
    // answers the same where no offer was open any more, one that was accepted meanwhile among
    // them, so who pays is read, and what is said is what that reads: that the offer was taken
    // back and its member goes on paying only where the subscription still names them.
    mutationFn: async (name: string) => {
      unwrap(
        await api.DELETE('/households/{household_id}/billing/transfer', {
          params: { path: { household_id: household.id } },
        }),
      )
      // The answer itself says that no offer is open now, whichever way it went: kept so before
      // who pays is read, or a read that failed would leave the offer drawn, and the control
      // that takes it back, under the sentence that none is open.
      queries.setQueryData<Subscription>(subscriptionKey(household.id), (kept) =>
        kept === undefined ? kept : { ...kept, transfer: null },
      )
      try {
        const stands = await queries.query({
          ...subscriptionQuery(api, household.id),
          staleTime: 0,
        })
        return { name, pays: isPayer(stands, me.id) }
      } catch {
        // Unread: nothing is said of who pays.
        return { name, pays: false }
      }
    },
    onSuccess: ({ name, pays }) => {
      toast({
        message: pays ? t('billing.offer.withdrawn', { name }) : t('billing.offer.closed'),
      })
      void reread()
    },
    onError: (error) => {
      refusals.refuse(error)
    },
  })

  if (!payer) {
    // Somebody else pays: who, what is theirs alone, and an offer while one is open.
    if (payerName === null) return null
    const mine = offer !== null && sameId(offer.offered_to.user_id, me.id)
    return (
      <Section title={t('billing.payer.title')}>
        <p className={account.text}>{t('billing.payer.other', { name: payerName })}</p>
        {offer === null ? null : mine ? (
          // So when the screen opened: read in its place.
          <Banner
            tone="info"
            title={t('billing.offer.yours.title', { name: payerName })}
            actions={
              <Link className={account.link} to={inHousehold.takeover(household.id)}>
                {t('billing.offer.yours.open')}
              </Link>
            }
          >
            {t('billing.offer.yours.body', { day: day(offer.expires_at) })}
          </Banner>
        ) : (
          <p className={account.text}>
            {t('billing.offer.others', { name: offer.offered_to.label ?? '' })}
          </p>
        )}
      </Section>
    )
  }

  const owners = members.data === undefined ? undefined : otherOwners(members.data, me.id)
  return (
    <Section title={t('billing.handover.title')}>
      <div ref={place} tabIndex={-1} className={styles.place}>
        {offer !== null ? (
          <>
            <p className={account.text}>
              {t('billing.offer.open', {
                name: offer.offered_to.label ?? '',
                day: day(offer.offered_at),
                expires: day(offer.expires_at),
              })}
            </p>
            <div className={account.actions}>
              {/* A control of its own, and not the one that offers under other words: one that
                was pressed leaves, and the focus it held is put on the section's place. */}
              <Button
                key="withdraw"
                loading={withdraw.isPending}
                onClick={() => {
                  refusals.clear()
                  withdraw.mutate(offer.offered_to.label ?? '')
                }}
              >
                {t('billing.offer.withdraw')}
              </Button>
            </div>
          </>
        ) : owners === undefined ? (
          members.isError || members.fetchStatus === 'paused' ? (
            // No frame draws this part's read: said as it arrives, and again for each read that
            // fails.
            <Banner
              key={members.errorUpdateCount}
              tone="danger"
              announce
              actions={
                <Button
                  onClick={() => {
                    void members.refetch()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              }
            >
              {t('billing.handover.unread')}
            </Banner>
          ) : (
            <Skeleton bars={[[70, 1]]} />
          )
        ) : owners.length === 0 ? (
          <>
            <p className={account.text}>
              {t('billing.handover.nobody', { household: household.name })}
            </p>
            {/* No way that could only be refused: a household that takes no writes makes no owner. */}
            {writes(household) ? (
              <Link className={account.link} to={inHousehold.members(household.id)}>
                {t('household.leave.last_owner.action')}
              </Link>
            ) : (
              <p className={account.text}>{t('billing.handover.nobody_read_only')}</p>
            )}
          </>
        ) : (
          <>
            <p className={account.text}>{t('billing.handover.body')}</p>
            <div className={account.actions}>
              <Button
                key="offer"
                onClick={() => {
                  refusals.clear()
                  setOffering(true)
                }}
              >
                {t('billing.handover.action')}
              </Button>
            </div>
          </>
        )}
        {offering ? null : <Refused said={refusals.refused} />}
        {offering && owners !== undefined ? (
          <Offer
            owners={owners}
            subscribed={subscription.interval !== null}
            onClose={() => {
              setOffering(false)
            }}
            onMoved={(error) => {
              setOffering(false)
              refusals.refuse(error)
            }}
          />
        ) : null}
      </div>
    </Section>
  )
}
