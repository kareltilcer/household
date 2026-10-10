// The attachment pending queue (D-25, PRD 03 §2.7, ADR 0019): a file taken offline waits in the
// device's own storage beside the row that names it, which syncs at once with its attachment pending,
// and is uploaded through its module's route once the server holds the row. An upload the server
// refuses for what the file is (its size, its type, the household's storage) is not retried: the server
// marks the row failed with the reason, and the queue keeps the refusal's code for the member. One the
// network or the server failed is tried again at the next run, as is one the household's state refused
// (FR-BI2), one refused by no problem of the API's (a proxy's answer, which has not judged the file), or
// one the server's limit refused (a 429), once the time each asks to be waited has passed: a run
// starts at every checkpoint, and every try sends the whole file. A file whose bytes the device no
// longer holds is kept as refused too (bytesLost), and one it cannot read is passed over until the next
// run: neither keeps the files behind it waiting.

import type { CommonPowerSyncDatabase, LocalStorageAdapter } from '@powersync/common'
import { maxRetryAfterMs, retryAfterMs, type Credential } from './connector.ts'
import { isEntitlement } from './mutation.ts'
import { localTables } from './schema.ts'

/**
 * How long the queue waits, once the household's state has refused a file, before it sends one again:
 * a household in grace writes and does not upload (PRD 04 §3), for days, and its rows keep syncing
 * meanwhile. The app that sees the household's state change ends the wait at once (resume). A refusal
 * that is no problem of the API's is waited out as long.
 */
export const stateRetryMs = 15 * 60_000

/**
 * The code a file is kept as refused with when the device no longer holds its bytes: no server's
 * refusal, but the same end, nothing left to send.
 */
export const bytesLost = 'bytes_lost'

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
  /** The refusal's code, for one that failed; bytesLost for one whose bytes the device lost. */
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

/** A file as it waits in the device's storage: where its bytes are, and what it says about itself. */
export interface StoredFile {
  /** Where the bytes wait, as the storage names the place (LocalStorageAdapter.getLocalUri). */
  readonly uri: string
  readonly contentType: string
  readonly fileName: string
}

/**
 * How a file is sent from where it waits, by a platform that sends one by its URI. The queue reads
 * none of it, so that no file is held in memory whole on its way out: a file may be a hundred
 * megabytes (FR-FL1), on a phone.
 */
export type StoredTransport = (
  url: string,
  credential: string,
  file: StoredFile,
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
   * `@household/sync/web`, which is handed the file's bytes; on React Native the app's own, `byUri`,
   * which is handed where the file waits and sends it from there.
   */
  readonly transport: UploadTransport | { readonly byUri: StoredTransport }
}

/** Reads and discards a response's body, which every platform's Response can: not all of them stream it. */
export async function drain(response: Response): Promise<void> {
  await response.text().catch(() => '')
}

/** The status of a response that says the file itself was refused, which no retry would change. */
function refusesTheFile(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429
}

/** The code of the problem document response carries, or null when it carries none. */
async function problemCode(response: Response): Promise<string | null> {
  try {
    const code = ((await response.json()) as { code?: unknown }).code
    return typeof code === 'string' && code !== '' ? code : null
  } catch {
    return null
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
   * household's state refused one, or something that is not the API did; a 429's Retry-After after
   * the server's limit did; 0 for now. It is kept in memory: a replica opened again tries once more.
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
      // The bytes the row names are gone, with the device's storage or in a run that ended between
      // deleting them and forgetting the row: nothing is left to send, and it is kept as refused,
      // for the member to see. Left waiting, its read would fail at every run, and no file behind
      // it would ever be sent.
      if (!(await this.options.storage.fileExists(a.local_uri))) {
        await this.db.execute(
          `UPDATE ${localTables.attachments} SET status = 'failed', code = ? WHERE id = ?`,
          [bytesLost, a.id],
        )
        continue
      }
      let send: (credential: string) => Promise<Response>
      if (typeof transport === 'function') {
        let data: ArrayBuffer
        try {
          data = await this.options.storage.readFile(a.local_uri)
        } catch {
          // Bytes the device holds and cannot read now are tried again at the next run, the files
          // behind them not kept waiting.
          await this.attempted(a.id)
          continue
        }
        const file: AttachmentFile = { data, contentType: a.content_type, fileName: a.file_name }
        send = (credential) => transport(url, credential, file, this.fetch)
      } else {
        // Sent from where it waits: nothing of it is read here.
        const file: StoredFile = {
          uri: a.local_uri,
          contentType: a.content_type,
          fileName: a.file_name,
        }
        send = (credential) => transport.byUri(url, credential, file, this.fetch)
      }
      // Read before the request: a credential that cannot be had is no failed upload, and one that
      // says the device's sign-in has ended (Revoked) is thrown to the replica, as renew()'s is.
      const credential = await this.credential.current()
      let response: Response
      try {
        response = await send(credential)
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
      // No refusal of the file, which waits, and its row with it, in two cases. It was refused for the
      // household's state, which does not upload now (grace, a restriction) and may again (PRD 04
      // §3). Or it was refused by no problem of the API's, which says why with a code: whatever
      // answered in its place, a proxy that lost its upstream or a host that is not the API, has not
      // judged the file, and its bytes are not dropped on its word. Either way no file is sent for a
      // while: what refused this one refuses the next.
      if (code === null || isEntitlement(code)) {
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
