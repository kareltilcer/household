// What the three screens of a household's sync read (A-32, A-33, C-57; PRD 17 §8, PRD 10 §6): the
// reader's own replicas as each last reported itself, every member's clients with the version
// each named, and of this browser's own replica what only it can say, which is everything that
// is so now. The server knows of a replica what it reported and nothing since (D-125): it holds
// no replica's queue, and a browser that has not reported is nowhere in its answers.
//
// What the server answers is a query filed under the household's own key, drawn from what this
// browser kept where the server cannot be asked, and read again with the household (data.ts).
// What the replica says is asked of the replica, in the one tab that holds it: every other tab
// of this browser has none to ask (sync/ReplicaProvider.tsx), and says so.
import type { ApiClient, components } from '@household/api'
import type { Replica } from '@household/sync'
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { householdKey } from '../household/households.ts'
import { useInbox, useReplica, useSync } from '../sync/ReplicaProvider.tsx'

/** One of the reader's replicas, as it last reported itself. */
export type Report = NonNullable<components['schemas']['SyncState']['replicas']>[number]
export type Client = components['schemas']['Client']
export type ClientList = components['schemas']['ClientList']
export type Device = components['schemas']['Device']

/** The reader's replicas of a household (`getSyncState`), under the household's own key. */
export function syncStateKey(household: string) {
  return [...householdKey(household), 'sync', 'state'] as const
}

/** The household's clients (`getClients`), under the household's own key too. */
export function clientsKey(household: string) {
  return [...householdKey(household), 'clients'] as const
}

/**
 * The account's phones and tablets (`getMeDevices`), for what a report does not say of one: its
 * platform. Filed under the account's key, as everything of a member's own is.
 */
export const ownDevicesKey = ['me', 'devices'] as const

/** Each of the reader's replicas of the household, the one that reported last first. */
export function syncStateQuery(api: ApiClient, household: string) {
  return queryOptions({
    queryKey: syncStateKey(household),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/sync/state', {
          params: { path: { household_id: household } },
          signal,
        }),
      ).replicas ?? [],
  })
}

export function useSyncState(household: string): UseQueryResult<Report[]> {
  return useQuery(syncStateQuery(useApi(), household))
}

/**
 * Every client that synced the household, whose it is and the version it named, with the oldest
 * versions the deployment serves. An owner's to read: a member and a child profile are answered
 * `404`, so a screen asks only where its reader is an owner (`enabled`).
 */
export function useClients(
  household: string,
  { enabled = true }: { readonly enabled?: boolean } = {},
): UseQueryResult<ClientList> {
  const api = useApi()
  return useQuery({
    queryKey: clientsKey(household),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/households/{household_id}/clients', {
          params: { path: { household_id: household } },
          signal,
        }),
      ),
    enabled,
  })
}

/**
 * The account's phones and tablets, asked only where a replica names one (`enabled`): a report
 * carries a device's label and not its platform. A list that cannot be read names nothing, and
 * its rows are named by their labels alone.
 */
export function useOwnDevices({
  enabled = true,
}: { readonly enabled?: boolean } = {}): UseQueryResult<Device[]> {
  const api = useApi()
  return useQuery({
    queryKey: ownDevicesKey,
    queryFn: async ({ signal }) => unwrap(await api.GET('/me/devices', { signal })).items ?? [],
    enabled,
  })
}

/**
 * The id this browser's replica reports under, which marks its row among the server's: once the
 * replica is open in this tab and has been asked. Undefined before that, and in a tab that
 * holds no replica, where nothing can say which row is this browser; null where the replica was
 * asked and could not say, a database that failed under the question.
 */
export function useOwnReplicaId(): string | null | undefined {
  const replica = useReplica()
  const [read, setRead] = useState<{ readonly replica: Replica; readonly id: string | null }>()
  useEffect(() => {
    if (replica === undefined) return undefined
    let stopped = false
    replica.id().then(
      (id) => {
        if (!stopped) setRead({ replica, id })
      },
      () => {
        if (!stopped) setRead({ replica, id: null })
      },
    )
    return () => {
      stopped = true
    }
  }, [replica])
  // What was read of another replica says nothing of this one.
  return read !== undefined && read.replica === replica ? read.id : undefined
}

