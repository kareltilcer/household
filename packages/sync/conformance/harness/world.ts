// One run of the suite: its seeded generator, the households and members it made, its clients,
// what they did (Recorder), and the checks that judge it.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Admin, Household, Member, MemberSpec } from './admin.ts'
import { Client, type ClientOptions } from './client.ts'
import type { Attempt, HoldReason } from './connector.ts'
import {
  acknowledgedWrites,
  answeredAs,
  compareReplica,
  monotonicity,
  replayedAnswers,
  terminality,
  type Answered,
  type Violation,
} from './invariants.ts'
import { apiUrl } from './env.ts'
import { Recorder } from './recorder.ts'
import { Rng } from './rng.ts'
import {
  ends,
  type SyncMutation,
  type SyncMutationBatchResult,
  type SyncMutationResult,
} from './mutation.ts'
import type { Target } from './target.ts'
import { sleep, until } from './wait.ts'

/** How long a run waits for its clients to settle before the invariants judge what it has. */
export const settleMs = 20_000

export interface CheckOptions {
  /** The clients judged; every client of the run by default. */
  readonly clients?: readonly Client[]
  /** Held mutations left held on purpose (TerminalityOptions). */
  readonly allowHeld?: readonly HoldReason[]
}

export class World {
  readonly target: Target
  readonly admin: Admin
  readonly name: string
  /** The run's schedule: what its scenario or its fuzzer draws, and nothing PowerSync's timing does. */
  readonly rng: Rng
  readonly recorder = new Recorder()
  readonly clients: Client[] = []
  private readonly dir: string
  /** The fresh keys a batch delivered again is sent under, drawn apart from the schedule. */
  private readonly keys: Rng

  constructor(target: Target, admin: Admin, seed: number, name: string) {
    this.target = target
    this.admin = admin
    this.name = name
    this.rng = new Rng(seed)
    this.keys = this.rng.fork()
    this.dir = mkdtempSync(join(tmpdir(), 'household-conformance-'))
  }

  member(name: string): Promise<Member> {
    return this.admin.member(this.rng, name)
  }

  household(name: string, members: readonly MemberSpec[]): Promise<Household> {
    return this.admin.household(this.rng, name, members)
  }

