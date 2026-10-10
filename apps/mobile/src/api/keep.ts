// What the query client read, kept on the device for its member: one entry of the device's
// key-value store a member, named for them, so that a tablet several profiles are signed in to
// keeps each one's apart, and removed with their sign-in however it ends (D-161's twin on a
// device). A device that will not store keeps nothing, and the app reads from the server.
//
// Its own, on the query client's `dehydrate` and `hydrate`, and not TanStack's persister: a
// removal drops the write that was waiting and every write after it, where a throttled write
// would put a member's reads back after they were removed, as at a sign-out; and a store that
// refuses is answered with nothing, where the persister's restore rejects.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import { clientName } from './client.ts'
import { cacheMaxAge, isKept } from './query.ts'

/** How often the reads are written, at most: a burst of changes is one write of the last state. */
export const writeEvery = 1000

/** Where `member`'s reads are kept. An id is written in either case, and is one member's. */
export function keepKey(member: string): string {
  return `household.queries.${member.toLowerCase()}`
}

/** What is stored: the reads, when they were written, and the build that wrote them. */
interface Stored {
  readonly build: string
  readonly at: number
  readonly state: DehydratedState
}

function isStored(value: unknown): value is Stored {
  if (typeof value !== 'object' || value === null) return false
  const stored = value as Partial<Record<keyof Stored, unknown>>
  return (
    typeof stored.build === 'string' &&
    typeof stored.at === 'number' &&
    typeof stored.state === 'object' &&
    stored.state !== null
  )
}

export interface Keep {
  /**
   * Puts what the device kept into `queries`: what was read within the day, by this build. A
   * newer build may read the contract differently, so what an older one kept is dropped rather
   * than shown.
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
  /** The build that writes, and whose reads alone are read back. Left out, this one. */
  readonly build?: string
  readonly now?: () => number
}

/** What the device keeps of `member`'s reads. */
export function createKeep(
  member: string,
  { build = clientName(), now = Date.now }: KeepOptions = {},
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
    const stored: Stored = { build, at: now(), state }
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
      if (stored.build !== build || now() - stored.at > cacheMaxAge) return
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
