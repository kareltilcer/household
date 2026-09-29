// The conformance module's tables as a client holds them (server/internal/conformance), declared
// once: the PowerSync schema each client opens, the fields its connector sends for each entity,
// and the form in which a replica's rows and the server's are compared.

import { Schema, Table, column } from '@powersync/node'

/** How a column's value is compared: a replica holds booleans as 0 and 1, and times as text. */
export type Kind = 'text' | 'uuid' | 'integer' | 'boolean' | 'timestamp' | 'date' | 'uuid[]'

export interface TableSpec {
  /** The table, the same name on the server and in a replica. */
  readonly table: string
  /** The sync entity whose rows it holds, or null for a projection, which no client writes. */
  readonly entity: string | null
  /** Every column but id, with its kind. */
  readonly columns: Readonly<Record<string, Kind>>
  /** The columns a client writes, which its mutations carry as fields; the rest are the server's. */
  readonly writes: readonly string[]
}

// The base columns every entity has (add_entity_columns), which only the server writes.
const base = {
  household_id: 'uuid',
  version: 'integer',
  created_by: 'uuid',
  created_at: 'timestamp',
  updated_by: 'uuid',
  updated_at: 'timestamp',
  deleted_at: 'timestamp',
} as const satisfies Record<string, Kind>

export const tables = [
  {
    table: 'conformance_items',
    entity: 'conformance.item',
    columns: { ...base, title: 'text', note: 'text', quantity: 'integer' },
    writes: ['title', 'note', 'quantity'],
  },
  {
    table: 'conformance_item_checks',
    entity: 'conformance.item_checked',
    columns: {
      ...base,
      item_id: 'uuid',
      checked: 'boolean',
      checked_at: 'timestamp',
      clock_flagged: 'boolean',
    },
    writes: ['item_id', 'checked'],
  },
  {
    table: 'conformance_readings',
    entity: 'conformance.reading',
    columns: { ...base, meter_id: 'uuid', read_at: 'timestamp', value: 'integer' },
    writes: ['meter_id', 'read_at', 'value'],
  },
  {
    table: 'conformance_budgets',
    entity: 'conformance.budget',
    columns: { ...base, name: 'text', amount_minor: 'integer', currency: 'text' },
    writes: ['name', 'amount_minor', 'currency'],
  },
  {
    table: 'conformance_notes',
    entity: 'conformance.note',
    columns: { ...base, visibility: 'text', owner_id: 'uuid', title: 'text', body: 'text' },
    writes: ['visibility', 'owner_id', 'title', 'body'],
  },
  {
    // A private note's redacted form (D-88), which item 14's stream writes to a client table of its
    // own for everyone with the grant, its owner included (D-93, ADR 0001; Admin.visible).
    table: 'conformance_notes_redacted',
    entity: null,
    columns: { household_id: 'uuid', owner_id: 'uuid', version: 'integer' },
    writes: [],
  },
  {
    table: 'conformance_chores',
    entity: 'conformance.chore',
    columns: { ...base, name: 'text', rotation: 'uuid[]', rotation_index: 'integer' },
    writes: ['name', 'rotation'],
  },
  {
    table: 'conformance_completions',
    entity: 'conformance.completion',
    columns: {
      ...base,
      chore_id: 'uuid',
      occurrence: 'date',
      done: 'boolean',
      done_at: 'timestamp',
    },
    writes: ['chore_id', 'occurrence', 'done'],
  },
  {
    table: 'conformance_attachments',
    entity: 'conformance.attachment',
    columns: {
      ...base,
      item_id: 'uuid',
      file_name: 'text',
      attachment_status: 'text',
      failure_reason: 'text',
    },
    writes: ['item_id', 'file_name', 'attachment_status'],
  },
  {
    table: 'conformance_conversations',
    entity: 'conformance.conversation',
    columns: { ...base, title: 'text' },
    writes: ['title'],
  },
  {
    table: 'conformance_conversation_members',
    entity: 'conformance.conversation_member',
    columns: { ...base, conversation_id: 'uuid', user_id: 'uuid', floor_seq: 'integer' },
    writes: ['conversation_id', 'user_id'],
  },
  {
    table: 'conformance_messages',
    entity: 'conformance.message',
    columns: { ...base, conversation_id: 'uuid', seq: 'integer', body: 'text', readers: 'uuid[]' },
    writes: ['conversation_id', 'body'],
  },
] as const satisfies readonly TableSpec[]

