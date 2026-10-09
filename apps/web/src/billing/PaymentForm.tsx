// The payment form (PRD 04 §6, D-131): the processor's own, Stripe's Payment Element, drawn in a
// node this component owns and taken away with it. What is typed into it goes from its frame to
// the processor; the page holds the secret of what is being confirmed, in its state and nowhere
// else, and the press that confirms it.
//
// It is given a `BillingIntent` its screen asked the server for once its member had pressed, and
// confirms it as its `intent` says: a `payment`, charged as it is confirmed, or the `setup` of a
// method for later charges. The page is left only where the method itself needs it, a bank's own
// page, and the processor then sends its member back to the billing screen's address
// (`returnAddress`), which reads the subscription again and believes nothing of what the address
// carried (Billing.tsx).
//
// A confirmation the processor did not take is said in the app's own words, by the kind of the
// processor's refusal and never in its sentence: the form marks what is missing itself, a method
// that was not accepted is said to have charged nothing, and so is anything else. What the
// processor took is its screen's to follow: nothing here says a payment went through, which only
// the server's reading of the processor does (D-134).
//
// The form is drawn in the page and never in a modal: where a bank asks its customer to confirm
// a payment (3-D Secure), the processor's script draws that over the page, and a modal would hold
// it inert beneath itself. Its look is the page's own tokens as they are computed where it
// stands (appearance.ts), read again when the root's display modes change or the device's theme
// does.
import { catalogLocale } from '@household/i18n/lazy'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import account from '../account/Settings.module.css'
import { askedNow } from '../api/query.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { useI18n, useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { appearanceAt } from './appearance.ts'
import styles from './Billing.module.css'
import { returnAddress, type BillingIntent } from './data.ts'
import { loadProcessor, type FormLocale, type PaymentFrame } from './stripe.ts'

/** What a confirmation the processor did not take is said to have failed for. */
type Fault =
  /** Something the form asks for is missing or not right: the form marks it itself. */
  | 'incomplete'
  /** The method was not accepted: a card declined. */
  | 'declined'
  /** Anything else: it could not be confirmed. */
  | 'failed'

/** The kind of the processor's refusal, read by its `type`. */
function faultOf(type: string): Fault {
  if (type === 'validation_error') return 'incomplete'
  return type === 'card_error' ? 'declined' : 'failed'
}

const darkScheme = '(prefers-color-scheme: dark)'

export interface PaymentFormProps {
  /** What is confirmed, as the server answered it: its secret is kept nowhere else. */
  readonly intent: BillingIntent
  /** The words of the press that confirms it: *Pay EUR 59.88*. */
  readonly submit: string
  /** What a confirmation that was not taken left as it was, in the screen's own sentence. */
  readonly unchanged: string
  /** The processor took the confirmation: its screen reads how the subscription stands. */
  readonly onConfirmed: () => void
  /** The words of the control that puts the form away, where its screen has one. */
  readonly putAway?: string
  readonly onPutAway?: () => void
}

