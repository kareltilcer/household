// Where a row stands, for a module's own screens (F-8, F-9, 06-clients §5): the state the replica
// computes for it (ADR 0019), the mark it carries, the sentence that stands in its place once it
// has been withdrawn, and the sentence for a write this browser may not make offline (D-84).
//
// A row in sync carries no mark: the absence of one is that state. A merge is no mark either: it
// is a banner (KeptLoser.tsx). A row that left because access changed is not an error, not an
// empty state and not somebody else's deletion: one of two sentences says which of the two
// causes it was, without naming what was withdrawn, and neither says the data was recalled
// everywhere, since a device that never reconnects keeps its copy (FR-SY8).
import type { Translate } from '@household/i18n/lazy'
import type { RowState } from '@household/sync'
import { useCallback, useEffect, useState } from 'react'
import type { StateText } from '../ui/StateFrame.tsx'
import type { SyncState } from '../ui/StatusMark.tsx'
import { useReplica, useSync } from './ReplicaProvider.tsx'

export interface WatchedRow {
  /**
   * Where the row stands. Undefined until the replica has said, and in a tab that does not hold
   * the household's replica, which has nothing to say of any row.
   */
  readonly state: RowState | undefined
  /**
   * When its write began to sync, as `Date.now()` counts, while it is syncing: what a mark's
   * `since` and a row's `syncingSince` take, so that the moment a sync is given before it is
   * shown is counted from the write and not from when the row was drawn.
   */
  readonly since: number | undefined
}

interface Read {
  readonly watch: unknown
  readonly table: string
  readonly id: string
  readonly state: RowState
  readonly since: number | undefined
}

/** The state of `table`'s row `id` in this household's replica, now and as it moves. */
export function useRowState(table: string, id: string): WatchedRow {
  const replica = useReplica()
  const [read, setRead] = useState<Read>()
  useEffect(() => {
    if (replica === undefined) return undefined
    return replica.watchRowState(table, id, (state) => {
      // The library dates nothing: the move to syncing is dated here, as it is told of, and a
      // sync that is told of again, its write another, keeps the time it began.
      const now = Date.now()
      setRead((was) => {
        const same =
          was !== undefined && was.watch === replica && was.table === table && was.id === id
        const since =
          state.kind !== 'syncing'
            ? undefined
            : same && was.state.kind === 'syncing'
              ? was.since
              : now
        return { watch: replica, table, id, state, since }
      })
    })
  }, [replica, table, id])
  // What was read of another row, or of another replica, says nothing of this one.
  const mine =
    read !== undefined && read.watch === replica && read.table === table && read.id === id
      ? read
      : undefined
  return { state: mine?.state, since: mine?.since }
}

/**
 * The sync mark a row in `state` carries (ui/StatusMark), or none: a row in sync, one that
 * merged, one that was withdrawn and one this replica does not hold carry no mark.
 */
export function markOf(state: RowState | undefined): SyncState | undefined {
  switch (state?.kind) {
    case 'pending':
    case 'syncing':
    case 'conflict':
    case 'rejected':
      return state.kind
    default:
      return undefined
  }
}

/** Why a row left this replica, as the library tells the two causes apart. */
export type WithdrawnReason = Extract<RowState, { readonly kind: 'withdrawn' }>['reason']

/**
 * The sentence that stands where a withdrawn row was (F-9), as `StateFrame`'s `texts.withdrawn`:
 * that the member's access changed, or that the module was turned off for the household, whose
 * data is kept. Its screen adds the way out to the nearest surface the member still has.
 */
export function withdrawnText(t: Translate, reason: WithdrawnReason): StateText {
  return { text: t(reason === 'module' ? 'sync.withdrawn.module' : 'sync.withdrawn.access') }
}

/**
 * Tells whether an error a write threw is the library's refusal of a write to an entity that is
 * not written offline (D-84), which a screen answers with `needsConnectionText` and no failure:
 * nothing was changed. A screen asks here, and never imports the library to ask it
 * (`instanceof` needs the class, and the class is the download a page makes only when a replica
 * is opened, open.ts). `replica.writable(table)` asks ahead, where a screen would rather not
 * draw the control at all.
 */
export function useNeedsConnection(): (error: unknown) => boolean {
  const { replica } = useSync()
  const asks = replica.phase === 'open' ? replica.needsConnection : undefined
  return useCallback((error: unknown) => asks?.(error) ?? false, [asks])
}

/** What a write that needs a connection says, in place of the change it did not make (D-84). */
export function needsConnectionText(t: Translate): string {
  return t('sync.needs_connection')
}
