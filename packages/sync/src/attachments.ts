// The attachment pending queue (D-25, PRD 03 §2.7, ADR 0019): a file taken offline waits in the
// device's own storage beside the row that names it, which syncs at once with its attachment pending,
// and is uploaded through its module's route once the server holds the row. An upload the server
// refuses for what the file is (its size, its type, the household's storage) is not retried: the server
// marks the row failed with the reason, and the queue keeps the refusal's code for the member. One the
// network or the server failed is tried again at the next run, as is one the household's state refused
// (FR-BI2) or the server's limit did (a 429), once the time each asks to be waited has passed: a run
// starts at every checkpoint, and every try sends the whole file.

import type { CommonPowerSyncDatabase, LocalStorageAdapter } from '@powersync/common'
import { maxRetryAfterMs, retryAfterMs, type Credential } from './connector.ts'
import { isEntitlement } from './mutation.ts'
import { localTables } from './schema.ts'

/**
 * How long the queue waits, once the household's state has refused a file, before it sends one again:
 * a household in grace writes and does not upload (PRD 04 §3), for days, and its rows keep syncing
 * meanwhile. The app that sees the household's state change ends the wait at once (resume).
 */
export const stateRetryMs = 15 * 60_000

/** A file waiting to be uploaded, or refused. */
export interface PendingAttachment {
  /** The id of the row the file belongs to. */
  readonly id: string
  readonly entity_type: string
  readonly table_name: string
  readonly file_name: string
  readonly content_type: string
  readonly size: number
  readonly local_uri: string
  readonly status: 'pending' | 'failed'
  readonly attempts: number
  /** The refusal's code, for one that failed. */
  readonly code: string | null
}

/** The bytes of a file, and what it says about itself. */
export interface AttachmentFile {
  readonly data: ArrayBuffer
  readonly contentType: string
  readonly fileName: string
}

/** How a file is sent: multipart, its field `file`, by default (files.Receive). */
export type UploadTransport = (
  url: string,
  credential: string,
  file: AttachmentFile,
  fetch: typeof globalThis.fetch,
) => Promise<Response>

export interface AttachmentOptions {
  /** Where the bytes wait: PowerSync's adapter for the platform, or the app's. */
  readonly storage: LocalStorageAdapter
  /**
   * The URL of the module's route that takes an entity's file, or null for an entity that has none.
   */
  readonly uploadUrl: (entityType: string, household: string, entityId: string) => string | null
  /**
   * How a file is sent: `multipart` on Node and in a browser, from `@household/sync/node` and
   * `@household/sync/web`; on React Native, whose FormData takes a file by its URI, the app's.
   */
  readonly transport: UploadTransport
}

/** Reads and discards a response's body, which every platform's Response can: not all of them stream it. */
export async function drain(response: Response): Promise<void> {
  await response.text().catch(() => '')
}

/** The status of a response that says the file itself was refused, which no retry would change. */
function refusesTheFile(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429
}

async function problemCode(response: Response): Promise<string> {
  try {
    const code = ((await response.json()) as { code?: unknown }).code
    return typeof code === 'string' ? code : String(response.status)
  } catch {
    return String(response.status)
  }
}

/** The queue of one replica's files. */
export class Attachments {
  private readonly db: CommonPowerSyncDatabase
  private readonly household: string
  private readonly options: AttachmentOptions
  private readonly credential: Credential
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => Date
  private running: Promise<void> | null = null
  /** How many times upload() was called: a run that ends with more calls than it listed for is followed by another. */
  private calls = 0
  /**
   * When a run may next send a file, in milliseconds since the epoch: stateRetryMs after the
   * household's state refused one, a 429's Retry-After after the server's limit did; 0 for now. It is
   * kept in memory: a replica opened again tries once more.
   */
  private notBefore = 0

  constructor(
    db: CommonPowerSyncDatabase,
    household: string,
    options: AttachmentOptions,
    credential: Credential,
    fetch: typeof globalThis.fetch,
    now: () => Date,
  ) {
    this.db = db
    this.household = household
    this.options = options
    this.credential = credential
    this.fetch = fetch
    this.now = now
  }

  /** Keeps file's bytes for the row id of table, entityType's, until they are uploaded. */
  async add(entityType: string, table: string, id: string, file: AttachmentFile): Promise<void> {
    await this.options.storage.initialize()
    const uri = this.options.storage.getLocalUri(id)
    await this.options.storage.saveFile(uri, file.data)
    await this.db.writeTransaction(async (tx) => {
      await tx.execute(`DELETE FROM ${localTables.attachments} WHERE id = ?`, [id])
      await tx.execute(
        `INSERT INTO ${localTables.attachments} (id, entity_type, table_name, file_name, content_type, size, local_uri, status, attempts, code, queued_at, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, (SELECT coalesce(max(position), 0) + 1 FROM ${localTables.attachments}))`,
        [
          id,
          entityType,
          table,
          file.fileName,
          file.contentType,
          file.data.byteLength,
          uri,
          this.now().toISOString(),
        ],
      )
    })
  }

