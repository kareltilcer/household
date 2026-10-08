// Where the app opens. It has no screen of its own: a visitor is sent to sign in, and a member to
// their household, the one they were last in on this browser where they are still in it, or else
// their first. The household is in the address from then on (D-4). A member who is in none is
// sent to their account, which says so and is theirs either way (A-19).
//
// A household the platform suspended is passed over while the member is in one that opens
// (D-162). The list still names it, for its lockout, and its own address answers `404` (D-115):
// opened there, a member would be at a screen whose one way out leads back here.
import { Navigate } from 'react-router'
import { lastHousehold, useHouseholds } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useSession, type Me } from '../session/SessionProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { Unreachable, Waiting } from './guards.tsx'
import { inHousehold, paths } from './paths.ts'
import styles from './Root.module.css'

function MemberHome({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const households = useHouseholds()
  if (households.data === undefined) {
    if (!households.isError) return <Waiting />
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{t('shell.households.error.title')}</h1>
        <p className={styles.lead}>{t('shell.households.error.body')}</p>
        <Button
          variant="primary"
          onClick={() => {
            void households.refetch()
          }}
        >
          {t('ui.retry')}
        </Button>
      </div>
    )
  }
  const last = lastHousehold(me.id)
  const opening = households.data.filter(
    (household) => household.entitlement?.state !== 'suspended',
  )
  // In none but suspended ones, a member is opened at the first: where its lockout stands.
  const open =
    opening.find((household) => household.id === last) ?? opening[0] ?? households.data[0]
  if (open === undefined) return <Navigate to={paths.account.path} replace />
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
