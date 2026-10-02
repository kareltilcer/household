import { UpdateType } from '@powersync/common'
import { describe, expect, it } from 'vitest'
import {
  Connector,
  RateLimited,
  inProgressWindowMs,
  locate,
  retryAfterMs,
  rowKey,
  type ConnectorOptions,
  type Held,
  type HoldReason,
  type Journal,
  type QueuedBatch,
  type Rebase,
  type RebaseEntry,
  type Surface,
  type UploadQueue,
} from './connector.ts'
import { encodeMetadata, type SyncMutation, type SyncMutationResult } from './mutation.ts'
import { testRegistry } from './testing.ts'

const push = 'https://standin.test/api/v1/households/h/sync/mutations'

/** The body a request was sent with, which the library always sends as text. */
function bodyOf(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}

/** An upload queue of item writes, which a completed batch leaves. */
class Queue implements UploadQueue {
  readonly entries: QueuedBatch['entries'][number][] = []
  private next = 1

  write(
    title: string,
    op: UpdateType = UpdateType.PUT,
    row: { readonly id?: string; readonly base?: number; readonly table?: string } = {},
  ): string {
    const id = row.id ?? `item-${String(this.next)}`
    this.entries.push({
      clientId: this.next,
      op,
      table: row.table ?? 'items',
      id,
      opData: { title },
      metadata: encodeMetadata({
        mutation_id: `m-${String(this.next)}`,
        client_time: '2026-09-29T10:00:00Z',
        ...(row.base === undefined ? {} : { base_version: row.base }),
      }),
    })
    this.next++
    return id
  }

  peek(limit: number): Promise<QueuedBatch | null> {
    const taken = this.entries.slice(0, limit)
    if (taken.length === 0) return Promise.resolve(null)
    return Promise.resolve({
      entries: taken,
      complete: () => {
        this.entries.splice(0, taken.length)
        return Promise.resolve()
      },
    })
  }
}

/** A journal in memory. */
class Memory implements Journal {
  readonly recorded: [SyncMutation, SyncMutationResult, Surface][] = []
  holding: Held[] = []
  readonly rows = new Map<string, Rebase>()
  readonly seen = new Set<string>()
  sentThrough = 0
  waitUntil = 0

  record(mutation: SyncMutation, result: SyncMutationResult, surface: Surface): Promise<void> {
    this.recorded.push([mutation, result, surface])
    return Promise.resolve()
  }

  settled(mutationId: string): Promise<void> {
    this.seen.add(mutationId)
    return Promise.resolve()
  }

  rebases(): Promise<ReadonlyMap<string, Rebase>> {
    return Promise.resolve(new Map(this.rows))
  }

  rebase(entries: readonly RebaseEntry[]): Promise<void> {
    for (const e of entries)
      this.rows.set(rowKey(e.entityType, e.entityId), { from: e.from, to: e.to })
    return Promise.resolve()
  }

  prune(): Promise<void> {
    return Promise.resolve()
  }

  sent(clientId: number): Promise<void> {
    this.sentThrough = Math.max(this.sentThrough, clientId)
    return Promise.resolve()
  }

  notBefore(): Promise<number> {
    return Promise.resolve(this.waitUntil)
  }

  setNotBefore(at: number): Promise<void> {
    this.waitUntil = at
    return Promise.resolve()
  }

  hold(reason: HoldReason, mutation: SyncMutation): Promise<void> {
    this.holding = [
      ...this.holding.filter((h) => h.mutation.mutation_id !== mutation.mutation_id),
      { reason, mutation },
    ]
    return Promise.resolve()
  }

  held(reason: HoldReason): Promise<Held[]> {
    return Promise.resolve(this.holding.filter((h) => h.reason === reason))
  }

  release(ids: readonly string[]): Promise<void> {
    this.holding = this.holding.filter((h) => !ids.includes(h.mutation.mutation_id))
    return Promise.resolve()
  }
}

interface Sent {
  readonly key: string
  readonly ids: string[]
  readonly authorization: string
}

type Answer = Response | Error | ((ids: string[]) => Response)

