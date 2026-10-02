// A replica on a phone (@powersync/react-native, on op-sqlite in an Expo dev build, PL-5): the mobile
// app's offline-first store (06-clients §1).

import { PowerSyncDatabase } from '@powersync/react-native'
import { ChecksumWatch } from '../src/checksums.ts'
import { servedRegistry } from '../src/registry.ts'
import { Replica, type ReplicaOptions } from '../src/replica.ts'
import { schemaOf } from '../src/schema.ts'

export interface NativeReplicaOptions extends Omit<ReplicaOptions, 'db' | 'checksums'> {
  /** The SQLite file the replica is kept in, one for each household (D-4). */
  readonly dbFilename: string
}

/** Opens a replica of options.household in the app's own storage, which a later open finds as it was left. */
export async function openReplica(options: NativeReplicaOptions): Promise<Replica> {
  const checksums = new ChecksumWatch()
  const db = new PowerSyncDatabase({
    schema: schemaOf(options.registry ?? servedRegistry),
    database: { dbFilename: options.dbFilename },
    logger: checksums,
  })
  await db.init()
  return new Replica({ ...options, db, checksums })
}
