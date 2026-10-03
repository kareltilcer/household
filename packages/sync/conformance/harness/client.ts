// One client of the suite: a replica of @household/sync's (plan item 18) on its own SQLite file,
// subscribed to one household's streams (D-4), writing through the library's connector, over a
// network of its own, on a clock of its own. The suite drives the library as an app does; what it adds
// is the network it can partition, the clock it can skew and the recorder the invariants read.

import { PowerSyncDatabase } from '@powersync/node'
import {
  ChecksumWatch,
  Replica,
  schemaOf,
  type Held,
  type HoldReason,
  type Observer,
  type RecordedOutcome,
} from '../../src/index.ts'
import { NodeFileSystemAdapter, multipart } from '../../src/node.ts'
import type { Household, Member } from './admin.ts'
import { apiUrl } from './env.ts'
import { Network } from './network.ts'
import type { Recorder } from './recorder.ts'
import type { Rng } from './rng.ts'
import { suiteRegistry, tableSpec, type TableName } from './schema.ts'
import type { Target } from './target.ts'

export type { RecordedOutcome } from '../../src/index.ts'

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

export class Client {
  readonly name: string
  readonly member: Member
  readonly household: Household
  readonly network = new Network()
  skewMs: number
  private replicaNow: Replica
  private readonly options: ClientOptions
  private readonly ctx: ClientContext
  private readonly dbFilename: string
  private credential: string | null = null

  constructor(ctx: ClientContext, options: ClientOptions) {
    this.ctx = ctx
    this.options = options
    this.name = options.name
    this.member = options.member
    this.household = options.household
    this.skewMs = options.skewMs ?? 0
    this.dbFilename = `${options.name}-${ctx.rng.uuid()}.sqlite`
    this.replicaNow = this.open()
  }

  /** The library's replica the client drives. */
  get replica(): Replica {
    return this.replicaNow
  }

  get db(): Replica['db'] {
    return this.replicaNow.db
  }

  get connector(): Replica['connector'] {
    return this.replicaNow.connector
  }

