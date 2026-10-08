// How an account signs in (`/account/security`; PRD 02 §2, ADR 0009, ADR 0010): its password, its
// second step, and Google and Apple where the server signs in with them.
//
// Each says what the server does, which is not always what the prototype drew:
//
// - Changing the password needs the current one, and signs out every *other* browser and device;
//   this one stays. A new password is screened against a list of breached ones the server keeps,
//   and a refusal says what that list is: nothing of the password is sent anywhere else. An
//   account that signs in only with Google or Apple has no password to change, and a password
//   reset sets one.
// - Turning the second step off and making new recovery codes each ask for the password again
//   (PasswordDialog.tsx). Turning it off cannot be taken back: the authenticator, its recovery
//   codes and every trusted browser and device go, so there is no undo, and the confirmation says
//   so. New codes are shown once, from memory (RecoveryCodes.tsx); afterwards the account says
//   only how many are left.
// - A provider is offered only where the server is configured for it (FR-ID2): a control that
//   could only fail is not drawn. The only way an account signs in cannot be disconnected.
//
// A child profile signs in with its PIN alone (D-104), and has none of these.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { paths } from '../app/paths.ts'
import { checkNewPassword, fieldCodes, useRefusedField } from '../auth/fields.tsx'
import {
  startProvider,
  useOfferedProviders,
  useShownAgain,
  type Provider,
} from '../auth/provider.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { meKey, useMe, type Me } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { PasswordField } from '../ui/Field.tsx'
import { List, ListRow } from '../ui/ListRow.tsx'
import { useToast } from '../ui/Toast.tsx'
import a11y from '../ui/a11y.module.css'
import { signedInKey, useOwnZone } from './common.ts'
import { Section, SettingsPage } from './Page.tsx'
import { PasswordDialog } from './PasswordDialog.tsx'
import { RecoveryCodes } from './RecoveryCodes.tsx'
import styles from './Settings.module.css'

function ChangePassword({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const say = useProblemText(useOwnZone())
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [checked, setChecked] = useState({ current: false, next: false })
  const change = useMutation({
    ...askedNow,
    mutationFn: async (body: {
      readonly current_password: string
      readonly new_password: string
    }) => {
      unwrap(await api.POST('/auth/password', { body }))
    },
    onSuccess: () => {
      setCurrent('')
      setNext('')
      toast({ message: t('account.security.password.changed') })
      // Every other browser and device was signed out with it.
      void queries.invalidateQueries({ queryKey: signedInKey })
    },
  })
  // What the server refused it with, or what it was last checked to, anew at each submission.
  const form = useRefusedField(change.error ?? checked)
  const wrong = problemIn(change.error)?.code === 'invalid_credentials'
  const refused = fieldCodes(change.error).get('/new_password')
  const currentError = checked.current
    ? t('account.security.password.current.missing')
    : wrong
      ? t('account.security.password.current.wrong')
      : undefined
  const nextError = checked.next
    ? t('account.security.password.new.short')
    : refused === 'invalid'
      ? t('account.security.password.new.breached')
      : refused !== undefined
        ? t('account.security.password.new.short')
        : undefined
  const other = change.isError && !wrong && refused === undefined ? say(change.error) : undefined
  return (
    <form
      ref={form}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        // The new one is held to the contract's minimum as every screen that sets one holds it.
        const failed = { current: current === '', next: checkNewPassword(next) !== undefined }
        setChecked(failed)
        change.reset()
        if (failed.current || failed.next) return
        change.mutate({ current_password: current, new_password: next })
      }}
    >
      {/* Whose password it is, for a password manager: drawn nowhere, and no field of the form's. */}
      <input type="text" hidden readOnly autoComplete="username" value={me.email ?? ''} />
      <PasswordField
        label={t('account.security.password.current.label')}
        autoComplete="current-password"
        value={current}
        error={currentError}
        onChange={(event) => {
          setCurrent(event.currentTarget.value)
        }}
      />
      <PasswordField
        label={t('account.security.password.new.label')}
        help={t('account.security.password.new.help')}
        autoComplete="new-password"
        value={next}
        error={nextError}
        onChange={(event) => {
          setNext(event.currentTarget.value)
        }}
      />
      <p className={styles.note}>{t('account.security.password.consequence')}</p>
      {other === undefined ? null : (
        <Banner tone="danger" announce>
          {other}
        </Banner>
      )}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={change.isPending}>
          {t('account.security.password.change')}
        </Button>
      </div>
    </form>
  )
}

