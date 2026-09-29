// One client of the suite: a PowerSync database of its own, in its own SQLite file, subscribed
// to one household's streams (D-4), writing through the suite's connector, over a network of its
// own, on a clock of its own.

import { PowerSyncDatabase } from '@powersync/node'
import type { SyncStreamSubscription } from '@powersync/common'
import type { Household, Member } from './admin.ts'
import {
  ConformanceConnector,
  type Held,
  type HoldReason,
  type Journal,
  type Observer,
} from './connector.ts'
import {
  encodeMetadata,
  type SyncMutation,
  type SyncMutationResult,
  type WriteMetadata,
} from './mutation.ts'
import { Network } from './network.ts'
import type { Recorder } from './recorder.ts'
import type { Rng } from './rng.ts'
import { heldTable, outcomesTable, schema, tableSpec, type TableName } from './schema.ts'
import { Unauthorized, type Target } from './target.ts'

export interface ClientOptions {
  readonly name: string
  readonly member: Member
  readonly household: Household
  /** How far the client's clock is from the server's, in milliseconds (PRD 03 §2.8). */
  readonly skewMs?: number
  /** Mutations to a batch; the contract's 500 by default. */
  readonly maxBatch?: number
  /** The negative control's broken connector, which retries a rejection forever. */
  readonly retryRejections?: boolean
  /** Streams beyond the target's, each subscribed with {household_id}: the negative control's leaky one. */
  readonly extraStreams?: readonly string[]
  /** The lifetime of each API credential the client signs in for; the target's default when absent. */
  readonly credentialTtlSeconds?: number
}

export interface ClientContext {
  readonly target: Target
  readonly recorder: Recorder
  readonly rng: Rng
  /** Where the client's SQLite file goes. */
  readonly dir: string
}

/** An answer the client recorded in its outcomes table. */
export interface RecordedOutcome {
  readonly mutation_id: string
  readonly entity_type: string
  readonly entity_id: string
  readonly op: string
  readonly outcome: SyncMutationResult['outcome']
  readonly code: string | null
  readonly version: number | null
  readonly row: unknown
}

export class Client {
  readonly name: string
  readonly member: Member
  readonly household: Household
  readonly network = new Network()
  readonly db: PowerSyncDatabase
  readonly connector: ConformanceConnector
  skewMs: number
  private readonly options: ClientOptions
  private readonly ctx: ClientContext
  private credential: string | null = null
  private subscriptions: SyncStreamSubscription[] | null = null
  private onlineNow = false
  /** A flush replayHeld started and that has not finished. */
  private replaying: Promise<void> | null = null

  constructor(ctx: ClientContext, options: ClientOptions) {
    this.ctx = ctx
    this.options = options
    this.name = options.name
    this.member = options.member
    this.household = options.household
    this.skewMs = options.skewMs ?? 0
    this.db = new PowerSyncDatabase({
      schema,
      database: { dbFilename: `${options.name}-${ctx.rng.uuid()}.sqlite`, dbLocation: ctx.dir },
    })
    const recorder = ctx.recorder
    const observer: Observer = {
      attempted: (attempt) => {
        recorder.attempted(this.name, attempt)
      },
      answered: (mutation, result) => {
        recorder.answered(this.name, mutation, result)
      },
      malformed: (attempt, reason) => {
        recorder.malformed(this.name, attempt, reason)
      },
    }
    this.connector = new ConformanceConnector({
      pushUrl: ctx.target.pushUrl(options.household.id),
      fetch: this.network.fetch,
      credential: {
        current: async () => this.credential ?? (await this.renew()),
        renew: async () => {
          await this.renew()
        },
      },
      journal: this.journal(),
      newKey: () => ctx.rng.uuid(),
      observer,
      ...(options.maxBatch === undefined ? {} : { maxBatch: options.maxBatch }),
      ...(options.retryRejections === undefined
        ? {}
        : { retryRejections: options.retryRejections }),
    })
  }

  private async renew(): Promise<string> {
    const ttl = this.options.credentialTtlSeconds
    this.credential = await this.ctx.target.signIn(
      this.member.id,
      this.network.fetch,
      ttl === undefined ? {} : { ttlSeconds: ttl },
    )
    return this.credential
  }

  /** The API credential the client pushes with, signing in for one when it has none. */
  async credentialNow(): Promise<string> {
    return this.credential ?? (await this.renew())
  }

  /** The client's clock. */
  now(): Date {
    return new Date(Date.now() + this.skewMs)
  }

