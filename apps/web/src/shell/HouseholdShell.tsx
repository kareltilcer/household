// The shell around one household: the one the address names (D-4). It reads the household as its
// member does, keeps its replica open while it is on screen (sync/ReplicaProvider.tsx), and draws
// its screens inside the frame. An address that names a household the member is not in, or no
// household at all, opens nothing, and says no more than that (F-17): the server's word for it
// stands over whatever this browser kept of the household.
//
// A household the platform suspended answers as one the member is not in does, `404` on every
// route of it (D-115), and the member's own list of households still names it, with its state.
// So where the address is not found the list is read, and a household it names as suspended is
// drawn its lockout in the place of *not available* (A-31, Lockout.tsx): nothing of the
// household, no bar and no banner, since nothing of it can be read.
import { isUuid } from '@household/api'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router'
import { problemIn } from '../api/problem.ts'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { Unread, Waiting } from '../app/guards.tsx'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import {
  householdsKey,
  rememberHousehold,
  useHouseholdQuery,
  useHouseholds,
} from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { ReplicaProvider } from '../sync/ReplicaProvider.tsx'
import { AccountNavigation } from './AccountNavigation.tsx'
import { Frame } from './Frame.tsx'
import { HouseholdBars } from './HouseholdBars.tsx'
import { Lockout } from './Lockout.tsx'
import { Sidebar } from './Sidebar.tsx'
import { Switched } from './Switched.tsx'

/** The shell with no household in it: around what stands in a household's place. */
function Outside({ children }: { readonly children: React.ReactNode }) {
  const t = useTranslate()
  return (
    <Frame
      heading={t('app.name')}
      navigationLabel={t('shell.account.navigation')}
      navigation={<AccountNavigation />}
    >
      {children}
    </Frame>
  )
}

/**
 * In the place of a household whose address the server answered with not found: the lockout,
 * where the member's list of households names it as suspended, and else the neutral screen.
 */
function Gone({ id }: { readonly id: string }) {
  const t = useTranslate()
  const queries = useQueryClient()
  const households = useHouseholds()
  // The list this browser kept is not gone by. It may be what named the household, and would
  // lead back here from where the app opens; and it may be older than the suspension, or than
  // its lifting. It is read again from nothing, and only what was read since says anything.
  const [since] = useState(() => Date.now())
  useEffect(() => {
    void queries.resetQueries({ queryKey: householdsKey, exact: true })
  }, [queries])
  const list = households.dataUpdatedAt >= since ? households.data : undefined

  if (list === undefined) {
    // A read asked for with no connection waits for one, neither loading nor failed: to a member
    // it could not be made, and is said so.
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
  const named = list.find((each) => each.id.toLowerCase() === id)
  if (named?.entitlement?.state !== 'suspended') return <NotAvailable />
  return (
    <Lockout
      household={named}
      // Where a member may go from here: a household of theirs that opens.
      others={list.filter((each) => each !== named && each.entitlement?.state !== 'suspended')}
    />
  )
}

function Opened({ id }: { readonly id: string }) {
  const t = useTranslate()
  const me = useMe()
  const household = useHouseholdQuery(id)
  // The server's last word: the household is none of this member's to open, whether or not this
  // browser kept it from when it was.
  const gone = problemIn(household.error)?.status === 404
  const found = household.data !== undefined && !gone
  useEffect(() => {
    if (found) rememberHousehold(me.id, id)
  }, [found, me.id, id])

  // Not found is not an error: the address opens nothing for this member, or a lockout.
  if (gone) {
    return (
      <Outside>
        <Gone id={id} />
      </Outside>
    )
  }
  if (household.data === undefined) {
    // A read asked for with no connection waits for one, neither loading nor failed: to a member
    // it could not be made, and is said so, as the account's screens say it (account/common.ts).
    if (!household.isError && household.fetchStatus !== 'paused') {
      return (
        <Outside>
          <Waiting />
        </Outside>
      )
    }
    return (
      <Outside>
        <Unread
          title={t('shell.household.error.title')}
          body={t('shell.household.error.body')}
          retry={() => {
            void household.refetch()
          }}
        />
      </Outside>
    )
  }
  return (
    <HouseholdContext value={household.data}>
      <ReplicaProvider household={id}>
        <Frame
          heading={household.data.name}
          navigationLabel={t('shell.navigation')}
          navigation={<Sidebar />}
          above={
            <>
              <HouseholdBars />
              <Switched />
            </>
          }
        >
          <Outlet />
        </Frame>
      </ReplicaProvider>
    </HouseholdContext>
  )
}

export function HouseholdShell() {
  const { householdId = '' } = useParams()
  if (!isUuid(householdId)) {
    return (
      <Outside>
        <NotAvailable />
      </Outside>
    )
  }
  // A household's own, from its first render: nothing of the one that was open before is kept.
  return <Opened key={householdId.toLowerCase()} id={householdId.toLowerCase()} />
}
