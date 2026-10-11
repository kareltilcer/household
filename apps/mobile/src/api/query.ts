// The app's data layer for what is read from the server and is no part of a replica (06-clients,
// PL-4): TanStack Query, by the web's rules. The account, the member's households and a
// household's own answer are read through it, and kept on the device for as long as their
// member's sign-in (keep.ts), so that the app opens with no connection at the household it was
// last in, however long ago that was. A module's own rows are the replica's, which is the
// offline surface: nothing here stands in for it.
import { isAbsent, type ApiProblem, type UnreadableProblem } from '@household/api'
import NetInfo from '@react-native-community/netinfo'
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryCache,
  QueryClient,
  type FetchStatus,
  type Query,
} from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { isRetryable, problemIn } from './problem.ts'

export interface QueryClientOptions {
  /**
   * Told of every problem document a query or a mutation met: where the app reacts to what is
   * about the app and not about one screen, a `400 update_required`.
   */
  readonly onProblem?: (problem: ApiProblem | UnreadableProblem) => void
}

/**
 * Lets go of what `absent` held, and of every read filed under its key: the API's own *not
 * found* has just answered it, and the server's word stands over what was read before. The
 * query client keeps the last answer through a failure, so left where it was, the next re-read
 * that failed any other way, a server that could not be reached, would leave that answer with
 * no *not found* over it: drawn again as kept, and written to the device again (`isKept`).
 *
 * The read itself stays, emptied: removed, the reader still on it would build it anew at its
 * next render and ask again, be answered *not found* again and removed again, without end.
 * What is filed under it is removed: emptied where it stands it would be a success that holds
 * nothing, which the query client has no meaning for, and its readers stand under the reader
 * of the read that is gone, which stops drawing them. One that is read from elsewhere asks
 * again at its next render, and is answered for itself.
 */
function letGo(cache: QueryCache, absent: Query<unknown, unknown, unknown>): void {
  for (const query of cache.findAll({ queryKey: absent.queryKey })) {
    if (query.queryHash === absent.queryHash) absent.setState({ data: undefined, dataUpdatedAt: 0 })
    else cache.remove(query)
  }
}

export function createQueryClient({ onProblem }: QueryClientOptions = {}): QueryClient {
  const report = (error: unknown) => {
    const problem = problemIn(error)
    if (problem !== undefined) onProblem?.(problem)
  }
  const queryCache: QueryCache = new QueryCache({
    // Told once a read has failed for good, its failure already held: what is let go here is
    // gone before anything is drawn or written of it.
    onError: (error, query) => {
      report(error)
      const problem = problemIn(error)
      if (problem !== undefined && isAbsent(problem)) letGo(queryCache, query)
    },
  })
  return new QueryClient({
    queryCache,
    mutationCache: new MutationCache({ onError: report }),
    defaultOptions: {
      queries: {
        // A read is held for as long as its member's sign-in, on screen or not: what is
        // written to the device is what the cache holds (keep.ts), so one let go after a day,
        // the web's rule, would be written out of the device with it, and another household's
        // own answer could not be opened with no connection by an app left running overnight.
        // The cache is emptied with its member (session/SessionProvider.tsx).
        gcTime: Infinity,
        // A problem the server stated is its answer, and only one that may yet clear is asked
        // again: its own failure, and a first attempt still running. A request that got no
        // answer is not: the transport has already resent it twice (retryingFetch), and asked
        // twice more from here it would be nine requests, and several seconds, before a member
        // is told the server cannot be reached. Nor is an error that is no answer at all.
        retry: (failures, error) =>
          failures < 2 && problemIn(error) !== undefined && isRetryable(error),
      },
      // An unsafe request is resent by the transport alone, with the key it left with.
      mutations: { retry: false },
    },
  })
}

/**
 * How a write that must not wait is asked: at once, connection or none (D-164). Left to itself
 * the query client holds a write made with no connection and sends it when one returns, and a
 * sign-in completed, a device registered for notifications or a household's setting changed
 * minutes after the press, with nothing on the screen to say it is still to come and nobody
 * there to see it, is not what was asked for. Asked at once it fails at once, and its screen
 * says that the server could not be reached and nothing was changed. Every write that is no part
 * of a replica is asked so, and a test holds each to it (askedNow.test.ts): a write that should
 * wait for a connection is the replica's, which keeps it across a restart and says that it
 * waits.
 */
