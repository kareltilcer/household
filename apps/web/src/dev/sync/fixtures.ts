// The sync UI's fixtures: a registry of entities that are written offline, the answers a replica
// would keep of writes to them, and how their modules would describe them. None of it is the
// server's: the registry the server serves holds four admin entities, none written offline (plan
// item 25), so the inbox, its resolvers and the row states are drawn and tested over these. The
// entities are the ones design/v1's sync stage draws, a settlement in Finance, a meter reading
// in Utilities, a note and a shopping item, each under the merge policy PRD 03 §2.5 gives it.
//
// Everything written here is a fixture, in English and in no catalog (harness/model.ts says
// why); the dev page accents it under the pseudo-locale, which is why a describer is handed the
// page's `sample`. This file is data and pure functions, with nothing of the DOM's.
import { money } from '@household/domain'
import type { RecordedOutcome, Registry } from '@household/sync'
import { paths } from '../../app/paths.ts'
import type { Describers, Side } from '../../sync/describe.ts'
import { rejectionCodes } from '../../sync/rejection.ts'
import type { Setting } from '../../sync/setting.ts'
import type { Sample } from '../sample.ts'

export const registry: Registry = {
  description: 'The sync UI’s fixtures: no registry the server serves.',
  streams: [],
  entities: {
    'finance.settlement': {
      module: 'finance',
      table: 'settlements',
      policy: 'strict_version',
      offline_writes: true,
    },
    'utilities.reading': {
      module: 'utilities',
      table: 'meter_readings',
      policy: 'additive',
      offline_writes: true,
    },
    'notes.note': { module: 'notes', table: 'notes', policy: 'lww_row', offline_writes: true },
    'shopping.item': {
      module: 'shopping',
      table: 'shopping_items',
      policy: 'lww_field',
      offline_writes: true,
    },
    // Written online alone (D-84): what a write of it is refused for.
    'admin.membership': {
      module: 'admin',
      table: 'memberships',
      policy: 'strict_version',
      offline_writes: false,
    },
  },
  tables: {
    settlements: {
      entity: 'finance.settlement',
      redacted: false,
      columns: { title: 'text', amount_minor: 'integer', currency: 'text', due: 'date' },
    },
    meter_readings: {
      entity: 'utilities.reading',
      redacted: false,
      columns: { meter: 'text', value: 'real', read_on: 'date' },
    },
    notes: { entity: 'notes.note', redacted: false, columns: { title: 'text', body: 'text' } },
    shopping_items: {
      entity: 'shopping.item',
      redacted: false,
      columns: { name: 'text', quantity: 'integer', position: 'text' },
    },
    memberships: { entity: 'admin.membership', redacted: false, columns: { role: 'text' } },
  },
}

/** The household the fixtures are in: an id that is nobody's. */
export const household = '0198a000-0000-7000-8000-000000000001'

/** The other author of the fixtures' conflict, whom the fixture setting can name. */
export const petr = '0198a000-0000-7000-8000-0000000000b2'
/** An author no setting names: someone who has left the household. */
export const stranger = '0198a000-0000-7000-8000-0000000000c3'
/** The member the fixtures are drawn for. */
export const me = '0198a000-0000-7000-8000-0000000000a1'

interface OutcomeFixture {
  /** The mutation's id, and the answer's: short, since a test names it. */
  readonly id: string
  readonly entityType: string
  readonly outcome: RecordedOutcome['outcome']
  readonly op?: RecordedOutcome['op']
  readonly code?: string
  readonly fields?: Side
  readonly row?: Side
  readonly overridden?: readonly string[]
  /** When the member's device made the change. */
  readonly madeAt?: string
  readonly answeredAt?: string
}

/** An answer as a replica keeps one, of a mutation as the member's device made it. */
export function answer({
  id,
  entityType,
  outcome,
  op = 'update',
  code,
  fields = {},
  row,
  overridden = [],
  madeAt = '2026-03-03T17:12:00Z',
  answeredAt = '2026-03-03T17:41:00Z',
}: OutcomeFixture): RecordedOutcome {
  const entityId = `0198a000-0000-7000-8000-${id.padStart(12, '0').slice(-12)}`
  return {
    id: `answer-${id}`,
    mutation_id: id,
    entity_type: entityType,
    entity_id: entityId,
    op,
    outcome,
    code: code ?? null,
    // A developer's English, as the server writes it: no screen shows it.
    message: code === undefined ? null : `refused: ${code}`,
    version: null,
    row: row ?? null,
    mutation: {
      mutation_id: id,
      entity_type: entityType,
      entity_id: entityId,
      op,
      fields: { ...fields },
      client_time: madeAt,
    },
    answered_at: answeredAt,
    unresolved: true,
    overridden,
  }
}

/** The conflict design/v1 draws first: one settlement, two amounts, two authors, two times. */
export const conflict = answer({
  id: 'c1',
  entityType: 'finance.settlement',
  outcome: 'conflict',
  code: 'version_conflict',
  fields: { amount_minor: 45000 },
  row: {
    title: 'March electricity settlement',
    amount_minor: 50000,
    currency: 'CZK',
    due: '2026-03-15',
    updated_by: petr,
    updated_at: '2026-03-03T17:40:00Z',
  },
})