/** A push that records what it was sent and answers with answers, in turn, then applies everything. */
function server(...answers: Answer[]) {
  const sent: Sent[] = []
  const fetch: typeof globalThis.fetch = (_input, init) => {
    const headers = new Headers(init?.headers)
    // The connector sends its batch as a string.
    const body = typeof init?.body === 'string' ? init.body : '{"mutations":[]}'
    const ids = (JSON.parse(body) as { mutations: SyncMutation[] }).mutations.map(
      (m) => m.mutation_id,
    )
    sent.push({
      key: headers.get('idempotency-key') ?? '',
      ids,
      authorization: headers.get('authorization') ?? '',
    })
    const answer = answers.shift() ?? results([])
    if (answer instanceof Error) return Promise.reject(answer)
    return Promise.resolve(typeof answer === 'function' ? answer(ids) : answer)
  }
  return { sent, fetch }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** A 200 answering each mutation in turn with outcomes, and a code for each but applied. */
function results(
  outcomes: readonly (SyncMutationResult['outcome'] | [SyncMutationResult['outcome'], string])[],
): (ids: string[]) => Response {
  return (ids) =>
    json(200, {
      results: ids.map((mutation_id, i) => {
        const o = outcomes[i] ?? 'applied'
        const [outcome, code] = typeof o === 'string' ? [o, o === 'applied' ? null : o] : o
        return {
          mutation_id,
          outcome,
          code,
          version: outcome === 'applied' || outcome === 'merged' ? 1 : null,
        }
      }),
    })
}

function connector(
  fetch: typeof globalThis.fetch,
  journal: Journal,
  options: Partial<ConnectorOptions> = {},
) {
  let keys = 0
  let token = 0
  const renewed: number[] = []
  const c = new Connector({
    registry: testRegistry,
    pushUrl: push,
    fetch,
    journal,
    credential: {
      current: () => Promise.resolve(`token-${String(token)}`),
      renew: () => {
        token++
        renewed.push(token)
        return Promise.resolve()
      },
    },
    newKey: () => `key-${String(++keys)}`,
    ...options,
  })
  return { c, renewed }
}

describe('the connector', () => {
  it('ends every mutation the push answers, and keeps each answer but applied beside its mutation', async () => {
    const q = new Queue()
    q.write('Milk')
    q.write('Bread')
    q.write('Eggs')
    const journal = new Memory()
    const { fetch, sent } = server(results(['applied', 'merged', ['rejected', 'not_found']]))
    await connector(fetch, journal).c.upload(q)
    expect(q.entries).toEqual([])
    expect(sent).toHaveLength(1)
    expect(journal.recorded.map(([m, r]) => [m.mutation_id, r.outcome, r.code])).toEqual([
      ['m-2', 'merged', 'merged'],
      ['m-3', 'rejected', 'not_found'],
    ])
    expect(journal.holding).toEqual([])
    // Each before its request, the queue's writes sent so far: none of them is merged into again.
    expect(journal.sentThrough).toBe(3)
  })

  it('sends the queue in order, a batch at a time, each under a key of its own', async () => {
    const q = new Queue()
    for (const t of ['Milk', 'Bread', 'Eggs']) q.write(t)
    const { fetch, sent } = server()
    await connector(fetch, new Memory(), { maxBatch: 2 }).c.upload(q)
    expect(sent.map((s) => [s.key, s.ids])).toEqual([
      ['key-1', ['m-1', 'm-2']],
      ['key-2', ['m-3']],
    ])
  })

  it('sends a batch the network failed again unchanged, under its key, whatever was queued behind it', async () => {
    const q = new Queue()
    q.write('Milk')
    q.write('Bread')
    const { fetch, sent } = server(new TypeError('network: refused'))
    const { c } = connector(fetch, new Memory())
    await expect(c.upload(q)).rejects.toThrow('refused')
    expect(q.entries).toHaveLength(2)
    q.write('Eggs')
    await c.upload(q)
    expect(sent.map((s) => [s.key, s.ids])).toEqual([
      ['key-1', ['m-1', 'm-2']],
      ['key-1', ['m-1', 'm-2']],
      ['key-2', ['m-3']],
    ])
    expect(q.entries).toEqual([])
  })

  it('renews the credential the push refused, and throws so that the batch is sent again with the new one', async () => {
    const q = new Queue()
    q.write('Milk')
    const { fetch, sent } = server(json(401, { code: 'unauthenticated' }))
    const { c, renewed } = connector(fetch, new Memory())
    await expect(c.upload(q)).rejects.toThrow()
    expect(renewed).toEqual([1])
    await c.upload(q)
    expect(sent.map((s) => [s.key, s.authorization])).toEqual([
      ['key-1', 'Bearer token-0'],
      ['key-1', 'Bearer token-1'],
    ])
  })

  it('sends nothing more until a 429 has been waited out, across restarts', async () => {
    const q = new Queue()
    q.write('Milk')
    let now = 1_000_000
    const journal = new Memory()
    const { fetch, sent } = server(json(429, { code: 'rate_limited' }, { 'retry-after': '3' }))
    const { c } = connector(fetch, journal, { now: () => now })
    await expect(c.upload(q)).rejects.toThrow(RateLimited)
    expect(journal.waitUntil).toBe(now + 3000)
    // Before then, a restarted connector, which keeps its journal, sends nothing either.
    now += 2_000
    const restarted = connector(fetch, journal, { now: () => now }).c
    await expect(restarted.upload(q)).rejects.toThrow(RateLimited)
    expect(sent).toHaveLength(1)
    now += 1_000
    await restarted.upload(q)
    expect(sent).toHaveLength(2)
    expect(q.entries).toEqual([])
  })

  it("reads a Retry-After's seconds or its date", () => {
    const now = Date.parse('2026-10-02T23:00:00Z')
    expect(retryAfterMs('3', now)).toBe(3000)
    // A household past its day's mutations waits for the UTC day's end (D-127).
    expect(retryAfterMs('Sat, 03 Oct 2026 00:00:00 GMT', now)).toBe(3_600_000)
    expect(retryAfterMs(null, now)).toBe(1000)
    expect(retryAfterMs('soon', now)).toBe(1000)
  })

  it('halves a batch the push finds too large', async () => {
    const q = new Queue()
    for (const t of ['Milk', 'Bread', 'Eggs', 'Tea']) q.write(t)
    const { fetch, sent } = server(json(413, { code: 'batch_too_large' }))
    await connector(fetch, new Memory()).c.upload(q)
    expect(sent.map((s) => s.ids)).toEqual([
      ['m-1', 'm-2', 'm-3', 'm-4'],
      ['m-1', 'm-2'],
      ['m-3', 'm-4'],
    ])
    expect(q.entries).toEqual([])
  })

  it('rejects a mutation too large to send alone, rather than retrying it forever', async () => {
    const q = new Queue()
    q.write('Milk')
    q.write('Bread')
    const tooLarge = (): Response => json(413, { code: 'payload_too_large' })
    const journal = new Memory()
    const { fetch, sent } = server(tooLarge(), tooLarge())
    await connector(fetch, journal).c.upload(q)
    expect(sent.map((s) => s.ids)).toEqual([['m-1', 'm-2'], ['m-1'], ['m-2']])
    expect(journal.recorded.map(([m, r]) => [m.mutation_id, r.outcome, r.code])).toEqual([
      ['m-1', 'rejected', 'payload_too_large'],
    ])
    expect(q.entries).toEqual([])
  })

  it('rejects every mutation a 422 points at, and sends the rest again as a new batch', async () => {
    const q = new Queue()
    for (const t of ['Milk', 'Bread', 'Eggs', 'Tea']) q.write(t)
    const refusal = json(422, {
      code: 'validation_failed',
      errors: [
        { field: '/mutations/3/entity_id', code: 'pattern' },
        { field: '/mutations/1/entity_id', code: 'pattern' },
      ],
    })
    const journal = new Memory()
    const { fetch, sent } = server(refusal)
    await connector(fetch, journal).c.upload(q)
    expect(sent.map((s) => [s.key, s.ids])).toEqual([
      ['key-1', ['m-1', 'm-2', 'm-3', 'm-4']],
      ['key-2', ['m-1', 'm-3']],
    ])
    expect(journal.recorded.map(([m, r]) => [m.mutation_id, r.outcome])).toEqual([
      ['m-2', 'rejected'],
      ['m-4', 'rejected'],
    ])
    expect(q.entries).toEqual([])
  })

  it('rejects the mutation a 422 points at, and sends the rest again as a new batch', async () => {
    const q = new Queue()
    for (const t of ['Milk', 'Bread', 'Eggs']) q.write(t)
    const refusal = json(422, {
      code: 'validation_failed',
      errors: [{ field: '/mutations/1/entity_id', code: 'pattern' }],
    })
    const journal = new Memory()
    const { fetch, sent } = server(refusal)
    await connector(fetch, journal).c.upload(q)
    expect(sent.map((s) => [s.key, s.ids])).toEqual([
      ['key-1', ['m-1', 'm-2', 'm-3']],
      ['key-2', ['m-1', 'm-3']],
    ])
    expect(journal.recorded.map(([m, r]) => [m.mutation_id, r.outcome, r.code])).toEqual([
      ['m-2', 'rejected', 'validation_failed'],
    ])
    expect(q.entries).toEqual([])
  })

  it('answers every mutation of a batch refused whole alike: held on a 402, ended on a 404', async () => {
    const q = new Queue()
    q.write('Milk')
    q.write('Bread')
    const journal = new Memory()
    await connector(server(json(402, { code: 'entitlement_read_only' })).fetch, journal).c.upload(q)
    expect(journal.holding.map((h) => [h.reason, h.mutation.mutation_id])).toEqual([
      ['entitlement', 'm-1'],
      ['entitlement', 'm-2'],
    ])
    // Each with the 402's own code (D-118).
    expect(journal.recorded.map(([m, r]) => [m.mutation_id, r.outcome, r.code])).toEqual([
      ['m-1', 'rejected', 'entitlement_read_only'],
      ['m-2', 'rejected', 'entitlement_read_only'],
    ])
    q.write('Eggs')
    await connector(server(json(404, { code: 'not_found' })).fetch, journal).c.upload(q)
    expect(journal.recorded.at(-1)?.[1]).toMatchObject({ outcome: 'rejected', code: 'not_found' })
    expect(journal.holding).toHaveLength(2)
  })

  it('holds a deferred mutation and replays it once the queue has drained, after the writes queued behind it', async () => {
    const q = new Queue()
    for (const t of ['Rice', 'Brown rice', 'Basmati', 'Jasmine']) q.write(t, UpdateType.PATCH)
    const journal = new Memory()
    const { fetch, sent } = server(
      results(['applied', ['rejected', 'validation_failed'], ['deferred', 'dependency_failed']]),
    )
    await connector(fetch, journal, { maxBatch: 3 }).c.upload(q)
    expect(sent.map((s) => s.ids)).toEqual([['m-1', 'm-2', 'm-3'], ['m-4'], ['m-3']])
    expect(journal.holding).toEqual([])
    expect(journal.recorded.map(([m, r]) => [m.mutation_id, r.outcome])).toEqual([
      ['m-2', 'rejected'],
      ['m-3', 'deferred'],
    ])
  })

  it('holds an entitlement rejection until the household may write again', async () => {
    const q = new Queue()
    q.write('Honey')
    const journal = new Memory()
    const { fetch, sent } = server(results([['rejected', 'entitlement']]))
    const { c } = connector(fetch, journal)
    await c.upload(q)
    await c.upload(q)
    expect(sent).toHaveLength(1)
    expect(journal.holding.map((h) => h.reason)).toEqual(['entitlement'])
    c.resume()
    await c.upload(q)
    expect(sent.map((s) => s.ids)).toEqual([['m-1'], ['m-1']])
    expect(journal.holding).toEqual([])
  })

  it('replays the entitlement holds at a later upload when the replay resume() let through fails', async () => {
    const q = new Queue()
    q.write('Honey')
    const journal = new Memory()
    const { fetch, sent } = server(
      results([['rejected', 'entitlement_read_only']]),
      new TypeError('network: refused'),
    )
    const { c } = connector(fetch, journal)
    await c.upload(q)
    c.resume()
    expect(c.resuming).toBe(true)
    await expect(c.upload(q)).rejects.toThrow('refused')
    expect(c.resuming).toBe(true)
    await c.upload(q)
    expect(c.resuming).toBe(false)
    expect(sent.map((s) => [s.key, s.ids])).toEqual([
      ['key-1', ['m-1']],
      ['key-2', ['m-1']],
      ['key-2', ['m-1']],
    ])
    expect(journal.holding).toEqual([])
  })

  it('stops a replay once a batch ends none of the holds it sent, however many wait behind them', async () => {
    const q = new Queue()
    q.write('Honey')
    q.write('Jam')
    const journal = new Memory()
    const refused = results([['rejected', 'entitlement_read_only']])
    const { fetch, sent } = server(refused, refused, refused, refused, refused)
    const { c } = connector(fetch, journal, { maxBatch: 1 })
    await c.upload(q)
    // Resumed while the household still refuses them: m-1 is held again, behind m-2.
    c.resume()
    await c.upload(q)
    expect(sent.map((s) => s.ids)).toEqual([['m-1'], ['m-2'], ['m-1']])
    expect(journal.holding.map((h) => h.mutation.mutation_id)).toEqual(['m-2', 'm-1'])
    expect(c.resuming).toBe(false)
  })

  it('records no attempt at the push when the credential cannot be had', async () => {
    const q = new Queue()
    q.write('Milk')
    const { fetch, sent } = server()
    const attempts: string[] = []
    const c = new Connector({
      registry: testRegistry,
      pushUrl: push,
      fetch,
      journal: new Memory(),
      credential: {
        current: () => Promise.reject(new TypeError('network: the sign-in was refused')),
        renew: () => Promise.resolve(),
      },
      newKey: () => 'key-1',
      observer: {
        attempted: (a) => {
          attempts.push(a.key)
        },
      },
    })
    await expect(c.upload(q)).rejects.toThrow('sign-in was refused')
    expect(sent).toEqual([])
    expect(attempts).toEqual([])
    expect(q.entries).toHaveLength(1)
  })

  it('keeps a held batch its key while the queue is sent before it', async () => {
    const q = new Queue()
    for (const t of ['Rice', 'Brown rice']) q.write(t, UpdateType.PATCH)
    const journal = new Memory()
    const { fetch, sent } = server(
      results(['applied', ['deferred', 'dependency_failed']]),
      new TypeError('network: the response was lost'),
    )
    const { c } = connector(fetch, journal)
    await expect(c.upload(q)).rejects.toThrow('lost')
    expect(journal.holding.map((h) => h.mutation.mutation_id)).toEqual(['m-2'])
    q.write('Basmati', UpdateType.PATCH)
    await c.upload(q)
    expect(sent.map((s) => [s.key, s.ids])).toEqual([
      ['key-1', ['m-1', 'm-2']],
      ['key-2', ['m-2']],
      ['key-3', ['m-3']],
      ['key-2', ['m-2']],
    ])
    expect(journal.holding).toEqual([])
  })

  it("throws on a 409, and sends the batch under a fresh key once D-92's five minutes have passed", async () => {
    const q = new Queue()
    q.write('Milk')
    let now = 0
    const inProgress = (): Response => json(409, { code: 'idempotency_in_progress' })
    const { fetch, sent } = server(inProgress(), inProgress(), inProgress())
    const { c } = connector(fetch, new Memory(), { now: () => now })
    await expect(c.upload(q)).rejects.toThrow()
    now = inProgressWindowMs / 2
    await expect(c.upload(q)).rejects.toThrow()
    now = inProgressWindowMs + 1
    await expect(c.upload(q)).rejects.toThrow()
    // The fresh key has a window of its own.
    now = inProgressWindowMs + 2
    await c.upload(q)
    expect(sent.map((s) => s.key)).toEqual(['key-1', 'key-1', 'key-2', 'key-2'])
  })

  it('keeps a batch whose answer was lost on its key past five minutes: only a 409 gives a key up', async () => {
    const q = new Queue()
    q.write('Milk')
    let now = 0
    const { fetch, sent } = server(
      new TypeError('network: the response was lost'),
      new TypeError('network: refused'),
    )
    const { c } = connector(fetch, new Memory(), { now: () => now })
    await expect(c.upload(q)).rejects.toThrow('lost')
    now = inProgressWindowMs + 1
    await expect(c.upload(q)).rejects.toThrow('refused')
    now = 2 * inProgressWindowMs
    await c.upload(q)
    // The push answers the key from the response it stored, where a fresh key would run it again.
    expect(sent.map((s) => s.key)).toEqual(['key-1', 'key-1', 'key-1'])
    expect(q.entries).toEqual([])
  })

  it('starts the D-92 window again for the fresh key a 422 moves the rest of a batch to', async () => {
    const q = new Queue()
    q.write('Milk')
    q.write('Bread')
    let now = 0
    const refusal = json(422, {
      code: 'validation_failed',
      errors: [{ field: '/mutations/1/entity_id', code: 'pattern' }],
    })
    const { fetch, sent } = server(
      new TypeError('network: refused'),
      refusal,
      json(409, { code: 'idempotency_in_progress' }),
    )
    const { c } = connector(fetch, new Memory(), { now: () => now })
    await expect(c.upload(q)).rejects.toThrow('refused')
    // Late in key-1's window, a 422 moves the rest to key-2, whose first request is not answered.
    now = inProgressWindowMs - 1_000
    await expect(c.upload(q)).rejects.toThrow()
    // Past key-1's window, but not key-2's: the rest is sent under key-2 still.
    now = inProgressWindowMs + 1_000
    await c.upload(q)
    expect(sent.map((s) => [s.key, s.ids])).toEqual([
      ['key-1', ['m-1', 'm-2']],
      ['key-1', ['m-1', 'm-2']],
      ['key-2', ['m-1']],
      ['key-2', ['m-1']],
    ])
    expect(q.entries).toEqual([])
  })

  it('is busy from the moment an upload starts until it returns', async () => {
    const q = new Queue()
    q.write('Milk')
    let answer: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      answer = resolve
    })
    const { c } = connector(() => pending, new Memory())
    expect(c.busy).toBe(false)
    const upload = c.upload(q)
    expect(c.busy).toBe(true)
    answer(results([])(['m-1']))
    await upload
    expect(c.busy).toBe(false)

    q.write('Bread')
    const failing = connector(() => Promise.reject(new TypeError('network: refused')), new Memory())
    await expect(failing.c.upload(q)).rejects.toThrow('refused')
    expect(failing.c.busy).toBe(false)
  })

  it('throws on an answer the contract does not allow, and reports it', async () => {
    const reasons: string[] = []
    for (const answer of [
      json(200, { results: [] }),
      json(200, { results: [{ mutation_id: 'm-1', outcome: 'rejected', code: null }] }),
      json(200, { results: [{ mutation_id: 'someone-else', outcome: 'applied' }] }),
    ]) {
      const q = new Queue()
      q.write('Milk')
      const { c } = connector(server(answer).fetch, new Memory(), {
        observer: {
          malformed: (_attempt, reason) => {
            reasons.push(reason)
          },
        },
      })
      await expect(c.upload(q)).rejects.toThrow('malformed')
      expect(q.entries).toHaveLength(1)
    }
    expect(reasons).toEqual([
      '0 results for 1 mutations',
      'result 0 is rejected without a code',
      'result 0 answers another mutation',
    ])
  })

  it('broken on purpose, retries a rejection forever', async () => {
    const q = new Queue()
    q.write('Milk')
    const refused = results([['rejected', 'not_found']])
    const { fetch, sent } = server(refused, refused, refused)
    const { c } = connector(fetch, new Memory(), { retryRejections: true })
    for (let i = 0; i < 3; i++) await expect(c.upload(q)).rejects.toThrow('retries a rejection')
    expect(sent.map((s) => s.key)).toEqual(['key-1', 'key-1', 'key-1'])
    expect(q.entries).toHaveLength(1)
  })
})