  /** A replica on the client's SQLite file, as it was left. */
  private open(): Replica {
    const { ctx, options } = this
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
    const checksums = new ChecksumWatch()
    const db = new PowerSyncDatabase({
      schema: schemaOf(suiteRegistry),
      database: { dbFilename: this.dbFilename, dbLocation: ctx.dir },
      logger: checksums,
    })
    return new Replica({
      db,
      registry: suiteRegistry,
      household: options.household.id,
      apiUrl: `${apiUrl}/api/v1`,
      credential: {
        current: () => this.credentialNow(),
        renew: async () => {
          await this.renew()
        },
      },
      fetch: this.network.fetch,
      newId: () => ctx.rng.uuid(this.now().getTime()),
      now: () => this.now(),
      observer,
      checksums,
      reportEveryMs: 0,
      // Short, so that a run is quick: the upload throttle, and the wait before a failed upload or a
      // dropped connection is tried again.
      connection: { crudUploadThrottleMs: 20, retryDelayMs: 150 },
      attachments: {
        storage: new NodeFileSystemAdapter(`${ctx.dir}/${this.dbFilename}.files`),
        uploadUrl: (_entity, household, id) => ctx.target.attachmentUrl?.(household, id) ?? null,
        transport: multipart,
      },
      onWrite: (w) => {
        recorder.wrote(this.name, {
          mutationId: w.mutationId,
          table: tableSpec(w.table).table as TableName,
          entityId: w.entityId,
          op: w.op,
        })
      },
      ...(options.maxBatch === undefined ? {} : { maxBatch: options.maxBatch }),
      ...(options.retryRejections === undefined
        ? {}
        : { retryRejections: options.retryRejections }),
      ...(options.extraStreams === undefined ? {} : { extraStreams: options.extraStreams }),
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
  online(): Promise<void> {
    return this.replicaNow.connect()
  }

  /** Disconnects from PowerSync: the client goes offline, its replica and its queue kept. */
  offline(): Promise<void> {
    return this.replicaNow.disconnect()
  }

  /** Whether the client is online: between online() and offline(). */
  get isOnline(): boolean {
    return this.replicaNow.connected
  }

  /**
   * Closes the client's database and opens it again, as an app killed and started again does: what it
   * held, its queue and what it was answered, are what it finds (PRD 03 §2.1, nothing is lost). It
   * comes back offline.
   */
  async restart(): Promise<void> {
    await this.replicaNow.close()
    this.replicaNow = this.open()
    await this.db.init()
  }

  /** Runs the connector now, outside PowerSync's upload loop: the held mutations whose cause has cleared replay. */
  flush(): Promise<void> {
    return this.replicaNow.flush()
  }

  /** Starts a flush of held mutations whose cause has cleared, when nothing is queued (Replica.replayHeld). */
  replayHeld(): Promise<void> {
    return this.replicaNow.replayHeld()
  }

  /** Whether the client holds mutations whose cause has cleared, waiting to replay. */
  replayable(): Promise<boolean> {
    return this.replicaNow.replayable()
  }

  close(): Promise<void> {
    return this.replicaNow.close()
  }

  /** Creates a row of table with fields, offline or not, and returns its id. */
  create(
    table: TableName,
    fields: Readonly<Record<string, unknown>>,
    options: { readonly id?: string; readonly local?: Readonly<Record<string, unknown>> } = {},
  ): Promise<string> {
    return this.replicaNow.create(table, fields, {
      id: options.id ?? this.ctx.rng.uuid(this.now().getTime()),
      ...(options.local === undefined ? {} : { local: options.local }),
    })
  }

  /**
   * Sets fields of table's row id, against the version the replica holds, and reports whether the
   * replica held the row: a write to a row it does not hold queues nothing, and is not recorded.
   */
  update(
    table: TableName,
    id: string,
    fields: Readonly<Record<string, unknown>>,
    options: { readonly action?: string; readonly carry?: Readonly<Record<string, unknown>> } = {},
  ): Promise<boolean> {
    return this.replicaNow.update(table, id, fields, options)
  }

  /** Deletes table's row id, with its mutation's metadata, and reports whether the replica held it. */
  remove(table: TableName, id: string): Promise<boolean> {
    return this.replicaNow.remove(table, id)
  }

  /**
   * Checks or unchecks item: the state it wants, at the client's time (state_set, scenario 3). The
   * first check the replica makes of an item creates its row; later ones update it, carrying the
   * item_id the server keys the state on and the state itself: a state_set write carries the state it
   * wants, not a delta (PRD 03 §2.5), and a queued write leaves out a column the update did not change.
   * The time it was checked at, and whether the server flagged the client's clock, are the server's to
   * set: the replica shows them until the server's row arrives. It returns the id of the row it wrote,
   * or null when a checkpoint took the row it found away before its write, which then queued nothing.
   */
  async check(item: string, checked: boolean): Promise<string | null> {
    const row = await this.db.getOptional<{ id: string }>(
      'SELECT id FROM conformance_item_checks WHERE item_id = ?',
      [item],
    )
    const at = this.now().toISOString()
    if (row === null) {
      return this.create(
        'conformance_item_checks',
        { item_id: item, checked },
        { local: { checked_at: at, clock_flagged: false } },
      )
    }
    const queued = await this.replicaNow.update(
      'conformance_item_checks',
      row.id,
      { checked },
      { local: { checked_at: at }, carry: { item_id: item, checked } },
    )
    return queued ? row.id : null
  }

  /** Keeps a file for table's row id, to be uploaded once the server holds the row (D-25). */
  attach(
    table: TableName,
    id: string,
    file: { readonly bytes: Uint8Array; readonly contentType: string; readonly fileName: string },
  ): Promise<void> {
    const data = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer
    return this.replicaNow.attach(table, id, {
      data,
      contentType: file.contentType,
      fileName: file.fileName,
    })
  }

  /** table's rows in the replica, as its view shows them: the columns the schema declares. */
  rows(table: TableName): Promise<Record<string, unknown>[]> {
    return this.db.getAll<Record<string, unknown>>(`SELECT * FROM ${table}`)
  }

  /**
   * The columns each of table's rows holds as PowerSync stored it, by id: every column its stream
   * sent, which the table's view shows only as far as the schema declares them.
   */
  async stored(table: TableName): Promise<Map<string, string[]>> {
    const rows = await this.db.getAll<{ id: string; data: string | null }>(
      `SELECT id, data FROM ps_data__${table}`,
    )
    return new Map(
      rows.map((r) => {
        const data: unknown = r.data === null ? {} : JSON.parse(r.data)
        return [
          r.id.toLowerCase(),
          typeof data === 'object' && data !== null ? Object.keys(data) : [],
        ]
      }),
    )
  }

  row(table: TableName, id: string): Promise<Record<string, unknown> | null> {
    return this.db.getOptional<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id])
  }

  /** How many writes wait in the upload queue. */
  pending(): Promise<number> {
    return this.replicaNow.queued()
  }

  /** The mutations held to replay, of reason or of any. */
  held(reason?: HoldReason): Promise<Held[]> {
    return this.replicaNow.held(reason)
  }

  /** The answers other than `applied` the client recorded, oldest first. */
  outcomes(): Promise<RecordedOutcome[]> {
    return this.replicaNow.outcomes()
  }

  /** The replica's buckets and the op each has applied up to: its checkpoint (PRD 10 §4, invariant 5). */
  buckets(): Promise<{ name: string; last_applied_op: number }[]> {
    return this.db.getAll<{ name: string; last_applied_op: number }>(
      'SELECT name, last_applied_op FROM ps_buckets',
    )
  }
}
