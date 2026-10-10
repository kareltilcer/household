// A replica that is none, for the dev page of the sync UI, for the sync UI's own tests and for
// those of a household's sync health: what the screens ask of a household's replica
// (sync/open.ts), answered from memory. No entity the server serves is written offline yet (plan
// item 25), so no real replica has a conflict to show, and the inbox and its resolvers are drawn
// and tested over this. It keeps what was asked of it, in order, and an answer the member gave
// leaves its inbox, as it leaves a replica's. A test moves it as a real one moves: a row comes to
// stand otherwise, the replica catches up, something is queued, it reports, and it tells whoever
// listens to its status.
//
// It holds the part of `Replica` the screens use, typed as that part, so that a method the
// library changes is a type error here and not a stand-in that quietly answers something else.
import type {
  Held,
  RecordedOutcome,
  Registry,
  Replica,
  ReplicaDigestVerdict,
  RowState,
} from '@household/sync'
import type { Opened } from '../../sync/open.ts'

/** What the sync UI asks of a replica, and the screens of a household's sync health. */
type Asked = Pick<
  Replica,
  | 'registry'
  | 'inbox'
  | 'retry'
  | 'discard'
  | 'resolve'
  | 'watchRowState'
  | 'writable'
  | 'id'
  | 'queued'
  | 'held'
  | 'outcomes'
  | 'report'
  | 'caughtUp'
> & {
  readonly db: Pick<Replica['db'], 'registerListener'>
}

type Listener = Parameters<Replica['db']['registerListener']>[0]
type Status = Replica['db']['currentStatus']

/** What a write the stand-in refuses throws: its own, as the library's is the library's. */
export class StandInNeedsConnection extends Error {}

export interface StandInOptions {
  readonly registry: Registry
  /** What its inbox holds to begin with, oldest first. */
  readonly entries?: readonly RecordedOutcome[]
  /**
   * Whether a retry of a mutation writes. Left out, every one does; one that answers false is a
   * row the replica no longer holds, and one that throws a database that failed.
   */
  readonly retry?: (mutationId: string) => boolean
  /** Where its rows stand to begin with, by `rowKey`. A row that is not here is absent. */
  readonly rows?: Readonly<Record<string, RowState>>
  /** The id it reports under. */
  readonly id?: string
  /** Whether it has caught up to begin with: it has, unless a test says it is still connecting. */
  readonly caughtUp?: boolean
  /** How many writes wait in its upload queue to begin with. */
  readonly queued?: number
  /** How many mutations it holds to send again. */
  readonly held?: number
  /** Every answer it recorded, the settled ones among them. */
  readonly outcomes?: readonly RecordedOutcome[]
  /**
   * What the server answers its report: told once for each, it answers the verdict, null for a
   * report the server did not take, or throws for one that got no answer.
   */
  readonly onReport?: () => ReplicaDigestVerdict | null
  /** Whether its database fails under every question of what it is and what it holds. */
  readonly broken?: boolean
}

export interface StandIn {
  /** It, as the app holds an open replica. */
  readonly opened: Opened
  /** What was asked of it, in order: `retry:<mutation>`, `discard:<mutation>`, `resolve:<mutation>`. */
  readonly asked: readonly string[]
  /** Moves a row, and tells whoever watches it. */
  readonly move: (table: string, id: string, state: RowState) => void
  /** How many times it was asked to report. */
  readonly reports: () => number
  /** Moves the replica itself, and tells whoever listens to its status, as PowerSync does. */
  readonly become: (to: { readonly caughtUp?: boolean; readonly queued?: number }) => void
}

/** The key a row's state is kept under. */
export function rowKey(table: string, id: string): string {
  return `${table}/${id}`
}

/** The id it reports under where a test names none. */
const ownId = '0190a000-0000-7000-8000-0000000000d1'

const matched: ReplicaDigestVerdict = { matched: true, resnapshot_required: false, entries: [] }