function Mounted({
  intent,
  submit,
  unchanged,
  onConfirmed,
  putAway,
  onPutAway,
  language,
  onRetry,
}: PaymentFormProps & { readonly language: FormLocale; readonly onRetry: () => void }) {
  const t = useTranslate()
  const household = useHousehold()
  const host = useRef<HTMLDivElement>(null)
  // The processor's frame, while it is drawn: what a press confirms with.
  const drawn = useRef<PaymentFrame | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unloaded'>('loading')
  const { publishable_key: key, client_secret: secret, intent: kind } = intent

  useEffect(() => {
    const node = host.current
    if (node === null) return undefined
    // Whether this drawing was taken away before the script came: nothing is mounted then.
    let gone = false
    let frame: PaymentFrame | undefined
    const unloaded = () => {
      if (!gone) setPhase('unloaded')
    }
    loadProcessor(key, language)
      .then((processor) => {
        if (gone) return
        frame = processor.frame({ secret, kind, appearance: appearanceAt(node) })
        frame.mount(node, {
          onReady: () => {
            if (!gone) setPhase('ready')
          },
          onLoadError: unloaded,
        })
        drawn.current = frame
      })
      // The script that did not come, and the script that came and would not make the form, a
      // secret or a key it does not take: either is a form that could not be loaded, and is
      // said, where a skeleton would stand for ever.
      .catch(unloaded)
    return () => {
      gone = true
      drawn.current = null
      frame?.destroy()
    }
  }, [key, secret, kind, language])

  // The form's look follows the page's: the root's display modes are attributes of it
  // (display/store.ts), and the system theme is the device's to change.
  useEffect(() => {
    const restyle = () => {
      const node = host.current
      if (node !== null) drawn.current?.restyle(appearanceAt(node))
    }
    const modes = new MutationObserver(restyle)
    modes.observe(document.documentElement, { attributes: true })
    const scheme = window.matchMedia(darkScheme)
    scheme.addEventListener('change', restyle)
    return () => {
      modes.disconnect()
      scheme.removeEventListener('change', restyle)
    }
  }, [])

  const confirm = useMutation({
    ...askedNow,
    mutationFn: async (): Promise<Fault | null> => {
      const frame = drawn.current
      if (frame === null) return 'failed'
      const answer = await frame.confirm(returnAddress(household.id))
      return answer.error === undefined ? null : faultOf(answer.error.type)
    },
    onSuccess: (fault) => {
      if (fault === null) onConfirmed()
    },
  })
  // The script itself failing is a confirmation that could not be made, as any other.
  const fault: Fault | null = confirm.isError ? 'failed' : (confirm.data ?? null)
  /** Taken by the processor: busy until its screen has put something else in the form's place. */
  const taken = confirm.isSuccess && confirm.data === null

  return (
    <div className={account.group} role="group" aria-label={t('billing.form.label')}>
      {phase === 'loading' ? (
        <Skeleton
          bars={[
            [100, 2.75],
            [60, 2.75],
          ]}
        />
      ) : null}
      {phase === 'unloaded' ? (
        <Banner
          tone="danger"
          announce
          actions={
            <Button
              onClick={() => {
                onRetry()
              }}
            >
              {t('ui.retry')}
            </Button>
          }
        >
          {t('billing.form.unloaded')}
        </Banner>
      ) : null}
      {/* The processor's frame is drawn in here, and nothing of the page's own. */}
      <div ref={host} className={styles.form} />
      {fault === null || confirm.isPending ? null : (
        // A banner of its own for each refusal, so that a second one is said again.
        <Banner key={confirm.submittedAt} tone="danger" announce>
          <p>
            {fault === 'incomplete'
              ? t('billing.form.incomplete')
              : fault === 'declined'
                ? t('billing.form.declined')
                : t('billing.form.failed')}
          </p>
          {fault === 'incomplete' ? null : <p>{unchanged}</p>}
        </Banner>
      )}
      <p className={account.note}>{t('billing.form.note')}</p>
      <div className={account.actions}>
        {/* No press that could confirm nothing: it is drawn once the form takes input. */}
        {phase === 'ready' ? (
          <Button
            variant="primary"
            loading={confirm.isPending || taken}
            onClick={() => {
              confirm.mutate()
            }}
          >
            {submit}
          </Button>
        ) : null}
        {putAway === undefined || onPutAway === undefined ? null : (
          <Button
            // A confirmation on its way is not walked away from: its answer is the form's.
            aria-disabled={confirm.isPending || taken}
            onClick={() => {
              onPutAway()
            }}
          >
            {putAway}
          </Button>
        )}
      </div>
    </div>
  )
}

export function PaymentForm(props: PaymentFormProps) {
  // The form speaks the app's language: English where the app is shown in its pseudo-locale.
  const language = catalogLocale(useI18n().locale)
  // How many times the form was begun again after it could not be loaded: each is a drawing of
  // its own, as each secret and each language is.
  const [begun, setBegun] = useState(0)
  return (
    <Mounted
      key={`${String(begun)} ${language} ${props.intent.client_secret}`}
      {...props}
      language={language}
      onRetry={() => {
        setBegun((times) => times + 1)
      }}
    />
  )
}
