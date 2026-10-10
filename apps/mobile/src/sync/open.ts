// Opens a member's replica of a household on this device (@household/sync/native: PowerSync's
// React Native SDK on op-sqlite), and removes one. This is the one file of the app that imports
// the sync library's values: every other imports it for its types alone, and what a screen
// needs of it at run time is handed over with the open replica (`Opened`), as the web's is
// (apps/web/src/sync/open.ts).
//
// The replica reaches the API as the app does: by a `fetch` that names the client, or a
// household's clients would list this device with no type and no version (D-178), and with the
// device's own sign-in, renewed by the session. A renewal the server refuses has ended the
// sign-in (session/SessionProvider.tsx): the credential then throws the library's `Revoked`, at
// which the replica discards itself (FR-ID7), and the session removes everything else the
// device kept of its member, the replicas among it, through what is registered at the foot of
// this file.
//
// A replica is open once on a device however many hold it: the household on screen, and a dev
// screen drawn over it. Each holder lets go for itself, and the replica is closed when the last
// one has.
import {
  localTables,
  NeedsConnection,
  Revoked,
  type RecordedOutcome,
  type Replica,
} from '@household/sync'
import { openReplica } from '@household/sync/native'
import { open as openDatabase } from '@op-engineering/op-sqlite'
import { apiUrl, namedFetch } from '../api/client.ts'
import type { ProblemHub } from '../api/problems.ts'
import type { Session } from '../session/context.ts'
import { onForget } from '../session/forget.ts'
import {
  claimReplica,
  markLeaving,
  removeLeft,
  replicaDatabase,
  type Removal,
} from './databases.ts'
import { filesOf, fileStorage, removeFiles, uploadByUri } from './files.ts'

export interface OpenOptions {
  /** Whose replica it is: the signed-in member's id. */
  readonly member: string
  readonly household: string
  readonly problems: ProblemHub
  /** The device's sign-in as a replica takes it (`useSession().credential`). */
  readonly credential: Session['credential']
  /** The API's base. Left out, the build's own. */
  readonly api?: string
}

/**
 * A replica as the app holds it once it is open: the replica, and what of the library's own the
 * app's screens need beside it, so that none of them imports the library for more than its
 * types.
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
   * (D-84): what a screen that tried one says needs a connection (rowState.ts).
   */
  readonly needsConnection: (error: unknown) => boolean
  /** Lets go of it. The replica is closed once every holder has; asked twice, it is the same. */
  readonly close: () => Promise<void>
}

