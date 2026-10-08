// Turning the second step on (A-5 and A-6, `/account/2fa`; PRD 02 §2, ADR 0010): the password,
// then the square and the key, then the ten recovery codes.
//
// - The password is asked first (`postAuthMfaEnroll`): binding a second factor is at least as
//   sensitive as removing one, and a session alone must not be enough to enrol an authenticator
//   of its own. An account with no password, one that signs in with Google or Apple alone, sets
//   one by a password reset first.
// - An account whose address is not verified is refused, and told so where it is refused (A-4's
//   block): a second step bound to an address nobody has proven would outlive the reset that
//   proves it, and lock the address's owner out. The way on is the verification link, sent again
//   from here.
// - The key is offered at the same level as the square, not behind a "can't scan?": someone
//   setting this up on the only phone they own cannot scan the screen they are reading.
// - A wrong code says the commonest cause, a code that changed while it was typed; five wrong
//   ones in five minutes are answered with the time to try again at.
// - The codes are answered once (RecoveryCodes.tsx) and live in this page's memory alone. Should
//   the answer be lost on its way, the second step is on all the same and the screen says so,
//   with the way to a new set.
//
// Setting it up again, for a new phone, is the same road: the authenticator that is on stays on
// until the new one's code is confirmed.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { meKey, useMe, type Me } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { TextField } from '../ui/Field.tsx'
import { useToast } from '../ui/Toast.tsx'
import { askedNow, copyText, isRefusedAsSent, useOwnZone } from './common.ts'
import { Section, SettingsPage } from './Page.tsx'
import { PasswordDialog } from './PasswordDialog.tsx'
import { QrCode } from './QrCode.tsx'
import { RecoveryCodes } from './RecoveryCodes.tsx'
import styles from './Settings.module.css'
import { VerifyResend } from './VerifyResend.tsx'

type Stage =
  | { readonly at: 'start' }
  | { readonly at: 'scan'; readonly secret: string; readonly uri: string }
  | { readonly at: 'codes'; readonly codes: readonly string[] }

/** `secret` in groups of four, as a reader keeps their place in a key they type. */
export function grouped(secret: string): string[] {
  return secret.match(/.{1,4}/g) ?? [secret]
}

function Scan({
  secret,
  uri,
  onCodes,
}: {
  readonly secret: string
  readonly uri: string
  readonly onCodes: (codes: readonly string[]) => void
}) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const say = useProblemText(useOwnZone())
  const [code, setCode] = useState('')
  const [malformed, setMalformed] = useState(false)
  const activate = useMutation({
    ...askedNow,
    mutationFn: async (digits: string) =>
      unwrap(await api.POST('/auth/mfa/activate', { body: { code: digits } })),
    onSettled: () => {
      // On, or perhaps on: the account says which.
      void queries.invalidateQueries({ queryKey: meKey })
    },
    onSuccess: (answer) => {
      onCodes(answer.recovery_codes)
    },
  })
  // The answer carries the codes and is never kept to be answered with again: a request whose
  // answer was lost, and which the transport sent again, is told only that the first is done.
  const lost = problemIn(activate.error)?.code === 'idempotency_in_progress'
  const wrong = isRefusedAsSent(activate.error)
  const error = malformed
    ? t('account.second_step.code.malformed')
    : wrong
      ? t('account.second_step.code.wrong')
      : activate.isError && !lost
        ? say(activate.error)
        : undefined

  if (lost) {
    return (
      <SettingsPage title={t('account.second_step.title')}>
        <Banner tone="warning" title={t('account.second_step.lost.title')}>
          {t('account.second_step.lost.body')}
        </Banner>
        <Link className={styles.link} to={paths.accountSecurity.path}>
          {t('account.second_step.lost.action')}
        </Link>
      </SettingsPage>
    )
  }
  return (
    <SettingsPage title={t('account.second_step.title')} lead={t('account.second_step.lead')}>
      <Section
        title={t('account.second_step.scan.title')}
        note={t('account.second_step.scan.note')}
      >
        <QrCode value={uri} label={t('account.second_step.scan.square')} />
        <div className={styles.group}>
          <p className={styles.strong}>{t('account.second_step.scan.key')}</p>
          <p className={styles.key}>
            {grouped(secret).map((group, index) => (
              // A key may hold the same four characters twice: a group is its place in it.
              <span key={index}>{group}</span>
            ))}
          </p>
          <div className={styles.actions}>
            <Button
              onClick={() => {
                copyText(secret).then(
                  () => {
                    toast({ message: t('account.second_step.scan.copied') })
                  },
                  () => {
                    toast({ message: t('account.second_step.scan.copy_failed') })
                  },
                )
              }}
            >
              {t('account.second_step.scan.copy')}
            </Button>
          </div>
        </div>
      </Section>
      <Section title={t('account.second_step.code.title')}>
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            const digits = code.replace(/\s/g, '')
            // A code that is not six digits is no code of the app's: said here, and not spent
            // as one of the five tries the server allows in five minutes.
            const shaped = /^\d{6}$/.test(digits)
            setMalformed(!shaped)
            activate.reset()
            if (shaped) activate.mutate(digits)
          }}
        >
          <TextField
            label={t('account.second_step.code.label')}
            numeric
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            error={error}
            onChange={(event) => {
              setCode(event.currentTarget.value)
            }}
          />
          <p className={styles.note}>{t('account.second_step.code.next')}</p>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={activate.isPending}>
              {t('account.second_step.code.turn_on')}
            </Button>
            <Link className={styles.link} to={paths.accountSecurity.path}>
              {t('account.second_step.not_now')}
            </Link>
          </div>
        </form>
      </Section>
    </SettingsPage>
  )
}

