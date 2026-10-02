// The tables a client of the suite holds, as the suite's oracle reads them: the conformance module's
// (server/internal/conformance) and admin's, whose streams every member subscribes to (PRD modules/17
// Sync); the fields a client writes of each entity, and the form in which a replica's rows and the
// server's are compared. The schema each client opens is the library's, built from the suite's
// generated registry (suiteRegistry); harness.test.ts holds these declarations to it, so the oracle
// cannot drift from what a replica holds.

import { asRegistry, type Registry } from '../../src/index.ts'
import generated from '../stack/powersync/registry.json'

/** The suite's client registry, generated from the entity registry (server/internal/syncconfig). */
export const suiteRegistry: Registry = asRegistry(generated)

/** How a column's value is compared: a replica holds booleans as 0 and 1, and times as text. */
export type Kind =
  'text' | 'uuid' | 'integer' | 'boolean' | 'timestamp' | 'date' | 'uuid[]' | 'json'

export interface TableSpec {
  /** The table, the same name on the server and in a replica. */
  readonly table: string
  /** The sync entity whose rows it holds, or null for a projection, which no client writes. */
  readonly entity: string | null
  /** Every column but id, with its kind. */
  readonly columns: Readonly<Record<string, Kind>>
  /** The columns a client writes, which its mutations carry as fields; the rest are the server's. */
  readonly writes: readonly string[]
  /**
   * For a projection, the server table its rows are read from and the condition that picks them
   * out of it: the server has no table of the projection's name, only a replica does (Admin).
   */
  readonly source?: { readonly table: string; readonly where: string }
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
  // admin's, which no client writes offline (D-80): the household's settings, without its code, with
  // its entitlement as its banner shows it (D-124); its memberships, each with its member's grants and
  // a child profile's locks, without a child's birth year; which modules it enables; and its
  // invitations, without their tokens, which only the members granted admin replicate. The settings
  // name their household by their own id, and carry no household_id.
  {
    table: 'households',
    entity: 'admin.household_settings',
    columns: {
      name: 'text',
      country: 'text',
      timezone: 'text',
      base_currency: 'text',
      locale: 'text',
      units: 'text',
      first_day_of_week: 'integer',
      billing_payer_id: 'uuid',
      billing_state: 'text',
      trial_ends_at: 'timestamp',
      grace_ends_at: 'timestamp',
      retained_until: 'timestamp',
      restricted_at: 'timestamp',
      restricted_by: 'uuid',
      restricted_by_label: 'text',
      restriction_reason: 'text',
      version: 'integer',
      created_by: 'uuid',
      created_at: 'timestamp',
      updated_by: 'uuid',
      updated_at: 'timestamp',
      deleted_at: 'timestamp',
    },
    writes: [],
  },
  {
    table: 'memberships',
    entity: 'admin.membership',
    columns: {
      ...base,
      user_id: 'uuid',
      role: 'text',
      grants: 'json',
      dashboard_locked: 'boolean',
      pin_locked: 'boolean',
    },
    writes: [],
  },
  {
    table: 'module_enablement',
    entity: 'admin.module_enablement',
    columns: { ...base, module: 'text', enabled: 'boolean' },
    writes: [],
  },
  {
    table: 'invitations',
    entity: 'admin.invitation',
    columns: {
      ...base,
      kind: 'text',
      email: 'text',
      role: 'text',
      grants: 'json',
      dashboard_layout: 'json',
      message: 'text',
      invited_by: 'uuid',
      expires_at: 'timestamp',
      max_uses: 'integer',
      uses: 'integer',
      status: 'text',
    },
    writes: [],
  },
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
    // A private note's redacted form (D-88), which its own streams write to a client table of its
    // own for everyone with the grant, its owner included (D-93, ADR 0001; Admin.visible).
    table: 'conformance_notes_redacted',
    entity: null,
    columns: {
      household_id: 'uuid',
      owner_id: 'uuid',
      version: 'integer',
      deleted_at: 'timestamp',
    },
    writes: [],
    source: { table: 'conformance_notes', where: "visibility = 'private'" },
  },
  {
    // A note's comment, which carries its note's visibility and owner, rewritten when the note moves
    // between shared and private, which is no edit of the comment (ADR 0018).
    table: 'conformance_note_comments',
    entity: 'conformance.note_comment',
    columns: { ...base, note_id: 'uuid', visibility: 'text', owner_id: 'uuid', body: 'text' },
    writes: ['note_id', 'body'],
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
      rotated: 'boolean',
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
    case 'json':
      // As its keys sort: a replica holds PostgreSQL's text of a jsonb, and the server reads it back
      // parsed.
      return stable(typeof value === 'string' ? (JSON.parse(value) as unknown) : value)
    case 'uuid[]': {
      // In order: a chore's rotation means its order, so a replica holding it in another order
      // than the server has not converged.
      const list: unknown = typeof value === 'string' ? parseList(value) : value
      return Array.isArray(list) ? list.map((v) => text(v).toLowerCase()) : [text(value)]
    }
  }
}

/** value as JSON, every object's keys in order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
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
