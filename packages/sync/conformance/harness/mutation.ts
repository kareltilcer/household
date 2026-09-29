// A queued write as the push takes it (PRD 03 §2.4). PowerSync's upload queue holds row writes;
// what a mutation carries beyond one, its id, the client time it was made at, the version it
// was made against and any action, is recorded with the write as its `_metadata` when it is made
// (ADR 0001), and joined to the row's changed columns here.

import type { components } from '@household/api'
import { UpdateType, type CrudEntry } from '@powersync/common'
import { tableSpec } from './schema.ts'

export type SyncMutation = components['schemas']['SyncMutation']
export type SyncMutationResult = components['schemas']['SyncMutationResult']
export type SyncMutationBatchResult = components['schemas']['SyncMutationBatchResult']
export type Outcome = SyncMutationResult['outcome']

/** What a write records beside its row, as JSON in its `_metadata` column. */
export interface WriteMetadata {
  readonly mutation_id: string
  /** The client's clock when the write was made: its own, skewed as the client's is. */
  readonly client_time: string
  /** The row's version when the write was made; absent on a create. */
  readonly base_version?: number
  readonly action?: string
  /** Fields the mutation carries that the row write does not, such as a state_set's key. */
  readonly fields?: Readonly<Record<string, unknown>>
}

export function encodeMetadata(meta: WriteMetadata): string {
  return JSON.stringify(meta)
}

function decodeMetadata(entry: Pick<CrudEntry, 'metadata' | 'table' | 'id'>): WriteMetadata {
  if (entry.metadata === undefined || entry.metadata === '') {
    throw new Error(`a write to ${entry.table} ${entry.id} carries no metadata: every write the suite makes records its mutation`)
  }
  const meta = JSON.parse(entry.metadata) as Partial<WriteMetadata>
  if (typeof meta.mutation_id !== 'string' || typeof meta.client_time !== 'string') {
    throw new Error(`the metadata of a write to ${entry.table} ${entry.id} names no mutation id or client time`)
  }
  return meta as WriteMetadata
}

/** The part of a queued write this module reads. */
export type QueuedWrite = Pick<CrudEntry, 'op' | 'table' | 'id' | 'opData' | 'metadata'>

/**
 * The mutation a queued write stands for: a PUT creates, a PATCH updates (or acts, when its
 * metadata names an action), a DELETE deletes. Its fields are the columns the client writes that
 * the write changed, with a boolean column as a boolean, and the fields its metadata adds.
 */
export function toMutation(entry: QueuedWrite): SyncMutation {
  const spec = tableSpec(entry.table)
  if (spec.entity === null) throw new Error(`${entry.table} is a projection, which no client writes`)
  const meta = decodeMetadata(entry)
  const fields: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(entry.opData ?? {})) {
    if (!spec.writes.includes(name)) continue
    fields[name] = spec.columns[name] === 'boolean' ? value === 1 || value === true : value
  }
  Object.assign(fields, meta.fields ?? {})
  const op: SyncMutation['op'] =
    entry.op === UpdateType.PUT ? 'create' : entry.op === UpdateType.DELETE ? 'delete' : meta.action !== undefined ? 'action' : 'update'
  return {
    mutation_id: meta.mutation_id,
    entity_type: spec.entity,
    entity_id: entry.id,
    op,
    base_version: meta.base_version ?? null,
    action: meta.action ?? null,
    fields,
    client_time: meta.client_time,
  }
}

/** The outcomes that end a mutation (PRD 10 §4, invariant 6); `deferred` does not. */
export const terminal: ReadonlySet<Outcome> = new Set(['applied', 'merged', 'conflict', 'rejected'])

/**
 * Whether a rejection is the household's entitlement refusing it (FR-BI2), which is held and
 * replayed rather than ended: PRD 10 §4's scenario 14 names the code `entitlement`, and the
 * contract's problem codes spell the household's states `entitlement_read_only` and
 * `entitlement_restricted`. Item 18 settles which a mutation carries.
 */
export function isEntitlement(code: string | null | undefined): boolean {
  return code === 'entitlement' || (code?.startsWith('entitlement_') ?? false)
}
