// What a child profile's graduation link opens (FR-CH4, D-104, ADR 0012): the page on which a
// young adult turns the profile an owner made for them into an account of their own, by choosing
// its password. The address the link was sent to becomes the account's, the password takes the
// PIN's place, and everything the profile made stays with it.
//
// Its reader has never had a password here, and may never have had one anywhere: the words are
// plain, each refusal says who to ask, and that is always an owner of their household, a person
// they live with, never a support address. A refusal whose way on is that person draws no
// control: a link to a sign-in that a PIN does not open would lead nowhere. The link's token is
// in the fragment, read once and taken out of the address (fragment.ts), and is spent when the
// password is set.
import { useMutation } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
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
import { Form, Notices, Screen, Way, Ways } from './Screen.tsx'

export function Graduate() {
  const t = useTranslate()
  const api = useApi()
  const problemText = useProblemText()
  const token = useFragment().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [fault, setFault] = useState<{ readonly password: PasswordFault }>()

  const graduate = useMutation({
    mutationFn: async (chosen: string) => {
      unwrap(await api.POST('/auth/graduation/confirm', { body: { token, password: chosen } }))
    },
  })

  const submit = () => {
    const found = checkNewPassword(password)
    if (found !== undefined) {
      graduate.reset()
      setFault({ password: found })
      return
    }
    setFault(undefined)
    graduate.mutate(password)
  }

  const problem = problemIn(graduate.error)
  let said: { readonly title: string; readonly lede: string; readonly rest: ReactNode }
  if (graduate.isSuccess) {
    said = {
      title: t('auth.graduate.done.title'),
      lede: t('auth.graduate.done.body'),
      rest: (
        <Ways>
          <Way to={paths.signIn.path}>{t('auth.way.sign_in')}</Way>
        </Ways>
      ),
    }
  } else if (token === '' || problem?.status === 404 || fieldCodes(graduate.error).has('/token')) {
    // A link nobody issued, one cut short in copying, and a profile no longer in its household
    // read the same.
    said = {
      title: t('auth.link.nothing.title'),
      lede: t('auth.graduate.nothing.body'),
      rest: null,
    }
  } else if (problem?.code === 'email_taken') {
    said = {
      title: t('auth.graduate.email_taken.title'),
      lede: t('auth.graduate.email_taken.body'),
      rest: null,
    }
  } else if (problem?.code === 'token_expired') {
    said = {
      title: t('auth.link.expired.title'),
      lede: t('auth.graduate.expired.body'),
      rest: null,
    }
  } else if (problem?.status === 410) {
    // Used, replaced by a newer link, or withdrawn with its sender's ownership (D-103). Whoever
    // used it themselves has an account now, and the way to it.
    said = {
      title: t('auth.graduate.gone.title'),
      lede: t('auth.graduate.gone.body'),
      rest: (
        <Ways>
          <Way to={paths.signIn.path}>{t('auth.way.sign_in')}</Way>
        </Ways>
      ),
    }
  } else {
    const passwordFault = fault?.password ?? refusedPassword(graduate.error)
    // The household is in a state that does not write (D-120): the link is left as it was.
    const paused = problem?.status === 402
    said = {
      title: t('auth.graduate.title'),
      lede: t('auth.graduate.lede'),
      rest: (
        <>
          <Notices>
            {passwordFault === 'breached' ? <Breached /> : null}
            {paused ? (
              <Banner tone="warning" announce title={t('auth.graduate.paused.title')}>
                {t('auth.graduate.paused.body')}
              </Banner>
            ) : null}
            {graduate.error !== null && !paused && passwordFault === undefined ? (
              <Banner tone="danger" announce>
                {problemText(graduate.error)}
              </Banner>
            ) : null}
          </Notices>
          <Form onSubmit={submit} busy={graduate.isPending} refused={fault ?? graduate.error}>
            <NewPasswordField
              label={t('auth.password.label')}
              value={password}
              onChange={setPassword}
              fault={passwordFault}
            />
            <Button type="submit" variant="primary" loading={graduate.isPending}>
              {t('auth.graduate.submit')}
            </Button>
          </Form>
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
