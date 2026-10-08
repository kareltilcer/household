// How an answer is read (sync/describe.ts): through its entity's describer where a module
// registered one, and plainly where none did, which is every entity today.
import { catalogs } from '@household/i18n'
import { translatorOver } from '@household/i18n/lazy'
import type { Registry } from '@household/sync'
import { describe, expect, it } from 'vitest'
import {
  answer,
  conflict,
  household,
  overriddenMerge,
  registry,
  rejectionWith,
} from '../dev/sync/fixtures.ts'
import { createFormatters } from '../i18n/format.ts'
import { describers, read, rowOf, subjectOf, type Describers, type Words } from './describe.ts'

const words: Words = {
  t: translatorOver('en', catalogs.en),
  format: createFormatters('en'),
  timezone: 'Europe/Prague',
}

describe('the app’s describers', () => {
  it('are none yet: no entity the server serves is written offline', () => {
    expect(describers).toEqual({})
  })
})

describe('an answer no module describes', () => {
  it('is called by its module’s name, with each field under its own key as it was written', () => {
    const reading = read(conflict, registry, {}, words, household)
    expect(reading).toEqual({
      module: 'finance',
      name: 'Finance',
      fields: [{ key: 'amount_minor', label: 'amount_minor', mine: '45000', theirs: '50000' }],
      address: undefined,
    })
  })

  it('writes a value that is no text as it is, and nothing for one that is none', () => {
    const outcome = answer({
      id: 'g1',
      entityType: 'shopping.item',
      outcome: 'conflict',
      fields: { checked: true, tags: ['dairy', 'cold'], note: null, quantity: 0 },
      row: { checked: false, tags: [], note: 'From the market', quantity: 2 },
    })
    expect(read(outcome, registry, {}, words, household).fields).toEqual([
      { key: 'checked', label: 'checked', mine: 'true', theirs: 'false' },
      { key: 'tags', label: 'tags', mine: '["dairy","cold"]', theirs: '[]' },
      { key: 'note', label: 'note', mine: undefined, theirs: 'From the market' },
      { key: 'quantity', label: 'quantity', mine: '0', theirs: '2' },
    ])
  })

  it('has no chip and a plain name where its module is none the app knows', () => {
    const unknown: Registry = {
      ...registry,
      entities: {
        'lab.sample': {
          module: 'lab',
          table: 'samples',
          policy: 'lww_field',
          offline_writes: true,
        },
      },
    }
    const sample = answer({ id: 'g2', entityType: 'lab.sample', outcome: 'rejected' })
    expect(read(sample, unknown, {}, words, household)).toMatchObject({
      module: undefined,
      name: 'Your change',
    })
    // And an entity the replica's registry does not hold at all reads the same.
    const gone = answer({ id: 'g3', entityType: 'toString', outcome: 'rejected' })
    expect(read(gone, registry, {}, words, household)).toMatchObject({
      module: undefined,
      name: 'Your change',
    })
  })
})

describe('an answer its module describes', () => {
  const known: Describers = {
    'finance.settlement': {
      name: ({ fields, row }) => String(fields.title ?? row?.title),
      fields: {
        amount_minor: {
          label: () => 'Amount',
          // Read beside its currency, which the member's change did not set.
          value: (value, side) => `${String(Number(value) / 100)} ${String(side.currency)}`,
        },
      },
      address: ({ id }, home) => `/households/${home}/modules/finance/settlements/${id}`,
    },
  }

  it('is called what its module calls it, with the fields its module names, and its address', () => {
    expect(read(conflict, registry, known, words, household)).toEqual({
      module: 'finance',
      name: 'March electricity settlement',
      // The member's amount is read beside the row's own currency.
      fields: [{ key: 'amount_minor', label: 'Amount', mine: '450 CZK', theirs: '500 CZK' }],
      address: `/households/${household}/modules/finance/settlements/${conflict.entity_id}`,
    })
  })

  it('shows no field its module leaves out', () => {
    const outcome = answer({
      id: 'd1',
      entityType: 'finance.settlement',
      outcome: 'conflict',
      fields: { amount_minor: 100, position: 'a0V' },
      row: { title: 'Rent', amount_minor: 200, currency: 'CZK', position: 'a1' },
    })
    expect(read(outcome, registry, known, words, household).fields.map(({ key }) => key)).toEqual([
      'amount_minor',
    ])
  })

  it('reads a refusal’s own value beside nothing of the neighbour it was refused for', () => {
    const neighbour = answer({
      id: 'd2',
      entityType: 'finance.settlement',
      outcome: 'rejected',
      code: 'monotonicity_violation',
      op: 'create',
      fields: { title: 'Rent', amount_minor: 100 },
      // Another row, in another currency: it lends the member's own amount none.
      row: { amount_minor: 200, currency: 'EUR' },
    })
    expect(read(neighbour, registry, known, words, household).fields).toEqual([
      { key: 'amount_minor', label: 'Amount', mine: '1 undefined', theirs: '2 EUR' },
    ])
  })
})

describe('the fields an answer is read by', () => {
  it('are the ones the member set, each beside the neighbour’s where a refusal carried one', () => {
    const reading = read(rejectionWith('monotonicity_violation'), registry, {}, words, household)
    expect(reading.fields).toEqual([
      { key: 'meter', label: 'meter', mine: 'Electricity, cellar meter', theirs: undefined },
      { key: 'value', label: 'value', mine: '18116', theirs: '18402.4' },
      { key: 'read_on', label: 'read_on', mine: '2026-03-10', theirs: '2026-03-03' },
    ])
  })

  it('are the ones a merge overrode, and not the rest of what the member set', () => {
    expect(overriddenMerge.overridden).toEqual(['quantity'])
    const outcome = answer({
      id: 'd3',
      entityType: 'shopping.item',
      outcome: 'merged',
      fields: { quantity: 2, name: 'Oat milk' },
      row: { name: 'Oat milk', quantity: 3 },
      overridden: ['quantity'],
    })
    expect(read(outcome, registry, {}, words, household).fields).toEqual([
      { key: 'quantity', label: 'quantity', mine: '2', theirs: '3' },
    ])
  })
})

describe('what an answer is about', () => {
  it('is the member’s fields and the row it carried, where that is a row', () => {
    expect(subjectOf(conflict)).toMatchObject({
      entityType: 'finance.settlement',
      id: conflict.entity_id,
      op: 'update',
      fields: { amount_minor: 45000 },
      row: { amount_minor: 50000 },
    })
    expect(rowOf(rejectionWith('forbidden'))).toBeUndefined()
    expect(rowOf({ ...conflict, row: ['not', 'a', 'row'] })).toBeUndefined()
    expect(rowOf({ ...conflict, row: 'a row' })).toBeUndefined()
  })
})
