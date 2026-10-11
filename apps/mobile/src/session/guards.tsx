// Who a screen is drawn for. A household's screens and everything in them are a member's: a
// visitor who arrives at one of their addresses is sent to sign in, with the address held for
// them (04-navigation §8, the cold start), and brought back to it once they are in. The screens
// that sign a person in are a visitor's: a member who opens one is sent on.
//
// And what stands in a screen's place while it is not known who is signed in, and where that
// could not be read.
import { Redirect, useIsFocused, usePathname } from 'expo-router'
import { useEffect, type ReactNode } from 'react'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { heldDestination, holdDestination, takeDestination } from '../links/destination.ts'
import { announceNow } from '../ui/announce.ts'
import { Button } from '../ui/Button.tsx'
import { Screen } from '../ui/Screen.tsx'
import { Skeleton, type SkeletonBar } from '../ui/Skeleton.tsx'
import { Text } from '../ui/Text.tsx'
import { useSession } from './context.ts'

/** The shape of a screen: its title, and two lines under it. */
const page: readonly SkeletonBar[] = [
  [40, 2],
  [90, 1],
  [70, 1],
]

/**
 * In a screen's place while it is not yet known who is signed in, or while what the screen is
 * drawn from is read for the first time: the shape of a screen, and never a spinner.
 */
export function Waiting() {
  return (
    <Screen testID="waiting">
      <Skeleton bars={page} />
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
 * takes the place of a wait, and asked again of a server that answers and to no avail it is
 * drawn anew and said again, where a screen that came back without a word would tell whoever
 * cannot see it nothing of the press. Asked again with no connection the read waits for one
 * as it did, nothing is drawn anew and nothing is said: the press changed nothing. And where
 * asking again brings the screen, the screen is what is drawn: nothing here says so, there
 * being no words for it but the screen's own (ADR 0029).
 */
export function Unread({ title, body, retry }: UnreadProps) {
  const t = useTranslate()
  useEffect(() => {
    // The title, a line break, the sentence: as a banner says its own (ui/Banner.tsx).
    announceNow(`${title}\n${body}`)
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

export interface UnreachableProps {
  readonly retry: () => void
  /** Whether it is the device that would not say, and not the server that could not be asked. */
  readonly device?: boolean | undefined
}

/**
 * In a screen's place where who is signed in could not be read: the server could not be asked
 * and nothing is kept, or the device itself would not say whose sign-in it holds. Each in its
 * own words: a member told to check their connection for a keychain that is shut would check
 * the wrong thing.
 */
export function Unreachable({ retry, device = false }: UnreachableProps) {
  const t = useTranslate()
  return (
    <Unread
      title={device ? t('device.session.unread.title') : t('session.unreachable.title')}
      body={device ? t('device.session.unread.body') : t('session.unreachable.body')}
      retry={retry}
    />
  )
}

/** What is under it is drawn for a member, and for nobody else. */
export function Signed({ children }: { readonly children: ReactNode }) {
  const { state, signedOut, retry } = useSession()
  // Where the app is, which the router says for every screen alike: the whole app's address,
  // and this screen's own only while it is the one in front.
  const address = usePathname()
  // Whether it is. A household another was opened over, and one that a screen of the root's
  // stack stands over, *not available* opened by a pressed notification, stay mounted with
  // their guard, and the address the router says is then that other screen's.
  const inFront = useIsFocused()
  const member = state.status === 'member'
  const visitor = state.status === 'visitor'
  // The address held while a visitor signed in has been reached, or another has: it is held no
  // longer, so that it is opened once.
  useEffect(() => {
    if (member) takeDestination()
  }, [member, address])
  // The address is held for whoever was on their way to it: someone who opened it signed out,
  // or whose sign-in ended under them. A member who signed out themselves was on their way out,
  // and the next person to sign in here is not sent to where they were. The sign-in's own
  // address is never held: the router names it already as this screen gives way to it. And
  // only the screen in front holds one: underneath another it would hold that screen's address
  // for its own, and whoever signed in next would be led to wherever that was.
  useEffect(() => {
    if (visitor && !signedOut && inFront && address !== paths.signIn.path) {
      holdDestination(address)
    }
  }, [visitor, signedOut, inFront, address])
  switch (state.status) {
    case 'member':
      return children
    case 'unknown':
      return <Waiting />
    case 'unreachable':
      return <Unreachable retry={retry} device={state.device} />
    case 'visitor':
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