export const askedNow = { networkMode: 'always' } as const

/** What a query may say of itself, beside its key (TanStack's `meta`). */
export interface QueryNotes extends Record<string, unknown> {
  /**
   * `false` keeps its answer out of what this device keeps: what nobody reads again, or what is
   * of no use later, a link to a file that is good for minutes. Such a query names its own
   * `gcTime` too: left to the default it stays in memory for as long as its member's sign-in.
   */
  readonly persist?: boolean
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: QueryNotes
  }
}

/**
 * Whether what a query holds is written to this device: the last answer it was given, unless it
 * says no, and whatever became of asking again but for one thing. A re-read that got no answer,
 * or that the server failed or refused for now, says nothing of what was read: dropped for it,
 * as TanStack's own rule drops whatever is not a success, an app opened once while the server
 * was away would write out everything the device kept, and open on nothing at its next start
 * with no connection. The server's own word that the thing is not there for this caller, the
 * API's `404`, is its answer, and stands over what was kept (household/data.ts): the query
 * client lets go of what such a read held as it is answered (`letGo`), so a failure of another
 * kind after it finds nothing to keep.
 */
export function isKept(query: Query): boolean {
  if (query.state.data === undefined || query.meta?.persist === false) return false
  const problem = problemIn(query.state.error)
  return problem === undefined || !isAbsent(problem)
}

/**
 * Tells the query client when the app is looked at again: on a device that is the app coming to
 * the front, which is when a read that has gone stale is asked for again, the account's every
 * time. It answers with what stops it.
 */
export function watchFocus(): () => void {
  const subscription = AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active')
  })
  return () => {
    subscription.remove()
  }
}

/**
 * Tells the query client whether the device has a connection, as the device says and at each
 * change. Told that it has none, a read is not sent: it waits, which a screen draws as could
 * not be read where nothing is kept of it (household/data.ts, `readState`), and it is asked
 * when a connection returns. A write left to the query client would wait the same way, unseen,
 * which is what `askedNow` is for.
 *
 * The device is believed in one direction only: one that says it has no connection has none.
 * One that does not know yet, as it starts, or that has a network with nothing behind it, is
 * taken to have one, and a request that then fails says so itself. Whether the internet can be
 * reached is not asked: what the device says of that it works out by asking a host that is none
 * of the app's. It answers with what stops it, after which the query client is told nothing
 * and takes it that there is a connection.
 *
 * This is the app's one listener to the device, started with the app (session/Providers.tsx):
 * the device tells whoever starts listening what it knows now, and then of each change, so by
 * the time a household is drawn the answer is the device's. A screen reads it with `useOnline`.
 */
export function watchConnection(): () => void {
  const stop = NetInfo.addEventListener((state) => {
    onlineManager.setOnline(state.isConnected !== false)
  })
  return () => {
    stop()
    onlineManager.setOnline(true)
  }
}

/**
 * Whether a read that holds nothing could not be made: it failed, or it was asked with no
 * connection and waits for one, which is neither loading nor failed. To a member the two are
 * the same, and it is said so: no skeleton stands for a read that is not on its way. Every
 * reader that has something to draw in a read's place asks this, and none decides it again.
 */
export function couldNotBeRead(read: {
  readonly isError: boolean
  readonly fetchStatus: FetchStatus
}): boolean {
  return read.isError || read.fetchStatus === 'paused'
}

const hearConnection = (notify: () => void) => onlineManager.subscribe(notify)
const hasConnection = () => onlineManager.isOnline()

/**
 * Whether the device says it has a connection, as the query client was told (`watchConnection`):
 * what the offline bar is drawn by (A-37), and what a body that is read from the server calls
 * offline (household/data.ts, `readState`). One word for both, so a read that waits for a
 * connection and the bar that says there is none never disagree. With the sync service alone
 * away it is still true, and the replica's own status says that (D-105).
 */
export function useOnline(): boolean {
  return useSyncExternalStore(hearConnection, hasConnection)
}