  /** Connects to PowerSync, subscribed to the household's streams: the client comes online. */
  async online(): Promise<void> {
    const { target } = this.ctx
    if (this.subscriptions === null) {
      this.subscriptions = []
      for (const stream of [...target.streams, ...(this.options.extraStreams ?? [])]) {
        this.subscriptions.push(
          await this.db.syncStream(stream, { household_id: this.household.id }).subscribe(),
        )
      }
    }
    await this.db.connect(
      {
        fetchCredentials: async () => {
          const credential = this.credential ?? (await this.renew())
          try {
            return await target.powerSyncCredentials(
              credential,
              this.household.id,
              this.network.fetch,
            )
          } catch (error) {
            if (!(error instanceof Unauthorized)) throw error
            return target.powerSyncCredentials(
              await this.renew(),
              this.household.id,
              this.network.fetch,
            )
          }
        },
        uploadData: () => this.flush(),
      },
      // Short, so that a run is quick: the upload throttle, and the wait before a failed upload
      // or a dropped connection is tried again.
      { crudUploadThrottleMs: 20, retryDelayMs: 150 },
    )
    this.onlineNow = true
  }

  /**
   * Runs the connector now, outside PowerSync's upload loop, which starts only on a local write:
   * the held mutations whose cause has cleared replay (ConformanceConnector.resume).
   */
  async flush(): Promise<void> {
    await this.connector.upload({
      peek: async (limit) => {
        const batch = await this.db.getCrudBatch(limit)
        return batch === null ? null : { entries: batch.crud, complete: () => batch.complete() }
      },
    })
  }

  /**
   * Starts a flush when the queue is empty and the connector holds mutations whose cause has
   * cleared: PowerSync calls uploadData only while its queue holds a write, so a replay the network
   * or the server failed after the queue drained would otherwise wait for the next local write.
   * It does not wait for the flush, whose failure the next call tries again.
   */
  async replayHeld(): Promise<void> {
    if (!this.onlineNow || this.replaying !== null || (await this.pending()) > 0) return
    const waiting =
      (await this.held('deferred')).length > 0 ||
      (this.connector.resuming && (await this.held('entitlement')).length > 0)
    if (!waiting) return
    this.replaying = this.flush()
      .catch(() => undefined)
      .finally(() => {
        this.replaying = null
      })
  }

  /** Disconnects from PowerSync: the client goes offline, its replica and its queue kept. */
  async offline(): Promise<void> {
    this.onlineNow = false
    await this.db.disconnect()
  }

  /** Whether the client is online: between online() and offline(). */
  get isOnline(): boolean {
    return this.onlineNow
  }

  async close(): Promise<void> {
    for (const s of this.subscriptions ?? []) s.unsubscribe()
    await this.replaying
    await this.db.close()
  }

  private metadata(extra: Partial<WriteMetadata> = {}): { meta: WriteMetadata; encoded: string } {
    const meta: WriteMetadata = {
      mutation_id: this.ctx.rng.uuid(),
      client_time: this.now().toISOString(),
      ...extra,
    }
    return { meta, encoded: encodeMetadata(meta) }
  }

  private toClient(table: TableName, name: string, value: unknown): unknown {
    return tableSpec(table).columns[name] === 'boolean'
      ? value === true
        ? 1
        : value === false
          ? 0
          : value
      : value
  }

  /** Creates a row of table with fields, offline or not, and returns its id. */
  async create(
    table: TableName,
    fields: Readonly<Record<string, unknown>>,
    options: { readonly id?: string } = {},
  ): Promise<string> {
    const id = options.id ?? this.ctx.rng.uuid(this.now().getTime())
    const { meta, encoded } = this.metadata()
    const names = Object.keys(fields)
    const values = names.map((n) => this.toClient(table, n, fields[n]))
    await this.db.execute(
      `INSERT INTO ${table} (id, household_id, ${names.join(', ')}, _metadata) VALUES (?, ?, ${names.map(() => '?').join(', ')}, ?)`,
      [id, this.household.id, ...values, encoded],
    )
    this.ctx.recorder.wrote(this.name, {
      mutationId: meta.mutation_id,
      table,
      entityId: id,
      op: 'create',
    })
    return id
  }

  /**
   * Sets fields of table's row id, against the version the replica holds, and reports whether the
   * replica held the row: a write to a row it does not hold queues nothing, and is not recorded.
   * The row is read and written in one transaction, which no checkpoint can land inside: one that
   * retracted the row between the two would leave a write recorded that was never queued.
   */
  async update(
    table: TableName,
    id: string,
    fields: Readonly<Record<string, unknown>>,
    options: { readonly action?: string; readonly carry?: Readonly<Record<string, unknown>> } = {},
  ): Promise<boolean> {
    const names = Object.keys(fields)
    const meta = await this.db.writeTransaction(async (tx) => {
      const current = await tx.getOptional<{ version: number | null }>(
        `SELECT version FROM ${table} WHERE id = ?`,
        [id],
      )
      if (current === null) return null
      const { meta, encoded } = this.metadata({
        ...(current.version === null ? {} : { base_version: current.version }),
        ...(options.action === undefined ? {} : { action: options.action }),
        ...(options.carry === undefined ? {} : { fields: options.carry }),
      })
      await tx.execute(
        `UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(', ')}, _metadata = ? WHERE id = ?`,
        [...names.map((n) => this.toClient(table, n, fields[n])), encoded, id],
      )
      return meta
    })
    if (meta === null) return false
    this.ctx.recorder.wrote(this.name, {
      mutationId: meta.mutation_id,
      table,
      entityId: id,
      op: options.action === undefined ? 'update' : 'action',
    })
    return true
  }

