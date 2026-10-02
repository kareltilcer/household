// A replica of one household (D-4, D-93, ADR 0001, ADR 0019): PowerSync's database, subscribed to the
// household's generated streams, writing through the connector, keeping what the server answered and
// what the member must see, reporting itself at rest, and downloading itself again when told to.

import type {
  CommonPowerSyncDatabase,
  PowerSyncCredentials,
  SyncStreamSubscription,
} from '@powersync/common'
import { newId as uuidv7 } from '@household/api'
import { Attachments, drain, type AttachmentFile, type AttachmentOptions } from './attachments.ts'
import type { ChecksumWatch } from './checksums.ts'
import {
  Connector,
  Revoked,
  type Credential,
  type Held,
  type HoldReason,
  type Observer,
} from './connector.ts'
import { algorithm, entries, type ReplicaDigest, type ReplicaDigestVerdict } from './digest.ts'
import { LocalJournal, outcomeColumns, outcomeOf, type RecordedOutcome } from './journal.ts'
import {
  encodeMetadata,
  serverColumns,
  toStored,
  type SyncMutation,
  type WriteMetadata,
} from './mutation.ts'
import { entityOf, servedRegistry, tableOf, type Registry } from './registry.ts'
import { localTables, metaKeys } from './schema.ts'

/** A write to an entity that may not be written offline (D-84): the client shows it needs a connection. */
export class NeedsConnection extends Error {
  readonly entity: string

  constructor(entity: string) {
    super(`${entity} is not written offline; it needs a connection`)
    this.entity = entity
  }
}

/** Where a row stands, as its member sees it (06-clients §5, design 03-patterns). */
export type RowState =
  /** As the server holds it; deleted when another member deleted it, which leaves its tombstone. */
  | { readonly kind: 'synced'; readonly deleted: boolean }
  /** A write of it waits: queued, or held to replay (a `deferred` one, or one the entitlement refused). */
  | {
      readonly kind: 'pending'
      readonly op: SyncMutation['op'] | null
      readonly held: HoldReason | null
    }
  /** A write of it was sent and not yet answered. */
  | { readonly kind: 'syncing'; readonly op: SyncMutation['op'] | null }
  /** The server answered a write of it in a way the member must see (the outcomes table). */
  | { readonly kind: 'conflict' | 'rejected' | 'merged'; readonly outcome: RecordedOutcome }
  /**
   * It left the replica because access changed (FR-SY7), which is no deletion by another member: a
   * deleted row stays, a tombstone. The reason says which of the two causes the member is told of.
   */
  | { readonly kind: 'withdrawn'; readonly reason: 'access' | 'module' }
  /** The replica does not hold it, and never held it while watched. */
  | { readonly kind: 'absent' }

/** A local write, as the replica queued it: the mutation it is recorded in, an earlier one when merged into it. */
export interface Write {
  readonly mutationId: string
  readonly table: string
  readonly entityId: string
  readonly op: SyncMutation['op']
}

export interface ReplicaOptions {
  readonly db: CommonPowerSyncDatabase
  /** The registry the db's schema was built from; the server's by default. */
  readonly registry?: Registry
  readonly household: string
  /** The API's base, `https://…/api/v1`. */
  readonly apiUrl: string
  /** The credential the API is called with, a device's access token or a session's. */
  readonly credential: Credential
  readonly fetch?: typeof globalThis.fetch
  /** A new id: a mutation's, a key's, a replica's; a UUIDv7 by default. */
  readonly newId?: () => string
  /** The device's clock, which a mutation's client_time is read from. */
  readonly now?: () => Date
  readonly observer?: Observer
  /** Mutations to a batch, 500 by default. */
  readonly maxBatch?: number
  /** Broken on purpose: the conformance suite's negative control (ConnectorOptions.retryRejections). */
  readonly retryRejections?: boolean
  /** Streams beyond the registry's, each subscribed with the household: the suite's negative control. */
  readonly extraStreams?: readonly string[]
  /** PowerSync's upload throttle and its delay before trying a failed connection or upload again. */
  readonly connection?: { readonly crudUploadThrottleMs?: number; readonly retryDelayMs?: number }
  readonly attachments?: AttachmentOptions
  /** How often a connected replica reports itself at rest (D-125): 15 minutes by default, 0 never. */
  readonly reportEveryMs?: number
  /** The checksum failures the db's logger counts (ChecksumWatch), which a report carries. */
  readonly checksums?: ChecksumWatch
  /** Told once the replica has discarded itself, its device's sign-in ended (FR-ID7). */
  readonly onRevoked?: () => void
  /** Told of each local write once it is queued. */
  readonly onWrite?: (write: Write) => void
}

