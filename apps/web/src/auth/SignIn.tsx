// Sign in (A-1, FR-ID3): an address and a password, and under them the providers the server
// signs in with (FR-ID2). A web sign-in sets the session's cookie, which no script reads, so the
// app learns who is signed in by asking, and then goes where the visitor was going.
//
// What the screen says of a failure is auth.js's register, and is not softened here: a wrong
// password, an address with no account and an account that may not sign in are one sentence and
// one screen, since two would tell whether an account exists. A sign-in that is limited is said
// with the time it clears and the way to a reset beside it; it is not said to be *from this
// device*, as the prototype has it, since the server counts by address and by network (PRD 02
// §9). An account with the second step on answers with a challenge, which signs nobody in: it is
// held for the second-step screens (challenge.ts).
import type { MessageKey } from '@household/i18n/lazy'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { heldDestination } from '../session/destination.ts'
import { useSession, type Ended } from '../session/SessionProvider.tsx'
import { Banner, type BannerTone } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { PasswordField } from '../ui/Field.tsx'
import { challengeIn, holdChallenge } from './challenge.ts'
import { Destination } from './Destination.tsx'
import { checkEmail, EmailField, fieldCodes, refusedEmail, type EmailFault } from './fields.tsx'
import { noticeIn, type Notice } from './notice.ts'
import {
  providers,
  startProvider,
  useOfferedProviders,
  useShownAgain,
  type Provider,
} from './provider.ts'
import { Form, Notices, Screen, Way, Ways } from './Screen.tsx'
import styles from './Screen.module.css'

/** Why a person is at the sign-in again, as the screen that sent them says it. */
const noticed = {
  took_too_long: { tone: 'info', key: 'auth.sign_in.notice.took_too_long' },
  locked: { tone: 'warning', key: 'auth.sign_in.notice.locked' },
  password_set: { tone: 'info', key: 'auth.sign_in.notice.password_set' },
} as const satisfies Record<Notice, { tone: BannerTone; key: MessageKey }>

/** Why the session that was here ended, said calmly: nothing was lost by it. */
const endings = {
  expired: 'auth.sign_in.ended.expired',
  csrf: 'auth.sign_in.ended.csrf',
} as const satisfies Record<Ended, MessageKey>

const continueWith = {
  google: 'auth.sign_in.google',
  apple: 'auth.sign_in.apple',
} as const satisfies Record<Provider, MessageKey>

/** What was typed that the server would certainly refuse, found before it is asked. */
interface Faults {
  readonly email: EmailFault | undefined
  readonly password: boolean
}

export function SignIn() {
  const t = useTranslate()
  const api = useApi()
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const problemText = useProblemText()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [faults, setFaults] = useState<Faults>()

  const signIn = useMutation({
    ...askedNow,
    mutationFn: async (credentials: { readonly email: string; readonly password: string }) =>
      unwrap(await api.POST('/auth/login', { body: { ...credentials, client_type: 'web' } })),
    onSuccess: async () => {
      await session.entered()
      void navigate(heldDestination() ?? paths.home.path, { replace: true })
    },
    onError: (error) => {
      const challenge = challengeIn(error)
      if (challenge === undefined) return
      holdChallenge(challenge)
      // A locked authenticator takes only a recovery code, and `totp` is then not among the ways.
      void navigate(
        challenge.methods.includes('totp') ? paths.secondStep.path : paths.recoveryCode.path,
      )
    },
  })

  // The providers this server signs in with. A control that could only fail is not drawn
  // (FR-ID2), so until the list is known, and where it is empty, nothing of them is.
  const offered = useOfferedProviders()
  const listed = providers.filter((provider) => offered.data?.includes(provider) === true)
  const start = useMutation({
    ...askedNow,
    mutationFn: (provider: Provider) => startProvider({ api, provider, intent: 'sign-in' }),
  })
  // Back from the provider's page, to this one as the browser kept it: the start is put back.
  useShownAgain(start.reset)

  const submit = () => {
    const address = email.trim()
    const found: Faults = { email: checkEmail(address), password: password === '' }
    start.reset()
    if (found.email !== undefined || found.password) {
      signIn.reset()
      setFaults(found)
      return
    }
    setFaults(undefined)
    signIn.mutate({ email: address, password })
  }

  const emailFault = faults?.email ?? refusedEmail(signIn.error)
  const passwordFault = faults?.password === true || fieldCodes(signIn.error).has('/password')

  // The one sentence over the form, for a refusal that is no field's.
  const refusal = signIn.error ?? start.error
  let sentence: string | undefined
  if (refusal !== null && challengeIn(refusal) === undefined) {
    if (problemIn(refusal)?.code === 'invalid_credentials') sentence = t('auth.sign_in.bad')
    else if (emailFault === undefined && !passwordFault) sentence = problemText(refusal)
  }
  const limited = problemIn(refusal)?.status === 429

  // One way in at a time: while a sign-in or a start is on its way the form sends nothing and no
  // provider's control takes a press, so neither is put away, nor another sent in its place,
  // before it is answered. A start that was answered holds nothing: the page is leaving, and
  // where it did not, the form is still a way in.
  const asking = signIn.isPending || start.isPending

  const notice = noticeIn(location.state)
  return (
    <Screen title={t('auth.sign_in.title')} lede={t('auth.sign_in.lede')}>
      <Notices>
        {notice !== undefined ? (
          <Banner tone={noticed[notice].tone}>{t(noticed[notice].key)}</Banner>
        ) : session.ended !== null ? (
          <Banner tone="info">{t(endings[session.ended])}</Banner>
        ) : null}
        <Destination />
        {sentence === undefined ? null : (
          <Banner
            tone="danger"
            announce
            actions={
              limited ? (
                <Link to={paths.reset.path} className={styles.way}>
                  {t('auth.sign_in.forgot')}
                </Link>
              ) : undefined
            }
          >
            {sentence}
          </Banner>
        )}
      </Notices>
      <Form onSubmit={submit} busy={asking} refused={faults ?? signIn.error}>
        <EmailField value={email} onChange={setEmail} fault={emailFault} autoComplete="username" />
        <PasswordField
          label={t('auth.password.label')}
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.currentTarget.value)
          }}
          error={passwordFault ? t('auth.password.required') : undefined}
        />
        <Button
          type="submit"
          variant="primary"
          loading={signIn.isPending}
          aria-disabled={start.isPending}
        >
          {t('auth.sign_in.submit')}
        </Button>
      </Form>
      {listed.length === 0 ? null : (
        <>
          <p className={styles.or}>{t('auth.sign_in.or')}</p>
          <div className={styles.providers}>
            {listed.map((provider) => (
              <Button
                key={provider}
                // It stays busy once the start is answered: the page is leaving for the
                // provider's, and is put back where it is shown again from there.
                loading={start.variables === provider && (start.isPending || start.isSuccess)}
                aria-disabled={asking}
                onClick={() => {
                  signIn.reset()
                  setFaults(undefined)
                  start.mutate(provider)
                }}
              >
                {t(continueWith[provider])}
              </Button>
            ))}
          </div>
        </>
      )}
      <Ways>
        <Way to={paths.reset.path}>{t('auth.sign_in.forgot')}</Way>
        <Way to={paths.register.path}>{t('auth.sign_in.register')}</Way>
      </Ways>
    </Screen>
  )
}
