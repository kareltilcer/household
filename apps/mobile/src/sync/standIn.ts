// A replica that is none, for the sync UI's dev screen and for the sync UI's own tests: what the
// screens ask of a household's replica (open.ts), answered from memory. No entity the server
// serves is written offline yet, so no real replica has a conflict to show, and the inbox and
// its resolvers are drawn and tested over this. It keeps what was asked of it, in order, and an
// answer the member gave leaves its inbox, as it leaves a replica's. A test moves it as a real
// one moves: a row comes to stand otherwise, and the sync service says something of itself.
//
// It holds the part of `Replica` the screens use, typed as that part, so that a method the
// library changes is a type error here and not a stand-in that quietly answers something else.
// It stands here and not with the dev screens: no file outside them imports one of theirs, and
// the tests beside this file draw over it. No screen of a build a member is served imports it.
import type { RecordedOutcome, Registry, Replica, RowState } from '@household/sync'
import type { Opened } from './open.ts'

type Status = Replica['db']['currentStatus']
type Listener = Parameters<Replica['db']['registerListener']>[0]

/** What the sync UI asks of a replica. */
type Asked = Pick<
  Replica,
  'registry' | 'inbox' | 'retry' | 'discard' | 'resolve' | 'watchRowState' | 'writable' | 'resume'
> & {
  readonly db: Pick<Replica['db'], 'registerListener'> & {
    readonly currentStatus: Pick<Status, 'connected' | 'downloadError'>
  }
}

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
}

export interface StandIn {
  /** It, as the app holds an open replica. */
  readonly opened: Opened
  /**
   * What was asked of it, in order: `retry:<mutation>`, `discard:<mutation>`,
   * `resolve:<mutation>`, `resume`, `close`.
   */
  readonly asked: readonly string[]
  /** Moves a row, and tells whoever watches it. */
  readonly move: (table: string, id: string, state: RowState) => void
  /** What the sync service says of the replica from now on, told to whoever listens, as PowerSync tells. */
  readonly become: (status: Pick<Status, 'connected' | 'downloadError'>) => void
}

/** The key a row's state is kept under. */
export function rowKey(table: string, id: string): string {
  return `${table}/${id}`
}

export function standIn({ registry, entries = [], retry, rows = {} }: StandInOptions): StandIn {
  let inbox: readonly RecordedOutcome[] = entries
  const listeners = new Set<(entries: readonly RecordedOutcome[]) => void>()
  const asked: string[] = []
  const states = new Map<string, RowState>(Object.entries(rows))
  const watchers = new Map<string, Set<(state: RowState) => void>>()
  const listening = new Set<Listener>()
  // Before it has tried: neither connected, nor failed.
  let status: Pick<Status, 'connected' | 'downloadError'> = {
    connected: false,
    downloadError: undefined,
  }

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
    resume: () => {
      asked.push('resume')
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
    db: {
      get currentStatus() {
        return status
      },
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
      close: () => {
        asked.push('close')
        return Promise.resolve()
      },
    },
    asked,
    move: (table, id, state) => {
      tell(rowKey(table, id), state)
    },
    become: (next) => {
      status = next
      // What the provider does on a status is read the replica's own again.
      for (const listener of listening) listener.statusChanged?.(next as Status)
    },
  }
}
