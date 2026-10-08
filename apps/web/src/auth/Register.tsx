// Register (A-2, FR-ID1): a name, an address and a password, and the account exists at once,
// unverified. The server answers `202` whether or not the address already has an account, and
// the next screen is the same either way (D-13): what differs is the email, a verification link
// to a new address and a note to one that has an account. So nothing here, and nothing on the
// screen it leads to, says which it was.
//
// The password's minimum is the contract's twelve characters, where the prototype says ten, and
// its one refusal no schema names is the breached-password screen's, said as fields.tsx says it.
// The prototype's box of terms is not drawn: the contract takes no such field, and a box nothing
// records is no agreement.
import { pseudoLocale } from '@household/i18n/lazy'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { TextField } from '../ui/Field.tsx'
import {
  Breached,
  checkEmail,
  checkNewPassword,
  EmailField,
  fieldCodes,
  NewPasswordField,
  refusedEmail,
  refusedPassword,
  type EmailFault,
  type PasswordFault,
} from './fields.tsx'
import { Form, Notices, Screen, Way, Ways } from './Screen.tsx'
import { sentState } from './sent.ts'

/** What was typed that the server would certainly refuse, found before it is asked. */
interface Faults {
  readonly name: boolean
  readonly email: EmailFault | undefined
  readonly password: PasswordFault | undefined
}

export function Register() {
  const { t, locale } = useI18n()
  const api = useApi()
  const navigate = useNavigate()
  const problemText = useProblemText()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [faults, setFaults] = useState<Faults>()

  const register = useMutation({
    mutationFn: async (account: {
      readonly display_name: string
      readonly email: string
      readonly password: string
    }) => {
      unwrap(
        await api.POST('/auth/register', {
          // The language the app is shown in becomes the account's. The pseudo-locale is
          // nobody's: left out, the server takes the browser's own.
          body: locale === pseudoLocale ? account : { ...account, locale },
        }),
      )
    },
    onSuccess: (_, account) => {
      void navigate(paths.verifySent.path, { state: sentState(account.email) })
    },
  })

  const submit = () => {
    // Leading and trailing white space is no part of a name, and a name of nothing else is none.
    const account = { display_name: name.trim(), email: email.trim(), password }
    const found: Faults = {
      name: account.display_name === '',
      email: checkEmail(account.email),
      password: checkNewPassword(password),
    }
    if (found.name || found.email !== undefined || found.password !== undefined) {
      register.reset()
      setFaults(found)
      return
    }
    setFaults(undefined)
    register.mutate(account)
  }

  const refused = fieldCodes(register.error)
  const nameFault = faults?.name === true || refused.has('/display_name')
  const emailFault = faults?.email ?? refusedEmail(register.error)
  const passwordFault = faults?.password ?? refusedPassword(register.error)
  // A refusal that is no field's: a limit, with its time, or a failure.
  const other =
    register.error !== null && !nameFault && emailFault === undefined && passwordFault === undefined
  return (
    <Screen title={t('auth.register.title')} lede={t('auth.register.lede')}>
      <Notices>
        {passwordFault === 'breached' ? <Breached /> : null}
        {other ? (
          <Banner tone="danger" announce>
            {problemText(register.error)}
          </Banner>
        ) : null}
      </Notices>
      <Form onSubmit={submit} busy={register.isPending} refused={faults ?? register.error}>
        <TextField
          label={t('auth.name.label')}
          autoComplete="name"
          // The contract's longest name.
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value)
          }}
          error={nameFault ? t('auth.name.required') : undefined}
        />
        <EmailField value={email} onChange={setEmail} fault={emailFault} />
        <NewPasswordField
          label={t('auth.password.label')}
          value={password}
          onChange={setPassword}
          fault={passwordFault}
        />
        <Button type="submit" variant="primary" loading={register.isPending}>
          {t('auth.register.submit')}
        </Button>
      </Form>
      <Ways>
        <Way to={paths.signIn.path}>{t('auth.register.have_account')}</Way>
      </Ways>
    </Screen>
  )
}
