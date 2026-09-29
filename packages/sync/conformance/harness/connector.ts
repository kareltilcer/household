// The suite's own connector (plan item 12): it drains a client's upload queue to the push the way
// item 15's will (ADR 0001), until item 15's replaces it. PowerSync applies no checkpoint while
// the queue holds anything, so the connector ends every mutation the server answers, whatever the
// answer, and throws (so that PowerSync retries it) only when nothing answered the mutations: a
// transport failure, a 5xx, a 401, a 409 or a 429.
//
// It sends the queue in order, several queued transactions to a batch up to maxBatch, under one
// Idempotency-Key per batch that stays with the batch until it is answered. What it does with each
// answer:
//   - applied: ended.
//   - merged, conflict, and a rejection: ended, and recorded in the local-only outcomes table with
//     the mutation, since the next checkpoint replaces the local write.
//   - an `entitlement` rejection: recorded, and held to replay once the household may write again
//     (resume(); FR-BI2, scenario 14).
//   - deferred: recorded, and held to replay once the queue has drained (scenario 8). So a held
//     mutation replays after the writes queued behind it, the one reordering a client's own
//     uploads have (PRD 10 §4).
// And to a response that answers no mutation: a 401 renews the API credential and throws; a 429
// waits out its Retry-After and throws; a 413 halves the batch; a 422 rejects the mutation it
// locates and sends the rest again; a 402 or a 404 answers every mutation of the batch alike,
// `entitlement` or `not_found`; a 409 idempotency_in_progress throws, and past D-92's five minutes
// the batch is sent under a fresh key, which per-mutation idempotency answers (FR-SY5).

import {
  isEntitlement,
  terminal,
  toMutation,
  type QueuedWrite,
  type SyncMutation,
  type SyncMutationResult,
} from './mutation.ts'

/** How long a key whose first request never answered is kept before the batch gets a fresh one (D-92). */
export const inProgressWindowMs = 5 * 60_000

/** The oldest writes in a client's upload queue, and the means to end them. */
export interface QueuedBatch {
  readonly entries: readonly (QueuedWrite & { readonly clientId: number })[]
  complete(): Promise<void>
}

/** A client's upload queue: PowerSync's (getCrudBatch), or a test's. */
export interface UploadQueue {
  peek(limit: number): Promise<QueuedBatch | null>
}

export type HoldReason = 'deferred' | 'entitlement'

export interface Held {
  readonly reason: HoldReason
  readonly mutation: SyncMutation
}

/** The connector's local-only tables. */
export interface Journal {
  /** Records an answer other than `applied`, with its mutation. */
  record(mutation: SyncMutation, result: SyncMutationResult): Promise<void>
  hold(reason: HoldReason, mutation: SyncMutation): Promise<void>
  /** The held mutations of reason, oldest first. */
  held(reason: HoldReason): Promise<Held[]>
  release(mutationIds: readonly string[]): Promise<void>
}

/** The API credential the push is sent with, and the means to renew it. */
export interface Credential {
  current(): Promise<string>
  renew(): Promise<void>
}

/** One request the connector made, as the suite's recorder sees it. */
export interface Attempt {
  readonly key: string
  readonly mutationIds: readonly string[]
  readonly source: 'queue' | HoldReason
  /** The status answered, or null when the request failed on the network. */
  readonly status: number | null
  /** The batch as sent. */
  readonly body: string
  /** The response's body, or null when none arrived. */
  readonly response: string | null
}

/** What the connector tells the suite's recorder. */
export interface Observer {
  attempted?(attempt: Attempt): void
  answered?(mutation: SyncMutation, result: SyncMutationResult, via: Attempt): void
  /** A response the connector could not read as the contract says: a protocol fault, which it throws on. */
  malformed?(attempt: Attempt, reason: string): void
}