  /** The files waiting, and those refused, oldest first. */
  list(): Promise<PendingAttachment[]> {
    return this.db.getAll<PendingAttachment>(
      `SELECT id, entity_type, table_name, file_name, content_type, size, local_uri, status, attempts, code
       FROM ${localTables.attachments} ORDER BY position`,
    )
  }

  /** Forgets a file, uploaded or not. */
  async remove(id: string): Promise<void> {
    const row = await this.db.getOptional<{ local_uri: string }>(
      `SELECT local_uri FROM ${localTables.attachments} WHERE id = ?`,
      [id],
    )
    if (row === null) return
    if (await this.options.storage.fileExists(row.local_uri))
      await this.options.storage.deleteFile(row.local_uri)
    await this.db.execute(`DELETE FROM ${localTables.attachments} WHERE id = ?`, [id])
  }

  /**
   * Uploads the files whose rows the server holds, oldest first, until one fails on the network or the
   * server: the rest wait for the next run. A run inside the time a refusal asked to be waited (the
   * household's state, a 429) sends none. A run already under way is joined, not doubled, and is
   * followed by another: it listed the files before this call, and one added since, or one whose row
   * a checkpoint has brought since, would otherwise wait for a call that may be long in coming.
   */
  upload(): Promise<void> {
    this.calls++
    this.running ??= (async () => {
      let listed: number
      do {
        listed = this.calls
        await this.run()
      } while (listed !== this.calls)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  /**
   * Ends the wait a refusal set: the next run sends again. The replica calls it when its app says the
   * household's state has changed (Replica.resume).
   */
  resume(): void {
    this.notBefore = 0
  }

  private async run(): Promise<void> {
    // No longer than the longest a refusal asks: a wait further off is a clock that has moved since.
    const wait = this.notBefore - this.now().getTime()
    if (wait > 0 && wait <= maxRetryAfterMs) return
    const transport = this.options.transport
    for (const a of await this.list()) {
      if (a.status !== 'pending') continue
      // The server takes the bytes of a row it holds: one the replica holds at a version it was sent.
      const row = await this.db.getOptional<{ version: number | null }>(
        `SELECT version FROM ${a.table_name} WHERE id = ?`,
        [a.id],
      )
      if (row?.version === null || row?.version === undefined) continue
      const url = this.options.uploadUrl(a.entity_type, this.household, a.id)
      if (url === null) continue
      const data = await this.options.storage.readFile(a.local_uri)
      const file: AttachmentFile = { data, contentType: a.content_type, fileName: a.file_name }
      // Read before the request: a credential that cannot be had is no failed upload, and one that
      // says the device's sign-in has ended (Revoked) is thrown to the replica, as renew()'s is.
      const credential = await this.credential.current()
      let response: Response
      try {
        response = await transport(url, credential, file, this.fetch)
      } catch {
        await this.attempted(a.id)
        return
      }
      if (response.ok) {
        await drain(response)
        await this.remove(a.id)
        continue
      }
      if (response.status === 401) {
        await drain(response)
        await this.credential.renew()
        return
      }
      if (!refusesTheFile(response.status)) {
        // The server's limit names how long to wait, a day at most as the push's does.
        if (response.status === 429) {
          const now = this.now().getTime()
          this.notBefore =
            now + Math.min(maxRetryAfterMs, retryAfterMs(response.headers.get('retry-after'), now))
        }
        await drain(response)
        await this.attempted(a.id)
        return
      }
      const code = await problemCode(response)
      // Refused for the household's state, which does not upload now (grace, a restriction) and may
      // again (PRD 04 §3): no refusal of the file, which waits, and its row with it. No file is sent
      // for a while: the state that refused this one refuses the next.
      if (isEntitlement(code)) {
        this.notBefore = this.now().getTime() + stateRetryMs
        await this.attempted(a.id)
        return
      }
      // Refused for what it is: the row is marked failed on the server; the bytes are of no further use.
      if (await this.options.storage.fileExists(a.local_uri))
        await this.options.storage.deleteFile(a.local_uri)
      await this.db.execute(
        `UPDATE ${localTables.attachments} SET status = 'failed', code = ?, attempts = attempts + 1 WHERE id = ?`,
        [code, a.id],
      )
    }
  }

  private async attempted(id: string): Promise<void> {
    await this.db.execute(
      `UPDATE ${localTables.attachments} SET attempts = attempts + 1 WHERE id = ?`,
      [id],
    )
  }
}
