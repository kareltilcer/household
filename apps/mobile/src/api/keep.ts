// What the query client read, kept on the device for its member: one entry of the device's
// key-value store a member, named for them, so that a tablet several profiles are signed in to
// keeps each one's apart, and removed with their sign-in however it ends (D-161's twin on a
// device). A device that will not store keeps nothing, and the app reads from the server.
//
// It is kept for as long as its member's sign-in, and read back however old it is and whichever
// build of the app wrote it: the account, the member's households and a household's own answer
// are what the shell and the replica open on (session/SessionProvider.tsx,
// sync/ReplicaProvider.tsx), and a member who last had the app open two days ago, or whose
// phone updated the app overnight, opens it with no connection as one who had it open an hour
// ago does (PRD 03 §2.1: reads work offline, days offline among them). What is restored is
// stale, and asked for again as soon as there is a connection; the server's own answer, a `404`
// among them, stands over it. The day and the one build the web keeps a read for
// (apps/web/src/api/query.ts) are a browser's, which is no offline surface.
//
// Its own, on the query client's `dehydrate` and `hydrate`, and not TanStack's persister: a
// removal drops the write that was waiting and every write after it, where a throttled write
// would put a member's reads back after they were removed, as at a sign-out; and a store that
// refuses is answered with nothing, where the persister's restore rejects.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import { isKept } from './query.ts'

/** How often the reads are written, at most: a burst of changes is one write of the last state. */
export const writeEvery = 1000

/**
 * The shape the reads are kept in. What is stored says it, and what was stored under another
 * number is not read back. It is raised only by the change after which this app can no longer
 * draw what an earlier one kept: a query's key that comes to mean something else, a read kept
 * as something other than its answer, a TanStack Query whose `hydrate` no longer takes what an
 * earlier `dehydrate` wrote. The pull request that needs it raises it, and a release never
 * does, which is the manner of the web's version (D-158).
 *
 * The reads are for one shape and not for one build (D-187). A read is the contract's own
 * answer, which a later build of the same major (`/api/v1`) reads as it reads an older
 * server's, so an update of the app is no reason to drop it: dropped at every update, the
 * first start after one would need a connection, and a member whose phone updated the app
 * overnight would open it with none to *could not be read* and no replica.
 */
export const keptShape = 1

/** What every member's reads are kept under, before their id. */
const keptUnder = 'household.queries.'

/** Where `member`'s reads are kept. An id is written in either case, and is one member's. */
export function keepKey(member: string): string {
  return `${keptUnder}${member.toLowerCase()}`
}

/**
 * The members this device keeps reads of, by what they are kept under: what the session goes
 * by as the app starts, to remove those of anybody it holds no sign-in of (session/forget.ts).
 */
export async function keptMembers(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys()
  return keys.filter((key) => key.startsWith(keptUnder)).map((key) => key.slice(keptUnder.length))
}

/** What is stored: the reads, when they were written, and the shape they are kept in. */
interface Stored {
  readonly shape: number
  readonly at: number
  readonly state: DehydratedState
}

function isStored(value: unknown): value is Stored {
  if (typeof value !== 'object' || value === null) return false
  const stored = value as Partial<Record<keyof Stored, unknown>>
  return (
    typeof stored.shape === 'number' &&
    typeof stored.at === 'number' &&
    typeof stored.state === 'object' &&
    stored.state !== null
  )
}

/**
 * A kept read as it is stored: the answer it last was. One whose re-read failed since is held
 * as failed, with that answer still in it (`isKept`), and is read back as it was stored: left
 * so, the next start would draw a failure of a run before over what the device kept, and an
 * error that has been through storage is no problem a screen can read. It is stored as read,
 * and still marked as to be asked for again.
 */
function asRead(query: DehydratedState['queries'][number]): DehydratedState['queries'][number] {
  if (query.state.status !== 'error') return query
  return {
    ...query,
    state: {
      ...query.state,
      status: 'success',
      error: null,
      fetchFailureCount: 0,
      fetchFailureReason: null,
    },
  }
}

export interface Keep {
  /**
   * Puts what the device kept into `queries`: what was written in this shape, however long ago
   * and by whichever build of the app. What was kept in another shape is dropped rather than
   * shown, and read from the server; so is what a build kept before the shape had a number,
   * which it named for itself.
   */
  readonly restore: (queries: QueryClient) => Promise<void>
  /** Writes `queries` as it changes, at most once a second, until the function it returns is called. */
  readonly watch: (queries: QueryClient) => () => void
  /** Removes what is kept, and keeps nothing from then on: its member's sign-in has ended. */
  readonly remove: () => Promise<void>
  /** Writes what is waiting, now: how a test settles a write without a clock. */
  readonly flush: () => Promise<void>
}

export interface KeepOptions {
  /** The shape that is written, and whose reads alone are read back. Left out, `keptShape`. */
  readonly shape?: number
  readonly now?: () => number
}

/** What the device keeps of `member`'s reads. */
export function createKeep(
  member: string,
  { shape = keptShape, now = Date.now }: KeepOptions = {},
): Keep {
  const key = keepKey(member)
  let watched: QueryClient | undefined
  let waiting = false
  let removed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const write = async () => {
    timer = undefined
    if (!waiting || removed || watched === undefined) return
    waiting = false
    // What was read, and no write: left to itself TanStack stores a write that waits for a
    // connection, with everything it was to send, and a start that loads it back cannot send
    // it. A write that must outlive the app is the replica's.
    const state = dehydrate(watched, {
      shouldDehydrateQuery: isKept,
      shouldDehydrateMutation: () => false,
    })
    const stored: Stored = {
      shape,
      at: now(),
      state: { ...state, queries: state.queries.map(asRead) },
    }
    try {
      await AsyncStorage.setItem(key, JSON.stringify(stored))
    } catch {
      // Nothing is kept: the next start reads from the server.
    }
  }

  return {
    restore: async (queries) => {
      let stored: unknown
      try {
        const text = await AsyncStorage.getItem(key)
        stored = text === null ? undefined : JSON.parse(text)
      } catch {
        return
      }
      if (removed || !isStored(stored)) return
      if (stored.shape !== shape) return
      hydrate(queries, stored.state)
    },
    watch: (queries) => {
      watched = queries
      const stop = queries.getQueryCache().subscribe(() => {
        if (removed) return
        waiting = true
        timer ??= setTimeout(() => void write(), writeEvery)
      })
      return () => {
        stop()
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
      }
    },
    remove: async () => {
      removed = true
      waiting = false
      try {
        await AsyncStorage.removeItem(key)
      } catch {
        // There was nothing to remove from a store that cannot be opened.
      }
    },
    flush: async () => {
      if (timer !== undefined) clearTimeout(timer)
      await write()
    },
  }
}

/**
 * Removes what the device kept of `member`'s reads, for a member whose reads are not the ones
 * being written: a sign-in that ended while another profile's was the one on screen.
 */
export async function removeKept(member: string): Promise<void> {
  await createKeep(member).remove()
}
