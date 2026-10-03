// The connector's journal in a replica's own local-only tables (schema.ts): what the next checkpoint
// must not replace, and what the replica keeps across restarts.

import type { CommonPowerSyncDatabase } from '@powersync/common'
import {
  rowKey,
  type Held,
  type HoldReason,
  type Journal,
  type Rebase,
  type RebaseEntry,
  type Surface,
} from './connector.ts'
import type { SyncMutation, SyncMutationResult } from './mutation.ts'
import { localTables, metaKeys } from './schema.ts'

/** An answer the replica recorded in its outcomes table. */
export interface RecordedOutcome {
  readonly id: string
  readonly mutation_id: string
  readonly entity_type: string
  readonly entity_id: string
  readonly op: SyncMutation['op']
  readonly outcome: SyncMutationResult['outcome']
  readonly code: string | null
  readonly message: string | null
  readonly version: number | null
  /** The row the answer carried: the server's, on a conflict or a merge; the neighbour, on a monotonicity rejection. */
  readonly row: unknown
  /** The mutation it answered: what the member wrote. */
  readonly mutation: SyncMutation
  readonly answered_at: string
  /** Whether the member must still see it. */
  readonly unresolved: boolean
  /** The fields of a merge the row it returned does not say what the member set. */
  readonly overridden: readonly string[]
}

interface OutcomeRow {
  id: string
  mutation_id: string
  entity_type: string
  entity_id: string
  op: SyncMutation['op']
  outcome: SyncMutationResult['outcome']
  code: string | null
  message: string | null
  version: number | null
  row: string | null
  mutation: string
  answered_at: string
  unresolved: number | null
  overridden: string | null
}

export function outcomeOf(r: OutcomeRow): RecordedOutcome {
  return {
    ...r,
    row: r.row === null ? null : (JSON.parse(r.row) as unknown),
    mutation: JSON.parse(r.mutation) as SyncMutation,
    unresolved: r.unresolved === 1,
    overridden: r.overridden === null ? [] : (JSON.parse(r.overridden) as string[]),
  }
}

export const outcomeColumns =
  'id, mutation_id, entity_type, entity_id, op, outcome, code, message, version, row, mutation, answered_at, unresolved, overridden'

/** The connector's journal over db's local-only tables. */
export class LocalJournal implements Journal {
  private readonly db: CommonPowerSyncDatabase
  private readonly tables: ReadonlySet<string>
  private readonly newId: () => string
  private readonly now: () => Date

  /** tables are the client tables of the replica's registry. */
  constructor(
    db: CommonPowerSyncDatabase,
    tables: ReadonlySet<string>,
    newId: () => string,
    now: () => Date,
  ) {
    this.db = db
    this.tables = tables
    this.newId = newId
    this.now = now
  }

  async record(
    mutation: SyncMutation,
    result: SyncMutationResult,
    surface: Surface,
  ): Promise<void> {
    // After every answer recorded before it, as held mutations are (hold).
    await this.db.execute(
      `INSERT INTO ${localTables.outcomes} (id, mutation_id, entity_type, entity_id, op, outcome, code, message, version, row, mutation, answered_at, unresolved, overridden, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM ${localTables.outcomes}))`,
      [
        this.newId(),
        mutation.mutation_id,
        mutation.entity_type,
        mutation.entity_id,
        mutation.op,
        result.outcome,
        result.code ?? null,
        result.message ?? null,
        result.version ?? null,
        result.row === undefined ? null : JSON.stringify(result.row),
        JSON.stringify(mutation),
        this.now().toISOString(),
        surface.unresolved ? 1 : 0,
        JSON.stringify(surface.overridden),
      ],
    )
  }

  async settled(mutationId: string): Promise<void> {
    await this.db.execute(
      `UPDATE ${localTables.outcomes} SET unresolved = 0 WHERE mutation_id = ? AND unresolved = 1`,
      [mutationId],
    )
  }

