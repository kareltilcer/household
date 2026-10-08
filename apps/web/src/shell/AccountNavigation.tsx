// The navigation of a member's own account: the way back to a household, the account's
// sections, and the way out. It names no household but the one a member goes back to, and that
// one by the word *Home* alone.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { forgetPush } from '../push/worker.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { useToast } from '../ui/Toast.tsx'
import { NavLink } from './NavLink.tsx'
import styles from './Sidebar.module.css'

/** Signs the member out, and says so where the server could not be told. */
export function SignOut() {
  const t = useTranslate()
  const toast = useToast()
  const navigate = useNavigate()
  const api = useApi()
  const { signOut } = useSession()
  const [leaving, setLeaving] = useState(false)
  return (
    <Button
      variant="ghost"
      loading={leaving}
      onClick={() => {
        setLeaving(true)
        // The browser's subscription goes first, while the session can still tell the server:
        // whoever signs in here next is sent nothing that was this member's.
        void forgetPush(api)
          .then(signOut)
          .then(
            () => navigate(paths.signIn.path, { replace: true }),
            () => {
              // The session is the server's to end: with no answer from it, the member is still
              // signed in, and is told so.
              setLeaving(false)
              toast({ message: t('shell.sign_out.failed') })
            },
          )
      }}
    >
      {t('shell.sign_out.action')}
    </Button>
  )
}

export function AccountNavigation() {
  const t = useTranslate()
  return (
    <>
      <div className={styles.group}>
        <NavLink to={paths.home.path} end>
          {t('nav.home')}
        </NavLink>
      </div>
      <div className={styles.group}>
        <p className={styles.label}>{t('shell.account.heading')}</p>
        <NavLink to={paths.account.path} end>
          {t('account.nav.profile')}
        </NavLink>
        <NavLink to={paths.accountSecurity.path}>{t('account.nav.security')}</NavLink>
        <NavLink to={paths.accountDevices.path}>{t('account.nav.devices')}</NavLink>
        <NavLink to={paths.accountNotifications.path}>{t('account.nav.notifications')}</NavLink>
      </div>
      <div className={styles.foot}>
        <SignOut />
      </div>
    </>
  )
}