/** A change of the member's own to a row another member has since deleted. */
export const conflictWithDeletion = answer({
  id: 'c2',
  entityType: 'finance.settlement',
  outcome: 'conflict',
  code: 'version_conflict',
  fields: { due: '2026-03-20' },
  row: {
    title: 'February water settlement',
    amount_minor: 18400,
    currency: 'CZK',
    due: '2026-03-10',
    updated_by: stranger,
    updated_at: '2026-03-02T08:05:00Z',
    deleted_at: '2026-03-02T08:05:00Z',
  },
  madeAt: '2026-03-02T19:30:00Z',
  answeredAt: '2026-03-03T06:10:00Z',
})

/** What the member entered, for a refusal that carries no row. */
const oatMilk: Side = { name: 'Oat milk', quantity: 2, position: 'a0V' }

/** A change that was not accepted, for each code a refusal is recorded with, and for one it is not. */
export const rejections: readonly RecordedOutcome[] = [...rejectionCodes, 'teapot'].map(
  (code, index) =>
    code === 'monotonicity_violation'
      ? answer({
          id: `r${String(index)}`,
          entityType: 'utilities.reading',
          outcome: 'rejected',
          op: 'create',
          code,
          fields: { meter: 'Electricity, cellar meter', value: 18116, read_on: '2026-03-10' },
          // The neighbour, as the push carries it: the fields the series is held by.
          row: { id: 'neighbour', value: 18402.4, read_on: '2026-03-03' },
          answeredAt: '2026-03-10T19:02:00Z',
        })
      : answer({
          id: `r${String(index)}`,
          entityType: 'shopping.item',
          outcome: 'rejected',
          op: code === 'fair_use_ceiling' ? 'create' : 'update',
          code,
          fields: oatMilk,
          answeredAt: `2026-03-0${String((index % 8) + 1)}T09:15:00Z`,
        }),
)

/** The refusal recorded with `code`, among the fixtures. */
export function rejectionWith(code: string): RecordedOutcome {
  const found = rejections.find((entry) => entry.code === code)
  if (found === undefined) throw new Error(`no fixture is refused ${code}`)
  return found
}

/** A merge that overrode a field the member set: the row holds another quantity. */
export const overriddenMerge = answer({
  id: 'm1',
  entityType: 'shopping.item',
  outcome: 'merged',
  code: 'concurrent_change',
  fields: { quantity: 2 },
  row: { name: 'Oat milk', quantity: 3 },
  overridden: ['quantity'],
  answeredAt: '2026-03-04T07:20:00Z',
})

/** A merge of an entity that keeps its loser: the member's body replaced one they had not seen. */
export const replacingMerge = answer({
  id: 'm2',
  entityType: 'notes.note',
  outcome: 'merged',
  code: 'concurrent_change',
  fields: { body: 'Tent, stove, the blue cool box.' },
  row: { title: 'Packing list', body: 'Tent, stove, the blue cool box.' },
  answeredAt: '2026-03-04T07:25:00Z',
})

/** Everything at once, oldest first, as an inbox lists it. */
export const everything: readonly RecordedOutcome[] = [
  conflictWithDeletion,
  conflict,
  ...rejections,
  overriddenMerge,
  replacingMerge,
].toSorted((a, b) => a.answered_at.localeCompare(b.answered_at))

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * How the fixtures' modules describe their rows: what a module registers in sync/describe.ts,
 * written here for the entities above. `sample` accents what a member would have written.
 */
export function describersFor(sample: Sample): Describers {
  const written = (value: unknown) => sample(text(value))
  const here = () => paths.devSync.path
  return {
    'finance.settlement': {
      name: ({ fields, row }) => sample(text(fields.title ?? row?.title) || 'A settlement'),
      fields: {
        amount_minor: {
          label: () => sample('Amount'),
          value: (value, side, { format }) =>
            format.money(money(Number(value), text(side.currency) || 'CZK')),
        },
        due: {
          label: () => sample('Due'),
          value: (value, _side, { format }) => format.day(text(value)),
        },
      },
      address: here,
    },
    'utilities.reading': {
      name: ({ fields }) => sample(text(fields.meter) || 'A meter reading'),
      fields: {
        value: {
          label: () => sample('Reading'),
          value: (value, _side, { format }) => `${format.number(Number(value))} kWh`,
        },
        read_on: {
          label: () => sample('Read on'),
          value: (value, _side, { format }) => format.day(text(value)),
        },
      },
      address: here,
    },
    'notes.note': {
      name: ({ fields, row }) => sample(text(fields.title ?? row?.title) || 'A note'),
      fields: { body: { label: () => sample('Text'), value: written } },
      address: here,
    },
    // No address: a shopping item is edited in its list, which these fixtures have none of.
    'shopping.item': {
      name: ({ fields, row }) => sample(text(fields.name ?? row?.name) || 'A shopping item'),
      fields: {
        name: { label: () => sample('Item'), value: written },
        quantity: {
          label: () => sample('Quantity'),
          value: (value, _side, { format }) => format.number(Number(value)),
        },
      },
    },
  }
}

/** The household the fixtures are drawn in, which names Petr and nobody else. */
export function settingFor(sample: Sample, { writes = true } = {}): Setting {
  return {
    household,
    timezone: 'Europe/Prague',
    writes,
    author: (user) => {
      if (user === me) return { kind: 'me' }
      return user === petr ? { kind: 'member', name: sample('Petr') } : { kind: 'unknown' }
    },
  }
}