  /**
   * Pushes mutations to household as member, signed in past every client's network, and returns
   * their answers, each of which must have taken effect: how a scenario makes a change the server
   * makes the rest of, as an access the rows carry (ADR 0018). Their ids and keys are drawn apart from
   * the schedule, as a client's are.
   */
  async pushAs(
    member: Member,
    household: Household,
    mutations: readonly Omit<SyncMutation, 'mutation_id' | 'client_time'>[],
  ): Promise<SyncMutationResult[]> {
    const response = await fetch(this.target.pushUrl(household.id), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.target.signIn(member.id, fetch)}`,
        'content-type': 'application/json',
        'idempotency-key': this.keys.uuid(),
      },
      body: JSON.stringify({
        mutations: mutations.map((m) => ({
          ...m,
          mutation_id: this.keys.uuid(),
          client_time: new Date().toISOString(),
        })),
      }),
    })
    const text = await response.text()
    if (response.status !== 200)
      throw new Error(`a push as ${member.name}: ${String(response.status)} ${text}`)
    const { results } = JSON.parse(text) as SyncMutationBatchResult
    for (const r of results) {
      if (r.outcome !== 'applied' && r.outcome !== 'merged')
        throw new Error(`a push as ${member.name} was answered ${JSON.stringify(r)}`)
    }
    return results
  }

  /**
   * Takes member out of conversation, as by, a member of it: the server takes them out of the readers
   * of every message of it, which retracts the messages from their replicas (D-90).
   */
  async leaveConversation(
    household: Household,
    conversation: string,
    member: Member,
    by: Member,
  ): Promise<void> {
    const membership = await this.admin.conversationMember(conversation, member)
    await this.pushAs(by, household, [
      {
        entity_type: 'conformance.conversation_member',
        entity_id: membership.id,
        op: 'delete',
        base_version: membership.version,
        fields: {},
      },
    ])
  }

  /**
   * Makes a shared note private to owner, as owner: the server rewrites the visibility and the owner
   * its comments carry, which retracts the note and its comments from everyone else (PRD 03 §2.6).
   */
  async makePrivate(household: Household, note: string, owner: Member): Promise<void> {
    await this.pushAs(owner, household, [
      {
        entity_type: 'conformance.note',
        entity_id: note,
        op: 'update',
        fields: { visibility: 'private', owner_id: owner.id },
      },
    ])
  }

  /**
   * Removes member from household as by, an owner, through item 10's route, which runs the hook that
   * takes them out of every audience's readers (app.Retract) in the removal's transaction.
   */
  async removeMember(household: Household, member: Member, by: Member): Promise<void> {
    const response = await fetch(
      `${apiUrl}/api/v1/households/${household.id}/members/${member.id}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${await this.target.signIn(by.id, fetch)}` },
      },
    )
    const text = await response.text()
    if (response.status !== 204)
      throw new Error(`removing ${member.name}: ${String(response.status)} ${text}`)
  }

  /**
   * A client, drawing its ids and its connector's keys from a generator forked from the schedule's:
   * how many it draws is PowerSync's timing, which must not move the schedule.
   */
  client(options: ClientOptions): Client {
    const c = new Client(
      { target: this.target, recorder: this.recorder, rng: this.rng.fork(), dir: this.dir },
      options,
    )
    this.clients.push(c)
    return c
  }

  /** Records each client's checkpoint, for invariant 5. */
  async sample(clients: readonly Client[] = this.clients): Promise<void> {
    for (const c of clients) this.recorder.sampled(c.name, await c.buckets())
  }

  /**
   * Waits until clients, the online ones by default, are quiet: no upload under way, nothing
   * queued, nothing held whose cause has cleared left to replay (Client.replayable), and each
   * replica equal to what its member may see. A client holding such mutations, with nothing queued
   * that would make PowerSync upload, is flushed (Client.replayHeld). It reports whether they got
   * there within timeoutMs; the invariants then judge whatever state they are in.
   */
  async settle(
    options: { readonly clients?: readonly Client[]; readonly timeoutMs?: number } = {},
  ): Promise<boolean> {
    const clients = options.clients ?? this.clients.filter((c) => c.isOnline)
    const took = await until(async () => {
      await this.sample(clients)
      for (const c of clients) {
        await c.replayHeld()
        // An upload under way may have released a replay's holds and not yet recorded its answers.
        if (c.connector.busy || (await c.pending()) > 0 || (await c.replayable())) return false
        if ((await compareReplica(c, this.target, this.admin)).length > 0) return false
      }
      return true
    }, options.timeoutMs ?? settleMs)
    return took !== null
  }

  /**
   * Everything the invariants find wrong with the run as it stands, but idempotency, which
   * delivers batches again and so is asked for apart (idempotency, replay).
   */
  async violations(options: CheckOptions = {}): Promise<Violation[]> {
    const clients = options.clients ?? this.clients
    await this.sample(clients)
    const out: Violation[] = []
    for (const c of clients) out.push(...(await compareReplica(c, this.target, this.admin)))
    out.push(...(await acknowledgedWrites(this.recorder, this.admin, clients)))
    out.push(...monotonicity(this.recorder))
    out.push(
      ...(await terminality(
        this.recorder,
        clients,
        options.allowHeld === undefined ? {} : { allowHeld: options.allowHeld },
      )),
    )
    return out
  }

  /**
   * client's batches that were answered 200, the ones a network retry could deliver again: its
   * queue's, and the replays of the mutations it held.
   */
  answered(client: Client): Attempt[] {
    return this.recorder.attempts.filter((a) => a.client === client.name && a.status === 200)
  }

  /**
   * Invariant 3 at the end of a run: every batch each of clients (every client of the run by
   * default) had answered is delivered again (replay). Nothing else may write meanwhile.
   */
  async idempotency(clients: readonly Client[] = this.clients): Promise<Violation[]> {
    const out: Violation[] = []
    for (const c of clients) {
      const attempts = this.answered(c)
      if (attempts.length > 0) out.push(...(await this.replay(c, attempts)))
    }
    return out
  }

  /**
   * Delivers attempt again, as a network retry would, under its own key or under a fresh one
   * (mode, as far as the target allows by default), and reports it answered otherwise than it
   * should be (invariant 3). Under its own key the batch's stored answer comes back whole. Under a
   * fresh one each mutation is answered from its own stored result (FR-SY5): the answer that ended
   * it, which for one the batch held (deferred, or rejected for its entitlement) is the answer its
   * replay got. One still held, whose replay has not ended it, has no stored result, and the
   * target may run it now: mid-run, as the fuzzer delivers a batch again, it is compared by its id
   * alone (replayedAnswers).
   */
  async deliverAgain(
    client: Client,
    attempt: Attempt,
    mode: Target['replay'] = this.target.replay,
  ): Promise<Violation[]> {
    const key = mode === 'fresh-key' ? this.keys.uuid() : attempt.key
    const send = (credential: string): Promise<Response> =>
      fetch(this.target.pushUrl(client.household.id), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: attempt.body,
      })
    let response = await send(await client.credentialNow())
    if (response.status === 401) {
      // The client's credential lapsed since it last pushed: sent again with a fresh one, signed
      // in past the client's network, as its connector would renew it.
      await response.body?.cancel()
      response = await send(await this.target.signIn(client.member.id, fetch))
    }
    // The device's batches are limited (PRD 02 §9), and every batch of a long run delivered again
    // at its end spends them: a 429 is waited out, as the connector waits it out.
    for (let waited = 0; response.status === 429 && waited < 120; waited++) {
      const after = Number(response.headers.get('retry-after') ?? '1')
      await response.body?.cancel()
      await sleep(Math.min(60, Number.isFinite(after) ? after : 1) * 1000)
      response = await send(await client.credentialNow())
    }
    const text = await response.text()
    const report = (detail: string): Violation[] => [
      { invariant: 'idempotency', client: client.name, detail },
    ]
    if (response.status !== 200)
      return report(
        `batch ${attempt.key} sent again was answered ${String(response.status)}: ${text}`,
      )
    const { want, got } = replayedAnswers(
      outcomes(attempt.response),
      outcomes(text),
      mode === 'fresh-key' ? (r) => this.endOf(r) : null,
    )
    if (want !== got) {
      return report(
        `batch ${attempt.key} sent again under ${mode === 'fresh-key' ? 'a fresh key' : 'its key'} was answered ${got}, for ${want}`,
      )
    }
    return []
  }

  /** The answer that ended the mutation r answers, or null when none has yet. */
  private endOf(r: Answered): Answered | null {
    const end = this.recorder.answersTo(r.id).find((a) => ends(a.result))
    return end === undefined ? null : answeredAs(end.result)
  }

  /**
   * Invariant 3, at rest: delivers each of attempts again (deliverAgain), and reports as well a
   * server the deliveries changed. Nothing else may write meanwhile.
   */
  async replay(
    client: Client,
    attempts: readonly Attempt[],
    mode: Target['replay'] = this.target.replay,
  ): Promise<Violation[]> {
    const out: Violation[] = []
    const before = await this.snapshot(client.household)
    for (const a of attempts) out.push(...(await this.deliverAgain(client, a, mode)))
    const after = await this.snapshot(client.household)
    if (after !== before) {
      out.push({
        invariant: 'idempotency',
        client: client.name,
        detail: `sending ${String(attempts.length)} batches again changed the server`,
      })
    }
    return out
  }

  /** The household's replicated rows and its history, as one comparable string. */
  private async snapshot(household: Household): Promise<string> {
    const parts: unknown[] = [await this.admin.history(household)]
    for (const table of this.target.replicates) {
      const rows = await this.admin.rows(table, household)
      parts.push([...rows.entries()].sort(([a], [b]) => a.localeCompare(b)))
    }
    return JSON.stringify(parts)
  }

  async close(): Promise<void> {
    for (const c of this.clients) {
      try {
        await c.close()
      } catch {
        // A client that failed to close leaves only its file, removed below.
      }
    }
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 3 })
  }
}

/** Each mutation's outcome, code and version in a push's answer, in order. */
function outcomes(text: string | null): Answered[] {
  if (text === null) return []
  const results = (JSON.parse(text) as { results?: SyncMutationResult[] }).results ?? []
  return results.map(answeredAs)
}
