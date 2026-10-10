// Who a screen is drawn for. A household's screens and everything in them are a member's: a
// visitor who arrives at one of their addresses is sent to sign in, with the address held for
// them (04-navigation §8, the cold start), and brought back to it once they are in. The screens
// that sign a person in are a visitor's: a member who opens one is sent on.
//
// And what stands in a screen's place while it is not known who is signed in, and where that
// could not be read.
import { Redirect, usePathname } from 'expo-router'
import { useEffect, type ReactNode } from 'react'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { heldDestination, holdDestination, takeDestination } from '../links/destination.ts'
import { announceNow } from '../ui/announce.ts'
import { Button } from '../ui/Button.tsx'
import { Screen } from '../ui/Screen.tsx'
import { Text } from '../ui/Text.tsx'
import { useSession } from './context.ts'

/**
 * In a screen's place while it is not yet known who is signed in, or while what the screen is
 * drawn from is read for the first time.
 */
export function Waiting() {
  const t = useTranslate()
  return (
    <Screen testID="waiting">
      {/* stub: P2 (Skeleton). The shape of a page stands here once the skeleton is built; until
          then, the word a skeleton is named by. */}
      <Text color="text-muted">{t('ui.loading')}</Text>
    </Screen>
  )
}

export interface UnreadProps {
  /** What could not be read: the screen's one title. */
  readonly title: string
  /** What became of it, and what to do. */
  readonly body: string
  /** Asks again. */
  readonly retry: () => void
}

/**
 * In a screen's place where what it is drawn from could not be read, and nothing is kept of it:
 * said, with the way to ask again. It is said aloud as it arrives, as a body's failure is: it
 * takes the place of a wait, and asked again to no avail it is drawn anew and said again, where
 * a screen that came back without a word would tell whoever cannot see it nothing of the press.
 */
export function Unread({ title, body, retry }: UnreadProps) {
  const t = useTranslate()
  useEffect(() => {
    announceNow(`${title} ${body}`)
  }, [title, body])
  return (
    <Screen title={title} testID="unread">
      <Text color="text-muted">{body}</Text>
      <Button
        variant="primary"
        onPress={() => {
          retry()
        }}
      >
        {t('ui.retry')}
      </Button>
    </Screen>
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

/** What is under it is drawn for a member, and for nobody else. */
export function Signed({ children }: { readonly children: ReactNode }) {
  const { state, signedOut, retry } = useSession()
  const address = usePathname()
  const member = state.status === 'member'
  // The address held while a visitor signed in has been reached, or another has: it is held no
  // longer, so that it is opened once.
  useEffect(() => {
    if (member) takeDestination()
  }, [member, address])
  switch (state.status) {
    case 'member':
      return children
    case 'unknown':
      return <Waiting />
    case 'unreachable':
      return <Unreachable retry={retry} />
    case 'visitor':
      // The address is held for whoever was on their way to it: someone who opened it signed
      // out, or whose sign-in ended under them. A member who signed out themselves was on their
      // way out, and the next person to sign in here is not sent to where they were.
      if (!signedOut) holdDestination(address)
      return <Redirect href={paths.signIn.path} />
  }
}

/**
 * What is under it is a visitor's: a member who opens it is signed in already, and is sent on
 * to the address held for them, or to where the app opens.
 */
export function VisitorOnly({ children }: { readonly children: ReactNode }) {
  const { state } = useSession()
  if (state.status === 'member') return <Redirect href={heldDestination() ?? paths.home.path} />
  return children
}
