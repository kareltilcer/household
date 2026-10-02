// The client registry (plan item 18, ADR 0019): what a replica is built from, generated from the
// server's entity registry and the schema its migrations make (server/internal/syncconfig). It names
// the streams a replica subscribes to with its household, each entity's client table, merge policy and
// offline-write flag, and each client table's columns with the kind a client holds each one as.

import served from './generated/registry.json'

/**
 * How a client holds a column. A boolean is stored as 0 or 1 and sent as a boolean; an array and a
 * JSON value are stored as their JSON text and sent as the value; the rest are sent as stored.
 */
export type Kind =
  | 'text'
  | 'uuid'
  | 'integer'
  | 'real'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'json'
  | 'uuid[]'
  | 'text[]'

/** An entity's merge policy (PRD 03 §2.5, D-24). */
export type Policy = 'lww_field' | 'additive' | 'lww_row' | 'strict_version' | 'state_set'

/** A stream a replica subscribes to with its household, and the client table its rows go to. */
export interface ClientStream {
  readonly stream: string
  readonly entity: string
  readonly table: string
}

export interface ClientEntity {
  /** The module it belongs to, whose enablement tells one withdrawal from another. */
  readonly module: string
  readonly table: string
  /** Its redacted projection's client table, when it has one (D-88). */
  readonly redacted?: string
  readonly policy: Policy
  /** Whether a client may write it offline (D-84). */
  readonly offline_writes: boolean
}

export interface ClientTable {
  readonly entity: string
  /** Whether it holds its entity's redacted projection, which no client writes. */
  readonly redacted: boolean
  /** Every column but id, with its kind. */
  readonly columns: Readonly<Record<string, Kind>>
}

export interface Registry {
  readonly description: string
  readonly streams: readonly ClientStream[]
  readonly entities: Readonly<Record<string, ClientEntity>>
  readonly tables: Readonly<Record<string, ClientTable>>
}

const kinds: ReadonlySet<string> = new Set<Kind>([
  'text',
  'uuid',
  'integer',
  'real',
  'boolean',
  'timestamp',
  'date',
  'json',
  'uuid[]',
  'text[]',
])
const policies: ReadonlySet<string> = new Set<Policy>([
  'lww_field',
  'additive',
  'lww_row',
  'strict_version',
  'state_set',
])

/**
 * value as a registry, or a throw naming what is wrong with it: a column of no kind, an entity of no
 * policy, a stream or a table naming an entity the registry does not hold, or an entity naming a
 * table it does not.
 */
export function asRegistry(value: unknown): Registry {
  const r = value as Partial<Registry> | null
  if (
    r === null ||
    typeof r !== 'object' ||
    !Array.isArray(r.streams) ||
    typeof r.entities !== 'object' ||
    typeof r.tables !== 'object'
  ) {
    throw new Error('a client registry holds streams, entities and tables')
  }
  const registry = r as Registry
  for (const [name, table] of Object.entries(registry.tables)) {
    if (registry.entities[table.entity] === undefined)
      throw new Error(`the client table ${name} holds ${table.entity}, which the registry does not`)
    for (const [column, kind] of Object.entries(table.columns)) {
      if (!kinds.has(kind)) throw new Error(`${name}.${column} is of no kind a client holds`)
    }
  }
  for (const [name, entity] of Object.entries(registry.entities)) {
    if (!policies.has(entity.policy)) throw new Error(`${name} declares no merge policy`)
    for (const table of [entity.table, entity.redacted]) {
      if (table !== undefined && registry.tables[table] === undefined)
        throw new Error(`${name}'s client table ${table} is not in the registry`)
    }
  }
  for (const s of registry.streams) {
    if (registry.entities[s.entity] === undefined || registry.tables[s.table] === undefined)
      throw new Error(
        `the stream ${s.stream} names an entity or a table the registry does not hold`,
      )
  }
  return registry
}

/** The registry of the server's streams, which the clients ship. */
export const servedRegistry: Registry = asRegistry(served)

/** The client table table's spec, or a throw. */
export function tableOf(registry: Registry, table: string): ClientTable {
  const spec = registry.tables[table]
  if (spec === undefined) throw new Error(`no client table ${table}`)
  return spec
}

/** The entity whose full rows table holds, or a throw for a table that holds none, a projection. */
export function entityOf(
  registry: Registry,
  table: string,
): ClientEntity & { readonly name: string } {
  const spec = tableOf(registry, table)
  const entity = registry.entities[spec.entity]
  if (entity === undefined || spec.redacted)
    throw new Error(`${table} is a redacted projection, which no client writes`)
  return { ...entity, name: spec.entity }
}
