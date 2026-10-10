// Where a visitor stands until the screens that sign somebody in are built (plan item 29: the
// address and password, a second step, a provider, a child's code). What is here is what a
// device has to say before any of them: whose app this is, that the sign-in it held has ended,
// and that signing in leads somewhere.
//
// - A sign-in that ended (`401 refresh_token_invalid`, FR-ID7): one calm sentence. This device
//   was signed out, what it kept of its member's households was removed with any change it had
//   not sent, and they sign in again. It names no cause: the answer gives none (Q18), and a
//   revoked device, a changed password and a token used twice read alike. No alarm: the
//   takeover notice (A-11) is its own screen, and item 29's.
// - An address held through the sign-in (04-navigation §8, the cold start): said, so that
//   nobody wonders where they will land. It names no place, an address being no words.
//
// It is a visitor's screen: a member who arrives here is signed in already, and is sent on to
// the address held for them, or to where the app opens.
import { router } from 'expo-router'
import { useState } from 'react'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useHeldDestination } from '../links/destination.ts'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Screen } from '../ui/Screen.tsx'
import { Text } from '../ui/Text.tsx'
import { useSession } from './context.ts'
import { VisitorOnly } from './guards.tsx'

function Visitor() {
  const t = useTranslate()
  const { ended } = useSession()
  const held = useHeldDestination()
  // A notice that was there when the screen opened is read in its place, as everything on a
  // screen that opens is. One that arrives while its reader is here is said aloud.
  const [openedEnded] = useState(ended)
  return (
    <Screen title={t('app.name')} testID="route:signIn">
      {ended ? (
        <Banner tone="info" announce={!openedEnded} testID="sign-in:ended">
          {t('device.session.ended')}
        </Banner>
      ) : null}
      {held === null ? null : (
        <Text color="text-muted" testID="sign-in:destination">
          {t('device.links.destination')}
        </Text>
      )}
      {
        // The dev screens' own way in, in a build that holds them (src/dev/gate.ts): the
        // condition is written out, as each of their routes writes it, so that a store's build
        // holds neither the control nor a word of it. Its name is its address, which is data.
        __DEV__ || process.env.EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS === '1' ? (
          <Button
            variant="ghost"
            testID="sign-in:dev"
            onPress={() => {
              router.push(paths.devSignIn.path)
            }}
          >
            {paths.devSignIn.path}
          </Button>
        ) : null
      }
    </Screen>
  )
}

export function SignIn() {
  return (
    <VisitorOnly>
      <Visitor />
    </VisitorOnly>
  )
}
