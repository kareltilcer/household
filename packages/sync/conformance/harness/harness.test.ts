import { isUuid } from '@household/api'
import { UpdateType } from '@powersync/common'
import { describe, expect, it } from 'vitest'
import { acknowledgedWrites, terminality } from './invariants.ts'
import {
  encodeMetadata,
  ends,
  isEntitlement,
  toMutation,
  type SyncMutation,
  type SyncMutationResult,
} from './mutation.ts'
import { Network, NetworkFault, push } from './network.ts'
import { Recorder } from './recorder.ts'
import { Rng } from './rng.ts'
import { canonical, canonicalRow, tableSpec } from './schema.ts'

describe('the seeded generator', () => {
  it('draws the same sequence from the same seed, and another from another', () => {
    const draw = (seed: number): number[] => {
      const rng = new Rng(seed)
      return Array.from({ length: 8 }, () => rng.u32())
    }
    expect(draw(7)).toEqual(draw(7))
    expect(draw(7)).not.toEqual(draw(8))
  })

  it('keeps to its ranges', () => {
    const rng = new Rng(1)
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(-3, 3)
      expect(n).toBeGreaterThanOrEqual(-3)
      expect(n).toBeLessThanOrEqual(3)
      expect(rng.float()).toBeLessThan(1)
    }
    expect(
      rng.weighted([
        ['never', 0],
        ['always', 1],
      ]),
    ).toBe('always')
    expect(rng.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4])
  })

  it('forks a generator whose draws, however many, leave its own sequence where it was', () => {
    const drawn = new Rng(5)
    const forked = drawn.fork()
    const untouched = new Rng(5)
    untouched.fork()
    for (let i = 0; i < 10; i++) forked.u32()
    expect(drawn.u32()).toBe(untouched.u32())
    expect(new Rng(5).fork().u32()).toBe(new Rng(5).fork().u32())
  })

  it('mints UUIDv7s that sort by the time they carry', () => {
    const rng = new Rng(3)
    const a = rng.uuid(1_790_000_000_000)
    const b = rng.uuid(1_790_000_000_001)
    expect(isUuid(a)).toBe(true)
    expect(a[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(a[19])
    expect(a < b).toBe(true)
  })
})

describe('a network', () => {
  const answered = (): typeof fetch => () => Promise.resolve(new Response('{}', { status: 200 }))

  it('refuses a request before it leaves, and loses an answer after the server gave it', async () => {
    let reached = 0
    const net = new Network(() => {
      reached++
      return Promise.resolve(new Response('ok'))
    })
    net.next(['refuse', 'lose'])
    await expect(net.fetch('https://s.test/a')).rejects.toMatchObject({ fault: 'refuse' })
    expect(reached).toBe(0)
    await expect(net.fetch('https://s.test/a')).rejects.toBeInstanceOf(NetworkFault)
    expect(reached).toBe(1)
    expect((await net.fetch('https://s.test/a')).status).toBe(200)
    expect(net.carried.map((c) => [c.fault, c.status])).toEqual([
      ['refuse', null],
      ['lose', 200],
      ['deliver', 200],
    ])
  })

  it('aims a scripted fault at the requests it matches', async () => {
    const net = new Network(answered())
    net.next('lose', push)
    expect((await net.fetch('https://s.test/standin/households/h/sync/credentials')).status).toBe(
      200,
    )
    await expect(
      net.fetch('https://s.test/api/v1/households/h/sync/mutations'),
    ).rejects.toMatchObject({ fault: 'lose' })
  })

  it('refuses everything while partitioned, and forgets every fault once healed', async () => {
    const net = new Network(answered())
    net.partition()
    net.next('lose')
    await expect(net.fetch('https://s.test/a')).rejects.toMatchObject({ fault: 'refuse' })
    net.heal()
    expect((await net.fetch('https://s.test/a')).status).toBe(200)
  })
})