/** A mutation held to send again, with what the member wrote in it. */
const heldMutation: Held = {
  reason: 'entitlement',
  mutation: {
    mutation_id: '0190a000-0000-7000-8000-0000000000f8',
    entity_type: 'shopping.item',
    entity_id: '0190a000-0000-7000-8000-0000000000f9',
    op: 'create',
    client_time: '2026-09-08T16:20:00Z',
    fields: { name: 'Kvasnice' },
  },
}

export function standIn({
  registry,
  entries = [],
  retry,
  rows = {},
  id = ownId,
  caughtUp = true,
  queued = 0,
  held = 0,
  outcomes = [],
  onReport = () => matched,
  broken = false,
}: StandInOptions): StandIn {
  let inbox: readonly RecordedOutcome[] = entries
  const listeners = new Set<(entries: readonly RecordedOutcome[]) => void>()
  const asked: string[] = []
  const states = new Map<string, RowState>(Object.entries(rows))
  const watchers = new Map<string, Set<(state: RowState) => void>>()
  const status = { caughtUp, queued, reports: 0 }
  const listening = new Set<Listener>()

  const tell = (key: string, state: RowState) => {
    states.set(key, state)
    for (const watcher of watchers.get(key) ?? []) watcher(state)
  }

  /** The member answered a mutation: it leaves the inbox, and the row it marked is in sync. */
  const settle = (mutationId: string) => {
    inbox = inbox.filter((entry) => entry.mutation_id !== mutationId)
    for (const listener of listeners) listener(inbox)
    for (const [key, state] of states) {
      if ('outcome' in state && state.outcome.mutation_id === mutationId) {
        tell(key, { kind: 'synced', deleted: false })
      }
    }
  }

  /** What its database answers a question of itself with, where it has not failed. */
  const answered = <T>(answer: () => T): Promise<T> =>
    broken ? Promise.reject(new Error('the database is closed')) : Promise.resolve(answer())

  const replica: Asked = {
    registry,
    writable: (table) =>
      Object.values(registry.entities).some(
        (entity) => entity.table === table && entity.offline_writes,
      ),
    inbox: () => Promise.resolve([...inbox]),
    retry: (mutationId) => {
      asked.push(`retry:${mutationId}`)
      try {
        const wrote = retry?.(mutationId) ?? true
        if (wrote) settle(mutationId)
        return Promise.resolve(wrote)
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
    discard: (mutationId) => {
      asked.push(`discard:${mutationId}`)
      settle(mutationId)
      return Promise.resolve()
    },
    resolve: (mutationId) => {
      asked.push(`resolve:${mutationId}`)
      settle(mutationId)
      return Promise.resolve()
    },
    watchRowState: (table, id, onChange) => {
      const key = rowKey(table, id)
      const watching = watchers.get(key) ?? new Set()
      watchers.set(key, watching)
      watching.add(onChange)
      onChange(states.get(key) ?? { kind: 'absent' })
      return () => {
        watching.delete(onChange)
      }
    },
    id: () => answered(() => id),
    queued: () => answered(() => status.queued),
    held: () => answered(() => Array.from({ length: held }, () => heldMutation)),
    outcomes: () => answered(() => [...outcomes]),
    report: () => {
      status.reports += 1
      // As the library: a replica with a write queued reports nothing.
      if (status.queued > 0) return Promise.resolve(null)
      try {
        return Promise.resolve(onReport())
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
    get caughtUp() {
      return status.caughtUp
    },
    db: {
      registerListener: (listener) => {
        listening.add(listener)
        return () => {
          listening.delete(listener)
        }
      },
    },
  }

  return {
    opened: {
      // The part the screens use is all there is of it.
      replica: replica as Replica,
      needsConnection: (error) => error instanceof StandInNeedsConnection,
      watchInbox: (listener) => {
        listeners.add(listener)
        listener(inbox)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    asked,
    move: (table, id, state) => {
      tell(rowKey(table, id), state)
    },
    reports: () => status.reports,
    become: (to) => {
      Object.assign(status, to)
      // What the screens do on a status is ask the replica again: the status itself is not read.
      for (const listener of listening) listener.statusChanged?.({} as Status)
    },
  }
}
