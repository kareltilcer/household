// A replica's report of what it holds (D-125, ADR 0018, ADR 0019): per entity type, how many rows and
// the sum modulo 2^64 of each row's xxh3-64 of "<entity_id>:<version>", an order-independent hash the
// server computes over what the replica's member may see. No row data is sent.

import type { CommonPowerSyncDatabase } from '@powersync/common'
import type { components } from '@household/api'
import type { Registry } from './registry.ts'
import { hex64, utf8, xxh3 } from './xxh3.ts'

export type ReplicaDigest = components['schemas']['ReplicaDigest']
export type ReplicaDigestVerdict = components['schemas']['ReplicaDigestVerdict']
export type DigestEntry = ReplicaDigest['entries'][number]

/** The algorithm a report names. */
export const algorithm = 'xxh3-64'

const mask = (1n << 64n) - 1n

/** The hash of one row's pair: the xxh3-64 of its id in lowercase, a colon, and its version. */
export function pairHash(entityId: string, version: number): bigint {
  return xxh3(utf8(`${entityId.toLowerCase()}:${String(version)}`))
}

/** An entity type's rows as a replica holds them: how many, and the sum of their pairs' hashes. */
export class Digest {
  count = 0
  hash = 0n

  add(entityId: string, version: number): void {
    this.count++
    this.hash = (this.hash + pairHash(entityId, version)) & mask
  }

  get hex(): string {
    return hex64(this.hash)
  }
}

/** What a report reads a replica's rows with: its database, or a transaction of it. */
export type RowReader = Pick<CommonPowerSyncDatabase, 'getAll'>

/**
 * The entries of db's report, one for each entity the registry's streams send: its rows in its own
 * client table, and those only its redacted projection's table holds, each id once, since the server
 * counts an entity's rows by id whichever of its streams reach the caller. Null when a row the
 * replica holds has no version, a write the server has not answered, which a report at rest never
 * holds. db is best a read transaction, in which every table is read as one checkpoint left it.
 */
export async function entries(db: RowReader, registry: Registry): Promise<DigestEntry[] | null> {
  const out: DigestEntry[] = []
  const reported = new Set(registry.streams.map((s) => s.entity))
  for (const [name, entity] of Object.entries(registry.entities)) {
    if (!reported.has(name)) continue
    const versions = new Map<string, number | null>()
    for (const table of [entity.table, entity.redacted]) {
      if (table === undefined) continue
      for (const r of await db.getAll<{ id: string; version: number | null }>(
        `SELECT id, version FROM ${table}`,
      )) {
        const id = r.id.toLowerCase()
        if (!versions.has(id)) versions.set(id, r.version)
      }
    }
    const d = new Digest()
    for (const [id, version] of versions) {
      if (version === null) return null
      d.add(id, version)
    }
    out.push({ entity_type: name, hash: d.hex, count: d.count })
  }
  return out
}
