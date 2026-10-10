// A household's replica, for as long as the household is on screen (plan item 28, ADR 0019): the
// member's own copy of it on this device, which is what they read with no connection, where
// their changes wait, what the server answered them, and the rows that say why something left.
// The web's is its twin (apps/web/src/sync/ReplicaProvider.tsx), less what a browser's tabs
// ask of it: a device runs the app once, so nothing here waits on another holder.
//
// It stands around a household's frame (shell/HouseholdLayout.tsx), above whatever reads the
// household, so it opens nothing on the address's word alone: a replica is opened for a member,
// of a household the server, or what the device kept of its answer, says is theirs. An address
// that opens nothing for them makes no file.
//
// With the replica comes what the app knows of the connection: whether the device says it has
// one, and whether the replica is receiving changes, which with the sync service down and the
// API up it is not, though everything else works (D-105). The replica connects as it is opened
// and keeps trying by itself: nothing here tells it to connect again.
import type { RecordedOutcome, Replica } from '@household/sync'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useProblems } from '../api/ApiProvider.tsx'
import { useHousehold } from '../household/data.ts'
import { useSession } from '../session/context.ts'
import { useOnline } from './online.ts'
import { openHouseholdReplica, type Opened } from './open.ts'

export type ReplicaState =
  /** Being opened, or not yet known to be the member's to open. */
  | { readonly phase: 'opening' }
  /** Open on this device, and connected or trying to be. */
  | ({ readonly phase: 'open' } & Opened)
  /** This device could not open its copy. `retry` asks it to once more: there is no page to reload. */
  | { readonly phase: 'unavailable'; readonly retry: () => void }

export interface Sync {
  readonly replica: ReplicaState
  /** Whether the device says it has a connection. */
  readonly online: boolean
  /**
   * Whether the replica is receiving the household's changes: true while it is connected to the
   * sync service, false once it has tried and is not, and null while that is not yet known or
   * there is no replica to say. False with the device online is D-105's state.
   */
  readonly receiving: boolean | null
}

const SyncContext = createContext<Sync | null>(null)

/** Opens `member`'s replica of `household`, connected or trying to be. */
export type OpenReplica = (member: string, household: string) => Promise<Opened>

export interface ReplicaProviderProps {
  /** The household in the address, which may be no household's id at all. */
  readonly household: string
  readonly children: ReactNode
  /** Opens the replica. Left out, the app's own (open.ts); a test gives its own. */
  readonly open?: OpenReplica
}

/**
 * Whether the replica is receiving, read off PowerSync's status. It is not once an attempt of
 * its has failed, and the SDK keeps that failure through every attempt after it, until one
 * succeeds. Before that there is nothing to say: a replica opened again has synced before and
 * has not tried yet, and one at its first attempt has not failed. Never read off `connecting`,
 * which every attempt is, nor off `hasSynced`.
 */
function receivingOf(replica: Replica): boolean | null {
  const status = replica.db.currentStatus
  if (status.connected) return true
  return status.downloadError === undefined ? null : false
}

interface Held {
  /** Whose replica of which household this says something of, and which attempt at opening it. */
  readonly of: string
  readonly attempt: number
  readonly state: ReplicaState
  readonly receiving: boolean | null
}

const opening: ReplicaState = { phase: 'opening' }

export function ReplicaProvider({ household, children, open }: ReplicaProviderProps) {
  const problems = useProblems()
  const { state: session, credential } = useSession()
  const online = useOnline()
  const read = useHousehold(household)
  const member = session.status === 'member' ? session.me.id.toLowerCase() : null
  // The member's, by the server's word or by what the device kept of it.
  const theirs = member !== null && read.status === 'read' ? household.toLowerCase() : null
  const of = member === null || theirs === null ? null : `${member}/${theirs}`

  const [held, setHeld] = useState<Held | null>(null)
  // What a member asked to be tried once more: each press opens anew.
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setAttempt((tried) => tried + 1)
  }, [])

  useEffect(() => {
    if (member === null || theirs === null) return undefined
    const mine = `${member}/${theirs}`
    // Read through an object: what is true of it changes under the closures below.
    const left = { over: false }
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const openIt: OpenReplica =
      open ??
      ((who, which) =>
        openHouseholdReplica({ member: who, household: which, problems, credential }))

    // The replica, for as long as this household is the one on screen: opened, and let go again.
    const keep = async () => {
      let opened: Opened
      try {
        opened = await openIt(member, theirs)
      } catch {
        if (!left.over) {
          setHeld({ of: mine, attempt, state: { phase: 'unavailable', retry }, receiving: null })
        }
        return
      }
      const { replica } = opened
      // One state for as long as it is open: what reads the replica is not drawn anew each
      // time the sync service says something of itself.
      const state: ReplicaState = { phase: 'open', ...opened }
      const say = () => {
        if (left.over) return
        const receiving = receivingOf(replica)
        setHeld((was) =>
          was?.state === state && was.receiving === receiving
            ? was
            : { of: mine, attempt, state, receiving },
        )
      }
      const unlisten = replica.db.registerListener({ statusChanged: say })
      if (!left.over) {
        say()
        await released
      }
      unlisten()
      await opened.close().catch(() => undefined)
    }
    void keep()
    return () => {
      left.over = true
      release()
    }
  }, [member, theirs, problems, credential, open, attempt, retry])

  // What was opened for another member or another household says nothing of this one, and
  // neither does what an attempt before this one came to.
  const mine = held !== null && held.of === of && held.attempt === attempt ? held : null
  const state = mine?.state ?? opening
  const receiving = mine?.state.phase === 'open' ? mine.receiving : null
  const value = useMemo<Sync>(
    () => ({ replica: state, online, receiving }),
    [state, online, receiving],
  )
  return <SyncContext value={value}>{children}</SyncContext>
}

/** A fixed state of sync, for a screen that draws the sync UI with no replica: a dev screen, a test. */
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

/** The household's replica where it is open here, and undefined in every other state. */
export function useReplica(): Replica | undefined {
  const { replica } = useSync()
  return replica.phase === 'open' ? replica.replica : undefined
}

/**
 * What needs the member's attention in this household (F-5): each mutation's last answer that
 * does, oldest first. Undefined until the replica is open and has been read.
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
