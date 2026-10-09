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
// processor is confirming it, that the new method is in use once the summary read says another
// method or a payment that was being retried has gone through, or that the processor has not
// said yet. A method replaced by the same card reads the same, and is said so.
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

/** What a subscription says of its method and of whether a payment is being retried. */
function standingOf(subscription: Subscription): string {
  return JSON.stringify([subscription.state === 'past_due', subscription.payment_method])
}

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
  // How the subscription stood when the processor took a new method: what it is read against.
  const [over, setOver] = useState<string | null>(null)
  const stands = standingOf(subscription)
  const inUse = over !== null && over !== stands

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
            {over === null
              ? null
              : inUse
                ? t('billing.method.in_use')
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
                  setOver(null)
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
                onConfirmed={() => {
                  // The secret has done what it was for, and is kept no longer.
                  setIntent(null)
                  setOver(stands)
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