  /**
   * Deletes table's row id, with its mutation's metadata, and reports whether the replica held it;
   * read and written in one transaction, as update is.
   */
  async remove(table: TableName, id: string): Promise<boolean> {
    const meta = await this.db.writeTransaction(async (tx) => {
      const current = await tx.getOptional<{ version: number | null }>(
        `SELECT version FROM ${table} WHERE id = ?`,
        [id],
      )
      if (current === null) return null
      const { meta, encoded } = this.metadata(
        current.version === null ? {} : { base_version: current.version },
      )
      // A delete that carries metadata is written as an update of _deleted (trackMetadata).
      await tx.execute(`UPDATE ${table} SET _deleted = 1, _metadata = ? WHERE id = ?`, [
        encoded,
        id,
      ])
      return meta
    })
    if (meta === null) return false
    this.ctx.recorder.wrote(this.name, {
      mutationId: meta.mutation_id,
      table,
      entityId: id,
      op: 'delete',
    })
    return true
  }

  /**
   * Checks or unchecks item: the state it wants, at the client's time (state_set, scenario 3). The
   * first check the replica makes of an item creates its row; later ones update it, carrying the
   * item_id the server keys the state on.
   */
  async check(item: string, checked: boolean): Promise<string> {
    const row = await this.db.getOptional<{ id: string }>(
      'SELECT id FROM conformance_item_checks WHERE item_id = ?',
      [item],
    )
    const at = this.now().toISOString()
    if (row === null) {
      return this.create('conformance_item_checks', {
        item_id: item,
        checked,
        checked_at: at,
        clock_flagged: false,
      })
    }
    await this.update(
      'conformance_item_checks',
      row.id,
      { checked, checked_at: at },
      { carry: { item_id: item } },
    )
    return row.id
  }

  /** table's rows in the replica. */
  rows(table: TableName): Promise<Record<string, unknown>[]> {
    return this.db.getAll<Record<string, unknown>>(`SELECT * FROM ${table}`)
  }

  row(table: TableName, id: string): Promise<Record<string, unknown> | null> {
    return this.db.getOptional<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id])
  }

  /** How many writes wait in the upload queue. */
  async pending(): Promise<number> {
    return (await this.db.getUploadQueueStats()).count
  }

  /** The mutations held to replay, of reason or of any. */
  async held(reason?: HoldReason): Promise<Held[]> {
    const rows = await this.db.getAll<{ reason: HoldReason; mutation: string }>(
      `SELECT reason, mutation FROM ${heldTable} ${reason === undefined ? '' : 'WHERE reason = ?'} ORDER BY position`,
      reason === undefined ? [] : [reason],
    )
    return rows.map((r) => ({ reason: r.reason, mutation: JSON.parse(r.mutation) as SyncMutation }))
  }

  /** The answers other than `applied` the client recorded, oldest first. */
  async outcomes(): Promise<RecordedOutcome[]> {
    const rows = await this.db.getAll<Omit<RecordedOutcome, 'row'> & { row: string | null }>(
      `SELECT mutation_id, entity_type, entity_id, op, outcome, code, version, row FROM ${outcomesTable} ORDER BY answered_at, id`,
    )
    return rows.map((r) => ({ ...r, row: r.row === null ? null : (JSON.parse(r.row) as unknown) }))
  }

  /** The replica's buckets and the op each has applied up to: its checkpoint (PRD 10 §4, invariant 5). */
  buckets(): Promise<{ name: string; last_applied_op: number }[]> {
    return this.db.getAll<{ name: string; last_applied_op: number }>(
      'SELECT name, last_applied_op FROM ps_buckets',
    )
  }

  private journal(): Journal {
    return {
      record: async (mutation, result) => {
        await this.db.execute(
          `INSERT INTO ${outcomesTable} (id, mutation_id, entity_type, entity_id, op, outcome, code, message, version, row, mutation, answered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.ctx.rng.uuid(),
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
            new Date().toISOString(),
          ],
        )
      },
      hold: async (reason, mutation) => {
        await this.db.writeTransaction(async (tx) => {
          await tx.execute(`DELETE FROM ${heldTable} WHERE id = ?`, [mutation.mutation_id])
          // Held after every mutation held before it, across restarts.
          await tx.execute(
            `INSERT INTO ${heldTable} (id, mutation_id, reason, position, mutation, held_at)
             VALUES (?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM ${heldTable}), ?, ?)`,
            [
              mutation.mutation_id,
              mutation.mutation_id,
              reason,
              JSON.stringify(mutation),
              new Date().toISOString(),
            ],
          )
        })
      },
      held: (reason) => this.held(reason),
      release: async (ids) => {
        if (ids.length === 0) return
        await this.db.execute(
          `DELETE FROM ${heldTable} WHERE id IN (${ids.map(() => '?').join(', ')})`,
          [...ids],
        )
      },
    }
  }
}
