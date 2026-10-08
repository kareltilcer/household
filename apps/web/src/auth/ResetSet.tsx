// Setting a new password with a reset link (A-10, FR-ID6). The link's token is in the fragment,
// read once and taken out of the address (fragment.ts); it is spent when the password is set,
// and not by opening the page.
//
// A reset signs the account out everywhere: every session, every device, every browser trusted
// to skip the second step. That is said before the button and in the button, not in a toast
// after it (auth.js A-10): somebody who reads nothing on this screen still reads the thing they
// are about to press. A device signed out discards its copy of the household, and what it had
// saved offline and not yet sent goes with it, which is the one loss the screen has to name.
//
// A reset link lasts one hour, and the screen that says one has expired says so: the
// prototype's one sentence for every expired link says twenty-four, which is the verification
// link's.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { meKey } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import {
  Breached,
  checkNewPassword,
  fieldCodes,
  NewPasswordField,
  refusedPassword,
  type PasswordFault,
} from './fields.tsx'
import { useFragment } from './fragment.ts'
import { noticeState } from './notice.ts'
import { Form, Notices, Screen, Way, Ways } from './Screen.tsx'

export function ResetSet() {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const problemText = useProblemText()
  const token = useFragment().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [fault, setFault] = useState<{ readonly password: PasswordFault }>()

  const set = useMutation({
    ...askedNow,
    mutationFn: async (chosen: string) => {
      unwrap(await api.POST('/auth/password-reset/confirm', { body: { token, password: chosen } }))
    },
    onSuccess: async () => {
      // A session of this account's in this browser has just ended, and the app learns that by
      // asking who is signed in. It is asked before the way to the sign-in is taken, which is a
      // visitor's alone and would send a member on; and where nobody was signed in, nothing is
      // asked, since a visitor's page asks the server nothing it would refuse. The account alone,
      // by its whole key: what else is filed under it, a list this browser kept and this page
      // has not read, has nobody here to ask for it.
      await queries.refetchQueries({ queryKey: meKey, exact: true })
      void navigate(paths.signIn.path, { replace: true, state: noticeState('password_set') })
    },
  })

  const submit = () => {
    const found = checkNewPassword(password)
    if (found !== undefined) {
      set.reset()
      setFault({ password: found })
      return
    }
    setFault(undefined)
    set.mutate(password)
  }

  const toSignIn = <Way to={paths.signIn.path}>{t('auth.way.back_to_sign_in')}</Way>
  const newLink = <Way to={paths.reset.path}>{t('auth.way.new_link')}</Way>
  const problem = problemIn(set.error)
  let said: { readonly title: string; readonly lede?: string; readonly rest: ReactNode }
  if (token === '' || problem?.status === 404 || fieldCodes(set.error).has('/token')) {
    // A link nobody issued and one cut short in copying read the same.
    said = {
      title: t('auth.link.nothing.title'),
      lede: t('auth.link.incomplete'),
      rest: (
        <Ways>
          {newLink}
          {toSignIn}
        </Ways>
      ),
    }
  } else if (problem?.code === 'token_already_used') {
    said = {
      title: t('auth.link.used.title'),
      lede: t('auth.reset_set.used.body'),
      rest: (
        <Ways>
          {toSignIn}
          {newLink}
        </Ways>
      ),
    }
  } else if (problem?.status === 410) {
    said = {
      title: t('auth.link.expired.title'),
      lede: t('auth.reset_set.expired.body'),
      rest: (
        <Ways>
          {newLink}
          {toSignIn}
        </Ways>
      ),
    }
  } else {
    const passwordFault = fault?.password ?? refusedPassword(set.error)
    said = {
      title: t('auth.reset_set.title'),
      rest: (
        <>
          <Notices>
            <Banner tone="warning" title={t('auth.reset_set.warning.title')}>
              {t('auth.reset_set.warning.body')}
            </Banner>
            {passwordFault === 'breached' ? <Breached /> : null}
            {set.error !== null && passwordFault === undefined ? (
              <Banner tone="danger" announce>
                {problemText(set.error)}
              </Banner>
            ) : null}
          </Notices>
          <Form onSubmit={submit} busy={set.isPending} refused={fault ?? set.error}>
            <NewPasswordField
              label={t('auth.password.new_label')}
              value={password}
              onChange={setPassword}
              fault={passwordFault}
            />
            <Button type="submit" variant="primary" loading={set.isPending}>
              {t('auth.reset_set.submit')}
            </Button>
          </Form>
          <Ways>
            <Way to={paths.signIn.path}>{t('auth.reset_set.cancel')}</Way>
          </Ways>
        </>
      ),
    }
  }
  return (
    <Screen live title={said.title} lede={said.lede}>
      {said.rest}
    </Screen>
  )
}