export interface ConnectorOptions {
  readonly pushUrl: string
  readonly fetch: typeof fetch
  readonly credential: Credential
  readonly journal: Journal
  readonly newKey: () => string
  readonly observer?: Observer
  /** Mutations to a batch, 500 by default: the contract's ceiling. */
  readonly maxBatch?: number
  /** The longest a Retry-After is waited out for. */
  readonly maxRetryAfterMs?: number
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  /**
   * Broken on purpose, for the suite's negative control: a rejection is thrown on rather than
   * ended, so PowerSync retries the batch forever and the replica freezes. The suite must fail it.
   */
  readonly retryRejections?: boolean
}

/** The ProblemCode of a 409 whose key's first request has not answered (D-92). */
const inProgress = 'idempotency_in_progress'

/** A batch not yet answered, which a retry must send again unchanged. */
interface InFlight {
  readonly source: Attempt['source']
  readonly ids: readonly string[]
  key: string
  readonly firstSentAt: number
  /** Mutations a 422 answered, which the batch no longer carries. */
  readonly settled: Map<string, SyncMutationResult>
}

export class ConformanceConnector {
  private readonly o: Required<Omit<ConnectorOptions, 'observer' | 'retryRejections'>> &
    Pick<ConnectorOptions, 'observer' | 'retryRejections'>
  private inflight: InFlight | null = null
  private maxBatch: number
  private entitlementResumed = false
  private lock: Promise<void> = Promise.resolve()

  constructor(options: ConnectorOptions) {
    this.o = {
      maxBatch: 500,
      maxRetryAfterMs: 60_000,
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...options,
    }
    this.maxBatch = this.o.maxBatch
  }

  /** Lets the mutations held for the household's entitlement replay at the next upload. */
  resume(): void {
    this.entitlementResumed = true
  }

  /**
   * Sends queue in order, then the held mutations whose cause has cleared. It returns once every
   * write it read is answered, and throws on the failures that answer none.
   */
  upload(queue: UploadQueue): Promise<void> {
    const run = this.lock.then(() => this.drain(queue))
    this.lock = run.catch(() => undefined)
    return run
  }

  private async drain(queue: UploadQueue): Promise<void> {
    for (;;) {
      const batch = await queue.peek(this.limit('queue'))
      if (batch === null) break
      const mutations = batch.entries.map(toMutation)
      if (!(await this.send('queue', mutations, () => Promise.resolve()))) continue
      await batch.complete()
      this.maxBatch = this.o.maxBatch
    }
    await this.replay('deferred')
    if (this.entitlementResumed) {
      this.entitlementResumed = false
      await this.replay('entitlement')
    }
  }

  /** How many mutations the next batch from source takes: a batch not yet answered is sent again whole. */
  private limit(source: Attempt['source']): number {
    return this.inflight?.source === source ? this.inflight.ids.length : this.maxBatch
  }

  /** Sends the held mutations of reason, oldest first, a batch at a time, until none is left or none moves. */
  private async replay(reason: HoldReason): Promise<void> {
    for (;;) {
      const held = (await this.o.journal.held(reason)).slice(0, this.limit(reason))
      if (held.length === 0) return
      const mutations = held.map((h) => h.mutation)
      // Released once answered, before the answers are settled: an answer that holds a mutation
      // again holds it anew.
      const release = (): Promise<void> =>
        this.o.journal.release(mutations.map((m) => m.mutation_id))
      if (!(await this.send(reason, mutations, release))) continue
      this.maxBatch = this.o.maxBatch
      const again = await this.o.journal.held(reason)
      // A mutation deferred at the head of its own batch waits for the next upload, not this one.
      if (again[0] !== undefined && again[0].mutation.mutation_id === mutations[0]?.mutation_id)
        return
    }
  }

