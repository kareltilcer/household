import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bytesLost, stateRetryMs } from './attachments.ts'
import { Revoked, type Credential } from './connector.ts'
import { localTables, metaKeys } from './schema.ts'
import { NodeFileSystemAdapter, multipart, openReplica } from './node.ts'
import { NeedsConnection, type Replica, type RowState } from './replica.ts'
import { testRegistry } from './testing.ts'
import type { SyncMutation } from './mutation.ts'

const household = '01920000-0000-7000-8000-00000000000a'

/**
 * Waits until holds is true, looking every 20 ms for at most five seconds: a row's watcher emits on a
 * schedule of its own, throttled, and later under a loaded run. It returns either way, so that the
 * assertion after it reports the state the watcher reached, which the tests' own timeout leaves it the
 * time to (waits).
 */
async function eventually(
  holds: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const start = Date.now()
  while (!(await holds()) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** The body a request was sent with, which the library always sends as text. */
function bodyOf(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}
const api = 'https://api.test/api/v1'

let dirs: string[] = []
let replicas: Replica[] = []

afterEach(async () => {
  for (const r of replicas) await r.close().catch(() => undefined)
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
  replicas = []
})

type Route = (url: string, init: RequestInit | undefined) => Response | Promise<Response>

/** A fetch that answers each request by the first route matching its URL, and records them. */
function routes(table: Record<string, Route>) {
  const calls: { url: string; body: unknown }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body
    calls.push({ url, body })
    for (const [suffix, route] of Object.entries(table)) {
      if (url.endsWith(suffix)) return route(url, init)
    }
    return new Response('{}', { status: 404 })
  }
  return { fetch, calls }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let ids = 0
const newId = (): string => `01920000-0000-7000-8000-${String(++ids).padStart(12, '0')}`

const signedIn: Credential = {
  current: () => Promise.resolve('token'),
  renew: () => Promise.resolve(),
}

/** A credential each renewal replaces, token-0 by token-1 and so on, and how often it was renewed. */
function renewable(): { credential: Credential; renewals: () => number } {
  let token = 0
  return {
    credential: {
      current: () => Promise.resolve(`token-${String(token)}`),
      renew: () => {
        token++
        return Promise.resolve()
      },
    },
    renewals: () => token,
  }
}

/**
 * A route that answers as answer does a request carrying the credential accepts names, and refuses
 * any other 401, as the API refuses a credential that has lapsed; carried is what each request
 * carried, in order.
 */
function admitting(accepts: () => string, answer: Route): { route: Route; carried: string[] } {
  const carried: string[] = []
  const route: Route = (url, init) => {
    const bearer = new Headers(init?.headers).get('authorization') ?? ''
    carried.push(bearer)
    return bearer === `Bearer ${accepts()}`
      ? answer(url, init)
      : json(401, { code: 'unauthenticated' })
  }
  return { route, carried }
}

async function open(
  options: {
    readonly dir?: string
    readonly fetch?: typeof globalThis.fetch
    readonly credential?: Credential
    readonly onRevoked?: () => void
    readonly storage?: string
    readonly now?: () => Date
  } = {},
): Promise<{ replica: Replica; dir: string }> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'household-sync-'))
  if (options.dir === undefined) dirs.push(dir)
  const replica = await openReplica({
    dbFilename: 'replica.sqlite',
    dbLocation: dir,
    registry: testRegistry,
    household,
    apiUrl: api,
    credential: options.credential ?? signedIn,
    fetch: options.fetch ?? routes({}).fetch,
    newId,
    reportEveryMs: 0,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onRevoked === undefined ? {} : { onRevoked: options.onRevoked }),
    ...(options.storage === undefined
      ? {}
      : {
          attachments: {
            storage: new NodeFileSystemAdapter(options.storage),
            uploadUrl: (entity: string, h: string, id: string) =>
              entity === 'test.item' ? `${api}/households/${h}/items/${id}/content` : null,
            transport: multipart,
          },
        }),
  })
  replicas.push(replica)
  return { replica, dir }
}

interface Queued {
  op: string
  id: string
  data?: Record<string, unknown>
  metadata: string
}

async function queue(replica: Replica): Promise<Queued[]> {
  const rows = await replica.db.getAll<{ data: string }>('SELECT data FROM ps_crud ORDER BY id')
  return rows.map((r) => JSON.parse(r.data) as Queued)
}

/** Stands in for a checkpoint: the server's row, written where PowerSync keeps it. */
async function arrive(replica: Replica, table: string, id: string, row: Record<string, unknown>) {
  await replica.db.execute(`INSERT OR REPLACE INTO ps_data__${table} (id, data) VALUES (?, ?)`, [
    id,
    JSON.stringify(row),
  ])
}

/** A push that answers each mutation applied, at version. */
function applying(version = 1): Route {
  return (_url, init) => {
    const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
    return json(200, {
      results: mutations.map((m) => ({ mutation_id: m.mutation_id, outcome: 'applied', version })),
    })
  }
}

/**
 * The time a test has: several waits of five seconds each (eventually). Under Vitest's own five
 * seconds, one wait that ran out would end the test before its assertion said what was reached, and
 * a loaded run would give a test's waits those five seconds between them.
 */
const waits = { timeout: 30_000 }

