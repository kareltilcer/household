// *Check your email* (A-3, FR-ID1): what a registration leads to. It is the same screen whether
// the address was new or already had an account, which is what makes registering say nothing of
// either (D-13, auth.js `register.taken`): it is drawn once, and the address's own inbox gets
// the difference.
//
// The address travels here in the history entry (sent.ts). Where the page has none, loaded
// again or opened cold, it asks for it, with the same control. The prototype's *Open the mail
// app* is not drawn: a web page cannot open one, and a control that cannot work is absent.
import { useLocation } from 'react-router'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Resend } from './Resend.tsx'
import { Screen, Way, Ways } from './Screen.tsx'
import { sentTo } from './sent.ts'

export function VerifySent() {
  const t = useTranslate()
  const location = useLocation()
  const email = sentTo(location.state)
  return (
    <Screen
      title={t('auth.verify.title')}
      lede={email === undefined ? t('auth.verify.ask') : t('auth.verify.sent_to', { email })}
    >
      {/* A link was sent as the registration was answered: the address waits its minute. */}
      <Resend to={email} label={t('auth.verify.resend')} sentJustNow={email !== undefined} />
      <Ways>
        <Way to={paths.register.path}>{t('auth.verify.different')}</Way>
        <Way to={paths.signIn.path}>{t('auth.way.sign_in')}</Way>
      </Ways>
    </Screen>
  )
}