function SecondStep({
  me,
  onCodes,
}: {
  readonly me: Me
  readonly onCodes: (codes: readonly string[]) => void
}) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const [asking, setAsking] = useState<'codes' | 'off' | null>(null)
  // The account alone, by its whole key: its other reads are filed under it.
  const refresh = () => queries.invalidateQueries({ queryKey: meKey, exact: true })
  // Turned off from somewhere else since this page was read: there is nothing left to do.
  const gone = (error: unknown) => {
    if (problemIn(error)?.status !== 404) return
    setAsking(null)
    toast({ message: t('account.security.second_step.turned_off') })
    void refresh()
  }
  const codes = useMutation({
    ...askedNow,
    mutationFn: async (password: string) =>
      unwrap(await api.POST('/auth/mfa/recovery-codes', { body: { password } })),
    onSuccess: (answer) => {
      setAsking(null)
      onCodes(answer.recovery_codes)
      void refresh()
    },
    onError: gone,
  })
  const off = useMutation({
    ...askedNow,
    mutationFn: async (password: string) => {
      unwrap(await api.POST('/auth/mfa/disable', { body: { password } }))
    },
    onSuccess: () => {
      setAsking(null)
      // No undo: what was turned off is gone, and turning it on is setting it up again.
      toast({ message: t('account.security.second_step.turned_off') })
      void refresh()
    },
  })
  const close = () => {
    setAsking(null)
    codes.reset()
    off.reset()
  }

  if (me.mfa_enabled !== true) {
    return (
      <Section title={t('account.security.second_step.title')}>
        <p className={styles.text}>{t('account.security.second_step.off')}</p>
        <Link className={styles.link} to={paths.accountSecondStep.path}>
          {t('account.security.second_step.add')}
        </Link>
      </Section>
    )
  }
  const left = me.mfa_recovery_codes_left ?? 0
  return (
    <Section title={t('account.security.second_step.title')}>
      <p className={styles.text}>{t('account.security.second_step.on')}</p>
      <p className={styles.text}>{t('account.security.second_step.codes_left', { count: left })}</p>
      {left <= 2 ? (
        <p className={styles.note}>{t('account.security.second_step.codes_low')}</p>
      ) : null}
      <div className={styles.actions}>
        <Button
          onClick={() => {
            setAsking('codes')
          }}
        >
          {t('account.security.second_step.new_codes')}
        </Button>
        <Button
          onClick={() => {
            setAsking('off')
          }}
        >
          {t('account.security.second_step.turn_off')}
        </Button>
      </div>
      <Link className={styles.link} to={paths.accountSecondStep.path}>
        {t('account.security.second_step.move')}
      </Link>
      <PasswordDialog
        open={asking === 'codes'}
        title={t('account.security.new_codes.title')}
        description={t('account.security.new_codes.body')}
        confirm={t('account.security.new_codes.confirm')}
        pending={codes.isPending}
        error={codes.error}
        onSubmit={(password) => {
          codes.mutate(password)
        }}
        onClose={close}
      />
      <PasswordDialog
        open={asking === 'off'}
        title={t('account.security.turn_off.title')}
        description={t('account.security.turn_off.body')}
        confirm={t('account.security.turn_off.confirm')}
        danger
        pending={off.isPending}
        error={off.error}
        onSubmit={(password) => {
          off.mutate(password)
        }}
        onClose={close}
      />
    </Section>
  )
}

