// Asking for a password reset (A-9, FR-ID6). The server answers `202` whether or not the
// address has an account, and the screen says the one thing that is so either way (auth.js
// `reset.request`): stated as a fact about the system, not as a hedge about the person.
//
// The confirmation is a notice on the same screen and no route of its own, so the form stays:
// a mistyped address is corrected here, and not discovered ten minutes later in an inbox that
// never rang.
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { checkEmail, EmailField, refusedEmail, type EmailFault } from './fields.tsx'
import { Form, Notices, Screen, Way, Ways } from './Screen.tsx'

export function ResetRequest() {
  const t = useTranslate()
  const api = useApi()
  const problemText = useProblemText()
  const [email, setEmail] = useState('')
  const [fault, setFault] = useState<{ readonly email: EmailFault }>()

  const request = useMutation({
    mutationFn: async (address: string) => {
      unwrap(await api.POST('/auth/password-reset', { body: { email: address } }))
    },
  })

  const submit = () => {
    const address = email.trim()
    const found = checkEmail(address)
    if (found !== undefined) {
      request.reset()
      setFault({ email: found })
      return
    }
    setFault(undefined)
    request.mutate(address)
  }

  const emailFault = fault?.email ?? refusedEmail(request.error)
  return (
    <Screen title={t('auth.reset.title')} lede={t('auth.reset.lede')}>
      <Notices>
        {request.isSuccess ? (
          <Banner tone="info" announce title={t('auth.reset.sent.title')}>
            {t('auth.reset.sent.body')}
          </Banner>
        ) : null}
        {request.error !== null && emailFault === undefined ? (
          <Banner tone="danger" announce>
            {problemText(request.error)}
          </Banner>
        ) : null}
      </Notices>
      <Form onSubmit={submit} busy={request.isPending} refused={fault ?? request.error}>
        <EmailField value={email} onChange={setEmail} fault={emailFault} />
        <Button type="submit" variant="primary" loading={request.isPending}>
          {t('auth.reset.submit')}
        </Button>
      </Form>
      <Ways>
        <Way to={paths.signIn.path}>{t('auth.way.back_to_sign_in')}</Way>
      </Ways>
    </Screen>
  )
}
