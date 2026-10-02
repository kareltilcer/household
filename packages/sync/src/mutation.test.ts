import { UpdateType } from '@powersync/common'
import { describe, expect, it } from 'vitest'
import {
  encodeMetadata,
  ends,
  isEntitlement,
  overridden,
  toMutation,
  toStored,
  type SyncMutation,
} from './mutation.ts'
import { testRegistry } from './testing.ts'

describe('a queued write', () => {
  const metadata = encodeMetadata({
    mutation_id: 'm-1',
    client_time: '2026-09-29T10:00:00Z',
    base_version: 4,
  })

  it("creates on a PUT, with the fields it changed but the server's and its local ones, each as its kind is sent", () => {
    expect(
      toMutation(testRegistry, {
        op: UpdateType.PUT,
        table: 'checks',
        id: 'c-1',
        opData: { household_id: 'h', item_id: 'i-1', checked: 1, checked_at: 'now', version: 3 },
        metadata: encodeMetadata({
          mutation_id: 'm-1',
          client_time: '2026-09-29T10:00:00Z',
          local: ['checked_at'],
        }),
      }),
    ).toEqual({
      mutation_id: 'm-1',
      entity_type: 'test.check',
      entity_id: 'c-1',
      op: 'create',
      base_version: null,
      action: null,
      fields: { item_id: 'i-1', checked: true },
      client_time: '2026-09-29T10:00:00Z',
    })
    // An array and a JSON value are stored as their text, and sent as themselves.
    expect(
      toMutation(testRegistry, {
        op: UpdateType.PUT,
        table: 'items',
        id: 'i-1',
        opData: { tags: '["dairy","cold"]', meta: '{"aisle":3}' },
        metadata,
      }).fields,
    ).toEqual({ tags: ['dairy', 'cold'], meta: { aisle: 3 } })
    expect(toStored('text[]', ['dairy'])).toBe('["dairy"]')
    expect(toStored('boolean', false)).toBe(0)
  })

  it('updates on a PATCH, against its base version, with the fields its metadata carries', () => {
    const m = toMutation(testRegistry, {
      op: UpdateType.PATCH,
      table: 'checks',
      id: 'c-1',
      opData: { checked: 0 },
      metadata: encodeMetadata({
        mutation_id: 'm-2',
        client_time: 't',
        base_version: 2,
        fields: { item_id: 'i-1' },
      }),
    })
    expect(m).toMatchObject({
      op: 'update',
      base_version: 2,
      fields: { checked: false, item_id: 'i-1' },
    })
  })

  it('acts when its metadata names an action, and deletes on a DELETE', () => {
    const acting = encodeMetadata({ mutation_id: 'm-3', client_time: 't', action: 'complete' })
    expect(
      toMutation(testRegistry, {
        op: UpdateType.PATCH,
        table: 'items',
        id: 'x',
        opData: {},
        metadata: acting,
      }),
    ).toMatchObject({ op: 'action', action: 'complete' })
    expect(
      toMutation(testRegistry, { op: UpdateType.DELETE, table: 'items', id: 'x', metadata }),
    ).toMatchObject({ op: 'delete', base_version: 4, fields: {} })
  })

  it('is refused without the metadata of its mutation, and for a redacted projection', () => {
    expect(() =>
      toMutation(testRegistry, {
        op: UpdateType.PUT,
        table: 'items',
        id: 'x',
        opData: { title: 'Milk' },
      }),
    ).toThrow('carries no metadata')
    expect(() =>
      toMutation(testRegistry, { op: UpdateType.PUT, table: 'notes_redacted', id: 'x', metadata }),
    ).toThrow('projection')
  })

  it('is held for the entitlement under either spelling of its code', () => {
    expect(
      ['entitlement', 'entitlement_read_only', 'entitlement_restricted'].every(isEntitlement),
    ).toBe(true)
    expect([null, undefined, 'not_found', 'forbidden'].some(isEntitlement)).toBe(false)
  })

  it('ends on a terminal answer, and is held by a deferral or an entitlement rejection', () => {
    expect(ends({ outcome: 'applied', code: null })).toBe(true)
    expect(ends({ outcome: 'rejected', code: 'not_found' })).toBe(true)
    expect(ends({ outcome: 'conflict', code: 'version_mismatch' })).toBe(true)
    expect(ends({ outcome: 'rejected', code: 'entitlement_read_only' })).toBe(false)
    expect(ends({ outcome: 'deferred', code: 'dependency_failed' })).toBe(false)
  })
})

describe('a merged answer', () => {
  const mutation: SyncMutation = {
    mutation_id: 'm-1',
    entity_type: 'test.item',
    entity_id: 'i-1',
    op: 'update',
    fields: { title: 'Oat milk', quantity: 2, due_at: '2026-10-02T10:00:00+02:00', tags: ['a'] },
    client_time: 't',
  }

  it('overrode the fields its row does not say what the member set, a time read as the instant it is', () => {
    expect(
      overridden(mutation, {
        title: 'Soy milk',
        quantity: 2,
        due_at: '2026-10-02T08:00:00Z',
        tags: ['a'],
      }),
    ).toEqual(['title'])
    expect(overridden(mutation, { title: 'Oat milk' })).toEqual([])
    expect(overridden(mutation, null)).toEqual([])
  })
})
