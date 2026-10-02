import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Revoked, type Credential } from './connector.ts'
import { localTables, metaKeys } from './schema.ts'
import { NodeFileSystemAdapter, multipart, openReplica } from './node.ts'
import { NeedsConnection, type Replica, type RowState } from './replica.ts'
import { testRegistry } from './testing.ts'
import type { SyncMutation } from './mutation.ts'

const household = '01920000-0000-7000-8000-00000000000a'

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

async function open(
  options: {
    readonly dir?: string
    readonly fetch?: typeof globalThis.fetch
    readonly credential?: Credential
    readonly onRevoked?: () => void
    readonly storage?: string
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

describe('a replica', () => {
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
    const milk = await replica.create('items', { title: 'Milk' })
    const stop = replica.watchRowState('items', milk, (s) => states.push(s))
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 120))
    await settle()
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
    await settle()

    // Another member's deletion leaves a tombstone, which is no withdrawal.
    await arrive(replica, 'items', milk, {
      household_id: household,
      title: 'Milk',
      version: 2,
      deleted_at: '2026-10-02T10:00:00Z',
    })
    await settle()
    expect(states.at(-1)).toEqual({ kind: 'synced', deleted: true })

    // A row that leaves the replica was withdrawn; with its module turned off, it says so.
    const bread = newId()
    await arrive(replica, 'items', bread, { household_id: household, title: 'Bread', version: 1 })
    const breadStates: RowState[] = []
    const stopBread = replica.watchRowState('items', bread, (s) => breadStates.push(s))
    await settle()
    await arrive(replica, 'module_enablement', newId(), { module: 'test', enabled: 0, version: 1 })
    await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [bread])
    await settle()
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
    stop()
    stopBread()
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
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 120))
    const milk = await replica.create('items', { title: 'Milk' })
    const states: RowState[] = []
    const stop = replica.watchRowState('items', milk, (s) => states.push(s))
    await settle()
    await replica.flush()
    // The next checkpoint takes away the row the server never had.
    await replica.db.execute('DELETE FROM ps_data__items WHERE id = ?', [milk])
    await settle()
    const [refused] = await replica.inbox()
    await replica.discard(refused?.mutation_id ?? '')
    await settle()
    expect(states.map((s) => s.kind)).toEqual(['pending', 'rejected', 'absent'])
    stop()
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

    verdict = { matched: false, resnapshot_required: true, entries: [] }
    await replica.report()
    await new Promise((r) => setTimeout(r, 100))
    expect(await replica.db.getAll('SELECT id FROM items')).toEqual([])
    expect(await replica.held()).toHaveLength(1)
    expect(await replica.journal.meta(metaKeys.resnapshot)).toBeNull()
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
    await new Promise((r) => setTimeout(r, 100))
    expect(revoked).toBe(true)
    expect(await replica.db.getAll('SELECT id FROM items')).toEqual([])
    expect(await replica.db.getAll(`SELECT id FROM ${localTables.meta}`)).toEqual([])
    // The file waiting for the row left the device with it.
    expect(existsSync(waiting?.local_uri ?? '')).toBe(false)
    await expect(replica.connect()).rejects.toThrow(Revoked)
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

    status = 415
    refusal = 'unsupported_media_type'
    await replica.attachments().upload()
    expect(await replica.attachments().list()).toMatchObject([
      { id: scan, status: 'failed', code: 'unsupported_media_type' },
    ])
  })
})