  async hold(reason: HoldReason, mutation: SyncMutation): Promise<void> {
    await this.db.writeTransaction(async (tx) => {
      await tx.execute(`DELETE FROM ${localTables.held} WHERE id = ?`, [mutation.mutation_id])
      // Held after every mutation held before it, across restarts.
      await tx.execute(
        `INSERT INTO ${localTables.held} (id, mutation_id, reason, position, mutation, held_at)
         VALUES (?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM ${localTables.held}), ?, ?)`,
        [
          mutation.mutation_id,
          mutation.mutation_id,
          reason,
          JSON.stringify(mutation),
          this.now().toISOString(),
        ],
      )
    })
  }

  async held(reason?: HoldReason): Promise<Held[]> {
    const rows = await this.db.getAll<{ reason: HoldReason; mutation: string }>(
      `SELECT reason, mutation FROM ${localTables.held} ${reason === undefined ? '' : 'WHERE reason = ?'} ORDER BY position`,
      reason === undefined ? [] : [reason],
    )
    return rows.map((r) => ({ reason: r.reason, mutation: JSON.parse(r.mutation) as SyncMutation }))
  }

  async release(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.execute(
      `DELETE FROM ${localTables.held} WHERE id IN (${ids.map(() => '?').join(', ')})`,
      [...ids],
    )
  }

  async rebases(): Promise<ReadonlyMap<string, Rebase>> {
    const rows = await this.db.getAll<{
      id: string
      from_version: number | null
      to_version: number
    }>(`SELECT id, from_version, to_version FROM ${localTables.rebase}`)
    return new Map(rows.map((r) => [r.id, { from: r.from_version, to: r.to_version }]))
  }

  async rebase(entries: readonly RebaseEntry[]): Promise<void> {
    await this.db.writeTransaction(async (tx) => {
      for (const e of entries) {
        await tx.execute(
          `INSERT OR REPLACE INTO ${localTables.rebase} (id, entity_type, entity_id, table_name, from_version, to_version)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [rowKey(e.entityType, e.entityId), e.entityType, e.entityId, e.table, e.from, e.to],
        )
      }
    })
  }

  /**
   * Forgets the rebase of each row the replica has caught up with: one it holds at the version the
   * answer returned or later, whose next write is made against it, or one it no longer holds while
   * its queue is empty.
   */
  async prune(): Promise<void> {
    const rows = await this.db.getAll<{
      id: string
      entity_id: string
      table_name: string
      to_version: number
    }>(`SELECT id, entity_id, table_name, to_version FROM ${localTables.rebase}`)
    if (rows.length === 0) return
    const queued = (await this.db.getUploadQueueStats()).count
    const stale: string[] = []
    for (const r of rows) {
      if (!this.tables.has(r.table_name)) {
        stale.push(r.id)
        continue
      }
      const held = await this.db.getOptional<{ version: number | null }>(
        `SELECT version FROM ${r.table_name} WHERE id = ?`,
        [r.entity_id],
      )
      if (held === null ? queued === 0 : held.version !== null && held.version >= r.to_version)
        stale.push(r.id)
    }
    if (stale.length > 0) {
      await this.db.execute(
        `DELETE FROM ${localTables.rebase} WHERE id IN (${stale.map(() => '?').join(', ')})`,
        stale,
      )
    }
  }

  async sent(clientId: number): Promise<void> {
    const current = Number((await this.meta(metaKeys.sent)) ?? '0')
    if (clientId > current) await this.setMeta(metaKeys.sent, String(clientId))
  }

  async notBefore(): Promise<number> {
    return Number((await this.meta(metaKeys.notBefore)) ?? '0')
  }

  async setNotBefore(at: number): Promise<void> {
    await this.setMeta(metaKeys.notBefore, String(at))
  }

  async meta(key: string): Promise<string | null> {
    const row = await this.db.getOptional<{ value: string | null }>(
      `SELECT value FROM ${localTables.meta} WHERE id = ?`,
      [key],
    )
    return row?.value ?? null
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    await this.db.execute(`INSERT OR REPLACE INTO ${localTables.meta} (id, value) VALUES (?, ?)`, [
      key,
      value,
    ])
  }

  /** The answers other than `applied` the replica recorded, oldest first. */
  async outcomes(): Promise<RecordedOutcome[]> {
    const rows = await this.db.getAll<OutcomeRow>(
      `SELECT ${outcomeColumns} FROM ${localTables.outcomes} ORDER BY position`,
    )
    return rows.map(outcomeOf)
  }
}
