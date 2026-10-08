// The shell around one household: the one the address names (D-4). It reads the household as its
// member does, keeps its replica open while it is on screen (sync/ReplicaProvider.tsx), and draws
// its screens inside the frame. An address that names a household the member is not in, one that
// is suspended, or no household at all, opens nothing, and says no more than that (F-17).
import { isUuid } from '@household/api'
import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router'
import { problemIn } from '../api/problem.ts'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { Waiting } from '../app/guards.tsx'
import styles from '../app/Root.module.css'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import { rememberHousehold, useHouseholdQuery } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { ReplicaProvider } from '../sync/ReplicaProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { AccountNavigation } from './AccountNavigation.tsx'
import { Frame } from './Frame.tsx'
import { HouseholdBars } from './HouseholdBars.tsx'
import { Sidebar } from './Sidebar.tsx'

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
  const household = useHouseholdQuery(id)
  const found = household.data !== undefined
  useEffect(() => {
    if (found) rememberHousehold(me.id, id)
  }, [found, me.id, id])

  if (household.data === undefined) {
    if (!household.isError) {
      return (
        <Outside>
          <Waiting />
        </Outside>
      )
    }
    // Not found is not an error: the address opens nothing for this member.
    if (problemIn(household.error)?.status === 404) {
      return (
        <Outside>
          <NotAvailable />
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
          above={<HouseholdBars />}
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