describe('a replica', waits, () => {
  it('refuses a write to an entity that is not written offline: it needs a connection (D-84)', async () => {
    const { replica } = await open()
    expect(replica.writable('settings')).toBe(false)
    expect(replica.writable('items')).toBe(true)
    await expect(replica.create('settings', { name: 'x' })).rejects.toThrow(NeedsConnection)
    expect(() => replica.writable('notes_redacted')).toThrow('redacted projection')
    // Nor a column the table does not have, whose name would be written into the statement.
    await expect(replica.create('items', { titel: 'Milk' })).rejects.toThrow('no column titel')
    expect(await replica.queued()).toBe(0)
  })

  it('records each write with its mutation, its kinds as the push takes them, its local columns kept back', async () => {
    const { replica } = await open()
    const id = await replica.create(
      'checks',
      { item_id: '01920000-0000-7000-8000-0000000000aa', checked: true },
      { local: { checked_at: '2026-10-02T10:00:00Z' } },
    )
    const [entry] = await queue(replica)
    expect(entry?.data).toMatchObject({ household_id: household, checked: 1 })
    const meta = JSON.parse(entry?.metadata ?? '{}') as { local?: string[] }
    expect(meta.local).toEqual(['checked_at'])
    // The replica shows what it wrote, the local column too.
    expect(
      await replica.db.get('SELECT checked, checked_at FROM checks WHERE id = ?', [id]),
    ).toEqual({ checked: 1, checked_at: '2026-10-02T10:00:00Z' })
  })

  it("merges an edit into its row's queued write until that one is sent, never after (06-clients §5)", async () => {
    const { replica } = await open()
    const milk = await replica.create('items', { title: 'Milk', tags: ['dairy'] })
    expect(await replica.update('items', milk, { title: 'Oat milk', quantity: 2 })).toBe(true)
    let queued = await queue(replica)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ op: 'PUT', data: { title: 'Oat milk', quantity: 2 } })
    const first = JSON.parse(queued[0]?.metadata ?? '{}') as { mutation_id: string }
    // Sent: the next edit is a mutation of its own, which a retry of the first cannot carry.
    await replica.journal.sent(Number.MAX_SAFE_INTEGER)
    await replica.update('items', milk, { title: 'Soy milk' })
    queued = await queue(replica)
    expect(queued.map((q) => q.op)).toEqual(['PUT', 'PATCH'])
    expect((JSON.parse(queued[0]?.metadata ?? '{}') as { mutation_id: string }).mutation_id).toBe(
      first.mutation_id,
    )
    // An action is never merged: it is its own mutation.
    await replica.update('items', milk, { quantity: 3 }, { action: 'complete' })
    expect(await replica.queued()).toBe(3)
  })

  it('keeps an edit naming a row created after its queued write a mutation of its own (D-129)', async () => {
    const { replica } = await open()
    const milk = await replica.create('items', { title: 'Milk' })
    const check = await replica.create('checks', { item_id: milk, checked: false })
    const bread = await replica.create('items', { title: 'Bread' })
    // Merged into the check's create, the edit would reach the push before the bread it names.
    await replica.update('checks', check, { item_id: bread })
    expect((await queue(replica)).map((q) => q.op)).toEqual(['PUT', 'PUT', 'PUT', 'PATCH'])
    // An edit that names no such row merges into the write before it.
    await replica.update('checks', check, { checked: true })
    const queued = await queue(replica)
    expect(queued.map((q) => q.op)).toEqual(['PUT', 'PUT', 'PUT', 'PATCH'])
    expect(queued[3]?.data).toMatchObject({ item_id: bread, checked: 1 })
  })

  it('keeps its queue, its rows and what it was answered when it is closed and opened again (03 §2.1)', async () => {
    const answered = routes({
      '/sync/mutations': (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        return json(200, {
          results: mutations.map((m) => ({
            mutation_id: m.mutation_id,
            outcome: 'rejected',
            code: 'entitlement_read_only',
          })),
        })
      },
    })
    const { replica, dir } = await open({ fetch: answered.fetch })
    const milk = await replica.create('items', { title: 'Milk' })
    await replica.flush()
    const bread = await replica.create('items', { title: 'Bread' })
    await replica.close()
    replicas = replicas.filter((r) => r !== replica)

    const again = (await open({ dir })).replica
    expect(await again.queued()).toBe(1)
    expect(await again.db.getAll('SELECT id, title FROM items ORDER BY title')).toEqual([
      { id: bread, title: 'Bread' },
      { id: milk, title: 'Milk' },
    ])
    expect((await again.held('entitlement')).map((h) => h.mutation.entity_id)).toEqual([milk])
    expect((await again.inbox()).map((o) => [o.entity_id, o.code])).toEqual([
      [milk, 'entitlement_read_only'],
    ])
    expect(await again.id()).toBe(await again.id())
  })

  it('says where a row stands: pending, syncing, synced, refused, and withdrawn rather than deleted', async () => {
    let answer: Route = applying(1)
    const { fetch } = routes({ '/sync/mutations': (url, init) => answer(url, init) })
    const { replica } = await open({ fetch })
    const states: RowState[] = []
    const breadStates: RowState[] = []
    const milk = await replica.create('items', { title: 'Milk' })
    const stops = [replica.watchRowState('items', milk, (s) => states.push(s))]
    try {
      await eventually(() => states.length > 0)
      expect(await replica.rowState('items', milk)).toEqual({
        kind: 'pending',
        op: 'create',
        held: null,
      })
      await replica.journal.sent(Number.MAX_SAFE_INTEGER)
      expect(await replica.rowState('items', milk)).toEqual({ kind: 'syncing', op: 'create' })
      await replica.flush()
      await arrive(replica, 'items', milk, { household_id: household, title: 'Milk', version: 1 })
      expect(await replica.rowState('items', milk)).toEqual({ kind: 'synced', deleted: false })
      await eventually(() => isDeepStrictEqual(states.at(-1), { kind: 'synced', deleted: false }))

      // Another member's deletion leaves a tombstone, which is no withdrawal.
      await arrive(replica, 'items', milk, {
        household_id: household,
        title: 'Milk',
        version: 2,
        deleted_at: '2026-10-02T10:00:00Z',
      })
      await eventually(() => isDeepStrictEqual(states.at(-1), { kind: 'synced', deleted: true }))
      expect(states.at(-1)).toEqual({ kind: 'synced', deleted: true })

      // A row that leaves the replica was withdrawn; with its module turned off, it says so.
      const bread = newId()
      await arrive(replica, 'items', bread, { household_id: household, title: 'Bread', version: 1 })
      stops.push(replica.watchRowState('items', bread, (s) => breadStates.push(s)))
      await eventually(() => breadStates.length > 0)
      await arrive(replica, 'module_enablement', newId(), {
        module: 'test',
        enabled: 0,
        version: 1,
      })
      await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [bread])
      await eventually(() => breadStates.at(-1)?.kind === 'withdrawn')
      expect(breadStates).toEqual([
        { kind: 'synced', deleted: false },
        { kind: 'withdrawn', reason: 'module' },
      ])

      // A refused write is the member's to see, before anything else of the row.
      answer = (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        return json(200, {
          results: mutations.map((m) => ({
            mutation_id: m.mutation_id,
            outcome: 'conflict',
            code: 'version_conflict',
            version: 3,
            row: { id: m.entity_id, title: 'Theirs', version: 3 },
          })),
        })
      }
      const eggs = newId()
      await arrive(replica, 'items', eggs, { household_id: household, title: 'Eggs', version: 2 })
      await replica.update('items', eggs, { title: 'Mine' })
      await replica.flush()
      const state = await replica.rowState('items', eggs)
      expect(state.kind).toBe('conflict')
    } finally {
      for (const stop of stops) stop()
    }
  })

  it("reads a row's state in one transaction, which no answer lands inside", async () => {
    const { replica } = await open()
    const milk = await replica.create('items', { title: 'Milk' })
    const transactions = vi.spyOn(replica.db, 'readTransaction')
    const apart = [
      vi.spyOn(replica.db, 'get'),
      vi.spyOn(replica.db, 'getAll'),
      vi.spyOn(replica.db, 'getOptional'),
    ]
    expect(await replica.rowState('items', milk)).toEqual({
      kind: 'pending',
      op: 'create',
      held: null,
    })
    expect(transactions).toHaveBeenCalledTimes(1)
    for (const read of apart) expect(read).not.toHaveBeenCalled()
  })

  it('tells a refused create the member discards, which leaves the replica, from a withdrawn row', async () => {
    const { fetch } = routes({
      '/sync/mutations': (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        return json(200, {
          results: mutations.map((m) => ({
            mutation_id: m.mutation_id,
            outcome: 'rejected',
            code: 'validation_failed',
          })),
        })
      },
    })
    const { replica } = await open({ fetch })
    const milk = await replica.create('items', { title: 'Milk' })
    const states: RowState[] = []
    const stop = replica.watchRowState('items', milk, (s) => states.push(s))
    try {
      await eventually(() => states.length > 0)
      await replica.flush()
      // The next checkpoint takes away the row the server never had.
      await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [milk])
      await eventually(() => states.at(-1)?.kind === 'rejected')
      const [refused] = await replica.inbox()
      await replica.discard(refused?.mutation_id ?? '')
      await eventually(() => states.at(-1)?.kind === 'absent')
      // Syncing between the first two, when the watcher looked while the batch was in flight.
      expect(states.map((s) => s.kind).filter((kind) => kind !== 'syncing')).toEqual([
        'pending',
        'rejected',
        'absent',
      ])
    } finally {
      stop()
    }
  })

  it('tells a watcher of a write in flight: syncing from its batch being marked sent until its answer', async () => {
    let answer = (): void => undefined
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const { fetch } = routes({
      '/sync/mutations': async (url, init) => {
        await answered
        return applying(1)(url, init)
      },
    })
    const { replica } = await open({ fetch })
    const milk = await replica.create('items', { title: 'Milk' })
    const states: RowState[] = []
    const stop = replica.watchRowState('items', milk, (s) => states.push(s))
    try {
      await eventually(() => states.length > 0)
      const flushed = replica.flush()
      // The push has not answered: nothing has moved but the mark the connector sends a batch under.
      await eventually(() => states.at(-1)?.kind === 'syncing')
      expect(states).toEqual([
        { kind: 'pending', op: 'create', held: null },
        { kind: 'syncing', op: 'create' },
      ])
      answer()
      await flushed
      await eventually(() => states.at(-1)?.kind === 'synced')
      expect(states.map((s) => s.kind)).toEqual(['pending', 'syncing', 'synced'])
    } finally {
      stop()
    }
  })

  it('tells a held create that replays, whose row its checkpoint has yet to bring, from a withdrawn row', async () => {
    let outcome: Record<string, unknown> = { outcome: 'rejected', code: 'entitlement_read_only' }
    const { fetch } = routes({
      '/sync/mutations': (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        return json(200, {
          results: mutations.map((m) => ({ mutation_id: m.mutation_id, ...outcome })),
        })
      },
    })
    const { replica } = await open({ fetch })
    const milk = await replica.create('items', { title: 'Milk' })
    await replica.flush()
    // The member has seen the refusal: the create waits for the household to write again.
    const [refused] = await replica.inbox()
    await replica.resolve(refused?.mutation_id ?? '')
    const states: RowState[] = []
    const stop = replica.watchRowState('items', milk, (s) => states.push(s))
    try {
      await eventually(() => states.length > 0)
      // The next checkpoint takes away the row the server does not hold yet.
      await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [milk])
      outcome = { outcome: 'applied', version: 1 }
      replica.connector.resume()
      await replica.flush()
      // Applied, and not in the replica until its checkpoint lands: no access was withdrawn.
      await eventually(() => states.at(-1)?.kind === 'absent')
      await arrive(replica, 'items', milk, { household_id: household, title: 'Milk', version: 1 })
      await eventually(() => states.at(-1)?.kind === 'synced')
      // The server's row, once the replica has held it, is withdrawn when it leaves.
      await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [milk])
      await eventually(() => states.at(-1)?.kind === 'withdrawn')
      expect(states).toEqual([
        { kind: 'pending', op: 'create', held: 'entitlement' },
        { kind: 'absent' },
        { kind: 'synced', deleted: false },
        { kind: 'withdrawn', reason: 'access' },
      ])
    } finally {
      stop()
    }
  })

  it('tells a row its member deleted from a withdrawn one, though the push answered the delete before the watcher looked', async () => {
    const [milk, bread] = [newId(), newId()]
    const { fetch } = routes({
      '/sync/mutations': (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        return json(200, {
          results: mutations.map((m) =>
            m.entity_id === bread
              ? { mutation_id: m.mutation_id, outcome: 'rejected', code: 'forbidden' }
              : { mutation_id: m.mutation_id, outcome: 'applied', version: 2 },
          ),
        })
      },
    })
    const { replica } = await open({ fetch })
    for (const id of [milk, bread])
      await arrive(replica, 'items', id, { household_id: household, title: 'Paper', version: 1 })
    const milkStates: RowState[] = []
    const breadStates: RowState[] = []
    const stops = [
      replica.watchRowState('items', milk, (s) => milkStates.push(s)),
      replica.watchRowState('items', bread, (s) => breadStates.push(s)),
    ]
    /** What a watcher was told, but the delete waiting or in flight, which it sees only when it looks in time. */
    const told = (states: RowState[]): string[] =>
      states.map((s) => s.kind).filter((kind) => kind !== 'pending' && kind !== 'syncing')
    try {
      await eventually(() => milkStates.length > 0 && breadStates.length > 0)
      // Deleted and pushed at once: the queue is empty again before the watcher, throttled, looks.
      await replica.remove('items', milk)
      await replica.flush()
      await eventually(() => told(milkStates).length > 1)
      expect(told(milkStates)).toEqual(['synced', 'absent'])
      // Its tombstone arrives with the next checkpoint, and leaves later with no word of a withdrawal.
      await arrive(replica, 'items', milk, {
        household_id: household,
        title: 'Paper',
        version: 2,
        deleted_at: '2026-10-02T10:00:00Z',
      })
      await eventually(() => milkStates.at(-1)?.kind === 'synced')
      await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [milk])
      await eventually(() => milkStates.at(-1)?.kind === 'absent')
      expect(told(milkStates)).toEqual(['synced', 'absent', 'synced', 'absent'])

      // A delete the server refuses: the row comes back with the next checkpoint, and its leaving
      // after that is a withdrawal again.
      await replica.remove('items', bread)
      await replica.flush()
      await eventually(() => breadStates.at(-1)?.kind === 'rejected')
      const [refused] = await replica.inbox()
      await replica.resolve(refused?.mutation_id ?? '')
      await eventually(() => breadStates.at(-1)?.kind === 'absent')
      await arrive(replica, 'items', bread, { household_id: household, title: 'Paper', version: 1 })
      await eventually(() => breadStates.at(-1)?.kind === 'synced')
      await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [bread])
      await eventually(() => breadStates.at(-1)?.kind === 'withdrawn')
      expect(told(breadStates)).toEqual(['synced', 'rejected', 'absent', 'synced', 'withdrawn'])
    } finally {
      for (const stop of stops) stop()
    }
  })

  it('calls a stopped watcher no more, and keeps to itself what one reads of a database being closed', async () => {
    const { replica } = await open()
    const milk = await replica.create('items', { title: 'Milk' })
    const rowState = replica.rowState.bind(replica)
    let reading = (): void => undefined
    let release = (): void => undefined
    let held = Promise.resolve()
    const reads: Promise<unknown>[] = []
    // Each read of the row's state waits to be let through, as a slow device's would.
    const hold = (): Promise<void> => {
      held = new Promise<void>((resolve) => {
        release = resolve
      })
      return new Promise<void>((resolve) => {
        reading = resolve
      })
    }
    const spy = vi.spyOn(replica, 'rowState').mockImplementation((table, id) => {
      const read = (async () => {
        reading()
        await held
        return rowState(table, id)
      })()
      reads.push(read.catch(() => undefined))
      return read
    })
    const states: RowState[] = []
    /** Once every read let through has ended, and what waited on it has run. */
    const settled = async (): Promise<void> => {
      await Promise.all(reads)
      await new Promise((resolve) => setImmediate(resolve))
    }

    // Stopped while its first read is under way: what the read finds is told to nobody.
    let underWay = hold()
    const stop = replica.watchRowState('items', milk, (s) => states.push(s))
    await underWay
    stop()
    release()
    await settled()
    expect(states).toEqual([])

    // Closed while a watcher's read is under way: the read fails on the closed database, and the
    // failure stays the watcher's own, where Vitest would fail the run on a rejection left unhandled.
    underWay = hold()
    const forgotten = replica.watchRowState('items', milk, (s) => states.push(s))
    await underWay
    await replica.close()
    release()
    await settled()
    expect(states).toEqual([])
    forgotten()
    spy.mockRestore()
  })

  it("drops a refused create's waiting file once the member discards it, and keeps one whose row the server holds", async () => {
    const { fetch } = routes({
      '/sync/mutations': (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        return json(200, {
          results: mutations.map((m) => ({
            mutation_id: m.mutation_id,
            outcome: 'rejected',
            code: 'validation_failed',
          })),
        })
      },
      // The files pipeline is down: a file whose row the server holds waits.
      '/content': () => new Response('', { status: 503 }),
    })
    const storage = mkdtempSync(join(tmpdir(), 'household-sync-files-'))
    dirs.push(storage)
    const { replica } = await open({ fetch, storage })
    const file = {
      data: new Uint8Array([1, 2, 3]).buffer,
      contentType: 'image/png',
      fileName: 'a.png',
    }
    const receipt = await replica.create('items', { title: 'Receipt' })
    await replica.attach('items', receipt, file)
    const milk = newId()
    await arrive(replica, 'items', milk, { household_id: household, title: 'Milk', version: 1 })
    await replica.update('items', milk, { title: 'Oat milk' })
    await replica.attach('items', milk, file)
    await replica.flush()
    // The next checkpoint takes away the row the server never had.
    await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [receipt])
    const [waiting] = await replica.attachments().list()
    for (const o of await replica.inbox()) await replica.discard(o.mutation_id)
    expect((await replica.attachments().list()).map((a) => a.id)).toEqual([milk])
    expect(existsSync(waiting?.local_uri ?? '')).toBe(false)
  })

  it('offers its conflicts and rejections until they are retried or discarded (DD-4)', async () => {
    let outcome: Record<string, unknown> = { outcome: 'rejected', code: 'validation_failed' }
    const bodies: SyncMutation[][] = []
    const { fetch } = routes({
      '/sync/mutations': (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        bodies.push(mutations)
        return json(200, {
          results: mutations.map((m) => ({ mutation_id: m.mutation_id, ...outcome })),
        })
      },
    })
    const { replica } = await open({ fetch })
    const budget = newId()
    await arrive(replica, 'budgets', budget, { household_id: household, name: 'Food', version: 4 })
    await replica.update('budgets', budget, { amount_minor: 45_000, currency: 'CZK' })
    const milk = await replica.create('items', { title: 'Milk' })
    await replica.flush()
    const inbox = await replica.inbox()
    expect(inbox.map((o) => [o.entity_id, o.outcome, o.mutation.fields])).toEqual([
      [budget, 'rejected', { amount_minor: 45_000, currency: 'CZK' }],
      [milk, 'rejected', { title: 'Milk' }],
    ])
    // Retried: the member's change again, against the row as the replica holds it now.
    outcome = { outcome: 'applied', version: 5 }
    expect(await replica.retry(inbox[0]?.mutation_id ?? '')).toBe(true)
    await replica.discard(inbox[1]?.mutation_id ?? '')
    await replica.flush()
    expect(await replica.inbox()).toEqual([])
    expect(bodies.at(-1)?.map((m) => [m.entity_id, m.op, m.base_version, m.fields])).toEqual([
      [budget, 'update', 4, { amount_minor: 45_000, currency: 'CZK' }],
    ])
  })

  it('gives up the hold of a mutation the member retries, whose change the new one carries', async () => {
    const { fetch } = routes({
      '/sync/mutations': (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        return json(200, {
          results: mutations.map((m) => ({
            mutation_id: m.mutation_id,
            outcome: 'rejected',
            code: 'entitlement_read_only',
          })),
        })
      },
    })
    const { replica } = await open({ fetch })
    const milk = newId()
    await arrive(replica, 'items', milk, { household_id: household, title: 'Milk', version: 1 })
    await replica.update('items', milk, { title: 'Oat milk' })
    await replica.flush()
    const [refused] = await replica.inbox()
    expect(await replica.held('entitlement')).toHaveLength(1)
    expect(await replica.retry(refused?.mutation_id ?? '')).toBe(true)
    // Only the retry waits: the old hold replaying beside it would make the change twice.
    expect(await replica.held()).toEqual([])
    expect(await replica.queued()).toBe(1)
  })

  it('retries a refused create as a create, over the row it left, before a checkpoint takes it away', async () => {
    let outcome: Record<string, unknown> = { outcome: 'rejected', code: 'validation_failed' }
    const bodies: SyncMutation[][] = []
    const { fetch } = routes({
      '/sync/mutations': (_url, init) => {
        const { mutations } = JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }
        bodies.push(mutations)
        return json(200, {
          results: mutations.map((m) => ({ mutation_id: m.mutation_id, ...outcome })),
        })
      },
    })
    const { replica } = await open({ fetch })
    const milk = await replica.create('items', { title: 'Milk', quantity: 0 })
    await replica.flush()
    const [refused] = await replica.inbox()
    // No checkpoint has landed, as none does offline or while more is queued: the replica still shows
    // the row the refused create wrote, which the server never held.
    expect(await replica.db.getAll('SELECT id, version FROM items')).toEqual([
      { id: milk, version: null },
    ])
    outcome = { outcome: 'applied', version: 1 }
    expect(await replica.retry(refused?.mutation_id ?? '')).toBe(true)
    expect((await queue(replica)).map((q) => q.op)).toEqual(['PUT'])
    await replica.flush()
    expect(bodies.at(-1)?.map((m) => [m.entity_id, m.op, m.base_version, m.fields])).toEqual([
      [milk, 'create', null, { title: 'Milk', quantity: 0 }],
    ])
    expect(await replica.inbox()).toEqual([])
    // Applied, its checkpoint still to come: the server holds the row now, at the version the answer
    // returned, and writing it again is an update against that.
    expect(await replica.retry(refused?.mutation_id ?? '')).toBe(true)
    await replica.flush()
    expect(bodies.at(-1)?.map((m) => [m.entity_id, m.op, m.base_version])).toEqual([
      [milk, 'update', 1],
    ])
  })

  it('replays what it holds on its own: when it connects, and when resume() lets the entitlement holds through', async () => {
    const { fetch, calls } = routes({
      '/sync/mutations': applying(1),
      // PowerSync itself is out of reach: the push is the API's, which answers.
      '/sync/credentials': () => json(503, {}),
    })
    const { replica } = await open({ fetch })
    const held = (title: string): SyncMutation => ({
      mutation_id: newId(),
      entity_type: 'test.item',
      entity_id: newId(),
      op: 'create',
      fields: { title },
      client_time: '2026-10-02T10:00:00Z',
    })
    // Held when the replica last closed: a replay the network failed, with nothing queued behind it.
    await replica.journal.hold('deferred', held('Milk'))
    await replica.journal.hold('entitlement', held('Bread'))
    const pushed = (): string[][] =>
      calls
        .filter((c) => c.url.endsWith('/sync/mutations'))
        .map((c) => (c.body as { mutations: SyncMutation[] }).mutations.map((m) => m.op))
    await replica.connect()
    await eventually(async () => (await replica.held('deferred')).length === 0)
    // The entitlement's wait for the household to write again.
    expect((await replica.held()).map((h) => h.reason)).toEqual(['entitlement'])
    replica.resume()
    await eventually(async () => (await replica.held()).length === 0)
    expect(await replica.held()).toEqual([])
    expect(pushed()).toEqual([['create'], ['create']])
  })

  it('reports itself at rest and downloads itself again when told to, its own tables kept (D-125)', async () => {
    let verdict = { matched: true, resnapshot_required: false, entries: [] }
    const { fetch, calls } = routes({
      '/sync/digest': () => json(200, verdict),
      '/sync/mutations': applying(1),
    })
    const { replica } = await open({ fetch })
    const milk = newId()
    await arrive(replica, 'items', milk, { household_id: household, title: 'Milk', version: 3 })
    const plan = newId()
    await arrive(replica, 'notes_redacted', plan, { owner_id: newId(), version: 2 })
    await replica.journal.hold('entitlement', {
      mutation_id: newId(),
      entity_type: 'test.item',
      entity_id: milk,
      op: 'update',
      fields: {},
      client_time: '2026-10-02T10:00:00Z',
    })
    // Not at rest while a write waits.
    const bread = await replica.create('items', { title: 'Bread' })
    expect(await replica.report()).toBeNull()
    await replica.flush()
    // Nor while a row has no version the server gave it.
    expect(await replica.report()).toBeNull()
    await arrive(replica, 'items', bread, { household_id: household, title: 'Bread', version: 1 })
    expect(await replica.report()).toEqual(verdict)
    const sent = calls.at(-1)?.body as {
      replica_id: string
      algorithm: string
      health: { pending_mutations: number; unresolved: number; checksum_failures: number }
      entries: { entity_type: string; count: number; hash: string }[]
    }
    expect(sent.replica_id).toBe(await replica.id())
    expect(sent.algorithm).toBe('xxh3-64')
    expect(sent.health).toEqual({ pending_mutations: 1, unresolved: 0, checksum_failures: 0 })
    expect(sent.entries.find((e) => e.entity_type === 'test.item')?.count).toBe(2)
    expect(sent.entries.find((e) => e.entity_type === 'test.note')?.count).toBe(1)

    const states: RowState[] = []
    const stop = replica.watchRowState('items', bread, (s) => states.push(s))
    try {
      await eventually(() => states.length > 0)
      verdict = { matched: false, resnapshot_required: true, entries: [] }
      await replica.report()
      // It downloads itself again after the report, once nothing is queued.
      await eventually(async () => (await replica.journal.meta(metaKeys.resnapshot)) === null)
      expect(await replica.db.getAll('SELECT id FROM items')).toEqual([])
      expect(await replica.held()).toHaveLength(1)
      expect(await replica.journal.meta(metaKeys.resnapshot)).toBeNull()
      // A row it held left with every other, to come back with the download: nobody's access changed.
      await eventually(() => states.at(-1)?.kind === 'absent')
      expect(states).toEqual([{ kind: 'synced', deleted: false }, { kind: 'absent' }])
    } finally {
      stop()
    }
  })

  it('keeps a write made while it disconnects to download itself again, and waits for it (D-125)', async () => {
    const { replica } = await open()
    const milk = newId()
    await arrive(replica, 'items', milk, { household_id: household, title: 'Milk', version: 3 })
    await replica.journal.setMeta(metaKeys.resnapshot, '2026-10-02T10:00:00Z')
    const disconnect = replica.db.disconnect.bind(replica.db)
    const spy = vi.spyOn(replica.db, 'disconnect').mockImplementation(async () => {
      await disconnect()
      // The member writes while the replica disconnects, after it found its queue empty.
      await replica.update('items', milk, { title: 'Oat milk' })
    })
    await replica.resnapshot()
    spy.mockRestore()
    expect(await replica.queued()).toBe(1)
    expect(await replica.db.getAll('SELECT title FROM items')).toEqual([{ title: 'Oat milk' }])
    expect(await replica.journal.meta(metaKeys.resnapshot)).not.toBeNull()
  })

  it('stays closed when it is closed while it downloads itself again (D-125)', async () => {
    const { fetch } = routes({ '/sync/credentials': () => json(503, {}) })
    const { replica } = await open({ fetch })
    await replica.connect()
    await replica.journal.setMeta(metaKeys.resnapshot, '2026-10-02T10:00:00Z')
    const disconnect = replica.db.disconnect.bind(replica.db)
    const closing: Promise<void>[] = []
    const spy = vi.spyOn(replica.db, 'disconnect').mockImplementation(async () => {
      await disconnect()
      // The app closes the replica while the download disconnects it.
      if (closing.length === 0) closing.push(replica.close())
    })
    await replica.resnapshot()
    await Promise.all(closing)
    spy.mockRestore()
    expect(closing).toHaveLength(1)
    expect(replica.connected).toBe(false)
  })

  it('keeps a connect and a download of itself apart: neither clears the subscriptions the other makes (D-125)', async () => {
    const { fetch } = routes({ '/sync/credentials': () => json(503, {}) })
    const { replica } = await open({ fetch })
    const streams = new Set(testRegistry.streams.map((s) => s.stream)).size
    const subscribed = async (): Promise<number> =>
      (await replica.db.get<{ n: number }>('SELECT count(*) AS n FROM ps_stream_subscriptions')).n
    const held = async (): Promise<number> =>
      (await replica.db.getAll('SELECT id FROM items')).length
    await arrive(replica, 'items', newId(), { household_id: household, title: 'Milk', version: 1 })

    // The app connects the replica, on its network coming back, say, while the replica has
    // disconnected to clear itself: the connect subscribes only once the clear has run.
    const rows: number[] = []
    const syncStream = replica.db.syncStream.bind(replica.db)
    const subscribing = vi.spyOn(replica.db, 'syncStream').mockImplementation((name, params) => {
      const stream = syncStream(name, params)
      return {
        ...stream,
        subscribe: async (options) => {
          rows.push(await held())
          return stream.subscribe(options)
        },
      }
    })
    const disconnect = replica.db.disconnect.bind(replica.db)
    const connects: Promise<void>[] = []
    const disconnecting = vi.spyOn(replica.db, 'disconnect').mockImplementation(async () => {
      await disconnect()
      if (connects.length === 0) connects.push(replica.connect())
    })
    await replica.resnapshot()
    await Promise.all(connects)
    subscribing.mockRestore()
    expect(connects).toHaveLength(1)
    expect(rows).toEqual(Array.from({ length: streams }, () => 0))
    expect(await subscribed()).toBe(streams)
    expect(replica.connected).toBe(true)

    // Connected when the download began, the replica is connected again by the download itself:
    // the connect that waited for it has nothing left to do.
    const connected = vi.spyOn(replica.db, 'connect')
    connects.length = 0
    await replica.resnapshot()
    await Promise.all(connects)
    disconnecting.mockRestore()
    expect(connects).toHaveLength(1)
    expect(connected).toHaveBeenCalledTimes(1)
    connected.mockRestore()
    expect(await subscribed()).toBe(streams)
    expect(replica.connected).toBe(true)

    // And a download that comes while a connect is under way waits for it, and connects the
    // replica again as that left it.
    await replica.disconnect()
    await arrive(replica, 'items', newId(), { household_id: household, title: 'Bread', version: 1 })
    const connecting = replica.connect()
    await Promise.all([connecting, replica.resnapshot()])
    expect(await held()).toBe(0)
    expect(await subscribed()).toBe(streams)
    expect(replica.connected).toBe(true)
  })

  it('disconnects a replica whose connect is still under way only once that has connected it', async () => {
    const { fetch } = routes({ '/sync/credentials': () => json(503, {}) })
    const { replica } = await open({ fetch })
    const calls: string[] = []
    const connect = replica.db.connect.bind(replica.db)
    vi.spyOn(replica.db, 'connect').mockImplementation((connector, options) => {
      calls.push('connect')
      return connect(connector, options)
    })
    const disconnect = replica.db.disconnect.bind(replica.db)
    vi.spyOn(replica.db, 'disconnect').mockImplementation(() => {
      calls.push('disconnect')
      return disconnect()
    })
    // The app goes to the background while the replica is still subscribing to its streams.
    const connecting = replica.connect()
    await replica.disconnect()
    await connecting
    // Disconnected first, PowerSync would have been connected after it, and left so.
    expect(calls).toEqual(['connect', 'disconnect'])
    expect(replica.connected).toBe(false)
  })

  it('discards itself, its own tables too, once its device is signed out (FR-ID7)', async () => {
    let revoked = false
    const credential: Credential = {
      current: () => Promise.resolve('token'),
      renew: () => Promise.reject(new Revoked('the device was signed out')),
    }
    const { fetch } = routes({ '/sync/mutations': () => json(401, { code: 'unauthenticated' }) })
    const storage = mkdtempSync(join(tmpdir(), 'household-files-'))
    dirs.push(storage)
    const { replica } = await open({
      fetch,
      credential,
      storage,
      onRevoked: () => {
        revoked = true
      },
    })
    const milk = await replica.create('items', { title: 'Milk' })
    await replica.attach('items', milk, {
      data: new TextEncoder().encode('%PDF-1.7').buffer,
      contentType: 'application/pdf',
      fileName: 'r.pdf',
    })
    const [waiting] = await replica.attachments().list()
    expect(existsSync(waiting?.local_uri ?? '')).toBe(true)
    await replica.journal.setMeta(metaKeys.notBefore, '0')
    await expect(replica.flush()).rejects.toThrow(Revoked)
    // It wipes itself outside the upload that found the revocation, and then says so.
    await eventually(() => revoked)
    expect(revoked).toBe(true)
    expect(await replica.db.getAll('SELECT id FROM items')).toEqual([])
    expect(await replica.db.getAll(`SELECT id FROM ${localTables.meta}`)).toEqual([])
    // The file waiting for the row left the device with it.
    expect(existsSync(waiting?.local_uri ?? '')).toBe(false)
    await expect(replica.connect()).rejects.toThrow(Revoked)
  })

  it('discards itself when its report finds the device signed out (FR-ID7)', async () => {
    let revoked = false
    const credential: Credential = {
      current: () => Promise.reject(new Revoked('the device was signed out')),
      renew: () => Promise.reject(new Revoked('the device was signed out')),
    }
    const { replica } = await open({
      credential,
      onRevoked: () => {
        revoked = true
      },
    })
    // Two first reports at once name one replica.
    const [one, two] = await Promise.all([replica.id(), replica.id()])
    expect(one).toBe(two)
    await expect(replica.report()).rejects.toThrow(Revoked)
    // It wipes itself outside the upload that found the revocation, and then says so.
    await eventually(() => revoked)
    expect(revoked).toBe(true)
  })

  it("renews the credential its request for PowerSync's credentials is refused with, and asks once more", async () => {
    const { credential, renewals } = renewable()
    let accepted = 'token-1'
    const theirs = {
      endpoint: 'https://sync.test',
      token: 'theirs',
      expires_at: '2026-10-02T10:05:00Z',
    }
    const { route, carried } = admitting(
      () => accepted,
      () => json(200, theirs),
    )
    const { replica } = await open({
      fetch: routes({ '/sync/credentials': route }).fetch,
      credential,
    })
    // What PowerSync is handed to ask with, asked here as it asks: no PowerSync is there to connect to.
    const connect = vi.spyOn(replica.db, 'connect').mockResolvedValue()
    await replica.connect()
    const connector = connect.mock.calls[0]?.[0]
    expect(await connector?.fetchCredentials()).toEqual({
      endpoint: theirs.endpoint,
      token: theirs.token,
      expiresAt: new Date(theirs.expires_at),
    })
    expect(carried).toEqual(['Bearer token-0', 'Bearer token-1'])
    expect(renewals()).toBe(1)
    // Refused with the credential it renewed as well, it asks no third time: PowerSync is told, and
    // asks again in its own time.
    accepted = 'none'
    await expect(connector?.fetchCredentials()).rejects.toThrow('the sync credentials: 401')
    expect(carried.slice(2)).toEqual(['Bearer token-1', 'Bearer token-2'])
    expect(renewals()).toBe(2)
  })

  it('renews the credential its report is refused with, and sends the report once more', async () => {
    const { credential, renewals } = renewable()
    let accepted = 'token-1'
    const verdict = { matched: true, resnapshot_required: false, entries: [] }
    const reports: string[] = []
    const { route, carried } = admitting(
      () => accepted,
      () => json(200, verdict),
    )
    const { fetch } = routes({
      '/sync/digest': (url, init) => {
        reports.push(bodyOf(init))
        return route(url, init)
      },
    })
    const { replica } = await open({ fetch, credential })
    expect(await replica.report()).toEqual(verdict)
    expect(carried).toEqual(['Bearer token-0', 'Bearer token-1'])
    expect(renewals()).toBe(1)
    // The report it was refused, sent again as it was.
    expect(reports[0]).toContain(await replica.id())
    expect(reports[1]).toBe(reports[0])
    // Refused with the credential it renewed as well, it has no verdict, and sends no third time.
    accepted = 'none'
    expect(await replica.report()).toBeNull()
    expect(carried.slice(2)).toEqual(['Bearer token-1', 'Bearer token-2'])
    expect(renewals()).toBe(2)
  })

  it('renews the credential a file is refused with, and sends the file at the next run', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'household-files-'))
    dirs.push(storage)
    const { credential, renewals } = renewable()
    const { route, carried } = admitting(
      () => 'token-1',
      () => json(201, {}),
    )
    const { replica } = await open({
      fetch: routes({ '/content': route }).fetch,
      credential,
      storage,
    })
    const file = {
      data: new TextEncoder().encode('%PDF-1.7').buffer,
      contentType: 'application/pdf',
      fileName: 'r.pdf',
    }
    const [receipt, scan] = [newId(), newId()]
    for (const id of [receipt, scan]) {
      await arrive(replica, 'items', id, { household_id: household, title: 'Paper', version: 1 })
      await replica.attach('items', id, file)
    }
    await replica.attachments().upload()
    // The run ends at the refusal, the file behind it unsent: it would carry the same credential.
    expect(carried).toEqual(['Bearer token-0'])
    expect(renewals()).toBe(1)
    // Both wait, bytes and all, and no try of the file is counted: what was refused is the credential.
    const waiting = await replica.attachments().list()
    expect(waiting).toMatchObject([
      { id: receipt, status: 'pending', attempts: 0, code: null },
      { id: scan, status: 'pending', attempts: 0, code: null },
    ])
    expect(waiting.map((a) => existsSync(a.local_uri))).toEqual([true, true])
    await replica.attachments().upload()
    expect(carried.slice(1)).toEqual(['Bearer token-1', 'Bearer token-1'])
    expect(renewals()).toBe(1)
    expect(await replica.attachments().list()).toEqual([])
  })

  it('uploads a file once the server holds its row, and keeps a refusal for the member (D-25)', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'household-files-'))
    dirs.push(storage)
    let status = 201
    let refusal = 'unsupported_media_type'
    const { fetch, calls } = routes({
      '/content': () => json(status, status === 201 ? {} : { code: refusal }),
      '/sync/mutations': applying(1),
    })
    const { replica } = await open({ fetch, storage })
    const receipt = await replica.create('items', { title: 'Receipt' })
    const file = {
      data: new TextEncoder().encode('%PDF-1.7').buffer,
      contentType: 'application/pdf',
      fileName: 'r.pdf',
    }
    await replica.attach('items', receipt, file)
    await replica.attachments().upload()
    // Not before the server holds the row.
    expect(calls.filter((c) => c.url.endsWith('/content'))).toHaveLength(0)
    await replica.flush()
    await arrive(replica, 'items', receipt, {
      household_id: household,
      title: 'Receipt',
      version: 1,
    })
    await replica.attachments().upload()
    expect(calls.filter((c) => c.url.endsWith('/content'))).toHaveLength(1)
    expect(await replica.attachments().list()).toEqual([])

    // Refused for the household's state, which may upload again: the file waits (FR-BI2).
    status = 402
    refusal = 'entitlement_read_only'
    const scan = newId()
    await arrive(replica, 'items', scan, { household_id: household, title: 'Scan', version: 1 })
    await replica.attach('items', scan, { ...file, fileName: 'scan.exe' })
    await replica.attachments().upload()
    const [waiting] = await replica.attachments().list()
    expect(waiting).toMatchObject({ id: scan, status: 'pending', attempts: 1, code: null })
    expect(existsSync(waiting?.local_uri ?? '')).toBe(true)
    // Nor is it sent again at every run, each of which would send the whole file to be refused.
    const sent = calls.filter((c) => c.url.endsWith('/content')).length
    await replica.attachments().upload()
    expect(calls.filter((c) => c.url.endsWith('/content'))).toHaveLength(sent)

    // The app says the household's state has changed: the file is sent again, and refused for itself.
    status = 415
    refusal = 'unsupported_media_type'
    replica.resume()
    await replica.attachments().upload()
    expect(await replica.attachments().list()).toMatchObject([
      { id: scan, status: 'failed', code: 'unsupported_media_type' },
    ])
  })

  it("waits out the time a file's refusal asks before sending it again: the state's, and a 429's Retry-After", async () => {
    const storage = mkdtempSync(join(tmpdir(), 'household-files-'))
    dirs.push(storage)
    let now = Date.parse('2026-10-02T10:00:00Z')
    let answer = (): Response =>
      new Response(JSON.stringify({ code: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '30' },
      })
    const { fetch, calls } = routes({ '/content': () => answer() })
    const { replica } = await open({ fetch, storage, now: () => new Date(now) })
    const sends = (): number => calls.filter((c) => c.url.endsWith('/content')).length
    const scan = newId()
    await arrive(replica, 'items', scan, { household_id: household, title: 'Scan', version: 1 })
    await replica.attach('items', scan, {
      data: new TextEncoder().encode('%PDF-1.7').buffer,
      contentType: 'application/pdf',
      fileName: 'scan.pdf',
    })
    await replica.attachments().upload()
    expect(sends()).toBe(1)
    // Within the thirty seconds the limit asked for, no run sends anything.
    now += 29_000
    await replica.attachments().upload()
    expect(sends()).toBe(1)
    // Past them it is sent again, and refused for the household's state, which is waited out longer.
    answer = () => json(402, { code: 'entitlement_restricted' })
    now += 1_000
    await replica.attachments().upload()
    expect(sends()).toBe(2)
    answer = () => json(201, {})
    now += stateRetryMs - 1
    await replica.attachments().upload()
    expect(sends()).toBe(2)
    now += 1
    await replica.attachments().upload()
    expect(sends()).toBe(3)
    expect(await replica.attachments().list()).toEqual([])
  })

  it('uploads a file added while a run is under way in the run that follows it', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'household-files-'))
    dirs.push(storage)
    let sending = (): void => undefined
    const underWay = new Promise<void>((resolve) => {
      sending = resolve
    })
    let answer = (): void => undefined
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const { fetch, calls } = routes({
      '/content': async () => {
        sending()
        await answered
        return json(201, {})
      },
    })
    const { replica } = await open({ fetch, storage })
    const file = {
      data: new TextEncoder().encode('%PDF-1.7').buffer,
      contentType: 'application/pdf',
      fileName: 'r.pdf',
    }
    const [receipt, scan] = [newId(), newId()]
    for (const id of [receipt, scan])
      await arrive(replica, 'items', id, { household_id: household, title: 'Paper', version: 1 })
    await replica.attach('items', receipt, file)
    const run = replica.attachments().upload()
    await underWay
    // Added while the first is being sent: the run under way listed the files before it, and the call
    // that joins it must not be the last the file gets.
    await replica.attach('items', scan, file)
    const joined = replica.attachments().upload()
    answer()
    await Promise.all([run, joined])
    expect(calls.filter((c) => c.url.endsWith('/content'))).toHaveLength(2)
    expect(await replica.attachments().list()).toEqual([])
  })

  it("keeps a file, bytes and all, that a refusal with no problem of the API's leaves: nothing judged it", async () => {
    const storage = mkdtempSync(join(tmpdir(), 'household-files-'))
    dirs.push(storage)
    let now = Date.parse('2026-10-02T10:00:00Z')
    // A proxy that lost its upstream, or a host that is not the API, answers for the upload's route.
    let answer = (): Response => new Response('<html>Not Found</html>', { status: 404 })
    const { fetch, calls } = routes({ '/content': () => answer() })
    const { replica } = await open({ fetch, storage, now: () => new Date(now) })
    const sends = (): number => calls.filter((c) => c.url.endsWith('/content')).length
    const scan = newId()
    await arrive(replica, 'items', scan, { household_id: household, title: 'Scan', version: 1 })
    await replica.attach('items', scan, {
      data: new TextEncoder().encode('%PDF-1.7').buffer,
      contentType: 'application/pdf',
      fileName: 'scan.pdf',
    })
    await replica.attachments().upload()
    const [waiting] = await replica.attachments().list()
    expect(waiting).toMatchObject({ id: scan, status: 'pending', attempts: 1, code: null })
    expect(existsSync(waiting?.local_uri ?? '')).toBe(true)
    // Nor is it sent again at every run: what answered the first answers the next.
    await replica.attachments().upload()
    expect(sends()).toBe(1)
    // The API's own refusal, a problem with its code, is one of the file.
    answer = () => json(404, { code: 'not_found' })
    now += stateRetryMs
    await replica.attachments().upload()
    expect(sends()).toBe(2)
    expect(await replica.attachments().list()).toMatchObject([
      { id: scan, status: 'failed', code: 'not_found' },
    ])
    expect(existsSync(waiting?.local_uri ?? '')).toBe(false)
  })

  it('keeps a file whose bytes the device lost as refused, and sends the files behind it', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'household-files-'))
    dirs.push(storage)
    const { fetch, calls } = routes({ '/content': () => json(201, {}) })
    const { replica } = await open({ fetch, storage })
    const file = {
      data: new TextEncoder().encode('%PDF-1.7').buffer,
      contentType: 'application/pdf',
      fileName: 'r.pdf',
    }
    const [receipt, scan] = [newId(), newId()]
    for (const id of [receipt, scan]) {
      await arrive(replica, 'items', id, { household_id: household, title: 'Paper', version: 1 })
      await replica.attach('items', id, file)
    }
    // The first file's bytes are gone, as after a run that ended between deleting them and
    // forgetting the row, or with the device's storage.
    const [lost] = await replica.attachments().list()
    rmSync(lost?.local_uri ?? '')
    await replica.attachments().upload()
    expect(calls.filter((c) => c.url.endsWith('/content'))).toHaveLength(1)
    expect(await replica.attachments().list()).toMatchObject([
      { id: receipt, status: 'failed', code: bytesLost },
    ])
  })
})