interface QueuedRow {
  id: number
  op: 'PUT' | 'PATCH' | 'DELETE'
}

const ops: Record<QueuedRow['op'], SyncMutation['op']> = {
  PUT: 'create',
  PATCH: 'update',
  DELETE: 'delete',
}

export class Replica {
  readonly db: CommonPowerSyncDatabase
  readonly registry: Registry
  readonly household: string
  readonly connector: Connector
  readonly journal: LocalJournal
  private readonly o: ReplicaOptions
  private readonly fetch: typeof globalThis.fetch
  private readonly newId: () => string
  private readonly now: () => Date
  private readonly attachmentQueue: Attachments | null
  private subscriptions: SyncStreamSubscription[] | null = null
  private connectedNow = false
  private reporting: ReturnType<typeof setInterval> | null = null
  /** Stops listening for the checkpoints after which waiting files are uploaded. */
  private unlisten: (() => void) | null = null
  private resnapshotting: Promise<void> | null = null
  private discarded = false
  /** A flush replayHeld started that has not finished. */
  private replaying: Promise<void> | null = null

  constructor(options: ReplicaOptions) {
    this.o = options
    this.db = options.db
    this.registry = options.registry ?? servedRegistry
    this.household = options.household
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.newId = options.newId ?? uuidv7
    this.now = options.now ?? (() => new Date())
    this.journal = new LocalJournal(
      this.db,
      new Set(Object.keys(this.registry.tables)),
      this.newId,
      this.now,
    )
    this.connector = new Connector({
      registry: this.registry,
      pushUrl: `${options.apiUrl}/households/${options.household}/sync/mutations`,
      fetch: this.fetch,
      credential: options.credential,
      journal: this.journal,
      newKey: this.newId,
      ...(options.observer === undefined ? {} : { observer: options.observer }),
      ...(options.maxBatch === undefined ? {} : { maxBatch: options.maxBatch }),
      ...(options.retryRejections === undefined
        ? {}
        : { retryRejections: options.retryRejections }),
    })
    this.attachmentQueue =
      options.attachments === undefined
        ? null
        : new Attachments(
            this.db,
            this.household,
            options.attachments,
            options.credential,
            this.fetch,
            this.now,
          )
  }

  /** The replica's id, which its reports name: minted the first time it is asked for, and kept. */
  async id(): Promise<string> {
    const kept = await this.journal.meta(metaKeys.replica)
    if (kept !== null) return kept
    const id = this.newId()
    await this.journal.setMeta(metaKeys.replica, id)
    return id
  }

  /** Whether the replica is connected: between connect() and disconnect(). */
  get connected(): boolean {
    return this.connectedNow
  }

  /** Connects to PowerSync, subscribed to the household's streams: the replica comes online. */
  async connect(): Promise<void> {
    if (this.discarded) throw new Revoked('the replica was discarded: its device was signed out')
    if (this.subscriptions === null) {
      const subscriptions: SyncStreamSubscription[] = []
      for (const stream of [
        ...new Set(this.registry.streams.map((s) => s.stream)),
        ...(this.o.extraStreams ?? []),
      ]) {
        subscriptions.push(
          await this.db.syncStream(stream, { household_id: this.household }).subscribe(),
        )
      }
      this.subscriptions = subscriptions
    }
    await this.db.connect(
      {
        fetchCredentials: () => this.credentials(),
        uploadData: () => this.upload(),
      },
      this.o.connection ?? {},
    )
    this.connectedNow = true
    // A file waits for its row to reach the server and come back with a version: each checkpoint
    // that lands may bring one.
    if (this.attachmentQueue !== null && this.unlisten === null) {
      const queue = this.attachmentQueue
      this.unlisten = this.db.registerListener({
        statusChanged: (status) => {
          if (status.connected && !status.downloading) void queue.upload().catch(() => undefined)
        },
      })
    }
    const every = this.o.reportEveryMs ?? 15 * 60_000
    if (every > 0 && this.reporting === null) {
      this.reporting = setInterval(() => {
        void this.report().catch(() => undefined)
      }, every)
    }
    // A download the server asked for before the replica last closed, which waited for its queue.
    if ((await this.journal.meta(metaKeys.resnapshot)) !== null) this.whenDrained()
  }

