// A household's replica, for as long as the household is on screen (plan item 25, ADR 0019,
// ADR 0026): the web client's queued writes, what the server answered them, and the rows that
// say why something left. One tab keeps a household's replica open at a time. Every tab would
// open the household's one database, and each replica runs a connector of its own, so two at
// once would send the same queued writes twice, and one's download would clear the database under
// the other. The tab that holds the household's lock (Web Locks) opens it; another waits, says so
// where the sync UI would be, and takes over when the first lets go.
//
// With the replica comes what the page knows of the connection: whether the browser is online,
// and whether the replica is receiving changes, which with the sync service down and the API up
// it is not, though everything else works (D-105).
import type { RecordedOutcome, Replica } from '@household/sync'
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useApi, useProblems } from '../api/ApiProvider.tsx'
import type { Opened } from './open.ts'

export type ReplicaState =
  /** Being opened, or waiting for its turn at the household's lock with none known to hold it. */
  | { readonly phase: 'opening' }
  /** Open in this tab, and connected or trying to be. */
  | ({ readonly phase: 'open' } & Opened)
  /** Another tab of this browser keeps this household's replica: this one takes over when it lets go. */
  | { readonly phase: 'elsewhere' }
  /** This browser keeps no replica: it has not what one needs, or refused it its storage. */
  | { readonly phase: 'unavailable' }

export interface Sync {
  readonly replica: ReplicaState
  /** Whether the browser says it has a connection. */
  readonly online: boolean
  /**
   * Whether the replica is receiving the household's changes: true while it is connected to the
   * sync service, false once it has tried and is not, and null while that is not yet known or
   * there is no replica to say. False with the browser online is D-105's state.
   */
  readonly receiving: boolean | null
}

const SyncContext = createContext<Sync | null>(null)

function subscribeToConnection(notify: () => void): () => void {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}

/** Whether the browser says it has a connection: what the offline bar is drawn by (A-37). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeToConnection, () => window.navigator.onLine)
}

/** The name of the lock a household's replica is held under, across this browser's tabs. */
export function replicaLock(household: string): string {
  return `household.replica.${household.toLowerCase()}`
}

/** Whether this browser has what a replica needs: the locks, the storage and the workers. */
function supported(): boolean {
  return (
    typeof window.navigator.locks !== 'undefined' &&
    typeof window.indexedDB !== 'undefined' &&
    typeof window.Worker !== 'undefined'
  )
}

export type OpenReplica = (household: string) => Promise<Opened>

export interface ReplicaProviderProps {
  readonly household: string
  readonly children: ReactNode
  /** Opens the household's replica. Left out, the app's own (open.ts); a test gives its own. */
  readonly open?: OpenReplica
}

/** Whether the replica is receiving, read off PowerSync's status. */
function receivingOf(replica: Replica): boolean | null {
  const status = replica.db.currentStatus
  if (status.connected) return true
  // Still at its first attempt, or between two: not yet a thing to say.
  if (status.connecting) return null
  return status.downloadError === undefined && status.hasSynced !== true ? null : false
}

export function ReplicaProvider({ household, children, open }: ReplicaProviderProps) {
  const api = useApi()
  const problems = useProblems()
  const online = useOnline()
  const [held, setHeld] = useState<{ readonly household: string; readonly state: ReplicaState }>({
    household,
    state: { phase: 'opening' },
  })
  // What was opened for another household says nothing of this one.
  const state: ReplicaState = held.household === household ? held.state : { phase: 'opening' }
  const [receiving, setReceiving] = useState<boolean | null>(null)

  useEffect(() => {
    const set = (next: ReplicaState) => {
      setHeld({ household, state: next })
    }
    if (!supported()) {
      set({ phase: 'unavailable' })
      return undefined
    }
    // Read through an object: what is true of it changes under the closures below.
    const left = { over: false }
    const over = () => left.over
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const waiting = new AbortController()
    const name = replicaLock(household)
    const openIt: OpenReplica =
      open ??
      (async (id) =>
        (await import('./open.ts')).openHouseholdReplica({ household: id, api, problems }))

    const hold = async () => {
      // Another tab holding it is said at once, and waited out.
      const { held: taken = [] } = await window.navigator.locks.query()
      if (!over() && taken.some((lock) => lock.name === name)) set({ phase: 'elsewhere' })
      await window.navigator.locks.request(name, { signal: waiting.signal }, async () => {
        if (over()) return
        set({ phase: 'opening' })
        let mine: Opened
        try {
          mine = await openIt(household)
        } catch {
          if (!over()) set({ phase: 'unavailable' })
          return
        }
        const { replica } = mine
        const unlisten = replica.db.registerListener({
          statusChanged: () => {
            if (!over()) setReceiving(receivingOf(replica))
          },
        })
        if (!over()) {
          set({ phase: 'open', ...mine })
          // Connecting is the replica's to keep trying: a sync service that cannot be reached is
          // the state the status says, not a failure to open.
          replica.connect().catch(() => undefined)
          setReceiving(receivingOf(replica))
          // Held until this household is left: the lock is the replica's for as long as it is open.
          await released
        }
        unlisten()
        await replica.close().catch(() => undefined)
      })
    }
    hold().catch(() => {
      // The wait for the lock was given up as the household was left, or the browser refused it.
      if (!over()) set({ phase: 'unavailable' })
    })
    return () => {
      left.over = true
      waiting.abort()
      release()
      setReceiving(null)
    }
  }, [household, api, problems, open])

  const value = useMemo<Sync>(
    () => ({ replica: state, online, receiving: state.phase === 'open' ? receiving : null }),
    [state, online, receiving],
  )
  return <SyncContext value={value}>{children}</SyncContext>
}

/** A fixed state of sync, for a page that draws the sync UI with no replica: the dev pages, a test. */
export function SyncFixture({
  value,
  children,
}: {
  readonly value: Sync
  readonly children: ReactNode
}) {
  return <SyncContext value={value}>{children}</SyncContext>
}

export function useSync(): Sync {
  const sync = use(SyncContext)
  if (sync === null) throw new Error('useSync: no ReplicaProvider above this component')
  return sync
}

/** The household's replica where this tab has it open, and undefined in every other state. */
export function useReplica(): Replica | undefined {
  const { replica } = useSync()
  return replica.phase === 'open' ? replica.replica : undefined
}

/**
 * What needs the member's attention in this household (F-5): each mutation's last answer that
 * does, oldest first. Undefined until the replica is open here and has been read, and in a tab
 * that does not hold it.
 */
export function useInbox(): readonly RecordedOutcome[] | undefined {
  const { replica } = useSync()
  const watch = replica.phase === 'open' ? replica.watchInbox : undefined
  const [read, setRead] = useState<{
    readonly watch: Opened['watchInbox']
    readonly entries: readonly RecordedOutcome[]
  }>()
  useEffect(() => {
    if (watch === undefined) return undefined
    return watch((entries) => {
      setRead({ watch, entries })
    })
  }, [watch])
  // What was read of another replica says nothing of this one.
  return read !== undefined && read.watch === watch ? read.entries : undefined
}
