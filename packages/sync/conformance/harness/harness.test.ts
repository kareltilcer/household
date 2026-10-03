import { isUuid } from '@household/api'
import { describe, expect, it } from 'vitest'
import {
  acknowledgedWrites,
  compareReplica,
  replayedAnswers,
  terminality,
  type Answered,
} from './invariants.ts'
import type { SyncMutation, SyncMutationResult } from '../../src/index.ts'
import { Network, NetworkFault, push } from './network.ts'
import { Recorder } from './recorder.ts'
import { Rng } from './rng.ts'
import {
  canonical,
  canonicalRow,
  suiteRegistry,
  tableSpec,
  tables,
  type CanonicalRow,
  type TableName,
  type TableSpec,
} from './schema.ts'

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

describe('a batch delivered again', () => {
  const answered = (
    id: string,
    outcome: string,
    code: string | null = null,
    version: number | null = null,
  ): Answered => ({ id, outcome, code, version })
  const applied = answered('m-1', 'applied', null, 2)
  const deferred = answered('m-2', 'deferred', 'dependency_failed')
  const held = answered('m-3', 'rejected', 'entitlement_read_only')
  const replayed = answered('m-2', 'applied', null, 3)
  const first = [applied, deferred, held]
  const alike = ({ want, got }: { want: string; got: string }): boolean => want === got

  it('is answered whole under its own key', () => {
    expect(alike(replayedAnswers(first, first, null))).toBe(true)
    expect(alike(replayedAnswers(first, [applied, replayed, held], null))).toBe(false)
  })

  it('is answered under a fresh key as each mutation ended, and a mutation still held by its id alone', () => {
    // m-1 ended applied, m-2 ended applied at 3 when it replayed, and m-3 is still held for its
    // entitlement: the target may run it now, as a duplicate delivered early would.
    const endOf = (r: Answered): Answered | null =>
      r.id === 'm-1' ? r : r.id === 'm-2' ? replayed : null
    const early = answered('m-3', 'applied', null, 1)
    expect(alike(replayedAnswers(first, [applied, replayed, early], endOf))).toBe(true)
    expect(alike(replayedAnswers(first, [applied, deferred, early], endOf))).toBe(false)
    expect(alike(replayedAnswers(first, [applied, replayed], endOf))).toBe(false)
    expect(
      alike(replayedAnswers(first, [applied, replayed, answered('m-4', 'applied')], endOf)),
    ).toBe(false)
  })
})

describe('a replica, judged', () => {
  const home = { id: 'h', name: 'Novákovi', timezone: 'Europe/Prague' }
  const eva = { id: 'e', name: 'Eva' }
  const note = { id: 'n-1', household_id: 'h', visibility: 'private', owner_id: 'j', version: 1 }
  // A replica whose view shows each row's declared columns, and whose storage holds them and any
  // others its stream sent (stored).
  const replica = (
    held: Partial<Record<string, Record<string, unknown>[]>>,
    stored: Partial<Record<string, readonly string[]>> = {},
  ) => ({
    name: 'eva',
    household: home,
    member: eva,
    rows: (table: string) => Promise.resolve(held[table] ?? []),
    stored: (table: string) =>
      Promise.resolve(
        new Map<string, string[]>(
          (held[table] ?? []).map((r) => [
            String(r['id']),
            [...Object.keys(r), ...(stored[table] ?? [])],
          ]),
        ),
      ),
  })
  // The server holds the note in Eva's household, and she may see nothing of the module's.
  const server = {
    visible: () => Promise.resolve(new Map<string, CanonicalRow>()),
    rows: (table: string) => {
      const rows = new Map<string, CanonicalRow>()
      if (table === 'conformance_notes')
        rows.set(note.id, canonicalRow(tableSpec('conformance_notes'), note))
      return Promise.resolve(rows)
    },
    householdOf: () => Promise.resolve(home.id),
  }
  const target = {
    name: 'stand-in',
    replicates: new Set<TableName>(['conformance_items']),
    tombstones: 'dropped' as const,
  }

  it('holds a table the target does not replicate to nothing', async () => {
    expect(await compareReplica(replica({}), target, server)).toEqual([])
    // A stream the target does not declare delivered a private note Eva may not see.
    expect(
      (await compareReplica(replica({ conformance_notes: [note] }), target, server)).map((v) => [
        v.invariant,
        v.detail,
      ]),
    ).toEqual([['retraction', 'holds conformance_notes n-1, which Eva may not see']])
  })

  it('holds a row to the columns its table declares, whatever its view shows', async () => {
    // Eva may see the private note's redacted form, which its stream sent with the note's title
    // and body: the view shows neither, and the replica holds both.
    const redacted = { id: 'n-1', household_id: 'h', owner_id: 'j', version: 1 }
    const projection = tableSpec('conformance_notes_redacted')
    const sees = {
      ...server,
      visible: (table: string) =>
        Promise.resolve(
          new Map<string, CanonicalRow>(
            table === projection.table ? [['n-1', canonicalRow(projection, redacted)]] : [],
          ),
        ),
    }
    const replicating = {
      ...target,
      replicates: new Set<TableName>(['conformance_notes_redacted']),
    }
    expect(
      await compareReplica(replica({ conformance_notes_redacted: [redacted] }), replicating, sees),
    ).toEqual([])
    expect(
      (
        await compareReplica(
          replica(
            { conformance_notes_redacted: [redacted] },
            { conformance_notes_redacted: ['title', 'body'] },
          ),
          replicating,
          sees,
        )
      ).map((v) => [v.invariant, v.detail]),
    ).toEqual([
      [
        'retraction',
        'holds title, body in conformance_notes_redacted n-1, columns its table does not declare',
      ],
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
    expect(canonical('uuid[]', '["B","a"]')).toEqual(['b', 'a'])
    expect(canonical('uuid[]', '{b,a}')).toEqual(['b', 'a'])
    expect(canonical('uuid[]', ['b', 'a'])).toEqual(['b', 'a'])
    expect(canonical('text', null)).toBeNull()
  })

  it('tells a list of ids held in another order apart: a rotation is its order', () => {
    expect(canonical('uuid[]', '["a","b","c"]')).not.toEqual(canonical('uuid[]', ['b', 'a', 'c']))
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

describe("the suite's tables", () => {
  it('are the tables and columns the generated registry says a replica holds, each of its kind', () => {
    const declared = new Map<string, TableSpec>(tables.map((t) => [t.table, t]))
    for (const [name, table] of Object.entries(suiteRegistry.tables)) {
      const spec = declared.get(name)
      expect(spec, name).toBeDefined()
      expect(spec?.entity ?? null, name).toBe(table.redacted ? null : table.entity)
      expect(spec?.columns, name).toEqual(table.columns)
    }
    expect([...declared.keys()].sort()).toEqual(Object.keys(suiteRegistry.tables).sort())
  })
})
