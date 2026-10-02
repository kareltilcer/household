// The connector (ADR 0001, ADR 0019): it drains a replica's upload queue to the push. PowerSync
// applies no checkpoint while the queue holds anything, so the connector ends every mutation the
// server answers, whatever the answer, and throws (so that PowerSync retries it) only when nothing
// answered the mutations: a transport failure, a 5xx, a 401, a 409 or a 429. A response outside the
// contract (a 200 that does not answer the batch, a 422 that neither locates a mutation nor refuses
// the batch's size, a status handled below by none of these rules) answers nothing either: it is
// reported as a protocol fault (Observer.malformed), and thrown on.
//
// It sends the queue in order, several queued transactions to a batch up to maxBatch, under one
// Idempotency-Key per batch that stays with the batch until it is answered, a held batch's as well
// as the queue's. What it does with each answer:
//   - applied: ended.
//   - merged, conflict, and a rejection: ended, and recorded in the local-only outcomes table with
//     the mutation, since the next checkpoint replaces the local write; a merge is for the member to
//     see where the row it returned does not say what they set, or where its entity keeps its loser
//     (lww_row), a conflict and a rejection always (D-122, DD-4).
//   - an `entitlement` rejection: recorded, and held to replay once the household may write again
//     (resume(); FR-BI2, scenario 14).
//   - deferred: recorded, and held to replay once the queue has drained (scenario 8). So a held
//     mutation replays after the writes queued behind it, the one reordering a client's own uploads
//     have (PRD 10 §4).
// And to a response that answers no mutation: a 401 renews the API credential and throws; a 429 sets
// the time the push may next be sent to, its Retry-After, kept across restarts, and throws, every
// upload before then throwing without sending (a household past its day's mutations waits for the
// UTC day's end, D-127); a 413 halves the batch, and rejects a mutation too large to send alone; a 422
// rejects the mutations it locates and sends the rest again; a 402 or a 404 answers every mutation of
// the batch alike, `entitlement` or `not_found`; a 409 idempotency_in_progress throws, and past D-92's
// five minutes the batch is sent under a fresh key, which per-mutation idempotency answers (FR-SY5).
//
// A replica makes each write against the version of the row it holds, which moves only when a
// checkpoint reaches it, and PowerSync applies none while the queue holds anything. So a mutation of
// the queue made while an earlier one of its row was in flight carries the version the earlier was
// made against, and is sent against the version the earlier one's answer returned (D-122): its own
// earlier write is no change it had not seen. The push holds the mutations of one batch so itself.

import { toMutation, isEntitlement, overridden, terminal, type QueuedWrite } from './mutation.ts'
import type { SyncMutation, SyncMutationResult } from './mutation.ts'
import type { Registry } from './registry.ts'

/** How long a key whose first request never answered is kept before the batch gets a fresh one (D-92). */
export const inProgressWindowMs = 5 * 60_000

/** The oldest writes in a replica's upload queue, and the means to end them. */
export interface QueuedBatch {
  readonly entries: readonly (QueuedWrite & { readonly clientId: number })[]
  complete(): Promise<void>
}

/** A replica's upload queue: PowerSync's (getCrudBatch), or a test's. */
export interface UploadQueue {
  peek(limit: number): Promise<QueuedBatch | null>
}

export type HoldReason = 'deferred' | 'entitlement'

export interface Held {
  readonly reason: HoldReason
  readonly mutation: SyncMutation
}

/** What an answer asks of the member, which the outcomes table keeps with it. */
export interface Surface {
  /** Whether the member must see it: a conflict, a rejection, a merge they must be told of. */
  readonly unresolved: boolean
  /** The fields of a merge the row it returned does not say what the member set. */
  readonly overridden: readonly string[]
}

/** The version a row's earlier queued mutation was made against, and the version its answer returned. */
export interface Rebase {
  readonly from: number | null
  readonly to: number
}

export interface RebaseEntry extends Rebase {
  readonly entityType: string
  readonly entityId: string
  /** The client table the row is in, which tells when the replica has caught up with it. */
  readonly table: string
}