describe('a queued write', () => {
  const metadata = encodeMetadata({
    mutation_id: 'm-1',
    client_time: '2026-09-29T10:00:00Z',
    base_version: 4,
  })

  it('creates on a PUT, with only the fields a client writes, its booleans as booleans', () => {
    expect(
      toMutation({
        op: UpdateType.PUT,
        table: 'conformance_item_checks',
        id: 'c-1',
        opData: {
          household_id: 'h',
          item_id: 'i-1',
          checked: 1,
          checked_at: 'now',
          clock_flagged: 0,
        },
        metadata: encodeMetadata({ mutation_id: 'm-1', client_time: '2026-09-29T10:00:00Z' }),
      }),
    ).toEqual({
      mutation_id: 'm-1',
      entity_type: 'conformance.item_checked',
      entity_id: 'c-1',
      op: 'create',
      base_version: null,
      action: null,
      fields: { item_id: 'i-1', checked: true },
      client_time: '2026-09-29T10:00:00Z',
    })
  })

  it('updates on a PATCH, against its base version, with the fields its metadata carries', () => {
    const m = toMutation({
      op: UpdateType.PATCH,
      table: 'conformance_item_checks',
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
      toMutation({
        op: UpdateType.PATCH,
        table: 'conformance_items',
        id: 'x',
        opData: {},
        metadata: acting,
      }),
    ).toMatchObject({
      op: 'action',
      action: 'complete',
    })
    expect(
      toMutation({ op: UpdateType.DELETE, table: 'conformance_items', id: 'x', metadata }),
    ).toMatchObject({
      op: 'delete',
      base_version: 4,
      fields: {},
    })
  })

  it('is refused without the metadata of its mutation', () => {
    expect(() =>
      toMutation({
        op: UpdateType.PUT,
        table: 'conformance_items',
        id: 'x',
        opData: { title: 'Milk' },
      }),
    ).toThrow('carries no metadata')
    expect(() =>
      toMutation({ op: UpdateType.PUT, table: 'conformance_notes_redacted', id: 'x', metadata }),
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

describe('terminality', () => {
  const quiet = {
    name: 'petr',
    held: () => Promise.resolve([]),
    pending: () => Promise.resolve(0),
  }
  const mutation = (id: string): SyncMutation => ({
    mutation_id: id,
    entity_type: 'conformance.item',
    entity_id: 'x',
    op: 'update',
    base_version: 1,
    action: null,
    fields: {},
    client_time: '2026-09-29T10:00:00Z',
  })
  const answer = (
    id: string,
    outcome: SyncMutationResult['outcome'],
    code: string | null = null,
  ): SyncMutationResult => ({
    mutation_id: id,
    outcome,
    code,
    message: null,
    version: outcome === 'applied' ? 2 : null,
  })
  const recorder = (...ids: string[]): Recorder => {
    const r = new Recorder()
    for (const id of ids)
      r.wrote('petr', { mutationId: id, table: 'conformance_items', entityId: 'x', op: 'update' })
    return r
  }

  it('ends a mutation held for its entitlement once, with the answer its replay got', async () => {
    const r = recorder('m-1')
    r.answered('petr', mutation('m-1'), answer('m-1', 'rejected', 'entitlement_read_only'))
    r.answered('petr', mutation('m-1'), answer('m-1', 'applied'))
    expect(await terminality(r, [quiet])).toEqual([])
  })

  it('reports a mutation ended twice, and one only held', async () => {
    const r = recorder('m-1', 'm-2')
    r.answered('petr', mutation('m-1'), answer('m-1', 'rejected', 'not_found'))
    r.answered('petr', mutation('m-1'), answer('m-1', 'applied'))
    r.answered('petr', mutation('m-2'), answer('m-2', 'rejected', 'entitlement'))
    expect((await terminality(r, [quiet])).map((v) => v.detail)).toEqual([
      'm-1 ended rejected and applied',
      expect.stringContaining('(m-2) never ended'),
    ])
  })

  it('judges only the clients it is given', async () => {
    const r = recorder('m-1')
    r.wrote('eva', { mutationId: 'm-2', table: 'conformance_items', entityId: 'y', op: 'update' })
    r.answered('petr', mutation('m-1'), answer('m-1', 'applied'))
    expect(await terminality(r, [quiet])).toEqual([])
  })
})

describe('no acknowledged write lost', () => {
  const home = { id: 'h', name: 'Novákovi', timezone: 'Europe/Prague' }
  const server = {
    rows: () =>
      Promise.resolve(
        new Map([['x', canonicalRow(tableSpec('conformance_items'), { id: 'x', version: 3 })]]),
      ),
  }
  const judge = async (result: Omit<SyncMutationResult, 'mutation_id'>): Promise<string[]> => {
    const r = new Recorder()
    r.answered(
      'petr',
      {
        mutation_id: 'm-1',
        entity_type: 'conformance.item',
        entity_id: 'x',
        op: 'update',
        base_version: 1,
        action: null,
        fields: {},
        client_time: '2026-09-29T10:00:00Z',
      },
      { mutation_id: 'm-1', ...result },
    )
    const found = await acknowledgedWrites(r, server, [{ name: 'petr', household: home }])
    return found.map((v) => v.detail)
  }

  it('holds an applied write to the row at the version it answered, or later', async () => {
    expect(await judge({ outcome: 'applied', version: 3, code: null })).toEqual([])
    expect(await judge({ outcome: 'merged', version: 2, code: 'merged' })).toEqual([])
    expect(await judge({ outcome: 'applied', version: 4, code: null })).toEqual([
      expect.stringContaining('the server holds at 3'),
    ])
  })

  it('reports an applied write answered without the version it committed at', async () => {
    expect(await judge({ outcome: 'applied', version: null, code: null })).toEqual([
      expect.stringContaining('without the version it committed at'),
    ])
  })
})

describe('a row, compared', () => {
  it('reads alike from a replica and from the server', () => {
    const spec = tableSpec('conformance_item_checks')
    const replica = canonicalRow(spec, {
      id: 'C-1',
      household_id: 'h',
      item_id: 'I-1',
      checked: 1,
      checked_at: '2026-09-29T10:00:00.123456Z',
      clock_flagged: 0,
      version: 2,
    })
    const server = canonicalRow(spec, {
      id: 'c-1',
      household_id: 'h',
      item_id: 'i-1',
      checked: true,
      checked_at: new Date('2026-09-29T10:00:00.123Z'),
      clock_flagged: false,
      version: '2',
    })
    expect(replica).toEqual(server)
  })

  it('reads a calendar day and a list of ids in either form', () => {
    expect(canonical('date', '2026-09-29')).toBe('2026-09-29')
    expect(canonical('uuid[]', '["B","a"]')).toEqual(['a', 'b'])
    expect(canonical('uuid[]', '{b,a}')).toEqual(['a', 'b'])
    expect(canonical('uuid[]', ['b', 'a'])).toEqual(['a', 'b'])
    expect(canonical('text', null)).toBeNull()
  })
})

describe('a checkpoint', () => {
  it('moves only forward, except in a bucket made again, which starts from nothing', () => {
    const r = new Recorder()
    r.sampled('eva', [{ name: 'b', last_applied_op: 10 }])
    r.sampled('eva', [{ name: 'b', last_applied_op: 0 }])
    r.sampled('eva', [{ name: 'b', last_applied_op: 12 }])
    expect(r.regressions).toEqual([])
    r.sampled('eva', [{ name: 'b', last_applied_op: 11 }])
    r.sampled('eva', [{ name: 'b', last_applied_op: 11 }])
    expect(r.regressions).toEqual([{ client: 'eva', bucket: 'b', from: 12, to: 11 }])
  })
})
