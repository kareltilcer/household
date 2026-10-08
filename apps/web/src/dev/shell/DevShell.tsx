// The shell's own parts in their states (plan item 25; F-13, F-15, A-36, A-37), as the
// twelve-state harness draws the data bodies: a dev-only route, which the end-to-end suite holds
// to axe in both themes, to the pseudo-locale and to the policy. A deployment's build has no
// module with a screen until the items that add them, so the sidebar's list and the arrange
// screen are drawn here from a registry of this page's own, over fixture households: what a
// member with several modules sees, with one pinned and one put away; a member who holds none;
// the switcher with several households, one of them read-only; and with none it could read.
//
// The households' names are fixtures, as every word of a dev page is (D-154). The words the
// shell says itself are the catalogs'.
import type { ReactNode } from 'react'
import { Placeholder } from '../../app/Placeholder.tsx'
import { usePageTitle } from '../../app/title.ts'
import { HouseholdContext } from '../../household/HouseholdContext.tsx'
import type { Household, HouseholdSummary } from '../../household/households.ts'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import type { ModuleRegistry } from '../../modules/registry.ts'
import { ArrangeLists } from '../../shell/Arrange.tsx'
import { arrangementKey } from '../../shell/arrangement.ts'
import type { Arrangement } from '../../shell/navigation.ts'
import { SidebarView } from '../../shell/Sidebar.tsx'
import { SwitcherView } from '../../shell/Switcher.tsx'
import { SyncFixture, type Sync } from '../../sync/ReplicaProvider.tsx'
import { OfflineBar } from '../../ui/Banner.tsx'
import { DevToolbar } from '../DevToolbar.tsx'
import { useSample, type Sample } from '../sample.ts'
import styles from './DevShell.module.css'

/** The modules this page has screens for: a registry of its own, each opening the same page. */
const screens = { load: () => Promise.resolve({ Component: Placeholder }) }
const registry: ModuleRegistry = {
  shopping: screens,
  tasks: screens,
  garden: screens,
  finance: screens,
  notes: screens,
  admin: screens,
}

type Grants = NonNullable<Household['my_grants']>

/** The member the fixtures are of, and their households. */
const user = '01900000-0000-7000-8000-00000000d0e5'
const home = '01900000-0000-7000-8000-0000000000a1'
const cottage = '01900000-0000-7000-8000-0000000000a2'
const none = '01900000-0000-7000-8000-0000000000a3'

function household(id: string, name: string, grants: Grants): Household {
  return {
    id,
    name,
    country: 'CZ',
    timezone: 'Europe/Prague',
    base_currency: 'CZK',
    locale: 'cs',
    my_role: 'owner',
    my_grants: grants,
  }
}

/** What the member holds in the first household: Finance at `none`, so it is in no list here. */
const grants: Grants = {
  dashboard: 'view',
  shopping: 'contribute',
  tasks: 'contribute',
  garden: 'manage',
  finance: 'none',
  notes: 'view',
  admin: 'manage',
}

/** Their arrangement of it: Garden pinned, Notes put away, Tasks before Shopping. */
const arranged: Arrangement = {
  pinned: ['garden'],
  order: ['tasks', 'shopping', 'admin'],
  hidden: ['notes'],
}

/** The arrangement, kept where the shell reads one, before the page first draws. */
function arrange(): void {
  try {
    const key = arrangementKey(user, home)
    if (window.localStorage.getItem(key) === null) {
      window.localStorage.setItem(key, JSON.stringify(arranged))
    }
  } catch {
    // Drawn in the product's own order.
  }
}

function others(sample: Sample): HouseholdSummary[] {
  return [
    {
      id: cottage,
      name: sample('Chata Vysočina'),
      my_role: 'member',
      entitlement: { state: 'read_only' },
    },
    { id: none, name: sample('Babička'), my_role: 'member', entitlement: { state: 'active' } },
  ]
}

const inSync: Sync = { replica: { phase: 'opening' }, online: true, receiving: null }

function Case({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className={styles.case}>
      <h2 className={styles.caseTitle}>{title}</h2>
      <div className={styles.body}>{children}</div>
    </section>
  )
}

export function DevShell() {
  const t = useTranslate()
  const sample = useSample()
  usePageTitle(sample('Shell'))
  arrange()
  const first = household(home, sample('Tilcerovi'), grants)
  const empty = household(none, sample('Babička'), { dashboard: 'view' })
  const switchTo = () => undefined
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{sample('Shell')}</h1>
      <DevToolbar />
      <SyncFixture value={inSync}>
        <HouseholdContext value={first}>
          <Case title={sample('Sidebar: several modules, one pinned, one put away')}>
            <nav aria-label={sample('Sidebar, populated')} className={styles.sidebar}>
              <SidebarView
                household={first}
                user={user}
                registry={registry}
                switcher={
                  <SwitcherView
                    household={first}
                    others={others(sample)}
                    failed={false}
                    onSwitch={switchTo}
                  />
                }
              />
            </nav>
          </Case>
          <Case title={sample('Arrange: pinned, in order, hidden by me')}>
            <ArrangeLists household={first} user={user} registry={registry} />
          </Case>
        </HouseholdContext>
        <HouseholdContext value={empty}>
          <Case title={sample('Sidebar: no module to list, one household')}>
            <nav aria-label={sample('Sidebar, empty')} className={styles.sidebar}>
              <SidebarView
                household={empty}
                user={user}
                registry={registry}
                switcher={
                  <SwitcherView household={empty} others={[]} failed={false} onSwitch={switchTo} />
                }
              />
            </nav>
          </Case>
          <Case title={sample('Switcher: the other households could not be read')}>
            <div className={styles.sidebar}>
              <SwitcherView household={empty} others={[]} failed onSwitch={switchTo} />
            </div>
          </Case>
          <Case title={sample('Arrange: nothing to arrange')}>
            <ArrangeLists household={empty} user={user} registry={registry} />
          </Case>
        </HouseholdContext>
      </SyncFixture>
      <Case title={sample('Above a household’s screens: offline, and not receiving')}>
        <OfflineBar />
        <OfflineBar sentence={t('sync.not_receiving')} />
      </Case>
    </div>
  )
}
