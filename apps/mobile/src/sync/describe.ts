// How a module describes its rows to the sync UI (F-5 to F-7, 06-clients §5). An answer the
// replica kept says what it is about by an entity's type and id and by the fields the member set,
// which is nothing a member reads: "both values, both authors, both times, and no jargon" needs
// the row's name, each field's label and each value as the module's own screens show it. A module
// whose entities are written offline registers a describer for each here, by entity type
// (`RecordedOutcome.entity_type`, such as `shopping.item`), in the pull request that adds its
// screens. The web's is its twin (apps/web/src/sync/describe.ts): the two clients share no code
// (D-36), and a module describes its rows to each.
//
// The registry is empty: no entity the server serves is written offline yet, so nothing reaches
// the inbox on real data. A row no module describes is read generically, by its module's name,
// with each field under its own key and its value as written. That reading is plain, not pretty,
// and it is never reached in production today: it is there so that a module which lands its
// offline writes before its describer shows what it holds and not a blank row.
import type { Translate } from '@household/i18n'
import type { RecordedOutcome, Registry } from '@household/sync'
import { moduleIds, type ModuleId } from '@household/tokens'
import type { Formatters } from '../i18n/format.ts'

/** What a describer writes with: the member's language and formats, and the household's zone. */
export interface Words {
  readonly t: Translate
  readonly format: Formatters
  /** The zone an instant is read in: the household's, which is never assumed. */
  readonly timezone: string
}

/** One version of a row, or the part of one a change set: its fields by key. */
export type Side = Readonly<Record<string, unknown>>

/** What an answer is about, as a describer is handed it. */
export interface Subject {
  readonly entityType: string
  /** The row's id. */
  readonly id: string
  readonly op: RecordedOutcome['op']
  /** What the member's change set: only the fields they changed, which for a create is every one. */
  readonly fields: Side
  /**
   * The row the answer carried, where it carried one: the server's own on a conflict or a merge,
   * and the neighbour on a refusal for a value out of order. No other refusal carries one.
   */
  readonly row: Side | undefined
}

export interface FieldDescriber {
  readonly label: (words: Words) => string
  /**
   * `value` as a member reads it. `side` is every field known of the version it is from, for a
   * value that is read beside another: an amount beside its currency.
   */
  readonly value: (value: unknown, side: Side, words: Words) => string
}

export interface Describer {
  /** What the row is called, from what the member set and the row the answer carried. */
  readonly name: (subject: Subject, words: Words) => string
  /**
   * The fields a comparison shows, by key. A field left out is not shown: one no member sets by
   * name, a position in a list, or a currency that is read with its amount.
   */
  readonly fields: Readonly<Record<string, FieldDescriber>>
  /**
   * The address that opens the row in `household`, where it has a screen of its own: where a
   * member edits a change that was refused, or enters a value that is neither of a conflict's two.
   */
  readonly address?: (subject: Subject, household: string) => string | undefined
}

/** The describers of a build, by entity type. */
export type Describers = Readonly<Record<string, Describer>>

/** The app's own: none yet. The first are the first module's that is written offline. */
export const describers: Describers = {}

/** One field of a comparison: what the member set, and what the row the answer carried holds. */
export interface ComparedField {
  readonly key: string
  readonly label: string
  /** Undefined where the member's change did not set it. */
  readonly mine: string | undefined
  /** Undefined where the answer carried no row, or one without it. */
  readonly theirs: string | undefined
}

/** An answer as a member reads it. */
export interface Reading {
  /** The module it belongs to, where it is one the app knows: its chip. */
  readonly module: ModuleId | undefined
  /** What the row is called. */
  readonly name: string
  readonly fields: readonly ComparedField[]
  /** The address that opens the row, where its module gives one. */
  readonly address: string | undefined
}

function isSide(value: unknown): value is Side {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The row an answer carried, as fields by key, or undefined where it carried none. */
export function rowOf(outcome: RecordedOutcome): Side | undefined {
  return isSide(outcome.row) ? outcome.row : undefined
}

/** What a describer is handed for `outcome`. */
export function subjectOf(outcome: RecordedOutcome): Subject {
  return {
    entityType: outcome.entity_type,
    id: outcome.entity_id,
    op: outcome.op,
    fields: outcome.mutation.fields ?? {},
    row: rowOf(outcome),
  }
}

/** A value as it was written, for a row no module describes. Nothing for a value that is none. */
function written(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return JSON.stringify(value)
}

/** The module an entity type belongs to by the replica's registry, where the app knows it. */
function moduleOf(registry: Registry, entityType: string): ModuleId | undefined {
  const entity = Object.hasOwn(registry.entities, entityType)
    ? registry.entities[entityType]
    : undefined
  return moduleIds.find((id) => id === entity?.module)
}

/**
 * `outcome` as a member reads it: through its entity's describer where a module registered one,
 * and generically where none did. A merge shows the fields the row does not hold as the member
 * set them, where the answer names them, and every other answer each field the member set.
 */
export function read(
  outcome: RecordedOutcome,
  registry: Registry,
  known: Describers,
  words: Words,
  household: string,
): Reading {
  const subject = subjectOf(outcome)
  const module = moduleOf(registry, outcome.entity_type)
  const describer = Object.hasOwn(known, outcome.entity_type)
    ? known[outcome.entity_type]
    : undefined
  const { fields: mine, row } = subject
  // The version the member's change would have made: the row as it stands, with what they set.
  // A refusal's neighbour is another row, and lends the member's own nothing.
  const whole = outcome.outcome === 'rejected' ? mine : { ...row, ...mine }
  const keys =
    outcome.outcome === 'merged' && outcome.overridden.length > 0
      ? outcome.overridden
      : Object.keys(mine)
  const fields = keys.flatMap((key): ComparedField[] => {
    const described = describer !== undefined && Object.hasOwn(describer.fields, key)
    const field = described ? describer.fields[key] : undefined
    // A module that describes its row has said which fields a member reads.
    if (describer !== undefined && field === undefined) return []
    const value = (side: Side) =>
      field === undefined ? written(side[key]) : field.value(side[key], side, words)
    return [
      {
        key,
        label: field === undefined ? key : field.label(words),
        mine: Object.hasOwn(mine, key) ? value(whole) : undefined,
        theirs: row !== undefined && Object.hasOwn(row, key) ? value(row) : undefined,
      },
    ]
  })
  const name =
    describer?.name(subject, words) ??
    (module === undefined ? words.t('sync.change.yours') : words.t(`module.${module}.name`))
  return { module, name, fields, address: describer?.address?.(subject, household) }
}