export type TableName = (typeof tables)[number]['table']
export type EntityType = NonNullable<(typeof tables)[number]['entity']>

export function tableSpec(table: string): TableSpec {
  const spec = tables.find((t) => t.table === table)
  if (spec === undefined) throw new Error(`no conformance table ${table}`)
  return spec
}

export function entitySpec(entity: string): TableSpec {
  const spec = tables.find((t) => t.entity === entity)
  if (spec === undefined) throw new Error(`no conformance entity ${entity}`)
  return spec
}

/** The local-only tables the suite's connector keeps (ADR 0001): what the next checkpoint must not replace. */
export const outcomesTable = 'conformance_outcomes'
export const heldTable = 'conformance_held'

function clientColumn(kind: Kind): typeof column.text | typeof column.integer {
  return kind === 'integer' || kind === 'boolean' ? column.integer : column.text
}

/**
 * The schema each client opens. Every table a client writes tracks the metadata of each write
 * (`_metadata`): the mutation id, the client time and the base version its mutation carries,
 * which a row write does not (ADR 0001).
 */
export const schema = new Schema({
  ...Object.fromEntries(
    tables.map((spec) => [
      spec.table,
      new Table(
        Object.fromEntries(
          Object.entries(spec.columns).map(([name, kind]) => [name, clientColumn(kind)]),
        ),
        { trackMetadata: spec.entity !== null },
      ),
    ]),
  ),
  // Each answer that was not `applied`, with its mutation: the conflict inbox and a rejection keep
  // what the member wrote from it.
  [outcomesTable]: new Table(
    {
      mutation_id: column.text,
      entity_type: column.text,
      entity_id: column.text,
      op: column.text,
      outcome: column.text,
      code: column.text,
      message: column.text,
      version: column.integer,
      row: column.text,
      mutation: column.text,
      answered_at: column.text,
    },
    { localOnly: true },
  ),
  // The mutations held to replay: a `deferred` one once its batch is answered, an `entitlement`
  // one once the household may write again.
  [heldTable]: new Table(
    {
      mutation_id: column.text,
      reason: column.text,
      position: column.integer,
      mutation: column.text,
      held_at: column.text,
    },
    { localOnly: true },
  ),
})

/** A column value in the form both sides are compared in. */
export type Canonical = string | number | boolean | null | readonly string[]

/** A scalar as text; anything else as its JSON. */
function text(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
    case 'bigint':
    case 'boolean':
      return value.toString()
    default:
      return value instanceof Date ? value.toISOString() : JSON.stringify(value)
  }
}

/** value, as a replica or the server holds a column of kind, in the form they are compared in. */
export function canonical(kind: Kind, value: unknown): Canonical {
  if (value === null || value === undefined) return null
  switch (kind) {
    case 'text':
      return text(value)
    case 'uuid':
      return text(value).toLowerCase()
    case 'integer':
      return Number(value)
    case 'boolean':
      return value === true || value === 1 || value === '1' || value === 't' || value === 'true'
    case 'timestamp': {
      const ms = value instanceof Date ? value.getTime() : Date.parse(text(value))
      return Number.isNaN(ms) ? text(value) : ms
    }
    case 'date':
      // The server's is read as text (Admin), never as a Date at some timezone's midnight.
      return text(value).slice(0, 10)
    case 'uuid[]': {
      const list: unknown = typeof value === 'string' ? parseList(value) : value
      return Array.isArray(list) ? list.map((v) => text(v).toLowerCase()).sort() : [text(value)]
    }
  }
}

// A replica holds an array as JSON; PostgreSQL's text form is {a,b}.
function parseList(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as unknown
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1)
    return inner === '' ? [] : inner.split(',')
  }
  return [trimmed]
}

/** A row in comparable form: its id and every column of spec, each canonical. */
export type CanonicalRow = Readonly<Record<string, Canonical>> & { readonly id: string }

export function canonicalRow(
  spec: TableSpec,
  row: Readonly<Record<string, unknown>>,
): CanonicalRow {
  const out: Record<string, Canonical> = {}
  for (const [name, kind] of Object.entries(spec.columns)) out[name] = canonical(kind, row[name])
  return { ...out, id: String(row['id']).toLowerCase() }
}