/** `replica` with what the app's screens watch it by, and `close` as its holder's way to let go. */
export function opened(replica: Replica, close: () => Promise<void>): Opened {
  return {
    replica,
    close,
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

/** A replica open on this device, or on its way to being, and how many hold it. */
interface Shared {
  readonly member: string
  /** The replica once it is open; rejected where it could not be opened. */
  readonly replica: Promise<Replica>
  holders: number
  /** Whether its note was made (databases.ts), after which only its own opening is waited on. */
  claimed: boolean
  /** Whether its member's sign-in has ended: it is opened for nobody from then on. */
  gone: boolean
  /** Its closing, once the last holder let go or it was emptied. */
  closed: Promise<void> | undefined
}

/** The replicas open here, by their file's name. */
const shared = new Map<string, Shared>()
/** Those whose member's sign-in ended while they were open, until each is emptied. */
const doomed = new Map<string, Shared>()

/** Closes `one`, once, whoever asks. */
function close(name: string, one: Shared): Promise<void> {
  one.closed ??= one.replica
    .then((replica) => replica.close())
    .catch(() => undefined)
    .finally(() => {
      if (shared.get(name) === one) shared.delete(name)
    })
  return one.closed
}

/** What a replica whose sign-in is gone is told when it asks for its credential. */
function ended(): Error {
  return new Revoked('the device’s sign-in has ended')
}

/**
 * Deletes a replica's database file, where there is one. What a run that ended badly left
 * beside it goes with it: a log found later beside a new file of the same name would be read
 * into that file.
 */
function deleteDatabase(name: string): void {
  let database
  try {
    // Opened only if it is there: one that was noted and never made has nothing to delete.
    database = openDatabase({ name, failOnCreate: true })
  } catch {
    return
  }
  try {
    database.executeSync('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // A file that cannot be read is deleted all the same.
  }
  database.delete()
}

const removal: Removal = {
  empty: async (member, household) => {
    const name = replicaDatabase(member, household)
    const open = doomed.get(name)
    doomed.delete(name)
    // One that was open here is emptied where it is, and closed under whoever still holds it.
    // One still waiting for its note opens nothing (`start`), and is nothing to wait for.
    const replica = open?.claimed === true ? await open.replica.catch(() => undefined) : undefined
    if (open !== undefined && replica !== undefined) {
      try {
        await replica.wipe()
      } finally {
        await close(name, open)
      }
      return
    }
    // Not open: opened to be emptied, for nobody, and asking nothing of the server.
    const closed = await openReplica({
      dbFilename: name,
      household,
      apiUrl: 'about:blank',
      credential: { current: () => Promise.reject(ended()), renew: () => Promise.reject(ended()) },
    })
    try {
      await closed.wipe()
    } finally {
      await closed.close()
    }
  },
  remove: (member, household) => {
    deleteDatabase(replicaDatabase(member, household))
    removeFiles(member, household)
    return Promise.resolve()
  },
}

async function start(
  { member, household, problems, credential, api }: OpenOptions,
  one: () => Shared,
): Promise<Replica> {
  if (!(await claimReplica(member, household, removal))) {
    throw new Error('what an ended sign-in left of this replica could not be removed')
  }
  one().claimed = true
  if (one().gone) throw new Error('the sign-in this replica was opened under has ended')
  const replica = await openReplica({
    dbFilename: replicaDatabase(member, household),
    household,
    apiUrl: api ?? apiUrl(),
    credential: credential(ended),
    fetch: namedFetch({ problems }),
    attachments: {
      storage: fileStorage(filesOf(member, household)),
      // No module's route takes a file yet: the first is the proof module's (plan item 30).
      uploadUrl: () => null,
      transport: { byUri: uploadByUri({ problems }) },
    },
  })
  // Once, however many come to hold it. Connecting is the replica's to keep trying: a sync
  // service that cannot be reached is the state its status says, not a failure to open.
  replica.connect().catch(() => undefined)
  return replica
}

/**
 * The member's replica of `household`, opened on the file this device keeps for it, as it was
 * left, and connected or trying to be; or the one already open here. The caller lets go of it
 * (`close`).
 */
export async function openHouseholdReplica(options: OpenOptions): Promise<Opened> {
  const name = replicaDatabase(options.member, options.household)
  // One that is being closed is waited out: its file is opened again once it has been let go.
  for (let closing = shared.get(name); closing?.closed !== undefined; closing = shared.get(name)) {
    await closing.closed
  }
  let one = shared.get(name)
  if (one === undefined) {
    const made: Shared = {
      member: options.member.toLowerCase(),
      replica: Promise.resolve().then(() => start(options, () => made)),
      holders: 0,
      claimed: false,
      gone: false,
      closed: undefined,
    }
    shared.set(name, made)
    one = made
  }
  const held = one
  held.holders += 1
  let released = false
  const release = () => {
    if (released) return held.closed ?? Promise.resolve()
    released = true
    held.holders -= 1
    return held.holders === 0 ? close(name, held) : Promise.resolve()
  }
  try {
    return opened(await held.replica, release)
  } catch (error) {
    await release()
    throw error
  }
}

// Said once, as this file is loaded, which it is with the household's layout as the app starts:
// what the device keeps of a member goes with their sign-in, however that ended (FR-ID7). The
// session waits for the note that each is leaving, and not for the removal: a sign-out's screen
// is not held up by a file, and a file that could not be removed now is removed at the next
// start, from the note.
onForget(async (member) => {
  const id = member.toLowerCase()
  for (const [name, one] of shared) {
    if (one.member !== id) continue
    // From now on it is nobody's to open or to join: whoever asks next opens it anew, emptied.
    one.gone = true
    shared.delete(name)
    doomed.set(name, one)
  }
  await markLeaving(id)
  void removeLeft(removal)
})
void removeLeft(removal)
