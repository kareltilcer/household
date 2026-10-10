// Where the app opens. It has no screen of its own: a visitor is sent to sign in, and a member to
// their household, the one they were last in on this device where they are still in it, or else
// their first. The household is in the address from then on (D-4). What it draws meanwhile is a
// wait, and what could not be read where nothing is kept of it.
//
// A household the platform suspended is passed over while the member is in one that opens
// (D-162, household/data.ts). A member who is in none is told so, and given the one thing
// there is to do here until plan item 29 builds the screens that make a household and answer
// an invitation: sign out, since every other way out of the app's account is inside a
// household.
import { Redirect } from 'expo-router'
import { useState } from 'react'
import { couldNotBeRead } from '../api/query.ts'
import { opening, useHouseholds, useLastHousehold } from '../household/data.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useSession, type Me } from '../session/context.ts'
import { Unreachable, Unread, Waiting } from '../session/guards.tsx'
import { Button } from '../ui/Button.tsx'
import { Screen } from '../ui/Screen.tsx'
import { useToast } from '../ui/Toast.tsx'
import { inHousehold, paths } from './paths.ts'

/** What a member in no household is shown: that they are in none, and the way to sign out. */
function InNone() {
  const t = useTranslate()
  const toast = useToast()
  const { signOut } = useSession()
  const [leaving, setLeaving] = useState(false)
  return (
    <Screen title={t('account.households.empty.title')} testID="route:home">
      <Button
        testID="home:sign-out"
        loading={leaving}
        onPress={() => {
          setLeaving(true)
          // Signed out, the index leads to sign-in by itself. Where the server could not be
          // told, its member is signed in still, and is told so: no control of this screen
          // says it.
          void signOut().catch(() => {
            setLeaving(false)
            toast({ message: t('shell.sign_out.failed') })
          })
        }}
      >
        {t('shell.sign_out.action')}
      </Button>
    </Screen>
  )
}

function MemberHome({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const households = useHouseholds()
  const last = useLastHousehold(me.id)
  if (households.data === undefined) {
    // A read that waits for a connection could not be made, to a member: it is said so.
    if (!couldNotBeRead(households)) return <Waiting />
    return (
      <Unread
        title={t('shell.households.error.title')}
        body={t('shell.households.error.body')}
        retry={() => {
          void households.refetch()
        }}
      />
    )
  }
  // Where they were last is the device's to say, and it is asked before the app opens anywhere.
  if (!last.read) return <Waiting />
  const open = opening(households.data, last.household)
  if (open === undefined) {
    // In none, as this device last read it, which may be a day old: somebody who has joined one
    // since, by an invitation answered elsewhere, is not told they are in none. The list is
    // being read again, and where the app opens waits for it. With no connection nothing is
    // being read, and what was kept is what there is to go by.
    if (households.isFetching) return <Waiting />
    return <InNone />
  }
  return <Redirect href={inHousehold.home(open.id)} />
}

export function Home() {
  const { state, retry } = useSession()
  switch (state.status) {
    case 'member':
      return <MemberHome me={state.me} />
    case 'visitor':
      return <Redirect href={paths.signIn.path} />
    case 'unknown':
      return <Waiting />
    case 'unreachable':
      return <Unreachable retry={retry} />
  }
}
