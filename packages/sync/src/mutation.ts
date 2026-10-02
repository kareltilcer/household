// A queued write as the push takes it (PRD 03 §2.4). PowerSync's upload queue holds row writes;
// what a mutation carries beyond one, its id, the client time it was made at, the version it was made
// against and any action, is recorded with the write as its `_metadata` when it is made (ADR 0001),
// and joined to the row's changed columns here.

import type { components } from '@household/api'
import { UpdateType, type CrudEntry } from '@powersync/common'
import { entityOf, tableOf, type Kind, type Registry } from './registry.ts'

export type SyncMutation = components['schemas']['SyncMutation']
export type SyncMutationResult = components['schemas']['SyncMutationResult']
export type SyncMutationBatchResult = components['schemas']['SyncMutationBatchResult']
export type Outcome = SyncMutationResult['outcome']

/** What a write records beside its row, as JSON in its `_metadata` column. */
export interface WriteMetadata {
  readonly mutation_id: string
  /** The client's clock when the write was made. */
  readonly client_time: string
  /** The row's version when the write was made; absent on a create, and on a row the server has not answered yet. */
  readonly base_version?: number
  readonly action?: string
  /**
   * Fields the mutation carries that the row write does not: a state_set's key, and its state, which
   * a row write leaves out when the replica already held it.
   */
  readonly fields?: Readonly<Record<string, unknown>>
  /**
   * Columns the write set for the replica alone, which the mutation does not carry: what the server
   * sets itself and the member's device shows until the server's row arrives.
   */
  readonly local?: readonly string[]
}

/** The columns every entity's row has, which only the server writes (add_entity_columns). */
export const serverColumns: ReadonlySet<string> = new Set([
  'household_id',
  'version',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'deleted_at',
])

export function encodeMetadata(meta: WriteMetadata): string {
  return JSON.stringify(meta)
}

export function decodeMetadata(entry: Pick<CrudEntry, 'metadata' | 'table' | 'id'>): WriteMetadata {
  if (entry.metadata === undefined || entry.metadata === '') {
    throw new Error(
      `a write to ${entry.table} ${entry.id} carries no metadata: every write through the library records its mutation`,
    )
  }
  const meta = JSON.parse(entry.metadata) as Partial<WriteMetadata>
  if (typeof meta.mutation_id !== 'string' || typeof meta.client_time !== 'string') {
    throw new Error(
      `the metadata of a write to ${entry.table} ${entry.id} names no mutation id or client time`,
    )
  }
  return meta as WriteMetadata
}

/** The part of a queued write this module reads. */
export type QueuedWrite = Pick<CrudEntry, 'op' | 'table' | 'id' | 'opData' | 'metadata'>

/**
 * A value of kind as a replica stores it: a boolean as 0 or 1, an array and a JSON value as their
 * JSON text, the rest as they are.
 */
export function toStored(kind: Kind | undefined, value: unknown): unknown {
  if (value === null || value === undefined) return null
  switch (kind) {
    case 'boolean':
      return value === true ? 1 : value === false ? 0 : value
    case 'json':
    case 'uuid[]':
    case 'text[]':
      return typeof value === 'string' ? value : JSON.stringify(value)
    default:
      return value
  }
}

/** A value of kind as a mutation sends it: the inverse of toStored. */
export function toSent(kind: Kind | undefined, value: unknown): unknown {
  if (value === null || value === undefined) return null
  switch (kind) {
    case 'boolean':
      return value === 1 || value === true || value === '1'
    case 'json':
    case 'uuid[]':
    case 'text[]':
      return typeof value === 'string' ? (JSON.parse(value) as unknown) : value
    default:
      return value
  }
}

/**
 * The mutation a queued write stands for: a PUT creates, a PATCH updates (or acts, when its metadata
 * names an action), a DELETE deletes. Its fields are the columns the write changed, but the server's
 * own and those its metadata keeps local, each as the push takes its kind, and the fields its metadata
 * adds.
 */
