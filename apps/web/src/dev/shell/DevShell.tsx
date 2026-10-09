// The shell's own parts in their states (plan item 25; F-13, F-15, A-36, A-37), as the
// twelve-state harness draws the data bodies: a dev-only route, which the end-to-end suite holds
// to axe in both themes, to the pseudo-locale and to the policy. A deployment's build has no
// module with a screen until the items that add them, so the sidebar's list and the arrange
// screen are drawn here from a registry of this page's own, over fixture households: what a
// member with several modules sees, with one pinned and one put away; a member who holds none;
// the switcher with several households, one of them read-only; and with none it could read.
//
// The entitlement banner is here in each of its drawings (plan item 27; A-30), and the suspended
// lockout (A-31): a household in each state would take a clock moved and a staff action to make,
// so the walk holds them to the two gates from fixtures. Each banner is drawn to one of its
// three readers, so that all three are on the page; a lapse with a restriction beside it and a
// restriction whose owner is gone are drawn too.
//
// The households' names are fixtures, as every word of a dev page is (D-154), and so are a
// restriction's reason and a suspension's notice, which are somebody's own words. The words the
// shell says itself are the catalogs'.
import type { ReactNode } from 'react'
import { inHousehold } from '../../app/paths.ts'
import { usePageTitle } from '../../app/title.ts'
import type { Reader } from '../../household/data.ts'
import { HouseholdContext } from '../../household/HouseholdContext.tsx'
import type { Household, HouseholdSummary, ModuleKey } from '../../household/households.ts'
import { beginnings, StartAnswers } from '../../household/Start.tsx'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import type { ModuleRegistry } from '../../modules/registry.ts'
import { ArrangeLists } from '../../shell/Arrange.tsx'
import { arrangementKey } from '../../shell/arrangement.ts'
import { bannerOf, type Entitlement } from '../../shell/entitlement.ts'
import { EntitlementBannerView } from '../../shell/EntitlementBanner.tsx'
import { LockoutView } from '../../shell/Lockout.tsx'
import type { Arrangement } from '../../shell/navigation.ts'
import { SidebarView } from '../../shell/Sidebar.tsx'
import { SwitcherView } from '../../shell/Switcher.tsx'
import { SyncFixture, type Sync } from '../../sync/ReplicaProvider.tsx'
import { OfflineBar } from '../../ui/Banner.tsx'
import { DevToolbar } from '../DevToolbar.tsx'
import { useSample, type Sample } from '../sample.ts'
import styles from './DevShell.module.css'

/**
 * The modules this page has screens for: a registry of its own, each opening at its module's
 * own address. Two of them take a first record, which the first run's question offers.
 */
const at = (module: ModuleKey) => ({
  home: (household: string) => inHousehold.module(household, module),
})
const capturing = (module: ModuleKey) => ({ ...at(module), capture: at(module).home })
const registry: ModuleRegistry = {
  shopping: capturing('shopping'),
  tasks: capturing('tasks'),
  garden: at('garden'),
  finance: at('finance'),
  notes: at('notes'),
  admin: at('admin'),
}

/** A build with no screen at all: what the shell draws where it has no module to list. */
const bare: ModuleRegistry = {}

type Grants = NonNullable<Household['my_grants']>

/** The member the fixtures are of, and their households. */
const user = '01900000-0000-7000-8000-00000000d0e5'
const home = '01900000-0000-7000-8000-0000000000a1'
const cottage = '01900000-0000-7000-8000-0000000000a2'
const none = '01900000-0000-7000-8000-0000000000a3'
const lodge = '01900000-0000-7000-8000-0000000000a4'

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

/** The moment the banners are drawn at, and the zone their days are said in. */
const now = Date.parse('2026-09-21T10:00:00Z')
const zone = 'Europe/Prague'

/** One drawing of the entitlement banner: the state it is of, and whom it is drawn to. */
interface BannerCase {
  readonly title: string
  readonly entitlement: Entitlement
  readonly reader: Reader
}

