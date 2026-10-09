// Sync health (A-32, `/households/{id}/settings/sync`; PRD 17 §8, FR-HA19; PRD 10 §6; D-125,
// D-128): the reader's own browsers and devices that keep a copy of the household, a row each,
// with how each stands in a status and a sentence or two, and the one thing that puts a copy
// right, downloading it again. Nobody at the platform can read a household (D-3), so this is the
// only view anyone gets of a sync failure, and it is every member's, whatever they hold.
//
// The rows are the contract's (`getSyncState`): the caller's replicas and nobody else's, each as
// it last reported itself, which the row says when. The prototype drew every member's devices
// and called the screen an owner's; another member's replica is never answered, and whose
// client runs which version is the owners' other screen (Clients.tsx). This browser's row is
// marked, and its figures are the replica's own as they are now: what waits to be sent, what
// waits for the member with the way to it, and whether changes are arriving. Only the tab that
// holds the household's replica can say those, or which row is its own; another tab says that.
// A browser is named for what its header tells and never by the header (account/userAgent.ts),
// and a device by its label, with its kind from the account's own list where the label does not
// say.
//
// The words are D-93's: a copy's *last checkpoint*, a number the library gives and the row
// shows as it is, and *download again*. An entity type has no word, so what disagreed is
// counted and not named. What the prototype drew and nothing gives is left out: no time of a
// last sync beside the last report, and no time a download began or ended.
//
// This browser reports itself as the screen opens, once (data.ts): the library's first report
// is a quarter of an hour after it connects, and a browser opened a minute ago would have no
// row. Until the list has it, its row is drawn from the replica alone and says it has not
// reported.
//
// Downloading again (`postSyncReset`) marks one of the reader's own replicas: it acts at its
// next report, once its queue has drained, and is listed as downloading again until the report
// after (D-128), which is all the row then says and offers. A household that takes no writes
// refuses it and takes no report either, so there the control is absent and the screen says
// that each row is as it last reported.
//
// A-32's states. *Loading* is the list being read, or this tab's replica being opened. *Error*
// is a list that could not be read in a tab with no replica to speak for itself; with one, this
// browser's row is drawn as it is now and a banner says the rest could not be read. *Empty* is
// no report yet and no replica here. *Populated* is the rows; *offline* the same from what this
// browser kept, its own row saying that it is offline. *Pending* is this browser's row with
// changes waiting, and *syncing* a row downloading again: each is a row's own status, drawn
// with its glyph and words, since two rows stand differently at once. *Read-only* is the list
// under its notice, with no control. *Absent* has nobody to be for: every member reads their
// own. *Conflicted* and *rejected* have nothing to be, this being the screen that counts them;
// nor has *withdrawn*, a replica being its member's and no grant's.
import type { components } from '@household/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import account from '../account/Settings.module.css'
import { refocus, sameId, useData, useNoWithdrawal, useSaid } from '../account/common.ts'
import { useClientNames } from '../account/userAgent.ts'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { inHousehold } from '../app/paths.ts'
import { useReread, writes } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { useRefusal } from '../household/settings/invitations.ts'
import { HouseholdSettingsPage, Section } from '../household/settings/Page.tsx'
import { isStandingRefusal } from '../household/settings/profile.ts'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useInbox, useSync } from '../sync/ReplicaProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button, RowAction } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { List } from '../ui/ListRow.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'
import { useToast } from '../ui/Toast.tsx'
import { NoReplica, Standing, type Mark } from './common.tsx'
import {
  syncStateKey,
  useOwn,
  useOwnDevices,
  useReportOnOpen,
  useSyncState,
  useWaiting,
  type Report,
} from './data.ts'
import styles from './Health.module.css'

type Device = components['schemas']['Device']

/** A replica as a row of the list. */
interface Listed {
  /** The row's own key: its replica's id. */
  readonly key: string
  readonly name: string
  /** What kind of device it is, where its name is a label that does not say. */
  readonly kind: string | undefined
  /** Whether it is this browser's, whose figures are the replica's own as they are now. */
  readonly own: boolean
  /** What it last reported of itself, or nothing for this browser before the server lists it. */
  readonly report: Report | undefined
  /** How many changes wait to be sent: now for this browser, at its last report for any other. */
  readonly waiting: number
  /** How many changes wait for the member's own answer: now, or at its last report. */
  readonly attention: number
}

/** How a row stands, the first that holds. */
type Stands =
  'downloading' | 'mismatch' | 'offline' | 'not_receiving' | 'attention' | 'waiting' | 'synced'

