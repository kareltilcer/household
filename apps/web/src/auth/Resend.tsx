// Sending the verification link again (`postAuthVerifyEmailResend`), from *Check your email*
// (A-3) and from a verification link that has expired. The server answers `202` whether or not
// the address has an account or is verified already, so what the control says once it is
// answered is said of the system and not of the address (D-13).
//
// An address may ask once a minute (PRD 02 §9). The wait is drawn as a countdown on the control
// and not as a refusal (auth.js A-3): the control keeps its place and its focus, says how long,
// and takes no press until then. A `429` is the same wait, for as long as its `Retry-After`
// says; one longer than a countdown is worth reading is said as the time it ends.
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { ApiProblemError, problemIn, unwrap } from '../api/problem.ts'
import { deviceTimeZone, useProblemText } from '../api/problemText.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { checkEmail, EmailField, refusedEmail, type EmailFault } from './fields.tsx'
import { Form } from './Screen.tsx'

/** How long an address waits between two links: the server's own minute. */
const cooldown = 60_000

/** The longest wait counted down in seconds. A longer one is said as the time it ends. */
const countedDown = 90

interface Wait {
  /** When the control may be pressed again, in milliseconds since the epoch. */
  readonly until: number | undefined
  /** The clock as it was last read: the countdown is drawn from the two. */
  readonly now: number
}

/** A wait, counted down as its seconds pass. */
function useWait(waiting: boolean) {
  const [wait, setWait] = useState<Wait>(() => {
    const now = Date.now()
    return { until: waiting ? now + cooldown : undefined, now }
  })
  const waitUntil = useCallback((until: number) => {
    setWait({ until, now: Date.now() })
  }, [])
  const { until } = wait
  useEffect(() => {
    if (until === undefined) return undefined
    const timer = window.setInterval(() => {
      const now = Date.now()
      setWait((current) => ({ ...current, now }))
      if (now >= until) window.clearInterval(timer)
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [until])
  const seconds = until === undefined ? 0 : Math.max(0, Math.ceil((until - wait.now) / 1000))
  return { seconds, until, waitUntil }
}

export interface ResendProps {
  /** The address the link goes to, where the screen knows it. Left out, a field asks for it. */
  readonly to?: string | undefined
  /** What the control says while it can be pressed. */
  readonly label: string
  /** A link was sent as the screen opened, so the control starts out waiting its minute. */
  readonly sentJustNow?: boolean
}

export function Resend({ to, label, sentJustNow = false }: ResendProps) {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const problemText = useProblemText()
  const [typed, setTyped] = useState('')
  const [fault, setFault] = useState<{ readonly email: EmailFault }>()
  const { seconds, until, waitUntil } = useWait(sentJustNow)

  const resend = useMutation({
    mutationFn: async (email: string) => {
      unwrap(await api.POST('/auth/verify-email/resend', { body: { email } }))
    },
    onSuccess: () => {
      waitUntil(Date.now() + cooldown)
    },
    onError: (error) => {
      if (problemIn(error)?.status !== 429) return
      const at = error instanceof ApiProblemError ? error.retryAt?.getTime() : undefined
      waitUntil(at ?? Date.now() + cooldown)
    },
  })

  const waiting = seconds > 0
  const submit = () => {
    // Enter in the field asks too, and is answered as a press on the control is.
    if (waiting) return
    const email = to ?? typed.trim()
    const found = to === undefined ? checkEmail(email) : undefined
    if (found !== undefined) {
      resend.reset()
      setFault({ email: found })
      return
    }
    setFault(undefined)
    resend.mutate(email)
  }

  const emailFault = fault?.email ?? (to === undefined ? refusedEmail(resend.error) : undefined)
  // A limit is the wait, said on the control. Anything else that is no field's is said here.
  const refused =
    resend.error !== null && problemIn(resend.error)?.status !== 429 && emailFault === undefined
  const words = !waiting
    ? label
    : seconds <= countedDown || until === undefined
      ? t('auth.verify.resend_in', { seconds })
      : t('auth.verify.resend_at', { time: format.time(new Date(until), deviceTimeZone()) })
  return (
    <>
      {resend.isSuccess ? (
        <Banner tone="info" announce>
          {t('auth.verify.resent')}
        </Banner>
      ) : null}
      {refused ? (
        <Banner tone="danger" announce>
          {problemText(resend.error)}
        </Banner>
      ) : null}
      <Form onSubmit={submit} busy={resend.isPending} refused={fault ?? resend.error}>
        {to === undefined ? (
          <EmailField value={typed} onChange={setTyped} fault={emailFault} />
        ) : null}
        <Button
          type="submit"
          variant={to === undefined ? 'primary' : 'secondary'}
          loading={resend.isPending}
          aria-disabled={waiting}
        >
          {words}
        </Button>
      </Form>
    </>
  )
}
