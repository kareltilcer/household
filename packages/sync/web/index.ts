// A replica in a browser (@powersync/web, wa-sqlite over IndexedDB): the web client's queued writes
// and its cache (06-clients §1).

import { PowerSyncDatabase } from '@powersync/web'
import { ChecksumWatch } from '../src/checksums.ts'
import { servedRegistry } from '../src/registry.ts'
import { Replica, type ReplicaOptions } from '../src/replica.ts'
import { schemaOf } from '../src/schema.ts'

export { IndexDBFileSystemStorageAdapter } from '@powersync/web'
export { multipart } from '../src/multipart.ts'

export interface WebReplicaOptions extends Omit<ReplicaOptions, 'db' | 'checksums'> {
  /** The database the replica is kept in, one for each household (D-4). */
  readonly dbFilename: string
  /**
   * Whether tabs share one connection to PowerSync, through a shared worker; off by default. Either
   * way every tab that opens a household's replica opens its one database (dbFilename), and each
   * tab's Replica runs its own connector, whose lock and batch in flight are its own: two tabs
   * uploading at once send the same queued writes twice, under keys of their own, and one tab's
   * download or discard clears the database under the other. The app keeps one tab's replica of a
   * household open at a time (ADR 0019).
   */
  readonly multiTab?: boolean
}

/** Opens a replica of options.household in the browser's storage, which a later open finds as it was left. */
export async function openReplica(options: WebReplicaOptions): Promise<Replica> {
  const checksums = new ChecksumWatch()
  const db = new PowerSyncDatabase({
    schema: schemaOf(options.registry ?? servedRegistry),
    database: { dbFilename: options.dbFilename, enableMultiTabs: options.multiTab ?? false },
    logger: checksums,
  })
  await db.init()
  return new Replica({ ...options, db, checksums })
}
