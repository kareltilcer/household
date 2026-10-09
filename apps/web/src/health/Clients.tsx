// Clients and versions (C-57, `/households/{id}/settings/clients`; PRD 17 §8, FR-HA18; PRD 06
// §7): every browser and device that synced this household, whose it is, what it is, the
// version it named itself with and when it last reported. It is for when one member sees
// something the others do not, which is why it is every member's clients and an owner's to
// read: anybody else is answered `404`, and is drawn the neutral *not available* with nothing
// asked.
//
// A row is a replica that has reported (`getClients`), and never a device or a session of an
// account's, which span households: a client that is signed in and has not synced this
// household is not here. What it is comes from what its report named. A browser is named for
// what its header tells and never by the header (account/userAgent.ts); the app on a phone by
// its label, or its platform where it named nothing; and a client that last reported before the
// server kept its type by whichever of the two what is left tells, or as neither.
//
// Two things are said of a version and no third (versions.ts). A browser's is the same build as
// this page or another build: nothing knows which version is the newest, so the prototype's
// *two versions behind* has no source and no client is ever behind. And a client under the
// oldest version the deployment serves must update before it syncs again, which is the one
// status of this screen. A client that reported before versions were recorded has none, and
// its row says so.
//
// This browser's row is marked, by the id its replica reports under, which only the tab that
// holds the replica can say; another tab says that it cannot.
//
// C-57's states. *Loading*, *error* and *offline* are the list's read: a skeleton, the list
// that did not load with the way to read it again, and the list as this browser kept it.
// *Populated* is the rows. *Empty* is a household none of whose clients has reported yet, which
// the ledger did not expect: a browser reports a quarter of an hour after it connects, so an
// owner who opens this first reads one sentence. *Absent* is everybody but an owner. *Read-only*
// is the list under a notice: nothing here writes, and in a household that takes no writes
// no client reports either, so each row is as it last did. Nothing is *pending*, *syncing*,
// *conflicted* or *rejected*, a version being reported and never edited; and what would be
// *withdrawn*, an owner made a member while the screen is open, is the absent state too, as the
// list's own refusal says once it is read again.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link } from 'react-router'
import account from '../account/Settings.module.css'
import { readState, sameId, useData, useNoWithdrawal } from '../account/common.ts'
import { agentOf, useClientNames, type ClientNames } from '../account/userAgent.ts'
import { clientName } from '../api/client.ts'
import { problemIn } from '../api/problem.ts'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import { writes } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { householdKey } from '../household/households.ts'
import { HouseholdSettingsPage, useStanding } from '../household/settings/Page.tsx'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { EmptyState } from '../ui/EmptyState.tsx'
import { List } from '../ui/ListRow.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'
import { Standing } from './common.tsx'
import { useClients, useOwn, type Client, type ClientList } from './data.ts'
import styles from './Health.module.css'
import { isUnder, ownVersion } from './versions.ts'

/** What a client is, as far as its report says: this app in a browser, the app on a device, or neither told. */
type Kind = 'browser' | 'device' | 'unknown'

/**
 * What `client` is. Its type says, where its last report named one. One that reported before
 * the server kept a client's type is a device where the account's record of it names a
 * platform, a browser where its label is a header that tells one, and otherwise not told: a
 * label that is no known header is drawn nowhere, since it may be one all the same.
 */
function kindOf(client: Client, recognised: boolean): Kind {
  if (client.type === 'web') return 'browser'
  if (client.type === 'mobile' || client.platform !== null) return 'device'
  return recognised ? 'browser' : 'unknown'
}