/** The key a row's rebase is kept under. */
export function rowKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId.toLowerCase()}`
}

/** The connector's local-only state. */
export interface Journal {
  /** Records an answer other than `applied`, with its mutation and what it asks of the member. */
  record(mutation: SyncMutation, result: SyncMutationResult, surface: Surface): Promise<void>
  /** Marks the answers recorded for a mutation as seen to: a held one that replayed and ended. */
  settled(mutationId: string): Promise<void>
  hold(reason: HoldReason, mutation: SyncMutation): Promise<void>
  /** The held mutations of reason, oldest first. */
  held(reason: HoldReason): Promise<Held[]>
  release(mutationIds: readonly string[]): Promise<void>
  /** The rebase of each row, by rowKey. */
  rebases(): Promise<ReadonlyMap<string, Rebase>>
  rebase(entries: readonly RebaseEntry[]): Promise<void>
  /** Forgets the rebase of each row the replica has caught up with. */
  prune(): Promise<void>
  /** Records that the queued writes through clientId may be in flight: no later edit merges into them. */
  sent(clientId: number): Promise<void>
  /** When the push may next be sent to, in milliseconds since the epoch; 0 for now. */
  notBefore(): Promise<number>
  setNotBefore(at: number): Promise<void>
}

/** The API credential the push is sent with, and the means to renew it. */
export interface Credential {
  current(): Promise<string>
  /** Renews it; throws Revoked when the device's sign-in has ended (FR-ID7). */
  renew(): Promise<void>
}

/** One request the connector made. */
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

/** What the connector tells an observer: the conformance suite's recorder, or an app's metrics. */
export interface Observer {
  attempted?(attempt: Attempt): void
  answered?(mutation: SyncMutation, result: SyncMutationResult): void
  /** A response the connector could not read as the contract says: a protocol fault, which it throws on. */
  malformed?(attempt: Attempt, reason: string): void
}

export interface ConnectorOptions {
  readonly registry: Registry
  readonly pushUrl: string
  readonly fetch: typeof fetch
  readonly credential: Credential
  readonly journal: Journal
  readonly newKey: () => string
  readonly observer?: Observer
  /** Mutations to a batch, 500 by default: the contract's ceiling. */
  readonly maxBatch?: number
  readonly now?: () => number
  /**
   * Broken on purpose, for the conformance suite's negative control: a rejection is thrown on rather
   * than ended, so PowerSync retries the batch forever and the replica freezes. The suite must fail it.
   */
  readonly retryRejections?: boolean
}

/** A refusal of the API credential that renewing it cannot mend: the device's sign-in ended (FR-ID7). */
export class Revoked extends Error {}

/** The push may not be sent to until notBefore, which a 429 named. */
export class RateLimited extends Error {
  readonly notBefore: number

  constructor(notBefore: number) {
    super(`the push is rate limited until ${new Date(notBefore).toISOString()}; to be sent again`)
    this.notBefore = notBefore
  }
}

/** The ProblemCode of a 409 whose key's first request has not answered (D-92). */
const inProgress = 'idempotency_in_progress'
/** The code a 402 that names none is recorded with: the household does not write. */
const entitlementReadOnly = 'entitlement_read_only'

/** A batch not yet answered, which a retry must send again unchanged. */
interface InFlight {
  readonly ids: readonly string[]
  key: string
  /** When the batch was first sent under key. */
  firstSentAt: number
  /**
   * Whether the push answered key 409 idempotency_in_progress: only such a key, whose first request
   * may have taken effect without its response being kept, is given up past D-92's five minutes. A
   * key whose answer was lost, or whose request never arrived, is kept, and the push answers it from
   * its stored response or runs it.
   */
  inProgress: boolean
  /** Mutations a 422 or a 413 answered, which the batch no longer carries. */
  readonly settled: Map<string, SyncMutationResult>
}

/** A mutation of the queue, with the base version it was made against and the table its row is in. */
interface Queued {
  readonly mutation: SyncMutation
  readonly madeAgainst: number | null
  readonly table: string
}

export class Connector {
  private readonly o: Required<Omit<ConnectorOptions, 'observer' | 'retryRejections'>> &
    Pick<ConnectorOptions, 'observer' | 'retryRejections'>
  /**
   * The batch of each source not yet answered: the queue's and each hold's apart, so that a held
   * batch whose answer was lost keeps its key while the queue is sent before it.
   */
  private readonly inflight = new Map<Attempt['source'], InFlight>()
  private maxBatch: number
  private entitlementResumed = false
  private lock: Promise<void> = Promise.resolve()
  /** Uploads started and not yet returned, the one running and those waiting on the lock. */
  private uploads = 0

  constructor(options: ConnectorOptions) {
    this.o = { maxBatch: 500, now: Date.now, ...options }
    this.maxBatch = this.o.maxBatch
  }

  /**
   * Lets the mutations held for the household's entitlement replay at the next upload, and at every
   * one after it until a replay of them is answered.
   */
  resume(): void {
    this.entitlementResumed = true
  }

  /** Whether resume() was called and the entitlement holds have not replayed since. */
  get resuming(): boolean {
    return this.entitlementResumed
  }

  /**
   * Whether an upload is under way: until it returns, the answers it has had may not all be recorded,
   * nor its held mutations held again, so the replica is not yet quiet.
   */
  get busy(): boolean {
    return this.uploads > 0
  }

  /**
   * Sends queue in order, then the held mutations whose cause has cleared. It returns once every
   * write it read is answered, and throws on the failures that answer none.
   */
  upload(queue: UploadQueue): Promise<void> {
    this.uploads++
    const run = this.lock
      .then(() => this.drain(queue))
      .finally(() => {
        this.uploads--
      })
    this.lock = run.catch(() => undefined)
    return run
  }

  private async drain(queue: UploadQueue): Promise<void> {
    const notBefore = await this.o.journal.notBefore()
    if (this.o.now() < notBefore) throw new RateLimited(notBefore)
    await this.o.journal.prune()
    for (;;) {
      const batch = await queue.peek(this.limit('queue'))
      if (batch === null) break
      const rebases = await this.o.journal.rebases()
      const queued = batch.entries.map((entry): Queued => {
        const mutation = toMutation(this.o.registry, entry)
        const madeAgainst = mutation.base_version ?? null
        const rebase = rebases.get(rowKey(mutation.entity_type, mutation.entity_id))
        return {
          mutation:
            rebase !== undefined && rebase.from === madeAgainst && mutation.op !== 'create'
              ? { ...mutation, base_version: rebase.to }
              : mutation,
          madeAgainst,
          table: entry.table,
        }
      })
      const last = batch.entries.at(-1)?.clientId
      const sent = async (): Promise<void> => {
        if (last !== undefined) await this.o.journal.sent(last)
      }
      if (!(await this.send('queue', queued, () => Promise.resolve(), sent))) continue
      await batch.complete()
      this.maxBatch = this.o.maxBatch
    }
    await this.replay('deferred')
    if (this.entitlementResumed) {
      // Cleared once the replay is answered: one the network or the server failed is tried again at
      // the next upload.
      await this.replay('entitlement')
      this.entitlementResumed = false
    }
  }

  /** How many mutations the next batch from source takes: a batch not yet answered is sent again whole. */
  private limit(source: Attempt['source']): number {
    return this.inflight.get(source)?.ids.length ?? this.maxBatch
  }

  /**
   * Sends the held mutations of reason, oldest first, a batch at a time, until none is left or a batch
   * ends none of those it sent. A mutation held again goes behind the others, so batches of holds whose
   * cause still refuses them, more than one batch takes, would otherwise follow one another without end.
   */
  private async replay(reason: HoldReason): Promise<void> {
    for (;;) {
      const held = (await this.o.journal.held(reason)).slice(0, this.limit(reason))
      if (held.length === 0) return
      const queued = held.map((h): Queued => ({
        mutation: h.mutation,
        madeAgainst: null,
        table: '',
      }))
      // Released once answered, before the answers are settled: an answer that holds a mutation again
      // holds it anew.
      const release = (): Promise<void> =>
        this.o.journal.release(held.map((h) => h.mutation.mutation_id))
      if (!(await this.send(reason, queued, release, () => Promise.resolve()))) continue
      this.maxBatch = this.o.maxBatch
      // Every one held again (deferred at the head of its batch, or its entitlement still refused)
      // waits for the next replay, not this one.
      const again = new Set((await this.o.journal.held(reason)).map((h) => h.mutation.mutation_id))
      if (held.every((h) => again.has(h.mutation.mutation_id))) return
    }
  }

  /**
   * Sends queued until every one is answered, then runs answered and settles the answers, and returns
   * true; or returns false when the batch must be sent again smaller (a 413). It throws when the batch
   * must be retried as it is. beforeSending runs before each request.
   */
  private async send(
    source: Attempt['source'],
    queued: readonly Queued[],
    answered: () => Promise<void>,
    beforeSending: () => Promise<void>,
  ): Promise<boolean> {
    const all = queued.map((q) => q.mutation)
    const ids = all.map((m) => m.mutation_id)
    let flight = this.inflight.get(source)
    if (flight === undefined || !sameIds(flight, ids)) {
      flight = {
        ids,
        key: this.o.newKey(),
        firstSentAt: this.o.now(),
        inProgress: false,
        settled: new Map(),
      }
      this.inflight.set(source, flight)
    } else if (flight.inProgress && this.o.now() - flight.firstSentAt > inProgressWindowMs) {
      // D-92: the push still answers this key idempotency_in_progress five minutes after its first
      // request, which took effect without its response being kept; per-mutation idempotency answers
      // each mutation that took effect from its stored result.
      this.rekey(flight)
    }
    for (;;) {
      const mutations = all.filter((m) => !flight.settled.has(m.mutation_id))
      if (mutations.length === 0) {
        await answered()
        await this.settle(source, queued, flight)
        this.inflight.delete(source)
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
      // Before the request: a sign-in that fails sent nothing to the push, and is no attempt at it.
      const credential = await this.o.credential.current()
      await beforeSending()
      let response: Response
      try {
        response = await this.o.fetch(this.o.pushUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${credential}`,
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
          const at = this.o.now() + retryAfterMs(response.headers.get('retry-after'), this.o.now())
          await this.o.journal.setNotBefore(at)
          throw new RateLimited(at)
        }
        case 413: {
          const [alone] = mutations
          if (mutations.length === 1 && alone !== undefined) {
            // Nothing smaller can be sent: a refusal, which retrying would never end (ADR 0001).
            flight.settled.set(alone.mutation_id, {
              mutation_id: alone.mutation_id,
              outcome: 'rejected',
              code: problemCode(text) ?? 'payload_too_large',
              message: 'the push refused this mutation as too large',
              version: null,
            })
            this.rekey(flight)
            continue
          }
          this.maxBatch = Math.max(1, Math.ceil(all.length / 2))
          this.inflight.delete(source)
          return false
        }
        case 422: {
          const located = (locate(text, mutations.length) ?? []).flatMap((i) => {
            const m = mutations[i]
            return m === undefined ? [] : [m]
          })
          if (located.length === 0) {
            if (tooMany(text) && mutations.length > 1) {
              this.maxBatch = Math.max(1, Math.ceil(all.length / 2))
              this.inflight.delete(source)
              return false
            }
            this.o.observer?.malformed?.(sent, `a 422 that locates no mutation: ${text}`)
            throw new Error(`the push refused the batch as a whole: ${text}`)
          }
          for (const m of located) {
            flight.settled.set(m.mutation_id, {
              mutation_id: m.mutation_id,
              outcome: 'rejected',
              code: problemCode(text) ?? 'validation_failed',
              message: 'the edge refused this mutation',
              version: null,
            })
          }
          // The rest are a new batch.
          this.rekey(flight)
          continue
        }
        case 402:
        case 404: {
          // A 402 is the household's state refusing the batch (FR-BI2, D-118): each mutation is
          // recorded with the problem's own code, entitlement_read_only or entitlement_restricted, and
          // held.
          const refused = problemCode(text)
          const code =
            response.status === 404
              ? 'not_found'
              : isEntitlement(refused)
                ? (refused ?? entitlementReadOnly)
                : entitlementReadOnly
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
          if (problemCode(text) === inProgress) flight.inProgress = true
          else this.o.observer?.malformed?.(sent, `a 409 the push does not declare: ${text}`)
          throw new Error('an earlier send of this batch has not answered; to be sent again')
        default:
          if (response.status < 500)
            this.o.observer?.malformed?.(sent, `status ${String(response.status)}: ${text}`)
          throw new Error(`the push answered ${String(response.status)}; to be sent again`)
      }
    }
  }

  /** Moves flight to a fresh key, whose D-92 window starts with its first request, now. */
  private rekey(flight: InFlight): void {
    flight.key = this.o.newKey()
    flight.firstSentAt = this.o.now()
    flight.inProgress = false
  }

  /**
   * Ends each of queued with its answer: records it, holds it, or both; marks what a held one's earlier
   * answers asked of the member seen to once it ends; and keeps, for each row the queue wrote, the
   * version its answer returned, which a later mutation of the row is sent against.
   */
  private async settle(
    source: Attempt['source'],
    queued: readonly Queued[],
    flight: InFlight,
  ): Promise<void> {
    const rebases: RebaseEntry[] = []
    for (const { mutation: m, madeAgainst, table } of queued) {
      const r = flight.settled.get(m.mutation_id)
      if (r === undefined) continue
      this.o.observer?.answered?.(m, r)
      if (source !== 'queue' && terminal.has(r.outcome) && !isEntitlementRejection(r)) {
        await this.o.journal.settled(m.mutation_id)
      }
      if (r.outcome !== 'applied') await this.o.journal.record(m, r, this.surface(m, r))
      if (r.outcome === 'deferred') await this.o.journal.hold('deferred', m)
      else if (isEntitlementRejection(r)) await this.o.journal.hold('entitlement', m)
      if (
        source === 'queue' &&
        (r.outcome === 'applied' || r.outcome === 'merged') &&
        typeof r.version === 'number'
      ) {
        rebases.push({
          entityType: m.entity_type,
          entityId: m.entity_id,
          table,
          from: madeAgainst,
          to: r.version,
        })
      }
    }
    if (rebases.length > 0) await this.o.journal.rebase(rebases)
  }

  /** What an answer but `applied` asks of the member. */
  private surface(m: SyncMutation, r: SyncMutationResult): Surface {
    switch (r.outcome) {
      case 'merged': {
        const fields = overridden(m, r.row)
        const keepsItsLoser = this.o.registry.entities[m.entity_type]?.policy === 'lww_row'
        return { unresolved: fields.length > 0 || keepsItsLoser, overridden: fields }
      }
      case 'conflict':
      case 'rejected':
        return { unresolved: true, overridden: [] }
      default:
        return { unresolved: false, overridden: [] }
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

function isEntitlementRejection(r: SyncMutationResult): boolean {
  return r.outcome === 'rejected' && isEntitlement(r.code)
}

function sameIds(flight: InFlight, ids: readonly string[]): boolean {
  const remaining = flight.ids
  return remaining.length === ids.length && remaining.every((id, i) => id === ids[i])
}

/**
 * How long a Retry-After asks to be waited, in milliseconds: its seconds, or the time to its date
 * (RFC 9110 §10.2.3); a second when it says neither.
 */
export function retryAfterMs(header: string | null, now: number): number {
  if (header === null) return 1000
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  return Number.isNaN(at) ? 1000 : Math.max(0, at - now)
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

/**
 * The indexes of the mutations a 422's field errors point into (ADR 0003), in order, when every error
 * points into a mutation of the batch: the edge reports each error it finds, so a batch with two
 * refused mutations names both. Null when any error points elsewhere, or there are none.
 */
export function locate(text: string, count: number): number[] | null {
  const indexes = new Set<number>()
  for (const e of fieldErrors(text)) {
    const match = /^\/mutations\/(\d+)(?:\/|$)/.exec(e.field)
    if (match?.[1] === undefined) return null
    const index = Number(match[1])
    if (index >= count) return null
    indexes.add(index)
  }
  return indexes.size === 0 ? null : [...indexes].sort((a, b) => a - b)
}

/** Whether a 422 refuses the batch for holding more mutations than the contract's ceiling. */
function tooMany(text: string): boolean {
  const errors = fieldErrors(text)
  return errors.length > 0 && errors.every((e) => e.field === '/mutations' && /max/i.test(e.code))
}