function Start({
  me,
  onEnrolled,
}: {
  readonly me: Me
  readonly onEnrolled: (stage: Stage) => void
}) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const [asking, setAsking] = useState(false)
  const enrol = useMutation({
    ...askedNow,
    mutationFn: async (password: string) =>
      unwrap(await api.POST('/auth/mfa/enroll', { body: { password } })),
    onSuccess: (enrolment) => {
      setAsking(false)
      onEnrolled({ at: 'scan', secret: enrolment.secret, uri: enrolment.otpauth_uri })
    },
    onError: (error) => {
      if (problemIn(error)?.code !== 'account_unverified') return
      // The server's word on it, whatever this page had read: the block is drawn in the
      // screen's own place, and lifts when the account is read as verified.
      setAsking(false)
      queries.setQueryData<Me>(meKey, (was) =>
        was === undefined ? was : { ...was, email_verified: false },
      )
    },
  })
  const on = me.mfa_enabled === true
  const email = me.email ?? null

  if (me.is_child === true) {
    return (
      <SettingsPage title={t('account.second_step.title')} lead={t('account.security.child')}>
        {null}
      </SettingsPage>
    )
  }
  if (!(me.credentials ?? []).includes('password')) {
    return (
      <SettingsPage title={t('account.second_step.title')} lead={t('account.second_step.lead')}>
        <p className={styles.text}>{t('account.second_step.no_password')}</p>
        <Link className={styles.link} to={paths.reset.path}>
          {t('account.security.password.reset')}
        </Link>
      </SettingsPage>
    )
  }
  if (!me.email_verified && email !== null) {
    return (
      <SettingsPage title={t('account.second_step.title')} lead={t('account.second_step.lead')}>
        <Banner tone="warning" title={t('account.second_step.unverified.title')}>
          {t('account.second_step.unverified.body')}
        </Banner>
        <VerifyResend email={email} />
      </SettingsPage>
    )
  }
  return (
    <SettingsPage title={t('account.second_step.title')} lead={t('account.second_step.lead')}>
      {on ? <Banner tone="info">{t('account.second_step.again.body')}</Banner> : null}
      <p className={styles.text}>{t('account.second_step.start.body')}</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => {
            setAsking(true)
          }}
        >
          {on ? t('account.second_step.again.action') : t('account.second_step.start.action')}
        </Button>
        <Link className={styles.link} to={paths.accountSecurity.path}>
          {t('account.second_step.not_now')}
        </Link>
      </div>
      <PasswordDialog
        open={asking}
        title={t('account.second_step.password.title')}
        description={t('account.second_step.password.body')}
        confirm={t('account.second_step.password.confirm')}
        pending={enrol.isPending}
        error={enrol.error}
        onSubmit={(password) => {
          enrol.mutate(password)
        }}
        onClose={() => {
          setAsking(false)
          enrol.reset()
        }}
      />
    </SettingsPage>
  )
}

export function SecondStepSetup() {
  const me = useMe()
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage>({ at: 'start' })
  switch (stage.at) {
    case 'start':
      return <Start me={me} onEnrolled={setStage} />
    case 'scan':
      return (
        <Scan
          secret={stage.secret}
          uri={stage.uri}
          onCodes={(codes) => {
            setStage({ at: 'codes', codes })
          }}
        />
      )
    case 'codes':
      return (
        <RecoveryCodes
          codes={stage.codes}
          onFinish={() => {
            void navigate(paths.accountSecurity.path)
          }}
        />
      )
  }
}