describe('the connector, across batches', () => {
  it("sends a later mutation of a row against the version an earlier one's answer returned (D-122)", async () => {
    const q = new Queue()
    q.write('Oat milk', UpdateType.PATCH, { id: 'milk', base: 3 })
    const journal = new Memory()
    const bodies: SyncMutation[][] = []
    const fetch: typeof globalThis.fetch = (_input, init) => {
      const batch = (JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }).mutations
      bodies.push(batch)
      const version = 3 + bodies.length
      return Promise.resolve(
        json(200, {
          results: batch.map((m) => ({ mutation_id: m.mutation_id, outcome: 'applied', version })),
        }),
      )
    }
    const { c } = connector(fetch, journal)
    await c.upload(q)
    // Made while the first was in flight, against the version the replica still held.
    q.write('Soy milk', UpdateType.PATCH, { id: 'milk', base: 3 })
    // A row created and then edited before the server answered either: the edit names no version.
    q.write('Bread', UpdateType.PUT, { id: 'bread' })
    await c.upload(q)
    q.write('Rye bread', UpdateType.PATCH, { id: 'bread' })
    // Another row's write against its own version is not touched.
    q.write('Eggs', UpdateType.PATCH, { id: 'eggs', base: 7 })
    await c.upload(q)
    expect(bodies.map((b) => b.map((m) => [m.entity_id, m.base_version]))).toEqual([
      [['milk', 3]],
      [
        ['milk', 4],
        ['bread', null],
      ],
      [
        ['bread', 5],
        ['eggs', 7],
      ],
    ])
    expect(journal.rows.get(rowKey('test.item', 'milk'))).toEqual({ from: 3, to: 5 })
  })

  it('tells the member of a merge only where it overrode what they set, or where the module keeps the loser', async () => {
    const q = new Queue()
    q.write('Oat milk', UpdateType.PATCH, { id: 'milk', base: 1 })
    q.write('Bread', UpdateType.PATCH, { id: 'bread', base: 1 })
    q.write('Plan', UpdateType.PATCH, { id: 'plan', base: 1, table: 'notes' })
    const journal = new Memory()
    const titles = ['Soy milk', 'Bread', 'Plan']
    const fetch: typeof globalThis.fetch = (_input, init) => {
      const batch = (JSON.parse(bodyOf(init)) as { mutations: SyncMutation[] }).mutations
      return Promise.resolve(
        json(200, {
          results: batch.map((m, i) => ({
            mutation_id: m.mutation_id,
            outcome: 'merged',
            code: 'concurrent_change',
            version: 2,
            row: { title: titles[i] },
          })),
        }),
      )
    }
    await connector(fetch, journal).c.upload(q)
    expect(journal.recorded.map(([m, , s]) => [m.entity_id, s.unresolved, s.overridden])).toEqual([
      ['milk', true, ['title']],
      ['bread', false, []],
      ['plan', true, []],
    ])
  })

  it('marks what a held mutation asked of the member seen to once its replay ends', async () => {
    const q = new Queue()
    q.write('Honey')
    const journal = new Memory()
    const { fetch } = server(results([['rejected', 'entitlement_read_only']]))
    const { c } = connector(fetch, journal)
    await c.upload(q)
    expect(journal.recorded[0]?.[2].unresolved).toBe(true)
    c.resume()
    await c.upload(q)
    expect([...journal.seen]).toEqual(['m-1'])
  })
})

describe('a 422', () => {
  it('locates the mutations its errors all point into', () => {
    const body = (fields: string[]): string =>
      JSON.stringify({ errors: fields.map((field) => ({ field, code: 'pattern' })) })
    expect(locate(body(['/mutations/2/entity_id', '/mutations/2/op']), 3)).toEqual([2])
    expect(locate(body(['/mutations/1/op', '/mutations/0/entity_id']), 3)).toEqual([0, 1])
    expect(locate(body(['/mutations/0/op', 'header:Idempotency-Key']), 3)).toBeNull()
    expect(locate(body(['header:Idempotency-Key']), 3)).toBeNull()
    expect(locate(body(['/mutations/5']), 3)).toBeNull()
    expect(locate(body([]), 3)).toBeNull()
    expect(locate('not json', 3)).toBeNull()
  })
})
