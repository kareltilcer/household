// Where the app opens. It has no screen of its own: a visitor is sent to sign in, and a member to
// their household, the one they were last in on this browser where they are still in it, or else
// their first. The household is in the address from then on (D-4). A member who is in none is
// sent to make one, which is the first thing a new account does (DD-6, A-22) and where an
// invitation that waits for them is said; a child profile, which makes none (D-104), to what
// is its own, its account.
//
// A household the platform suspended is passed over while the member is in one that opens
// (D-162). The list still names it, for its lockout, and its own address answers `404` (D-115):
// opened there, a member would be at a screen whose one way out leads back here.
import { Navigate } from 'react-router'
import { lastHousehold, useHouseholds } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useSession, type Me } from '../session/SessionProvider.tsx'
import { Unreachable, Unread, Waiting } from './guards.tsx'
import { inHousehold, paths } from './paths.ts'

function MemberHome({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const households = useHouseholds()
  if (households.data === undefined) {
    // A read that waits for a connection could not be made, to a member: it is said so.
    if (!households.isError && households.fetchStatus !== 'paused') return <Waiting />
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
  const last = lastHousehold(me.id)
  const opening = households.data.filter(
    (household) => household.entitlement?.state !== 'suspended',
  )
  // In none but suspended ones, a member is opened at the first: where its lockout stands.
  const open =
    opening.find((household) => household.id === last) ?? opening[0] ?? households.data[0]
  if (open === undefined) {
    const to = me.is_child === true ? paths.account.path : paths.householdNew.path
    return <Navigate to={to} replace />
  }
  return <Navigate to={inHousehold.home(open.id)} replace />
}

export function Home() {
  const { state, retry } = useSession()
  switch (state.status) {
    case 'member':
      return <MemberHome me={state.me} />
    case 'visitor':
      return <Navigate to={paths.signIn.path} replace />
    case 'unknown':
      return <Waiting />
    case 'unreachable':
      return <Unreachable retry={retry} />
  }
}
