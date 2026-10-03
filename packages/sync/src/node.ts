// A replica on Node (@powersync/node, on better-sqlite3): the conformance suite's clients, and any
// test that drives the library against the real stack (06-clients §1).

import { PowerSyncDatabase } from '@powersync/node'
import { ChecksumWatch } from './checksums.ts'
import { servedRegistry } from './registry.ts'
import { Replica, type ReplicaOptions } from './replica.ts'
import { schemaOf } from './schema.ts'

export { NodeFileSystemAdapter } from '@powersync/node'
export { multipart } from './multipart.ts'

export interface NodeReplicaOptions extends Omit<ReplicaOptions, 'db' | 'checksums'> {
  /** The SQLite file the replica is kept in, one for each household (D-4). */
  readonly dbFilename: string
  /** The directory it is in. */
  readonly dbLocation?: string
}

/** Opens a replica of options.household in its own SQLite file, which a later open finds as it was left. */
export async function openReplica(options: NodeReplicaOptions): Promise<Replica> {
  const checksums = new ChecksumWatch()
  const db = new PowerSyncDatabase({
    schema: schemaOf(options.registry ?? servedRegistry),
    database: {
      dbFilename: options.dbFilename,
      ...(options.dbLocation === undefined ? {} : { dbLocation: options.dbLocation }),
    },
    logger: checksums,
  })
  await db.init()
  return new Replica({ ...options, db, checksums })
}