const marks: Readonly<Record<Stands, Mark>> = {
  downloading: 'syncing',
  mismatch: 'stale',
  offline: 'offline',
  not_receiving: 'offline',
  attention: 'conflict',
  waiting: 'pending',
  synced: 'synced',
}

/** What this browser's replica says of the connection, which no report carries. */
interface Connection {
  readonly online: boolean
  readonly receiving: boolean | null
}

/**
 * How `row` stands. A copy being downloaded again, or one that does not match, is said before
 * anything it has waiting: it is what the row's one action is about. This browser alone says
 * how its connection is, since only it knows.
 */
function standsOf(row: Listed, connection: Connection): Stands {
  if (row.report?.needs_resnapshot === true) return 'downloading'
  if ((row.report?.digest_mismatch_entity_types?.length ?? 0) > 0) return 'mismatch'
  if (row.own && !connection.online) return 'offline'
  if (row.own && connection.receiving === false) return 'not_receiving'
  if (row.attention > 0) return 'attention'
  if (row.waiting > 0) return 'waiting'
  return 'synced'
}

/** Whether `report` is of a replica that may be asked to download itself again. */
function offersAgain(report: Report | undefined): report is Report & { replica_id: string } {
  return report?.replica_id !== undefined && report.needs_resnapshot !== true
}

/** The replica a confirmation asks to download itself again. */
interface Target {
  readonly id: string
  readonly name: string
  readonly own: boolean
}

function Row({
  row,
  connection,
  inbox,
  onAgain,
}: {
  readonly row: Listed
  readonly connection: Connection
  /** Where what waits for the member is answered: this browser's own inbox. */
  readonly inbox: string
  /** Asks to download it again, where that is offered: absent, not disabled. */
  readonly onAgain: (() => void) | undefined
}) {
  const t = useTranslate()
  const format = useFormat()
  const zone = useTimeZone()
  const data = useData()
  const { report } = row
  const stands = standsOf(row, connection)
  const kinds = report?.digest_mismatch_entity_types?.length ?? 0
  const failures = report?.checksum_failures ?? 0

  // How it stands, in the screen's own words: the contract's name for none of it is drawn.
  const words = (): string => {
    switch (stands) {
      case 'downloading':
        return t('health.sync.status.downloading')
      case 'mismatch':
        return t('health.sync.status.mismatch')
      case 'offline':
        return t('health.sync.status.offline')
      case 'not_receiving':
        return t('health.sync.status.not_receiving')
      case 'attention':
        return t('health.sync.status.attention')
      case 'waiting':
        return t('health.sync.status.waiting')
      case 'synced':
        return t('health.sync.status.synced')
    }
  }
  const reported = (): string => {
    if (report === undefined) return t('health.sync.row.unreported')
    const at = report.last_report_at ?? undefined
    if (at === undefined) return t('health.sync.row.reported_unknown')
    const when = format.instant(at, zone)
    return report.checkpoint == null
      ? t('health.sync.row.reported_bare', { when })
      : t('health.sync.row.reported', { when, checkpoint: data(report.checkpoint) })
  }

  return (
    <li className={styles.row}>
      <div className={styles.about}>
        <div className={styles.head}>
          <span className={styles.name}>{row.name}</span>
          {row.own ? (
            <span className={account.badge}>{t('account.devices.this_browser')}</span>
          ) : null}
        </div>
        {row.kind === undefined ? null : <p className={styles.detail}>{row.kind}</p>}
        <Standing mark={marks[stands]} words={words()} />
        {stands === 'downloading' ? (
          <p className={styles.detail}>{t('health.sync.row.downloading')}</p>
        ) : null}
        {row.own && !connection.online ? (
          <p className={styles.detail}>{t('health.sync.row.offline')}</p>
        ) : row.own && connection.receiving === false ? (
          <p className={styles.detail}>{t('health.sync.row.not_receiving')}</p>
        ) : null}
        {row.waiting === 0 ? null : (
          <p className={styles.detail}>
            {row.own
              ? t('health.sync.row.waiting_now', { count: row.waiting })
              : t('health.sync.row.waiting_then', { count: row.waiting })}
          </p>
        )}
        {row.attention === 0 ? null : row.own ? (
          // The sentence is the way: what waits for the member is answered in the inbox.
          <Link className={cx(account.link, styles.way)} to={inbox}>
            {t('health.sync.row.attention_now', { count: row.attention })}
          </Link>
        ) : (
          <p className={styles.detail}>
            {t('health.sync.row.attention_then', { count: row.attention })}
          </p>
        )}
        {kinds === 0 ? null : (
          <p className={styles.detail}>{t('health.sync.row.mismatch', { count: kinds })}</p>
        )}
        {failures === 0 ? null : (
          <p className={styles.detail}>{t('health.sync.row.checksums', { count: failures })}</p>
        )}
        <p className={styles.detail}>{reported()}</p>
      </div>
      {onAgain === undefined ? null : (
        <div className={styles.actions}>
          <RowAction
            name={t('health.sync.again.named', { name: row.name })}
            word={t('health.sync.again.word')}
            onPress={onAgain}
          />
        </div>
      )}
    </li>
  )
}

