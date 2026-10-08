// The shell around one household: the one the address names (D-4). It reads the household as its
// member does, keeps its replica open while it is on screen (sync/ReplicaProvider.tsx), and draws
// its screens inside the frame. An address that names a household the member is not in, one that
// is suspended, or no household at all, opens nothing, and says no more than that (F-17): the
// server's word for it stands over whatever this browser kept of the household.
import { isUuid } from '@household/api'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router'
import { problemIn } from '../api/problem.ts'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { Waiting } from '../app/guards.tsx'
import styles from '../app/Root.module.css'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import { householdsKey, rememberHousehold, useHouseholdQuery } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { ReplicaProvider } from '../sync/ReplicaProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { AccountNavigation } from './AccountNavigation.tsx'
import { Frame } from './Frame.tsx'
import { HouseholdBars } from './HouseholdBars.tsx'
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

function Opened({ id }: { readonly id: string }) {
  const t = useTranslate()
  const me = useMe()
  const queries = useQueryClient()
  const household = useHouseholdQuery(id)
  // The server's last word: the household is none of this member's, whether or not this
  // browser kept it from when it was.
  const gone = problemIn(household.error)?.status === 404
  const found = household.data !== undefined && !gone
  useEffect(() => {
    if (found) rememberHousehold(me.id, id)
  }, [found, me.id, id])
  // The list this browser kept may be what named it, and would lead back here from where the
  // app opens: it is read again before it leads anywhere.
  useEffect(() => {
    if (gone) queries.removeQueries({ queryKey: householdsKey, exact: true })
  }, [gone, queries])

  // Not found is not an error: the address opens nothing for this member.
  if (gone) {
    return (
      <Outside>
        <NotAvailable />
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
        <div className={styles.page}>
          <h1 className={styles.title}>{t('shell.household.error.title')}</h1>
          <p className={styles.lead}>{t('shell.household.error.body')}</p>
          <Button
            variant="primary"
            onClick={() => {
              void household.refetch()
            }}
          >
            {t('ui.retry')}
          </Button>
        </div>
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