/** The banner's seven drawings (A-30), and two more of a restriction: beside a lapse, and unnamed. */
function bannerCases(sample: Sample): BannerCase[] {
  const restriction = {
    restricted_by: { user_id: user, label: sample('Jana Tilcerová'), is_former_member: false },
    restricted_at: '2026-09-09T12:02:00Z',
    reason: sample('Until the insurance claim is settled.'),
  }
  return [
    {
      title: sample(
        'Trial, with ten days or fewer left: a notice that can be put away, to the payer',
      ),
      entitlement: {
        state: 'trialing',
        trial_notice: 'notice',
        trial_ends_at: '2026-09-30T08:00:00Z',
      },
      reader: 'payer',
    },
    {
      title: sample('Trial, with five days or fewer left: a banner that stays, to another owner'),
      entitlement: {
        state: 'trialing',
        trial_notice: 'banner',
        trial_ends_at: '2026-09-24T08:00:00Z',
      },
      reader: 'owner',
    },
    {
      title: sample('Past due, to the payer: no member is drawn it'),
      entitlement: { state: 'past_due' },
      reader: 'payer',
    },
    {
      title: sample('Grace, to a member'),
      entitlement: { state: 'grace', grace_ends_at: '2026-10-05T08:00:00Z' },
      reader: 'member',
    },
    {
      title: sample('Read-only, to the payer'),
      entitlement: { state: 'read_only', data_retained_until: '2027-10-09T08:00:00Z' },
      reader: 'payer',
    },
    {
      title: sample('Read-only with a restriction beside it, to another owner'),
      entitlement: {
        state: 'read_only',
        data_retained_until: '2027-10-09T08:00:00Z',
        restriction,
      },
      reader: 'owner',
    },
    {
      title: sample('Cancelled, to a member'),
      entitlement: { state: 'canceled', data_retained_until: '2027-10-09T08:00:00Z' },
      reader: 'member',
    },
    {
      title: sample('Restricted, with its reason, to an owner'),
      entitlement: { state: 'restricted', restriction },
      reader: 'owner',
    },
    {
      title: sample('Restricted by an account that is gone, to a member'),
      entitlement: {
        state: 'restricted',
        restriction: {
          restricted_by: { user_id: null, label: '', is_former_member: true },
          restricted_at: '2026-09-09T12:02:00Z',
          reason: null,
        },
      },
      reader: 'member',
    },
  ]
}

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
  // As the member's list of households names one the platform suspended (D-115).
  const suspended: HouseholdSummary = {
    id: lodge,
    name: sample('Srub Šumava'),
    my_role: 'member',
    entitlement: {
      state: 'suspended',
      suspended_at: '2026-09-09T12:02:00Z',
      suspension_notice: sample(
        'We were told that files kept here break our terms, and have suspended the household while we look at them.',
      ),
    },
  }
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
          <Case title={sample('The first run’s question: two modules to begin at')}>
            <StartAnswers household={first} offered={beginnings(first, registry)} />
          </Case>
        </HouseholdContext>
        <HouseholdContext value={empty}>
          <Case title={sample('Sidebar: no module to list, one household')}>
            <nav aria-label={sample('Sidebar, empty')} className={styles.sidebar}>
              <SidebarView
                household={empty}
                user={user}
                registry={bare}
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
            <ArrangeLists household={empty} user={user} registry={bare} />
          </Case>
        </HouseholdContext>
      </SyncFixture>
      <Case title={sample('Above a household’s screens: offline, and not receiving')}>
        <OfflineBar />
        <OfflineBar sentence={t('sync.not_receiving')} />
      </Case>
      <Case title={sample('Above a household that takes no writes: offline, and not receiving')}>
        <OfflineBar sentence={t('shell.offline.reading')} />
        <OfflineBar sentence={t('shell.not_receiving.reading')} />
      </Case>
      {bannerCases(sample).map(({ title, entitlement, reader }) => {
        const shown = bannerOf(entitlement, reader !== 'member')
        return shown === null ? null : (
          <Case key={title} title={title}>
            <EntitlementBannerView
              household={first}
              shown={shown}
              reader={reader}
              owners={[sample('Jana Tilcerová'), sample('Petr Tilcer')]}
              zone={zone}
              now={now}
              onDismiss={shown.kind === 'trial' && shown.stage === 'notice' ? switchTo : undefined}
            />
          </Case>
        )
      })}
      <Case
        title={sample('Switcher: the household that is open is read-only, another is suspended')}
      >
        <div className={styles.sidebar}>
          <SwitcherView
            household={{ ...first, entitlement: { state: 'read_only' } }}
            others={[suspended, ...others(sample)]}
            failed={false}
            onSwitch={switchTo}
          />
        </div>
      </Case>
      <Case title={sample('The lockout: a household the platform suspended')}>
        <LockoutView household={suspended} others={[first]} zone={zone} nested />
      </Case>
    </div>
  )
}
