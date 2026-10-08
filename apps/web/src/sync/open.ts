// Opens a household's replica in this browser (@household/sync/web: PowerSync's web SDK on
// wa-sqlite over IndexedDB). This file and what it imports, the sync library and its SDK, are
// fetched when a replica is first opened and not before (ReplicaProvider.tsx imports it as it
// opens one): a visitor's page, and a member's first paint, download none of it.
import type { ApiClient } from '@household/api'
import { localTables, NeedsConnection, type RecordedOutcome, type Replica } from '@household/sync'
import { openReplica } from '@household/sync/web'
import { apiPath } from '../api/client.ts'
import type { ProblemHub } from '../api/problems.ts'
import { noteReplica, replicaDatabase } from './databases.ts'
import { sessionCredential, sessionFetch } from './sessionFetch.ts'

export interface OpenOptions {
  readonly household: string
  readonly api: ApiClient
  readonly problems: ProblemHub
}

/**
 * A replica as the app holds it once it is open: the replica, and what of the library's own the
 * app's screens need beside it, so that none of them imports the library for more than its
 * types, and so none of them is what makes a page download it.
 */
export interface Opened {
  readonly replica: Replica
  /**
   * Tells `listener` what needs the member's attention, each mutation's last answer that does,
   * oldest first: now, and each time it changes, until the function it returns is called.
   */
  readonly watchInbox: (listener: (entries: readonly RecordedOutcome[]) => void) => () => void
  /**
   * Whether `error` is the library's refusal of a write to an entity that is not written offline
   * (D-84): what a screen that tried one says needs a connection (rowState.ts). A stand-in that
   * makes no write may leave it out, and then no error is taken for that refusal.
   */
  readonly needsConnection?: (error: unknown) => boolean
}

/** `replica` with what the app's screens watch it by. */
export function opened(replica: Replica): Opened {
  return {
    replica,
    needsConnection: (error) => error instanceof NeedsConnection,
    watchInbox: (listener) => {
      let stopped = false
      const stop = replica.db.onChange(
        {
          onChange: async () => {
            try {
              const entries = await replica.inbox()
              if (!stopped) listener(entries)
            } catch (error) {
              // What a read fails with once the watch has stopped, a closed database among it,
              // is nobody's to hear.
              if (!stopped) throw error
            }
          },
        },
        // The answers, and the holds: giving a hold up changes what an entry is.
        {
          tables: [localTables.outcomes, localTables.held],
          throttleMs: 30,
          triggerImmediate: true,
        },
      )
      return () => {
        stopped = true
        stop()
      }
    },
  }
}

/**
 * The replica of `household`, opened on the database this browser keeps for it, as it was left.
 * It reaches the API as the session does (sessionFetch.ts). The caller connects it, and closes it.
 */
export async function openHouseholdReplica({
  household,
  api,
  problems,
}: OpenOptions): Promise<Opened> {
  noteReplica(household)
  return opened(
    await openReplica({
      dbFilename: replicaDatabase(household),
      household,
      apiUrl: new URL(apiPath, window.location.origin).href,
      credential: sessionCredential(api, problems),
      fetch: sessionFetch({ problems }),
    }),
  )
}
