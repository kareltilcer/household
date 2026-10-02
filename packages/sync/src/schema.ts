// A replica's schema (D-93, ADR 0001, ADR 0019): a client table for each table the registry's streams
// write, and the library's own local-only tables, which no checkpoint replaces and no stream reaches.

import { Schema, Table, column, type BaseColumnType } from '@powersync/common'
import type { Kind, Registry } from './registry.ts'

/**
 * The library's local-only tables:
 *   - outcomes: each answer but `applied`, with the mutation it answers, since the next checkpoint
 *     replaces the local write: the conflict inbox and a rejection keep what the member wrote from it
 *     (ADR 0001). position orders them as they were answered.
 *   - held: the mutations held to replay, a `deferred` one once its batch is answered, an
 *     `entitlement` one once the household may write again.
 *   - meta: the replica's own facts, by key (metaKeys).
 *   - rebase: for each row a mutation of the queue wrote, the version the replica held when it was
 *     written and the version the push's answer returned, which a later mutation of the row made
 *     against the first is sent against (D-122).
 *   - attachments: the bytes waiting to be uploaded for a row written offline (D-25).
 */
export const localTables = {
  outcomes: 'household_sync_outcomes',
  held: 'household_sync_held',
  meta: 'household_sync_meta',
  rebase: 'household_sync_rebase',
  attachments: 'household_sync_attachments',
} as const

/** The keys of the replica's meta table. */
export const metaKeys = {
  /** The replica's id, which its reports name: minted once, kept across restarts. */
  replica: 'replica_id',
  /** The highest queued write ever sent: a write at or below it may be in flight, and is never merged into. */
  sent: 'sent_through',
  /** When the push may next be sent to, after a 429 (Retry-After), as milliseconds since the epoch. */
  notBefore: 'not_before',
  /** Whether the server told the replica to download itself again, which it does once its queue drains. */
  resnapshot: 'resnapshot',
} as const

/** The SQLite type a column of kind is stored as. */
function columnOf(kind: Kind): BaseColumnType<number | null> | BaseColumnType<string | null> {
  switch (kind) {
    case 'integer':
    case 'boolean':
      return column.integer
    case 'real':
      return column.real
    default:
      return column.text
  }
}

/**
 * The schema of a replica of registry's streams. Every table of an entity's full rows tracks each
 * write's metadata (`_metadata`): the mutation id, the client time, the base version and any action
 * its mutation carries, which a row write does not (ADR 0001).
 */
export function schemaOf(registry: Registry): Schema {
  const tables: Record<string, Table> = {}
  for (const [name, spec] of Object.entries(registry.tables)) {
    tables[name] = new Table(
      Object.fromEntries(
        Object.entries(spec.columns).map(([column, kind]) => [column, columnOf(kind)]),
      ),
      { trackMetadata: !spec.redacted },
    )
  }
  tables[localTables.outcomes] = new Table(
    {
      mutation_id: column.text,
      entity_type: column.text,
      entity_id: column.text,
      op: column.text,
      outcome: column.text,
      code: column.text,
      message: column.text,
      version: column.integer,
      row: column.text,
      mutation: column.text,
      answered_at: column.text,
      position: column.integer,
      // What the member must see: a conflict or a rejection, a merge that overrode a field they set,
      // or an lww_row write whose loser its module keeps. 0 once they have, or for nothing to see.
      unresolved: column.integer,
      // The fields of a merge the row it returned does not say what the member set, as JSON.
      overridden: column.text,
    },
    {
      localOnly: true,
      // It keeps every answer but applied: a row's state and the inbox look answers up by their row
      // and by their mutation.
      indexes: { row: ['entity_type', 'entity_id'], mutation: ['mutation_id'] },
    },
  )
  tables[localTables.held] = new Table(
    {
      mutation_id: column.text,
      reason: column.text,
      position: column.integer,
      mutation: column.text,
      held_at: column.text,
    },
    { localOnly: true },
  )
  tables[localTables.meta] = new Table({ value: column.text }, { localOnly: true })
  tables[localTables.rebase] = new Table(
    {
      entity_type: column.text,
      entity_id: column.text,
      table_name: column.text,
      from_version: column.integer,
      to_version: column.integer,
    },
    { localOnly: true },
  )
  tables[localTables.attachments] = new Table(
    {
      entity_type: column.text,
      table_name: column.text,
      file_name: column.text,
      content_type: column.text,
      size: column.integer,
      local_uri: column.text,
      status: column.text,
      attempts: column.integer,
      code: column.text,
      queued_at: column.text,
      position: column.integer,
    },
    { localOnly: true },
  )
  return new Schema(tables)
}
