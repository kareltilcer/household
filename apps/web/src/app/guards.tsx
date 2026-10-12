// Who a route is drawn for. The shell and everything in it is a member's: a visitor who opens
// one of its addresses is sent to sign in, with the address held for them (04-navigation §8, the
// cold start), and brought back to it once they are in. The screens that sign a person in are a
// visitor's: a member who opens one is sent on.
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { heldDestination, holdDestination, takeDestination } from '../session/destination.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { paths } from './paths.ts'
import styles from './Root.module.css'
import { Landmark } from './Root.tsx'
import { usePageTitle } from './title.ts'

/**
 * In a screen's place while it is not yet known who is signed in: the shape of a page, as wide
 * as the page, which its bars are shares of. It is drawn inside a landmark, as what could not
 * be read is (`Unread`): its layout's, or the one `WaitingPage` gives it.
 */
export function Waiting() {
  return (
    <div className={styles.waiting}>
      <Skeleton
        bars={[
          [40, 2],
          [90, 1],
          [70, 1],
        ]}
      />
    </div>
  )
}

/**
 * In a shell's place where there is none to draw yet: the shape of a page, in a landmark of its
 * own, since the shell is what gives a member's page its landmark. `Signed` draws it while it
 * is not yet known who is signed in, and while a visitor is on their way to sign in. The route
 * above the shells draws it after that, on the visit that opens the app at one of their
 * addresses, until the shell's file and its screen's have both come (routes.tsx): the router
 * draws an address it opened at once more, when every file it names has come or failed, so a
 * shell and its first screen are drawn together. The guard's and the route's are two places in
 * the page: the shape is taken down in one and built in the other as the member becomes known,
 * the same to look at.
 */
export function WaitingPage() {
  return (
    <Landmark>
      <Waiting />
    </Landmark>
  )
}

export interface UnreadProps {
  /** What could not be read: the page's one title. */
  readonly title: string
  /** What became of it, and what to do. */
  readonly body: string
  /** Asks again. */
  readonly retry: () => void
}

/**
 * In a screen's place where what it is drawn from could not be read, and nothing is kept of it:
 * said, with the way to ask again. A read that waits for a connection is one of these to a
 * member, and no skeleton. It is said as it arrives, as a body's failure is (ui/StateFrame): it
 * takes the place of a skeleton, and asked again to no avail it is drawn anew, where a screen
 * that came back without a word would tell whoever cannot see it nothing of the press. Asked
 * again with the browser offline, nothing is asked: the read waits for a connection as it did,
 * and the sentence that says so stands as it was, to be drawn anew by what the read comes to.
 */
export function Unread({ title, body, retry }: UnreadProps) {
  const t = useTranslate()
  usePageTitle(title)
  return (
    <div className={styles.page} role="alert">
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lead}>{body}</p>
      <Button
        variant="primary"
        onClick={() => {
          retry()
        }}
      >
        {t('ui.retry')}
      </Button>
    </div>
  )
}

/** In a screen's place where the server could not be asked who is signed in, and nothing is kept. */
export function Unreachable({ retry }: { readonly retry: () => void }) {
  const t = useTranslate()
  return (
    <Unread
      title={t('session.unreachable.title')}
      body={t('session.unreachable.body')}
      retry={retry}
    />
  )
}

/**
 * The routes under it are drawn for a member, and for nobody else. It is drawn before the shell
 * under it, whose file may still be loading on the visit that opens the app at one of its
 * addresses (routes.tsx): a visitor is sent to sign in without waiting for a file that is not
 * drawn for them, and that nobody could be asked who is signed in is said at once.
 */
export function Signed() {
  const { state, signedOut, retry } = useSession()
  const location = useLocation()
  const member = state.status === 'member'
  // The address held while a visitor signed in has been reached, or another has: it is held no
  // longer, so that it is opened once.
  useEffect(() => {
    if (member) takeDestination()
  }, [member, location.key])
  switch (state.status) {
    case 'member':
      return <Outlet />
    // The shell is not drawn yet, and the page has its landmark all the same.
    case 'unknown':
      return <WaitingPage />
    case 'unreachable':
      return (
        <Landmark>
          <Unreachable retry={retry} />
        </Landmark>
      )
    case 'visitor':
      // The address is held for whoever was on their way to it: someone who opened it signed
      // out, or whose session ended under them. A member who signed out themselves was on their
      // way out, and the next person to sign in here is not sent to where they were.
      if (!signedOut) holdDestination(`${location.pathname}${location.search}${location.hash}`)
      // The way in is a file too, and this route is drawn until it has come: the shape of a
      // page stays in its landmark meanwhile, where the one drawn while nobody was known stood.
      return (
        <>
          <WaitingPage />
          <Navigate to={paths.signIn.path} replace />
        </>
      )
  }
}

/**
 * The routes under it are a visitor's: a member who opens one is signed in already, and is sent
 * on to the address held for them, or to where the app opens. It is drawn before the screens
 * under it, as `Signed` is before a shell: a member is sent on without waiting for the file of
 * a screen that is not drawn for them (routes.tsx).
 */
export function VisitorOnly() {
  const { state } = useSession()
  if (state.status === 'member') {
    return <Navigate to={heldDestination() ?? paths.home.path} replace />
  }
  return <Outlet />
}