export function toMutation(registry: Registry, entry: QueuedWrite): SyncMutation {
  const entity = entityOf(registry, entry.table)
  const columns = tableOf(registry, entry.table).columns
  const meta = decodeMetadata(entry)
  const local = new Set(meta.local ?? [])
  const fields: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(entry.opData ?? {})) {
    if (serverColumns.has(name) || local.has(name) || name === 'id') continue
    fields[name] = toSent(columns[name], value)
  }
  Object.assign(fields, meta.fields ?? {})
  const op: SyncMutation['op'] =
    entry.op === UpdateType.PUT
      ? 'create'
      : entry.op === UpdateType.DELETE
        ? 'delete'
        : meta.action !== undefined
          ? 'action'
          : 'update'
  return {
    mutation_id: meta.mutation_id,
    entity_type: entity.name,
    entity_id: entry.id,
    op,
    base_version: meta.base_version ?? null,
    action: meta.action ?? null,
    fields,
    client_time: meta.client_time,
  }
}

/**
 * What can be told of a queued write toMutation cannot read, for the outcomes table to keep: one made
 * around the library, with no metadata, or one of a table the registry no longer holds. Its mutation
 * id and client time are its metadata's where it names them, id and at where it does not; the rest is
 * what the write itself says.
 */
export function unsendable(
  registry: Registry,
  entry: QueuedWrite,
  id: string,
  at: string,
): SyncMutation {
  let meta: Partial<WriteMetadata> = {}
  try {
    const parsed: unknown = JSON.parse(entry.metadata ?? '')
    if (parsed !== null && typeof parsed === 'object') meta = parsed
  } catch {
    // No metadata to read: the write is told by its row alone.
  }
  return {
    mutation_id: typeof meta.mutation_id === 'string' ? meta.mutation_id : id,
    entity_type: registry.tables[entry.table]?.entity ?? entry.table,
    entity_id: entry.id,
    op:
      entry.op === UpdateType.PUT ? 'create' : entry.op === UpdateType.DELETE ? 'delete' : 'update',
    base_version: null,
    action: null,
    fields: { ...(entry.opData ?? {}) },
    client_time: typeof meta.client_time === 'string' ? meta.client_time : at,
  }
}

/** The outcomes that end a mutation (PRD 10 §4, invariant 6); `deferred` does not. */
export const terminal: ReadonlySet<Outcome> = new Set(['applied', 'merged', 'conflict', 'rejected'])

/**
 * Whether a rejection is the household's entitlement refusing it (FR-BI2), which is held and
 * replayed rather than ended. Item 16 settled the code (D-118): the push answers a household that
 * does not write with a 402 for the whole batch, whose problem's code, `entitlement_read_only` or
 * `entitlement_restricted`, each of its mutations is recorded with. The bare `entitlement` PRD 10
 * §4 once named is held too.
 */
export function isEntitlement(code: string | null | undefined): boolean {
  return code === 'entitlement' || (code?.startsWith('entitlement_') ?? false)
}

/**
 * Whether an answer ends its mutation (invariant 6): a terminal outcome, but not an entitlement
 * rejection, which holds the mutation to replay once the household may write again (scenario 14),
 * as `deferred` holds one until its batch is answered.
 */
export function ends(result: Pick<SyncMutationResult, 'outcome' | 'code'>): boolean {
  return (
    terminal.has(result.outcome) && !(result.outcome === 'rejected' && isEntitlement(result.code))
  )
}

/** value as JSON, every object's keys in order, so that two values compare as text. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

/**
 * The fields mutation set that row, the row a `merged` answer carried, does not say what it set
 * (D-122): what the member must be shown was overridden. A field the row does not carry is not one.
 */
export function overridden(mutation: SyncMutation, row: unknown): string[] {
  if (row === null || typeof row !== 'object') return []
  const r = row as Record<string, unknown>
  return Object.entries(mutation.fields ?? {})
    .filter(([name, value]) => name in r && !sameValue(value, r[name]))
    .map(([name]) => name)
}

/**
 * Whether two values say the same thing: equal as JSON, or as instants when both are times, since
 * the server writes a time as it stores it, which need not be the spelling the client sent.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (stable(a) === stable(b)) return true
  if (typeof a === 'string' && typeof b === 'string') {
    const x = Date.parse(a)
    const y = Date.parse(b)
    return !Number.isNaN(x) && x === y && /\d{2}:\d{2}/.test(a) && /\d{2}:\d{2}/.test(b)
  }
  return false
}