  /** Disconnects from PowerSync: the replica goes offline, its rows and its queue kept. */
  async disconnect(): Promise<void> {
    this.connectedNow = false
    this.stopReporting()
    await this.db.disconnect()
  }

  async close(): Promise<void> {
    this.connectedNow = false
    this.stopReporting()
    for (const s of this.subscriptions ?? []) s.unsubscribe()
    this.subscriptions = null
    await this.replaying
    await this.resnapshotting
    await this.db.close()
  }

  private stopReporting(): void {
    if (this.reporting !== null) clearInterval(this.reporting)
    this.reporting = null
    this.unlisten?.()
    this.unlisten = null
  }

  /**
   * PowerSync's URL and a token of its own for the caller (postSyncCredentials). A 401 renews the API
   * credential and asks again; a device whose sign-in has ended discards the replica (FR-ID7).
   */
  private async credentials(): Promise<PowerSyncCredentials | null> {
    const ask = async (): Promise<Response> =>
      this.fetch(`${this.o.apiUrl}/households/${this.household}/sync/credentials`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.o.credential.current()}` },
      })
    try {
      let response = await ask()
      if (response.status === 401) {
        await drain(response)
        await this.o.credential.renew()
        response = await ask()
      }
      if (!response.ok) {
        throw new Error(`the sync credentials: ${String(response.status)} ${await response.text()}`)
      }
      const body = (await response.json()) as {
        endpoint: string
        token: string
        expires_at: string
      }
      return { endpoint: body.endpoint, token: body.token, expiresAt: new Date(body.expires_at) }
    } catch (error) {
      if (error instanceof Revoked) this.discardSoon()
      throw error
    }
  }

  /**
   * Drains the upload queue through the connector, then the held mutations whose cause has cleared,
   * and then the files waiting for rows the server now holds.
   */
  private async upload(): Promise<void> {
    try {
      await this.connector.upload({
        peek: async (limit) => {
          const batch = await this.db.getCrudBatch(limit)
          return batch === null ? null : { entries: batch.crud, complete: () => batch.complete() }
        },
      })
    } catch (error) {
      if (error instanceof Revoked) this.discardSoon()
      throw error
    }
    if (this.attachmentQueue !== null) void this.attachmentQueue.upload().catch(() => undefined)
    if ((await this.journal.meta(metaKeys.resnapshot)) !== null) this.whenDrained()
  }

  /**
   * Runs the connector now, outside PowerSync's upload loop, which starts only on a local write: the
   * held mutations whose cause has cleared replay.
   */
  flush(): Promise<void> {
    return this.upload()
  }

  /** Lets the mutations the household's entitlement refused replay (FR-BI2). */
  resume(): void {
    this.connector.resume()
  }

  /**
   * Starts a flush when the queue is empty and mutations whose cause has cleared wait to replay:
   * PowerSync calls uploadData only while its queue holds a write. It does not wait for the flush,
   * whose failure the next call tries again.
   */
  async replayHeld(): Promise<void> {
    if (!this.connectedNow || this.replaying !== null || (await this.queued()) > 0) return
    if (!(await this.replayable())) return
    this.replaying = this.flush()
      .catch(() => undefined)
      .finally(() => {
        this.replaying = null
      })
  }

  /** Whether held mutations wait to replay: every deferred one, and the entitlement holds resume() let through. */
  async replayable(): Promise<boolean> {
    return (
      (await this.held('deferred')).length > 0 ||
      (this.connector.resuming && (await this.held('entitlement')).length > 0)
    )
  }

  /** Whether an entity's client table may be written offline (D-84). */
  writable(table: string): boolean {
    return entityOf(this.registry, table).offline_writes
  }

  private writableEntity(table: string): ReturnType<typeof entityOf> {
    const entity = entityOf(this.registry, table)
    if (!entity.offline_writes) throw new NeedsConnection(entity.name)
    return entity
  }

  private metadata(extra: Omit<WriteMetadata, 'mutation_id' | 'client_time'>): WriteMetadata {
    return { mutation_id: this.newId(), client_time: this.now().toISOString(), ...extra }
  }

  private stored(table: string, name: string, value: unknown): unknown {
    return toStored(tableOf(this.registry, table).columns[name], value)
  }

  /**
   * Creates a row of table with fields, and returns its id. local are columns the replica shows until
   * the server's row arrives, which the server sets itself and the mutation does not carry; carry are
   * fields the mutation carries that the row does not have.
   */
  async create(
    table: string,
    fields: Readonly<Record<string, unknown>>,
    options: {
      readonly id?: string
      readonly local?: Readonly<Record<string, unknown>>
      readonly carry?: Readonly<Record<string, unknown>>
    } = {},
  ): Promise<string> {
    this.writableEntity(table)
    const id = options.id ?? this.newId()
    const local = options.local ?? {}
    const meta = this.metadata({
      ...(Object.keys(local).length === 0 ? {} : { local: Object.keys(local) }),
      ...(options.carry === undefined ? {} : { fields: options.carry }),
    })
    const columns = { ...fields, ...local }
    const names = Object.keys(columns)
    const withHousehold = 'household_id' in tableOf(this.registry, table).columns
    await this.db.execute(
      `INSERT INTO ${table} (id${withHousehold ? ', household_id' : ''}${names.map((n) => `, ${n}`).join('')}, _metadata)
       VALUES (?${withHousehold ? ', ?' : ''}${names.map(() => ', ?').join('')}, ?)`,
      [
        id,
        ...(withHousehold ? [this.household] : []),
        ...names.map((n) => this.stored(table, n, columns[n])),
        encodeMetadata(meta),
      ],
    )
    this.o.onWrite?.({ mutationId: meta.mutation_id, table, entityId: id, op: 'create' })
    return id
  }

  /**
   * Sets fields of table's row id against the version the replica holds, and reports whether the
   * replica held the row: a write to a row it does not hold queues nothing. An edit merges into the
   * row's queued mutation when that one has not been sent (06-clients §5): a mutation a retry may
   * already have sent is never changed. The row is read and written in one transaction, which no
   * checkpoint can land inside.
   */
  async update(
    table: string,
    id: string,
    fields: Readonly<Record<string, unknown>>,
    options: {
      readonly action?: string
      readonly local?: Readonly<Record<string, unknown>>
      readonly carry?: Readonly<Record<string, unknown>>
    } = {},
  ): Promise<boolean> {
    this.writableEntity(table)
    const local = options.local ?? {}
    const columns = { ...fields, ...local }
    const names = Object.keys(columns)
    const mutationId = await this.db.writeTransaction(async (tx) => {
      const current = await tx.getOptional<{ version: number | null }>(
        `SELECT version FROM ${table} WHERE id = ?`,
        [id],
      )
      if (current === null) return null
      const meta = this.metadata({
        ...(current.version === null ? {} : { base_version: current.version }),
        ...(options.action === undefined ? {} : { action: options.action }),
        ...(Object.keys(local).length === 0 ? {} : { local: Object.keys(local) }),
        ...(options.carry === undefined ? {} : { fields: options.carry }),
      })
      await tx.execute(
        `UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(', ')}${names.length > 0 ? ', ' : ''}_metadata = ? WHERE id = ?`,
        [...names.map((n) => this.stored(table, n, columns[n])), encodeMetadata(meta), id],
      )
      const into = options.action === undefined ? await mergeIntoPending(tx, table, id) : null
      return into ?? meta.mutation_id
    })
    if (mutationId === null) return false
    this.o.onWrite?.({
      mutationId,
      table,
      entityId: id,
      op: options.action === undefined ? 'update' : 'action',
    })
    return true
  }

  /** Deletes table's row id, and reports whether the replica held it. */
  async remove(table: string, id: string): Promise<boolean> {
    this.writableEntity(table)
    const mutationId = await this.db.writeTransaction(async (tx) => {
      const current = await tx.getOptional<{ version: number | null }>(
        `SELECT version FROM ${table} WHERE id = ?`,
        [id],
      )
      if (current === null) return null
      const meta = this.metadata(current.version === null ? {} : { base_version: current.version })
      // A delete that carries metadata is written as an update of _deleted (trackMetadata).
      await tx.execute(`UPDATE ${table} SET _deleted = 1, _metadata = ? WHERE id = ?`, [
        encodeMetadata(meta),
        id,
      ])
      return meta.mutation_id
    })
    if (mutationId === null) return false
    this.o.onWrite?.({ mutationId, table, entityId: id, op: 'delete' })
    return true
  }

  /** How many writes wait in the upload queue. */
  async queued(): Promise<number> {
    return (await this.db.getUploadQueueStats()).count
  }

  /** The mutations held to replay, of reason or of any. */
  held(reason?: HoldReason): Promise<Held[]> {
    return this.journal.held(reason)
  }

  /** The answers other than `applied` the replica recorded, oldest first. */
  outcomes(): Promise<RecordedOutcome[]> {
    return this.journal.outcomes()
  }

  /**
   * What the member must see, oldest first, one for each mutation (DD-4): its conflicts, its
   * rejections, the merges that overrode a field they set or whose loser the module keeps. The inbox
   * routes each to its row; nothing in it resolves itself or ages out.
   */
  async inbox(): Promise<RecordedOutcome[]> {
    const rows = await this.db.getAll<Parameters<typeof outcomeOf>[0]>(
      `SELECT ${outcomeColumns} FROM ${localTables.outcomes} o
       WHERE unresolved = 1 AND position = (SELECT max(position) FROM ${localTables.outcomes} p WHERE p.mutation_id = o.mutation_id)
       ORDER BY position`,
    )
    return rows.map(outcomeOf)
  }

  /** Marks what a mutation's answers asked of the member seen to. */
  async resolve(mutationId: string): Promise<void> {
    await this.journal.settled(mutationId)
  }

  /** Discards a mutation the member gives up: what it asked of them, and its hold if it was held. */
  async discard(mutationId: string): Promise<void> {
    await this.journal.release([mutationId])
    await this.journal.settled(mutationId)
  }

  /**
   * Writes again what a refused or conflicting mutation set, as a new mutation against the row as the
   * replica now holds it (the member's "retry", or their choice of their own value), and marks the old
   * one seen to. It reports whether it wrote: a row neither held nor created by the mutation is not.
   */
  async retry(mutationId: string): Promise<boolean> {
    const [last] = (await this.outcomes()).filter((o) => o.mutation_id === mutationId).slice(-1)
    if (last === undefined) return false
    const { mutation } = last
    const table = this.registry.entities[mutation.entity_type]?.table
    if (table === undefined) return false
    const columns = tableOf(this.registry, table).columns
    const fields: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(mutation.fields ?? {})) {
      if (name in columns && !serverColumns.has(name)) fields[name] = value
    }
    // Every field is carried, whatever the replica shows: a row write leaves out a column whose value
    // the replica already holds, as it does the member's own refused value until a checkpoint.
    const carry = { ...(mutation.fields ?? {}) }
    const extra = Object.keys(carry).length === 0 ? {} : { carry }
    let wrote: boolean
    if (mutation.op === 'delete') wrote = await this.remove(table, mutation.entity_id)
    else if (
      mutation.op === 'create' &&
      (await this.db.getOptional(`SELECT id FROM ${table} WHERE id = ?`, [mutation.entity_id])) ===
        null
    ) {
      await this.create(table, fields, { id: mutation.entity_id, ...extra })
      wrote = true
    } else {
      wrote = await this.update(table, mutation.entity_id, fields, {
        ...extra,
        ...(mutation.action === null || mutation.action === undefined
          ? {}
          : { action: mutation.action }),
      })
    }
    if (wrote) await this.journal.settled(mutationId)
    return wrote
  }

  /** Where table's row id stands now (RowState); `absent` for a row the replica does not hold. */
  async rowState(table: string, id: string): Promise<RowState> {
    const entity = tableOf(this.registry, table).entity
    const [outcome] = await this.db.getAll<Parameters<typeof outcomeOf>[0]>(
      `SELECT ${outcomeColumns} FROM ${localTables.outcomes}
       WHERE entity_type = ? AND entity_id = ? AND unresolved = 1 ORDER BY position DESC LIMIT 1`,
      [entity, id],
    )
    if (outcome !== undefined) {
      const o = outcomeOf(outcome)
      const kind =
        o.outcome === 'conflict' ? 'conflict' : o.outcome === 'merged' ? 'merged' : 'rejected'
      return { kind, outcome: o }
    }
    const queued = await this.db.getOptional<QueuedRow>(
      `SELECT id, json_extract(data, '$.op') AS op FROM ps_crud
       WHERE json_extract(data, '$.type') = ? AND json_extract(data, '$.id') = ? ORDER BY id DESC LIMIT 1`,
      [table, id],
    )
    if (queued !== null) {
      const sent = Number((await this.journal.meta(metaKeys.sent)) ?? '0')
      const op = ops[queued.op]
      return queued.id <= sent ? { kind: 'syncing', op } : { kind: 'pending', op, held: null }
    }
    const [held] = await this.db.getAll<{ reason: HoldReason; op: SyncMutation['op'] }>(
      `SELECT reason, json_extract(mutation, '$.op') AS op FROM ${localTables.held}
       WHERE json_extract(mutation, '$.entity_type') = ? AND json_extract(mutation, '$.entity_id') = ?
       ORDER BY position DESC LIMIT 1`,
      [entity, id],
    )
    if (held !== undefined) return { kind: 'pending', op: held.op, held: held.reason }
    const row = await this.db.getOptional<{ deleted_at: string | null }>(
      'deleted_at' in tableOf(this.registry, table).columns
        ? `SELECT deleted_at FROM ${table} WHERE id = ?`
        : `SELECT NULL AS deleted_at FROM ${table} WHERE id = ?`,
      [id],
    )
    return row === null ? { kind: 'absent' } : { kind: 'synced', deleted: row.deleted_at !== null }
  }

  /**
   * Calls onChange with where table's row id stands, now and each time it moves. A row the replica held
   * that leaves it, neither deleted by the member nor refused, was withdrawn (FR-SY7): the reason says
   * whether its module was turned off for the household or the member's access changed (design
   * 03-patterns, When access is withdrawn). It returns the means to stop.
   */
  watchRowState(table: string, id: string, onChange: (state: RowState) => void): () => void {
    const module = entityOf(this.registry, table).module
    let seen = false
    let deleting = false
    let last = ''
    const emit = async (): Promise<void> => {
      let state = await this.rowState(table, id)
      if (state.kind === 'absent' && seen && !deleting) {
        const enablement = await this.db.getOptional<{ enabled: number | null }>(
          'SELECT enabled FROM module_enablement WHERE module = ?',
          [module],
        )
        state = { kind: 'withdrawn', reason: enablement?.enabled === 0 ? 'module' : 'access' }
      }
      if (state.kind === 'synced' || state.kind === 'pending' || state.kind === 'syncing') {
        seen = true
        deleting = state.kind !== 'synced' && state.op === 'delete'
      }
      if (state.kind === 'synced' && state.deleted) deleting = true
      const text = JSON.stringify(state)
      if (text === last) return
      last = text
      onChange(state)
    }
    void emit()
    // PowerSync tells a watcher only of the tables it names: the row's own, what the server answered,
    // the holds, the upload queue, and the modules' enablement, which says why a row left.
    return this.db.onChange(
      {
        onChange: async () => {
          await emit()
        },
      },
      {
        tables: [table, localTables.outcomes, localTables.held, 'ps_crud', 'module_enablement'],
        throttleMs: 30,
      },
    )
  }

  /** Keeps file's bytes for table's row id, to be uploaded once the server holds the row (D-25). */
  async attach(table: string, id: string, file: AttachmentFile): Promise<void> {
    if (this.attachmentQueue === null)
      throw new Error('the replica was opened with no attachment storage')
    await this.attachmentQueue.add(entityOf(this.registry, table).name, table, id, file)
    if (this.connectedNow) void this.attachmentQueue.upload().catch(() => undefined)
  }

  /** The files waiting to be uploaded, and those refused. */
  attachments(): Attachments {
    if (this.attachmentQueue === null)
      throw new Error('the replica was opened with no attachment storage')
    return this.attachmentQueue
  }

  /**
   * Reports the replica to the server at rest (postSyncDigest, D-125): its upload queue empty, every
   * row it holds one the server answered. It returns the server's verdict, or null when the replica is
   * not at rest or the server did not answer one (a household that does not write is refused 402,
   * its replicas keeping on). Told to download itself again, the replica does so once its queue has
   * drained, nothing queued discarded.
   */
  async report(): Promise<ReplicaDigestVerdict | null> {
    if ((await this.queued()) > 0) return null
    const held = await this.held()
    const listed = await entries(this.db, this.registry)
    if (listed === null) return null
    const checkpoint = await this.db.getOptional<{ op: number | string | null }>(
      "SELECT max(last_applied_op) AS op FROM ps_buckets WHERE name <> '$local'",
    )
    const failures = this.o.checksums?.count ?? 0
    const body: ReplicaDigest = {
      replica_id: await this.id(),
      checkpoint: String(checkpoint?.op ?? 0),
      algorithm,
      health: {
        pending_mutations: held.length,
        unresolved: (await this.inbox()).length,
        checksum_failures: failures,
      },
      entries: listed,
    }
    const send = async (): Promise<Response> =>
      this.fetch(`${this.o.apiUrl}/households/${this.household}/sync/digest`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.o.credential.current()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    let response = await send()
    if (response.status === 401) {
      await drain(response)
      try {
        await this.o.credential.renew()
      } catch (error) {
        if (error instanceof Revoked) this.discardSoon()
        throw error
      }
      response = await send()
    }
    if (response.status !== 200) {
      await drain(response)
      return null
    }
    const verdict = (await response.json()) as ReplicaDigestVerdict
    this.o.checksums?.take(failures)
    if (verdict.resnapshot_required) {
      await this.journal.setMeta(metaKeys.resnapshot, this.now().toISOString())
      this.whenDrained()
    }
    return verdict
  }

  /** Starts the download the server asked for, once nothing waits in the queue; at once if nothing does. */
  private whenDrained(): void {
    setTimeout(() => {
      void this.resnapshot().catch(() => undefined)
    }, 0)
  }

  /**
   * Downloads the replica again (D-125): once its upload queue has drained, so that nothing queued is
   * lost, it clears every synced row, keeps its own local tables (the outcomes, the holds, the files
   * waiting), and connects afresh, PowerSync sending every bucket whole. A queue that holds writes
   * leaves it marked, to be done after the next upload drains it.
   */
  resnapshot(): Promise<void> {
    this.resnapshotting ??= (async () => {
      if ((await this.queued()) > 0 || this.discarded) return
      const reconnect = this.connectedNow
      this.connectedNow = false
      this.stopReporting()
      for (const s of this.subscriptions ?? []) s.unsubscribe()
      this.subscriptions = null
      await this.db.disconnectAndClear({ clearLocal: false })
      await this.db.execute(`DELETE FROM ${localTables.rebase}`)
      await this.journal.setMeta(metaKeys.sent, '0')
      await this.journal.setMeta(metaKeys.resnapshot, null)
      if (reconnect) await this.connect()
    })().finally(() => {
      this.resnapshotting = null
    })
    return this.resnapshotting
  }

  /**
   * Discards the replica (FR-ID7): its device's sign-in ended, so everything it holds, its own local
   * tables too, leaves the device; onRevoked tells the app, which signs the member out.
   */
  async wipe(): Promise<void> {
    if (this.discarded) return
    this.discarded = true
    this.connectedNow = false
    this.stopReporting()
    for (const s of this.subscriptions ?? []) s.unsubscribe()
    this.subscriptions = null
    await this.db.disconnectAndClear({ clearLocal: true })
    for (const a of (await this.attachmentQueue?.list()) ?? [])
      await this.attachmentQueue?.remove(a.id)
    this.o.onRevoked?.()
  }

  /** wipe, outside the PowerSync loop that found the revocation, which it waits on. */
  private discardSoon(): void {
    setTimeout(() => {
      void this.wipe().catch(() => undefined)
    }, 0)
  }
}

/**
 * Merges the row write just queued for table's row id into the row's write queued before it, when that
 * one has not been sent and neither acts: the earlier keeps its mutation id and the version it was
 * made against, and takes the later's columns, fields and client time. A queued write at or below the
 * replica's sent mark may be in flight, and a retry must send it unchanged, so it is never merged into.
 * It returns the mutation id the write was merged into, or null when it stays a mutation of its own.
 */
async function mergeIntoPending(
  tx: Parameters<Parameters<CommonPowerSyncDatabase['writeTransaction']>[0]>[0],
  table: string,
  id: string,
): Promise<string | null> {
  interface Entry {
    op: 'PUT' | 'PATCH' | 'DELETE'
    id: string
    type: string
    data?: Record<string, unknown>
    metadata?: string
  }
  const latest = await tx.getOptional<{ id: number; data: string }>(
    'SELECT id, data FROM ps_crud ORDER BY id DESC LIMIT 1',
  )
  if (latest === null) return null
  const later = JSON.parse(latest.data) as Entry
  if (later.op !== 'PATCH' || later.type !== table || later.id !== id) return null
  const sent = await tx.getOptional<{ value: string | null }>(
    `SELECT value FROM ${localTables.meta} WHERE id = ?`,
    [metaKeys.sent],
  )
  const earlierRow = await tx.getOptional<{ id: number; data: string }>(
    `SELECT id, data FROM ps_crud
     WHERE id > ? AND id < ? AND json_extract(data, '$.type') = ? AND json_extract(data, '$.id') = ?
     ORDER BY id DESC LIMIT 1`,
    [Number(sent?.value ?? '0'), latest.id, table, id],
  )
  if (earlierRow === null) return null
  const earlier = JSON.parse(earlierRow.data) as Entry
  if (earlier.op === 'DELETE' || earlier.metadata === undefined || later.metadata === undefined)
    return null
  const first = JSON.parse(earlier.metadata) as WriteMetadata
  const second = JSON.parse(later.metadata) as WriteMetadata
  if (first.action !== undefined || second.action !== undefined) return null
  const laterLocal = new Set(second.local ?? [])
  const earlierSends = Object.keys(earlier.data ?? {}).filter(
    (c) => !(first.local ?? []).includes(c),
  )
  // A column the earlier write sends that the later sets for the replica alone would lose what the
  // earlier sent: the two stay apart.
  if (earlierSends.some((c) => laterLocal.has(c))) return null
  const laterSends = Object.keys(later.data ?? {}).filter((c) => !laterLocal.has(c))
  const local = [...new Set([...(first.local ?? []), ...laterLocal])].filter(
    (c) => !laterSends.includes(c),
  )
  const merged: WriteMetadata = {
    mutation_id: first.mutation_id,
    client_time: second.client_time,
    ...(first.base_version === undefined ? {} : { base_version: first.base_version }),
    ...(first.fields === undefined && second.fields === undefined
      ? {}
      : { fields: { ...first.fields, ...second.fields } }),
    ...(local.length === 0 ? {} : { local }),
  }
  const entry: Entry = {
    ...earlier,
    data: { ...earlier.data, ...later.data },
    metadata: encodeMetadata(merged),
  }
  await tx.execute('UPDATE ps_crud SET data = ? WHERE id = ?', [
    JSON.stringify(entry),
    earlierRow.id,
  ])
  await tx.execute('DELETE FROM ps_crud WHERE id = ?', [latest.id])
  return first.mutation_id
}
