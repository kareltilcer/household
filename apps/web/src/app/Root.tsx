// What every route is drawn inside: the prompt that a newer build is live. The page's landmark
// is its layout's, one of four (paths.ts): the plain one below, the frame of the screens before
// sign-in (Public.tsx), and the shell around an account or a household (shell/). A route that
// fails is named inside its layout (RouteError), so this stays, and the layout with it. A build
// the server serves no longer is the one thing drawn in every route's place
// (session/UpdateRequired.tsx). The page's title is its screen's to say (title.ts): one set
// here would be set after a screen's own, and stand over it.
import { Outlet } from 'react-router'
import { Push } from '../push/Push.tsx'
import { useSession } from '../session/SessionProvider.tsx'
import { UpdateRequired } from '../session/UpdateRequired.tsx'
import { UpdatePrompt } from '../update/UpdatePrompt.tsx'
import styles from './Root.module.css'

export function Root() {
  const { minimumVersion } = useSession()
  if (minimumVersion !== null) return <UpdateRequired />
  return (
    <div className={styles.root}>
      <UpdatePrompt />
      <Push />
      <Outlet />
    </div>
  )
}

/** The plain layout: the page's one landmark, and whatever route is drawn in it. */
export function Plain() {
  return (
    <main className={styles.main}>
      <Outlet />
    </main>
  )
}
