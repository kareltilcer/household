// The app's data layer for what is read from the server and is no part of a replica (06-clients,
// PL-4): TanStack Query, by the web's rules. The account, the member's households and a
// household's own answer are read through it, and kept on the device for a day (keep.ts), so
// that the app opens with no connection at the household it was last in. A module's own rows
// are the replica's, which is the offline surface: nothing here stands in for it.
import type { ApiProblem, UnreadableProblem } from '@household/api'
import NetInfo from '@react-native-community/netinfo'
import {
  defaultShouldDehydrateQuery,
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

/** How long a read is kept on this device, and so how long the cache holds one unobserved. */
export const cacheMaxAge = 24 * 60 * 60 * 1000

export interface QueryClientOptions {
  /**
   * Told of every problem document a query or a mutation met: where the app reacts to what is
   * about the app and not about one screen, a `400 update_required`.
   */
  readonly onProblem?: (problem: ApiProblem | UnreadableProblem) => void
}

export function createQueryClient({ onProblem }: QueryClientOptions = {}): QueryClient {
  const report = (error: unknown) => {
    const problem = problemIn(error)
    if (problem !== undefined) onProblem?.(problem)
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError: report }),
    mutationCache: new MutationCache({ onError: report }),
    defaultOptions: {
      queries: {
        gcTime: cacheMaxAge,
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
   * `gcTime` too, where it should not stay in memory for the day.
   */
  readonly persist?: boolean
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: QueryNotes
  }
}

/** Whether a query's answer is written to this device: one that succeeded, unless it says no. */
export function isKept(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && query.meta?.persist !== false
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