  /**
   * Sends mutations until every one is answered, then runs answered and settles the answers, and
   * returns true; or returns false when the batch must be sent again smaller (a 413). It throws
   * when the batch must be retried as it is.
   */
  private async send(
    source: Attempt['source'],
    all: readonly SyncMutation[],
    answered: () => Promise<void>,
  ): Promise<boolean> {
    const ids = all.map((m) => m.mutation_id)
    let flight = this.inflight
    if (flight === null || flight.source !== source || !sameIds(flight, ids)) {
      flight = { source, ids, key: this.o.newKey(), firstSentAt: this.o.now(), settled: new Map() }
      this.inflight = flight
    } else if (this.o.now() - flight.firstSentAt > inProgressWindowMs) {
      // D-92: the first request under this key never answered in five minutes; per-mutation
      // idempotency answers each mutation that took effect from its stored result.
      flight.key = this.o.newKey()
    }
    for (;;) {
      const mutations = all.filter((m) => !flight.settled.has(m.mutation_id))
      if (mutations.length === 0) {
        await answered()
        await this.settle(all, flight)
        this.inflight = null
        return true
      }
      const body = JSON.stringify({ mutations })
      const attempt = (status: number | null, response: string | null): Attempt => ({
        key: flight.key,
        mutationIds: mutations.map((m) => m.mutation_id),
        source,
        status,
        body,
        response,
      })
      let response: Response
      try {
        response = await this.o.fetch(this.o.pushUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await this.o.credential.current()}`,
            'content-type': 'application/json',
            'idempotency-key': flight.key,
          },
          body,
        })
      } catch (error) {
        this.o.observer?.attempted?.(attempt(null, null))
        throw error
      }
      const text = await response.text()
      const sent = attempt(response.status, text)
      this.o.observer?.attempted?.(sent)
      switch (response.status) {
        case 200: {
          const results = this.read(sent, mutations, text)
          if (
            this.o.retryRejections === true &&
            results.some((r) => r.outcome === 'rejected' && !isEntitlement(r.code))
          ) {
            throw new Error('the broken connector retries a rejection')
          }
          for (const [i, r] of results.entries()) {
            const m = mutations[i]
            if (m !== undefined) flight.settled.set(m.mutation_id, r)
          }
          continue
        }
        case 401:
          await this.o.credential.renew()
          throw new Error('the push refused the API credential; renewed, to be sent again')
        case 429: {
          const after = Number(response.headers.get('retry-after') ?? '1')
          await this.o.sleep(
            Math.min(this.o.maxRetryAfterMs, (Number.isFinite(after) ? after : 1) * 1000),
          )
          throw new Error('the push is rate limited; to be sent again')
        }
        case 413:
          if (mutations.length === 1)
            throw new Error('one mutation alone is too large for the push')
          this.maxBatch = Math.max(1, Math.ceil(all.length / 2))
          this.inflight = null
          return false
        case 422: {
          const index = locate(text, mutations.length)
          const located = index === null ? undefined : mutations[index]
          if (located === undefined) {
            if (tooMany(text) && mutations.length > 1) {
              this.maxBatch = Math.max(1, Math.ceil(all.length / 2))
              this.inflight = null
              return false
            }
            this.o.observer?.malformed?.(sent, `a 422 that locates no mutation: ${text}`)
            throw new Error(`the push refused the batch as a whole: ${text}`)
          }
          flight.settled.set(located.mutation_id, {
            mutation_id: located.mutation_id,
            outcome: 'rejected',
            code: problemCode(text) ?? 'validation_failed',
            message: 'the edge refused this mutation',
            version: null,
          })
          // The rest are a new batch.
          flight.key = this.o.newKey()
          continue
        }
        case 402:
        case 404: {
          const code = response.status === 402 ? 'entitlement' : 'not_found'
          for (const m of mutations) {
            flight.settled.set(m.mutation_id, {
              mutation_id: m.mutation_id,
              outcome: 'rejected',
              code,
              message: null,
              version: null,
            })
          }
          continue
        }
        case 409:
          if (problemCode(text) !== inProgress)
            this.o.observer?.malformed?.(sent, `a 409 the push does not declare: ${text}`)
          throw new Error('an earlier send of this batch has not answered; to be sent again')
        default:
          if (response.status < 500)
            this.o.observer?.malformed?.(sent, `status ${String(response.status)}: ${text}`)
          throw new Error(`the push answered ${String(response.status)}; to be sent again`)
      }
    }
  }

  /** Ends each of all with its answer: records it, holds it, or both. */
  private async settle(all: readonly SyncMutation[], flight: InFlight): Promise<void> {
    const via: Attempt = {
      key: flight.key,
      mutationIds: flight.ids,
      source: flight.source,
      status: 200,
      body: '',
      response: null,
    }
    for (const m of all) {
      const r = flight.settled.get(m.mutation_id)
      if (r === undefined) continue
      this.o.observer?.answered?.(m, r, via)
      if (r.outcome !== 'applied') await this.o.journal.record(m, r)
      if (r.outcome === 'deferred') await this.o.journal.hold('deferred', m)
      else if (r.outcome === 'rejected' && isEntitlement(r.code))
        await this.o.journal.hold('entitlement', m)
    }
  }

  /** The answers of a 200, one for each mutation in order, or a throw when the body is not that. */
  private read(
    sent: Attempt,
    mutations: readonly SyncMutation[],
    text: string,
  ): SyncMutationResult[] {
    const fail = (reason: string): never => {
      this.o.observer?.malformed?.(sent, reason)
      throw new Error(`the push's answer is malformed: ${reason}`)
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return fail('not JSON')
    }
    const results = (body as { results?: unknown }).results
    if (!Array.isArray(results) || results.length !== mutations.length) {
      return fail(
        `${String(Array.isArray(results) ? results.length : 'no')} results for ${String(mutations.length)} mutations`,
      )
    }
    return results.map((r: unknown, i) => {
      const result = r as Partial<SyncMutationResult>
      const m = mutations[i]
      if (m === undefined || result.mutation_id !== m.mutation_id)
        return fail(`result ${String(i)} answers another mutation`)
      if (
        result.outcome === undefined ||
        !(terminal.has(result.outcome) || result.outcome === 'deferred')
      ) {
        return fail(`result ${String(i)} has no outcome`)
      }
      if (
        result.outcome !== 'applied' &&
        (result.code === null || result.code === undefined || result.code === '')
      ) {
        // PRD 10 §6: an outcome carries a machine-readable code, always.
        return fail(`result ${String(i)} is ${result.outcome} without a code`)
      }
      return result as SyncMutationResult
    })
  }
}

function sameIds(flight: InFlight, ids: readonly string[]): boolean {
  const remaining = flight.ids
  return remaining.length === ids.length && remaining.every((id, i) => id === ids[i])
}

/** The problem document's code, or null. */
function problemCode(text: string): string | null {
  try {
    const code = (JSON.parse(text) as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  } catch {
    return null
  }
}

function fieldErrors(text: string): { field: string; code: string }[] {
  try {
    const errors = (JSON.parse(text) as { errors?: unknown }).errors
    return Array.isArray(errors) ? (errors as { field: string; code: string }[]) : []
  } catch {
    return []
  }
}

/** The index of the mutation a 422's field errors point into (ADR 0003), when they all point into one. */
export function locate(text: string, count: number): number | null {
  const indexes = new Set<number>()
  for (const e of fieldErrors(text)) {
    const match = /^\/mutations\/(\d+)(?:\/|$)/.exec(e.field)
    if (match?.[1] === undefined) return null
    indexes.add(Number(match[1]))
  }
  const [index] = [...indexes]
  return indexes.size === 1 && index !== undefined && index < count ? index : null
}

/** Whether a 422 refuses the batch for holding more mutations than the contract's ceiling. */
function tooMany(text: string): boolean {
  const errors = fieldErrors(text)
  return errors.length > 0 && errors.every((e) => e.field === '/mutations' && /max/i.test(e.code))
}
