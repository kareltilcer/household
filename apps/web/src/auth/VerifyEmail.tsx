// What the verification email's link opens (FR-ID1, ADR 0009): its token is in the fragment,
// read once and taken out of the address (fragment.ts), and spent as the page opens, since
// opening the link is the whole of what it asks. Whoever holds the link holds the mailbox, so
// each answer is said precisely (auth.js `verify.expired`): vagueness here would only waste a
// trip.
//
// The page is drawn for anyone: the link is opened in whatever browser the mail is read in,
// signed in or not. A member's account is read again once it is verified, so that what waited
// on it, an invitation or billing, stops saying so.
import { useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useSession } from '../session/SessionProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { useOnArrival } from './arrival.ts'
import { useFragment } from './fragment.ts'
import { Resend } from './Resend.tsx'
import { Screen, Way, Ways } from './Screen.tsx'

export function VerifyEmail() {
  const t = useTranslate()
  const api = useApi()
  const session = useSession()
  const problemText = useProblemText()
  const token = useFragment().get('token') ?? ''
  const signedIn = session.state.status !== 'visitor'

  const verify = useMutation({
    ...askedNow,
    mutationFn: async (link: string) => {
      unwrap(await api.POST('/auth/verify-email', { body: { token: link } }))
    },
    onSuccess: () => {
      // A visitor's page asks the server nothing it would refuse: there is no account to read.
      if (signedIn) session.retry()
    },
  })
  useOnArrival(() => {
    if (token !== '') verify.mutate(token)
  })

  const toSignIn = <Way to={paths.signIn.path}>{t('auth.way.sign_in')}</Way>
  let said: { readonly title: string; readonly lede: string; readonly rest: ReactNode }
  const problem = problemIn(verify.error)
  if (token === '' || problem?.status === 404) {
    // A link nobody issued and one cut short in copying read the same.
    said = {
      title: t('auth.verify_email.nothing.title'),
      lede: t('auth.link.incomplete'),
      rest: (
        <Ways>
          <Way to={paths.verifySent.path}>{t('auth.way.new_link')}</Way>
          {toSignIn}
        </Ways>
      ),
    }
  } else if (verify.isSuccess) {
    said = {
      title: t('auth.verify_email.done.title'),
      lede: t('auth.verify_email.done.body'),
      rest: (
        <Ways>
          {session.state.status === 'member' ? (
            <Way to={paths.home.path}>{t('ui.not_available.home')}</Way>
          ) : (
            toSignIn
          )}
        </Ways>
      ),
    }
  } else if (problem?.code === 'token_already_used') {
    said = {
      title: t('auth.link.used.title'),
      lede: t('auth.verify_email.used.body'),
      rest: <Ways>{toSignIn}</Ways>,
    }
  } else if (problem?.status === 410) {
    said = {
      title: t('auth.link.expired.title'),
      lede: t('auth.verify_email.expired.body'),
      rest: (
        <>
          <Resend label={t('auth.verify_email.expired.send')} />
          <Ways>{toSignIn}</Ways>
        </>
      ),
    }
  } else if (verify.isError) {
    // No answer, a limit or a failure of the server's: the link is as good as it was.
    said = {
      title: t('auth.verify_email.failed.title'),
      lede: problemText(verify.error),
      rest: (
        <>
          <Button
            variant="primary"
            onClick={() => {
              verify.mutate(token)
            }}
          >
            {t('ui.retry')}
          </Button>
          <Ways>{toSignIn}</Ways>
        </>
      ),
    }
  } else {
    said = {
      title: t('auth.verify_email.working.title'),
      lede: t('auth.working'),
      rest: null,
    }
  }
  return (
    <Screen live title={said.title} lede={said.lede}>
      {said.rest}
    </Screen>
  )
}
