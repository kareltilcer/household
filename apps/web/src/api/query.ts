// The web app's data layer (06-clients, PL-4): TanStack Query, its cache persisted to IndexedDB so
// that a member who opens the app with no connection reads what they last read. A browser is not
// the offline-first surface: a cold cache is a loading state, and what is kept is kept for a day.
import {
  defaultShouldDehydrateQuery,
  MutationCache,
  notifyManager,
  QueryCache,
  QueryClient,
  useQueryClient,
  type Query,
  type QueryKey,
  type QueryStatus,
} from '@tanstack/react-query'
import type {
  PersistedClient,
  Persister,
  PersistQueryClientOptions,
} from '@tanstack/react-query-persist-client'
import type { ApiProblem, UnreadableProblem } from '@household/api'
import { createStore, del, get, set, type UseStore } from 'idb-keyval'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { isRetryable, problemIn } from './problem.ts'

/** How long a read is kept in this browser, and so how long the cache holds one unobserved. */
export const cacheMaxAge = 24 * 60 * 60 * 1000

/** How often the cache is written, at most: a burst of changes is one write of the last state. */
const writeEvery = 1000

export interface QueryClientOptions {
  /**
   * Told of every problem document a query or a mutation met: where the app reacts to what is
   * about the session and not about one screen, a `400 update_required` or a `403 csrf_failed`.
   */
  readonly onProblem?: (problem: ApiProblem | UnreadableProblem) => void
}

/**
 * Lets go of what `absent` held: the server has just answered that it is not found, and its
 * word stands over what was read before. The query client keeps the last answer through a
 * failure, so left where it was, the next re-read that failed any other way, a server that
 * could not be reached, would leave that answer with no *not found* over it, and whoever read
 * it next would draw it as kept.
 *
 * The read itself stays, emptied: removed, the reader still on it would build it anew at its
 * next render and ask again, be answered *not found* again and removed again, without end.
 * What is filed under its key is left as it is. A household's screens are its readers, under
 * the shell that reads the household, which stops drawing them a turn after this, when the
 * query client tells it: removed under them, one that was drawn again in that turn would build
 * its read anew and ask for it, of a server that has just said nothing there is its reader's.
 * A reader that stands elsewhere, the screen that deletes an account over a household's
 * members, draws by its own read of them, which nothing here changes.
 */
function letGo(absent: Query<unknown, unknown, unknown>): void {
  absent.setState({ data: undefined, dataUpdatedAt: 0 })
}

