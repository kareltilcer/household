// The web app's data layer (06-clients, PL-4): TanStack Query, its cache persisted to IndexedDB so
// that a member who opens the app with no connection reads what they last read. A browser is not
// the offline-first surface: a cold cache is a loading state, and what is kept is kept for a day.
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import type {
  PersistedClient,
  Persister,
  PersistQueryClientOptions,
} from '@tanstack/react-query-persist-client'
import type { ApiProblem, UnreadableProblem } from '@household/api'
import { createStore, del, get, set, type UseStore } from 'idb-keyval'
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
        // The transport already resends a request whose response was lost (retryingFetch). A
        // problem the server stated is its answer: only what may yet succeed is asked again.
        retry: (failures, error) => failures < 2 && isRetryable(error),
      },
      // An unsafe request is resent by the transport alone, with the key it left with.
      mutations: { retry: false },
    },
  })
}

/** The database the cache is kept in, and the one key it is kept under. */
const database = { name: 'household-web', store: 'query-cache', key: 'client' } as const

/**
 * The cache in IndexedDB, as one structured clone under one key. A browser that refuses storage,
 * in a private window or under a policy, keeps nothing and the app works from the network.
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

/**
 * How the cache is persisted: for a day, and for one build. A new build may read the contract
 * differently, so what an older one kept is dropped rather than shown.
 */
export function persistOptions(
  persister: Persister,
  build: string | undefined,
): Omit<PersistQueryClientOptions, 'queryClient'> {
  return { persister, maxAge: cacheMaxAge, buster: build ?? '' }
}