function Row({
  client,
  own,
  minimums,
  names,
}: {
  readonly client: Client
  /** Whether it is this browser's own. */
  readonly own: boolean
  readonly minimums: ClientList['minimum_versions']
  readonly names: ClientNames
}) {
  const t = useTranslate()
  const format = useFormat()
  const zone = useTimeZone()
  const data = useData()
  const agent = agentOf(client.label)
  const kind = kindOf(client, agent.browser !== undefined || agent.system !== undefined)
  const name =
    kind === 'browser'
      ? names.ofBrowser(agent.browser, agent.system)
      : kind === 'device'
        ? names.ofDevice(client.label, client.platform)
        : t('clients.row.unknown')
  // A device named by its label says what kind of device it is beside it.
  const platform =
    kind === 'device' && client.label.trim() !== '' && client.platform !== null
      ? names.ofPlatform(client.platform)
      : undefined
  const { version } = client
  const minimum =
    client.type === 'web' ? minimums.web : client.type === 'mobile' ? minimums.mobile : null
  // The oldest version of its type the deployment serves, where it is under it.
  const under =
    version !== null && minimum !== null && isUnder(version, minimum) ? minimum : undefined

  return (
    <li className={styles.row}>
      <div className={styles.about}>
        <div className={styles.head}>
          <span className={styles.name}>{name}</span>
          {own ? <span className={account.badge}>{t('account.devices.this_browser')}</span> : null}
        </div>
        <p className={styles.whose}>{client.member.label}</p>
        {platform === undefined ? null : <p className={styles.detail}>{platform}</p>}
        {under === undefined ? null : (
          <>
            <Standing mark="blocked" words={t('clients.row.must_update')} />
            <p className={styles.detail}>{t('clients.row.minimum', { minimum: data(under) })}</p>
          </>
        )}
        <p className={styles.detail}>
          {version === null
            ? t('clients.row.no_version')
            : t('clients.row.version', { version: data(version) })}
        </p>
        {/* A build is a browser's: the app on a phone is another app, and is compared with nothing. */}
        {own || kind !== 'browser' || client.type !== 'web' || version === null ? null : (
          <p className={styles.detail}>
            {version === ownVersion(clientName())
              ? t('clients.row.same_build')
              : t('clients.row.other_build')}
          </p>
        )}
        <p className={styles.detail}>
          {t('clients.row.reported', { when: format.instant(client.last_seen_at, zone) })}
        </p>
      </div>
    </li>
  )
}

function Listed() {
  const t = useTranslate()
  const queries = useQueryClient()
  const household = useHousehold()
  const online = useOnline()
  const names = useClientNames()
  const withdrawn = useNoWithdrawal()
  const own = useOwn()
  const read = useClients(household.id)

  // The list's own refusal says its reader is an owner no longer. The household alone is read
  // again, which is what takes this screen and its way in away: read again with it, the list
  // would only be refused again.
  const refused = problemIn(read.error)?.status === 404
  const { id } = household
  useEffect(() => {
    if (!refused) return
    void queries.invalidateQueries({ queryKey: householdKey(id), exact: true })
  }, [refused, queries, id])
  if (refused) return <NotAvailable home={inHousehold.home(household.id)} />

  const items = read.data?.items ?? []
  const base = readState(read, online, items.length === 0)
  const state: DataState =
    !writes(household) && (base === 'populated' || base === 'offline') ? 'readonly' : base

  return (
    <HouseholdSettingsPage
      title={t('household.settings.clients.title')}
      lead={t('clients.lead')}
      note={false}
    >
      <div className={styles.stack}>
        <StateFrame
          state={state}
          skeleton={
            <Skeleton
              bars={[
                [45, 1.25],
                [30, 1],
                [65, 1],
                [50, 1.25],
                [35, 1],
              ]}
            />
          }
          empty={<EmptyState sentence={t('clients.empty.sentence')} />}
          texts={{
            error: {
              title: t('clients.error.title'),
              text: t('clients.error.body'),
              actions: (
                <Button
                  onClick={() => {
                    void read.refetch()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              ),
            },
            withdrawn,
            readonly: { title: t('health.readonly.title'), text: t('clients.readonly.text') },
          }}
        >
          {() => (
            <>
              {own.at === 'elsewhere' ? (
                <p className={account.note}>{t('clients.unmarked')}</p>
              ) : null}
              <List label={t('household.settings.clients.title')}>
                {items.map((each) => (
                  <Row
                    key={each.replica_id}
                    client={each}
                    own={own.at === 'here' && sameId(each.replica_id, own.id)}
                    minimums={read.data?.minimum_versions ?? { web: null, mobile: null }}
                    names={names}
                  />
                ))}
              </List>
              <p className={account.note}>{t('clients.note')}</p>
            </>
          )}
        </StateFrame>
        <p className={account.note}>{t('clients.sync.note')}</p>
        <Link className={cx(account.link, styles.way)} to={inHousehold.syncHealth(household.id)}>
          {t('clients.sync.link')}
        </Link>
      </div>
    </HouseholdSettingsPage>
  )
}

export function Clients() {
  const household = useHousehold()
  // Absent: no list, no reason, and nothing asked of the server.
  if (!useStanding().owner) return <NotAvailable home={inHousehold.home(household.id)} />
  return <Listed />
}