export function createQueryClient({ onProblem }: QueryClientOptions = {}): QueryClient {
  const report = (error: unknown) => {
    const problem = problemIn(error)
    if (problem !== undefined) onProblem?.(problem)
  }
  return new QueryClient({
    queryCache: new QueryCache({
      // Told once a read has failed for good, its failure already held: what is let go here is
      // gone before anything is drawn of it. By the status, as the shell and a member's page
      // read it (`useNotFound`): a `404` that is no word of the server's empties a read too, and
      // a screen that tells by the code (`useNotTheirs`, household/data.ts) then says the read
      // could not be made, which is so.
      onError: (error, query) => {
        report(error)
        if (query.meta?.letGoWhereNotFound === true && problemIn(error)?.status === 404) {
          letGo(query)
        }
      },
    }),
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
 * the query client holds a write made with no connection in the page and sends it when one
 * returns, and a sign-in completed, a password changed, every device signed out or an account
 * deleted minutes after the press, with nothing on the screen to say it is still to come and
 * nobody there to see it, is not what was asked for. Asked at once it fails at once, and its
 * screen says that the server could not be reached and nothing was changed. Every write of the
 * screens before sign-in and of a member's own account is asked so (auth/, account/), and every
 * write of a household's own screens (household/, D-170).
 */
export const askedNow = { networkMode: 'always' } as const

/** The database the cache is kept in, and the one key it is kept under. */
const database = { name: 'household-web', store: 'query-cache', key: 'client' } as const

/**
 * The cache in IndexedDB, as one structured clone under one key. A browser that refuses storage,
 * in a private window or under a policy, keeps nothing and the app works from the network.
 *
 * Its own, and not TanStack's async-storage persister, for two things that one does not do: a
 * removal drops the write that was waiting, where TanStack's throttle would write a cache back
 * after it was removed, as at a sign-out; and a storage that refuses is answered with nothing,
 * where TanStack's restore and removal reject.
 *
 * `flush` writes what is waiting, now. The app never asks for it, since the cache is not written
 * as the page is hidden (ADR 0025): it is how the persister's tests settle a write without a clock.
 */
export function createPersister(
  store: UseStore = createStore(database.name, database.store),
): Persister & { readonly flush: () => Promise<void> } {
  let pending: PersistedClient | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const write = async () => {
    timer = undefined
    const client = pending
    pending = undefined
    if (client === undefined) return
    try {
      await set(database.key, client, store)
    } catch {
      // Nothing is kept: the next read comes from the network.
    }
  }
  return {
    persistClient: (client) => {
      pending = client
      timer ??= setTimeout(() => void write(), writeEvery)
    },
    restoreClient: async () => {
      try {
        return await get<PersistedClient>(database.key, store)
      } catch {
        return undefined
      }
    },
    removeClient: async () => {
      pending = undefined
      try {
        await del(database.key, store)
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

/** What a query may say of itself, beside its key (TanStack's `meta`). */
export interface QueryNotes extends Record<string, unknown> {
  /**
   * `false` keeps its answer out of this browser's stored cache: what nobody reads again, a
   * search as it is typed, or what is of no use later, a link to a file that is good for minutes.
   * Such a query names its own `gcTime` too, where it should not stay in memory for the day.
   */
  readonly persist?: boolean
  /**
   * `true` has the query client let go of what the read holds as the server answers that it is
   * not found (`letGo`): a read whose *not found* says that nothing of it is its reader's any
   * longer, and whose screen takes down what it drew for that, a household's own
   * (household/households.ts), one member's (household/settings/member.ts), and three of the
   * settings', the invitations (household/data.ts), the storage picture (storage/data.ts) and
   * the clients (health/data.ts). Its screen holds the word until the
   * server answers with what was asked for (`useHeldUntilAnswered`). A read that does not say so
   * keeps its last answer through every failure, a `404` among them: a screen that draws by its
   * read's state until the household's own answer takes it away, billing's, would say *could
   * not be read* for that turn.
   */
  readonly letGoWhereNotFound?: boolean
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: QueryNotes
  }
}

/**
 * `said`, the server's word that `read` is not found, as the screen that heard it draws by it:
 * from when it is said until the server answers with what was asked for. A read holds only its
 * last failure, so the word is read off it no longer once asking again has failed another way;
 * and a read that let go of what it held (`letGoWhereNotFound`) puts its failure away as it is
 * asked for again. It stands through both: a re-read that is on its way, that got no answer, or
 * that the server failed or refused for now, has said nothing of what was asked for, so neither
 * a skeleton nor *could not be read* takes the place of what the server said last, and nothing
 * this browser kept does.
 *
 * It is the state of the screen that heard it. One drawn at the address afterwards heard
 * nothing, and draws by what the read holds, which is why a read whose screen takes down what
 * it drew for the word lets go of it too.
 */
export function useHeldUntilAnswered(
  said: boolean,
  read: { readonly status: QueryStatus },
): boolean {
  const [wasSaid, setWasSaid] = useState(false)
  const answered = read.status === 'success'
  if (said && !wasSaid) setWasSaid(true)
  // Never while it is being said: a caller that said it of a read that is answered would have
  // the two lines undo each other at every render.
  else if (!said && answered && wasSaid) setWasSaid(false)
  return said || (wasSaid && !answered)
}

/**
 * Whether the server's last word of `read` is that it is not found, held until it answers with
 * what was asked for (`useHeldUntilAnswered`). By the status, as the query client lets go by it:
 * so the shell reads a household's `404`, a member's page its member's, and the invitations
 * their list's. The clients and the storage screen tell theirs by the problem's code
 * (`useNotTheirs`, household/data.ts).
 */
export function useNotFound(read: {
  readonly error: unknown
  readonly status: QueryStatus
}): boolean {
  return useHeldUntilAnswered(problemIn(read.error)?.status === 404, read)
}

/**
 * Which answer the read filed under `key` holds: the query's own count of them, which is
 * another each time the read is answered, by the server or by what the page itself keeps
 * there, a write's answer or a change of its own to what it read, and zero for a query that
 * nothing has answered. It is no word on whether the read holds anything: one that was let go
 * of (`letGo`) keeps its count. An answer that says what the last one said draws nothing anew,
 * the query client handing its reader the data it had, so what is to be done again whenever
 * the server has answered reads this: a picture that did not load is asked for again by it
 * (ui/Chip.tsx).
 *
 * By the whole key, and off the cache itself: it is no reader of the read, asks for nothing and
 * keeps nothing there. It is told as the query client tells its own readers, in the turn it
 * tells them in (`batchCalls`): the cache says what changed as it changes, which may be while
 * another component is being drawn.
 */
export function useAnswered(key: QueryKey): number {
  const queries = useQueryClient()
  const subscribe = useCallback(
    (notify: () => void) => queries.getQueryCache().subscribe(notifyManager.batchCalls(notify)),
    [queries],
  )
  return useSyncExternalStore(subscribe, () => queries.getQueryState(key)?.dataUpdateCount ?? 0)
}

/** Whether a query's answer is written to this browser: one that succeeded, unless it says no. */
export function isKept(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && query.meta?.persist !== false
}

/**
 * How the cache is persisted: for a day, and for one build. A new build may read the contract
 * differently, so what an older one kept is dropped rather than shown. A query keeps its answer
 * out of it by saying so (`QueryNotes`).
 *
 * What is kept is what was read, and no write. Left to itself TanStack stores a mutation that
 * waits for a connection, with everything it was to send, a password typed at sign-in among it,
 * and a page that loads it back cannot send it: it has the variables and not the function.
 */
export function persistOptions(
  persister: Persister,
  build: string | undefined,
): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister,
    maxAge: cacheMaxAge,
    buster: build ?? '',
    dehydrateOptions: { shouldDehydrateQuery: isKept, shouldDehydrateMutation: () => false },
  }
}