export function SyncHealth() {
  const t = useTranslate()
  const api = useApi()
  const toast = useToast()
  const queries = useQueryClient()
  const household = useHousehold()
  const zone = useTimeZone()
  const online = useOnline()
  const names = useClientNames()
  const refusal = useRefusal(zone)
  const say = useProblemText(zone)
  const reread = useReread(household.id)
  const withdrawn = useNoWithdrawal()
  const { pathname } = useLocation()
  const { receiving } = useSync()
  const own = useOwn()
  const waiting = useWaiting()
  const inbox = useInbox()
  const takesWrites = writes(household)

  const read = useSyncState(household.id)
  const reports = read.data
  // A report says a device's label and not what kind of device it is: the account's own list
  // does, and is asked only where a replica names a device.
  const devices = useOwnDevices({
    enabled: reports?.some((each) => each.device_id != null) === true,
  }).data

  const { id: householdId } = household
  const reported = useCallback(() => {
    void queries.invalidateQueries({ queryKey: syncStateKey(householdId) })
  }, [queries, householdId])
  useReportOnOpen(takesWrites, reported)

  const here = own.at === 'here'
  const ownReport = here ? reports?.find((each) => sameId(each.replica_id, own.id)) : undefined

  const nameOf = (report: Report): Pick<Listed, 'name' | 'kind'> => {
    if (report.device_id == null) return { name: names.ofAgent(report.label), kind: undefined }
    const device: Device | undefined = devices?.find((each) => sameId(each.id, report.device_id))
    const labelled = (report.label ?? '').trim() !== ''
    return {
      name: names.ofDevice(report.label, device?.platform),
      kind:
        labelled && device?.platform !== undefined ? names.ofPlatform(device.platform) : undefined,
    }
  }
  const rows: Listed[] = [
    ...(here
      ? [
          {
            // Its replica's own id, before the server lists it and after: the row stays the row.
            key: own.id,
            // Named from what this browser says of itself, as the server will keep it.
            name: names.ofAgent(ownReport?.label ?? window.navigator.userAgent),
            kind: undefined,
            own: true,
            report: ownReport,
            waiting: (waiting?.queued ?? 0) + (waiting?.held ?? 0),
            attention: inbox?.length ?? 0,
          },
        ]
      : []),
    ...(reports ?? [])
      .filter((each) => each !== ownReport)
      .map((each, index) => ({
        key: each.replica_id ?? String(index),
        ...nameOf(each),
        own: false,
        report: each,
        waiting: each.pending_mutations ?? 0,
        attention: each.unresolved_conflicts ?? 0,
      })),
  ]

  // With nothing kept, a read that failed and one that waits for a connection are the same to
  // a member: the list could not be read.
  const unread = reports === undefined && (read.isError || read.fetchStatus === 'paused')
  const state: DataState =
    own.at === 'opening' || (reports === undefined && !unread)
      ? 'loading'
      : reports === undefined && !here
        ? 'error'
        : rows.length === 0
          ? 'empty'
          : !takesWrites
            ? 'readonly'
            : online
              ? 'populated'
              : 'offline'

  const [target, setTarget] = useState<Target | null>(null)
  // A refusal that is no dialog's to say: each is said as it arrives.
  const [refused, refuse] = useSaid()

  // The control that was pressed is gone once the list is read again: a replica marked to
  // download itself again offers nothing, one that is listed no longer has no row, and a
  // household that stopped taking writes draws no control at all. The focus it held went with
  // it, and is put on the list's own place.
  const view = useRef<HTMLDivElement>(null)
  const asked = useRef<string | null>(null)
  useEffect(() => {
    const id = asked.current
    if (id === null || reports === undefined) return
    const row = reports.find((each) => sameId(each.replica_id, id))
    if (takesWrites && offersAgain(row)) return
    asked.current = null
    refocus(view.current)
  }, [reports, takesWrites])

  const again = useMutation({
    ...askedNow,
    mutationFn: async (given: Target) => {
      unwrap(
        await api.POST('/households/{household_id}/sync/reset', {
          params: { path: { household_id: household.id } },
          body: { replica_id: given.id },
        }),
      )
    },
    onSuccess: (_answer, given) => {
      asked.current = given.id
      setTarget(null)
      // The row says it is downloading again once the list is read again: until then, this.
      toast({ message: t('health.sync.again.done', { name: given.name }) })
      void reread()
    },
    onError: (error, given) => {
      // The household takes no writes now, or the replica is listed no longer: the question has
      // nothing left to ask, and the list is read again. Any other failure is the question's
      // own to say, and it stays open.
      if (!isStandingRefusal(error)) return
      asked.current = given.id
      setTarget(null)
      refuse(
        problemIn(error)?.code === 'not_found'
          ? t('health.sync.again.gone', { name: given.name })
          : refusal(error),
      )
      void reread()
    },
  })

  const connection: Connection = { online, receiving }

  return (
    <HouseholdSettingsPage
      title={t('household.settings.sync.title')}
      lead={t('health.sync.lead')}
      note={false}
    >
      <div ref={view} tabIndex={-1} className={cx(account.view, styles.stack)}>
        {refused === null ? null : (
          <Banner key={refused.id} tone="danger" announce>
            {refused.text}
          </Banner>
        )}
        <NoReplica own={own} />
        <StateFrame
          state={state}
          skeleton={
            <Skeleton
              bars={[
                [50, 1.25],
                [30, 1],
                [70, 1],
                [45, 1.25],
                [65, 1],
              ]}
            />
          }
          empty={
            <EmptyState
              sentence={t('health.sync.empty.sentence')}
              example={t('health.sync.empty.example')}
              action={
                <Button
                  onClick={() => {
                    void read.refetch()
                  }}
                >
                  {t('health.sync.empty.again')}
                </Button>
              }
            />
          }
          texts={{
            error: {
              title: t('health.sync.error.title'),
              text: t('health.sync.error.body'),
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
            readonly: {
              title: t('health.readonly.title'),
              text: t('health.sync.readonly.text'),
            },
          }}
        >
          {({ writes: drawn }) => (
            <>
              {reports === undefined ? (
                // This browser speaks for itself: what the server lists could not be read. Said
                // again for each read that fails.
                <Banner
                  key={read.errorUpdateCount}
                  tone="danger"
                  title={t('health.sync.unread.title')}
                  announce
                  actions={
                    <Button
                      onClick={() => {
                        void read.refetch()
                      }}
                    >
                      {t('ui.retry')}
                    </Button>
                  }
                >
                  {t('health.sync.unread.body')}
                </Banner>
              ) : null}
              <p className={account.note}>
                {here ? t('health.sync.note.live') : t('health.sync.note.reported')}
              </p>
              <List label={t('health.sync.list')}>
                {rows.map((row) => {
                  const { report } = row
                  return (
                    <Row
                      key={row.key}
                      row={row}
                      connection={connection}
                      inbox={inHousehold.sync(household.id)}
                      onAgain={
                        drawn && offersAgain(report)
                          ? () => {
                              again.reset()
                              refuse(null)
                              setTarget({ id: report.replica_id, name: row.name, own: row.own })
                            }
                          : undefined
                      }
                    />
                  )
                })}
              </List>
            </>
          )}
        </StateFrame>
        <Section title={t('health.sync.about.title')}>
          <p className={account.text}>{t('health.sync.about.checkpoint')}</p>
          <p className={account.text}>{t('health.sync.about.mismatch')}</p>
          <p className={account.text}>{t('health.sync.about.only_view')}</p>
          <Link
            className={account.link}
            to={inHousehold.diagnostics(household.id)}
            // The bundle is about the screen its member came from.
            state={{ from: pathname }}
          >
            {t('health.diagnostics.title')}
          </Link>
        </Section>
      </div>

      {target === null ? null : (
        <Dialog
          open
          onClose={() => {
            if (!again.isPending) setTarget(null)
          }}
          title={t('health.sync.again.title', { name: target.name })}
          description={
            target.own ? t('health.sync.again.body_here') : t('health.sync.again.body_there')
          }
          actions={
            <>
              <Button
                onClick={() => {
                  if (!again.isPending) setTarget(null)
                }}
              >
                {t('health.sync.again.keep')}
              </Button>
              <Button
                variant="primary"
                loading={again.isPending}
                onClick={() => {
                  again.mutate(target)
                }}
              >
                {t('health.sync.again.named', { name: target.name })}
              </Button>
            </>
          }
        >
          {again.isError && !isStandingRefusal(again.error) ? (
            <Banner key={again.submittedAt} tone="danger" announce>
              {say(again.error)}
            </Banner>
          ) : undefined}
        </Dialog>
      )}
    </HouseholdSettingsPage>
  )
}
