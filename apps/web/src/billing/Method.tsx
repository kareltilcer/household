// The payment method (PRD 04 §6, FR-BI5; A-28's *Card*): the summary of what the subscription is
// charged with, which its payer alone reads, and its replacement, in the processor's own form.
//
// A summary is all there is of a method: a card's brand, its last four digits and when it
// expires; a bank debit with no expiry, and no digits where its account ends in letters.
// Replacing it asks the server for what the form confirms a new one with, once the payer has
// pressed and not before: each asking makes a setup at the processor. The form is drawn where
// the control stood, and never in a sheet (PaymentForm.tsx).
//
// What the form confirms is not yet what the subscription is charged with. The processor says
// so to the server, and the server to this page: the subscription is read again for a bounded
// while, and one sentence under the summary says where that stands, from the press on: that the
// processor is confirming it, that the new method is in use, or that the processor has not said
// yet. Two things say that it is in use, and no other: the summary read names another method
// than there was, or a payment that was owed then has gone through. A renewal that fails
// meanwhile, or a restriction made or lifted, is no word on the method. Once said it stays said,
// whatever is read after it. A method replaced by the same card reads the same, so nothing here
// can say that it is in use: the sentence that the processor has not said yet is where that
// ends.
//
// A confirmation whose outcome nobody gave, its answer lost on the way back (PaymentForm.tsx),
// leaves the form standing under the sentence that the page cannot tell yet: pressed again, the
// processor would refuse what it had taken, at every press. So the section keeps how the
// subscription stood when the form was asked for, and once such a confirmation is read, by the
// same two things, as a method in use, the form is put away and the sentence says so. Not before
// one: a form somebody is typing into is not taken away because the summary moved.
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { askedNow } from '../api/query.ts'
import { useReread, type Subscription } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { Section } from '../household/settings/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { useProcessorsWord, type BillingIntent } from './data.ts'
import { Refused, useFocusKept, useMethodWords, useRefusals } from './parts.tsx'
import { PaymentForm } from './PaymentForm.tsx'

/** What a subscription says of its method, and whether a payment for it is owed. */
interface Stood {
  readonly method: string
  readonly owed: boolean
}

function standingOf(subscription: Subscription): Stood {
  return {
    method: JSON.stringify(subscription.payment_method),
    owed: subscription.state === 'past_due',
  }
}

/**
 * Whether `subscription` says that a method confirmed since it stood as `then` is in use: it
 * names another method than there was, or a payment that was owed then has gone through.
 */
function inUseSince(then: Stood, subscription: Subscription): boolean {
  return (
    JSON.stringify(subscription.payment_method) !== then.method ||
    (then.owed && subscription.state === 'active')
  )
}

/** What became of confirming a new method, once a press of the form was not simply refused. */
type Outcome =
  /** Nobody gave it: the form stands, and the subscription read since may say. */
  | 'unknown'
  /** The processor took it: the server's word is waited for. */
  | 'taken'
  /** The subscription read said the new method is in use. */
  | 'in_use'

export function Method({ subscription }: { readonly subscription: Subscription }) {
  const t = useTranslate()
  const api = useApi()
  const household = useHousehold()
  const reread = useReread(household.id)
  const refusals = useRefusals(household.id)
  const words = useMethodWords()
  const wait = useProcessorsWord(household.id)
  // What the form confirms a new method with: kept here, while the form is drawn, and nowhere
  // else.
  const [intent, setIntent] = useState<BillingIntent | null>(null)
  // How the subscription stood before a new method: when the form was asked for, and again when
  // the processor took one, unless an earlier confirmation of the form may have been taken too.
  // What is read after is read against it.
  const [stood, setStood] = useState<Stood | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // The subscription read since says the new method is in use. Kept, and not worked out at each
  // read: a payment that fails after it takes nothing back of what was said. A form left
  // standing by an outcome nobody gave is put away with it.
  if (
    (outcome === 'unknown' || outcome === 'taken') &&
    stood !== null &&
    inUseSince(stood, subscription)
  ) {
    setOutcome('in_use')
    setIntent(null)
  }
  const inUse = outcome === 'in_use'

  const begin = useMutation({
    ...askedNow,
    // Its answer is a secret: the query client keeps it no longer than this screen is drawn.
    gcTime: 0,
    mutationFn: async () =>
      unwrap(
        await api.POST('/households/{household_id}/billing/payment-method', {
          params: { path: { household_id: household.id } },
        }),
      ),
    onSuccess: (answer) => {
      setIntent(answer)
      setStood(standingOf(subscription))
    },
    onError: (error) => {
      refusals.refuse(error)
    },
  })

  // The summary says the new method: nothing more is waited for.
  const { end } = wait
  useEffect(() => {
    if (inUse) end()
  }, [inUse, end])

  // The control gives its place to the form, and the form to the sentence of how it stands:
  // the focus each held goes to the section's own place.
  const place = useFocusKept()

  const method = subscription.payment_method
  return (
    <Section title={t('billing.method.title')}>
      <div ref={place} tabIndex={-1} className={account.view}>
        <div className={account.group}>
          <p className={account.text}>
            {method === null ? t('billing.method.none') : words(method)}
          </p>
          {/* A status from the press on: one element, whose words change where they stand. */}
          <p role="status" className={account.note}>
            {inUse
              ? t('billing.method.in_use')
              : outcome !== 'taken'
                ? null
                : wait.state === 'unsaid'
                  ? t('billing.method.unsaid')
                  : t('billing.method.confirming')}
          </p>
          {intent === null ? (
            <div className={account.actions}>
              <Button
                loading={begin.isPending}
                onClick={() => {
                  refusals.clear()
                  // What was said of the method before this one is said no longer.
                  setOutcome(null)
                  wait.end()
                  begin.mutate()
                }}
              >
                {t('billing.method.replace')}
              </Button>
            </div>
          ) : (
            <>
              {subscription.state === 'past_due' ? (
                <p className={account.text}>{t('billing.method.retried')}</p>
              ) : null}
              <PaymentForm
                intent={intent}
                submit={t('billing.method.save')}
                unchanged={t('billing.method.unchanged')}
                putAway={t('billing.form.not_now')}
                onPutAway={() => {
                  setIntent(null)
                }}
                onUnknown={() => {
                  setOutcome('unknown')
                }}
                onConfirmed={() => {
                  // The secret has done what it was for, and is kept no longer.
                  setIntent(null)
                  if (outcome !== 'unknown') setStood(standingOf(subscription))
                  setOutcome('taken')
                  wait.begin()
                  void reread()
                }}
              />
            </>
          )}
          <Refused said={refusals.refused} />
        </div>
      </div>
    </Section>
  )
}