function SignInWith({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const say = useProblemText(useOwnZone())
  const offered = useOfferedProviders()
  const name = (provider: Provider): string =>
    provider === 'google'
      ? t('account.security.providers.google')
      : t('account.security.providers.apple')
  const connect = useMutation({
    ...askedNow,
    // It leaves for the provider's pages, and comes back to this screen once the link is made.
    mutationFn: (provider: Provider) =>
      startProvider({ api, provider, intent: 'link', returnTo: paths.accountSecurity.path }),
  })
  // Back from the provider's page with no link made, to this one as the browser kept it: the
  // control that stayed busy while the page was leaving is put back.
  useShownAgain(connect.reset)
  const disconnect = useMutation({
    ...askedNow,
    mutationFn: async (provider: Provider) => {
      unwrap(await api.DELETE('/auth/oauth/{provider}', { params: { path: { provider } } }))
    },
    onSuccess: (_answer, provider) => {
      toast({ message: t('account.security.providers.disconnected', { provider: name(provider) }) })
      void queries.invalidateQueries({ queryKey: meKey, exact: true })
    },
  })

  if (offered.data === undefined) {
    if (!offered.isError) return null
    return (
      <Section title={t('account.security.providers.title')}>
        {/* Said as it arrives, as a body's failure is (ui/StateFrame): nothing of the section is
            drawn while it is asked again, so one that fails again is drawn anew, and said anew. */}
        <Banner
          tone="danger"
          announce
          actions={
            <Button
              onClick={() => {
                void offered.refetch()
              }}
            >
              {t('ui.retry')}
            </Button>
          }
        >
          {t('account.security.providers.error')}
        </Banner>
      </Section>
    )
  }
  // Where the server signs in with neither, there is nothing to connect and nothing is drawn.
  if (offered.data.length === 0) return null

  const linked = new Set<string>(me.credentials ?? [])
  const only = problemIn(disconnect.error)?.code === 'only_credential'
  return (
    <Section title={t('account.security.providers.title')}>
      <List label={t('account.security.providers.title')}>
        {offered.data.map((provider) => {
          const connected = linked.has(provider)
          return (
            <ListRow
              key={provider}
              title={name(provider)}
              trailing={
                connected ? (
                  <>
                    <span className={styles.badge}>
                      {t('account.security.providers.connected')}
                    </span>
                    <Button
                      loading={disconnect.isPending && disconnect.variables === provider}
                      onClick={() => {
                        connect.reset()
                        disconnect.mutate(provider)
                      }}
                    >
                      {/* Named for what it disconnects; drawn as the one word. */}
                      <span className={a11y.visuallyHidden}>
                        {t('account.security.providers.disconnect_named', {
                          provider: name(provider),
                        })}
                      </span>
                      <span aria-hidden="true">{t('account.security.providers.disconnect')}</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    loading={
                      (connect.isPending || connect.isSuccess) && connect.variables === provider
                    }
                    onClick={() => {
                      disconnect.reset()
                      connect.mutate(provider)
                    }}
                  >
                    {t('account.security.providers.connect', { provider: name(provider) })}
                  </Button>
                )
              }
            />
          )
        })}
      </List>
      <p className={styles.note}>{t('account.security.providers.note')}</p>
      {disconnect.isError ? (
        <Banner
          tone="danger"
          announce
          actions={
            only ? (
              <Link className={styles.link} to={paths.reset.path}>
                {t('account.security.password.reset')}
              </Link>
            ) : undefined
          }
        >
          {only
            ? t('account.security.providers.only', { provider: name(disconnect.variables) })
            : say(disconnect.error)}
        </Banner>
      ) : null}
      {connect.isError ? (
        <Banner tone="danger" announce>
          {say(connect.error)}
        </Banner>
      ) : null}
    </Section>
  )
}

export function Security() {
  const t = useTranslate()
  const me = useMe()
  // The codes just made, for as long as this screen shows them: held here and nowhere else.
  const [codes, setCodes] = useState<readonly string[] | null>(null)
  if (codes !== null) {
    return (
      <RecoveryCodes
        codes={codes}
        onFinish={() => {
          setCodes(null)
        }}
      />
    )
  }
  if (me.is_child === true) {
    return (
      <SettingsPage title={t('account.security.title')} lead={t('account.security.child')}>
        {null}
      </SettingsPage>
    )
  }
  const password = (me.credentials ?? []).includes('password')
  return (
    <SettingsPage title={t('account.security.title')}>
      <Section title={t('account.security.password.title')}>
        {password ? (
          <ChangePassword me={me} />
        ) : (
          <>
            <p className={styles.text}>{t('account.security.password.none')}</p>
            <Link className={styles.link} to={paths.reset.path}>
              {t('account.security.password.reset')}
            </Link>
          </>
        )}
      </Section>
      <SecondStep me={me} onCodes={setCodes} />
      <SignInWith me={me} />
    </SettingsPage>
  )
}