/**
 * Where this tab stands towards the household's replica, for a screen that marks this browser's
 * own row: `here` with its id, once the replica is open in this tab and has said it; `opening`
 * until then; and where this tab has none to ask, why: another tab of this browser keeps it
 * (`elsewhere`), or this browser keeps none (`unavailable`).
 */
export type Own =
  | { readonly at: 'opening' }
  | { readonly at: 'here'; readonly id: string }
  | { readonly at: 'elsewhere' }
  | { readonly at: 'unavailable' }

export function useOwn(): Own {
  const { replica } = useSync()
  const id = useOwnReplicaId()
  switch (replica.phase) {
    case 'opening':
      return { at: 'opening' }
    case 'elsewhere':
      return { at: 'elsewhere' }
    case 'unavailable':
      return { at: 'unavailable' }
    case 'open':
      if (id === undefined) return { at: 'opening' }
      return id === null ? { at: 'unavailable' } : { at: 'here', id }
  }
}

/** What this browser's replica holds that has not reached the server. */
export interface Waiting {
  /** The writes in its upload queue. */
  readonly queued: number
  /** The mutations it holds to send again: deferred ones, and ones the entitlement refused. */
  readonly held: number
}

/**
 * What waits in this browser's replica, as it is now. It is read when the screen opens, and
 * again whenever PowerSync's status moves, an upload begun or ended among it, or the replica's
 * own tables of answers and holds change. Undefined until the replica is open here and has been
 * read.
 */
export function useWaiting(): Waiting | undefined {
  const replica = useReplica()
  // A hold given up or taken changes what the inbox watches, and so tells of itself here.
  const inbox = useInbox()
  const [read, setRead] = useState<{ readonly replica: Replica; readonly waiting: Waiting }>()
  useEffect(() => {
    if (replica === undefined) return undefined
    let stopped = false
    const look = () => {
      Promise.all([replica.queued(), replica.held()]).then(
        ([queued, held]) => {
          if (stopped) return
          // A status moves many times while a replica downloads: what was read is kept as it
          // is unless it says something else, and nothing is drawn again for it.
          setRead((was) =>
            was?.replica === replica &&
            was.waiting.queued === queued &&
            was.waiting.held === held.length
              ? was
              : { replica, waiting: { queued, held: held.length } },
          )
        },
        // What a read fails with as the database closes is nobody's to hear.
        () => undefined,
      )
    }
    look()
    const stop = replica.db.registerListener({ statusChanged: look })
    return () => {
      stopped = true
      stop()
    }
  }, [replica, inbox])
  return read !== undefined && read.replica === replica ? read.waiting : undefined
}

/**
 * Has this browser's replica report itself when its screen opens, once for each visit, and
 * tells `onReported` when the server has answered it. The library's own first report is a
 * quarter of an hour after it connects, so without this a browser that was opened a minute ago
 * has no row to read (D-125).
 *
 * It reports only a replica that has caught up: one that has not holds less than the server
 * through no fault, and two reports of it a minute apart read to the server as divergence. The
 * library itself reports nothing while a write waits in the queue (`report` answers null), and
 * answers null as well where the server did not take the report, a household that does not
 * write among them, which `enabled` leaves unasked.
 */
export function useReportOnOpen(enabled: boolean, onReported: () => void): void {
  const replica = useReplica()
  const asked = useRef<Replica | null>(null)
  // The last one given: what is told is whoever draws the screen when the answer comes.
  const told = useRef(onReported)
  useEffect(() => {
    told.current = onReported
  }, [onReported])
  useEffect(() => {
    if (replica === undefined || !enabled) return undefined
    const report = () => {
      if (asked.current === replica || !replica.caughtUp) return
      asked.current = replica
      replica.report().then(
        (verdict) => {
          if (verdict !== null) told.current()
        },
        // No answer, or a session that has ended, which the session's own fetch has told.
        () => undefined,
      )
    }
    report()
    // A replica still connecting as the screen opens reports once it has caught up.
    return replica.db.registerListener({ statusChanged: report })
  }, [replica, enabled])
}
