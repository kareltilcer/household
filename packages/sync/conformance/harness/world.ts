// One run of the suite: its seeded generator, the households and members it made, its clients,
// what they did (Recorder), and the checks that judge it.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Admin, Household, Member, MemberSpec } from './admin.ts'
import { Client, type ClientOptions } from './client.ts'
import type { Attempt, HoldReason } from './connector.ts'
import { acknowledgedWrites, compareReplica, monotonicity, terminality, type Violation } from './invariants.ts'
import { Recorder } from './recorder.ts'
import { Rng } from './rng.ts'
import type { SyncMutationResult } from './mutation.ts'
import type { Target } from './target.ts'
import { until } from './wait.ts'

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
  readonly rng: Rng
  readonly recorder = new Recorder()
  readonly clients: Client[] = []
  private readonly dir: string

  constructor(target: Target, admin: Admin, seed: number, name: string) {
    this.target = target
    this.admin = admin
    this.name = name
    this.rng = new Rng(seed)
    this.dir = mkdtempSync(join(tmpdir(), 'household-conformance-'))
  }

  member(name: string): Promise<Member> {
    return this.admin.member(this.rng, name)
  }

  household(name: string, members: readonly MemberSpec[]): Promise<Household> {
    return this.admin.household(this.rng, name, members)
  }

  client(options: ClientOptions): Client {
    const c = new Client({ target: this.target, recorder: this.recorder, rng: this.rng, dir: this.dir }, options)
    this.clients.push(c)
    return c
  }

  /** Records each client's checkpoint, for invariant 5. */
  async sample(clients: readonly Client[] = this.clients): Promise<void> {
    for (const c of clients) this.recorder.sampled(c.name, await c.buckets())
  }

  /**
   * Waits until clients, the online ones by default, are quiet: nothing queued, nothing deferred
   * left to replay, and each replica equal to what its member may see. It reports whether they got
   * there within timeoutMs; the invariants then judge whatever state they are in.
   */
  async settle(options: { readonly clients?: readonly Client[]; readonly timeoutMs?: number } = {}): Promise<boolean> {
    const clients = options.clients ?? this.clients.filter((c) => c.isOnline)
    const took = await until(async () => {
      await this.sample(clients)
      for (const c of clients) {
        if ((await c.pending()) > 0 || (await c.held('deferred')).length > 0) return false
        if ((await compareReplica(c, this.target, this.admin)).length > 0) return false
      }
      return true
    }, options.timeoutMs ?? settleMs)
    return took !== null
  }

  /** Everything the invariants find wrong with the run as it stands (all but idempotency; see replay). */
  async violations(options: CheckOptions = {}): Promise<Violation[]> {
    const clients = options.clients ?? this.clients
    await this.sample(clients)
    const out: Violation[] = []
    for (const c of clients) out.push(...(await compareReplica(c, this.target, this.admin)))
    out.push(...(await acknowledgedWrites(this.recorder, this.admin, clients)))
    out.push(...monotonicity(this.recorder))
    out.push(
      ...(await terminality(this.recorder, clients, options.allowHeld === undefined ? {} : { allowHeld: options.allowHeld })),
    )
    return out
  }

  /** client's batches that were answered 200, the ones a network retry could deliver again. */
  answered(client: Client): Attempt[] {
    return this.recorder.attempts.filter((a) => a.client === client.name && a.status === 200 && a.source === 'queue')
  }

  /**
   * Invariant 3: delivers each of attempts again, as a network retry would, under its own key or
   * under a fresh one (mode, as far as the target allows by default), and reports a batch answered
   * otherwise than the first time, or a server the delivery changed.
   */
  async replay(client: Client, attempts: readonly Attempt[], mode: Target['replay'] = this.target.replay): Promise<Violation[]> {
    const out: Violation[] = []
    const report = (detail: string): void => {
      out.push({ invariant: 'idempotency', client: client.name, detail })
    }
    const before = await this.snapshot(client.household)
    for (const a of attempts) {
      const key = mode === 'fresh-key' ? this.rng.uuid() : a.key
      const response = await fetch(this.target.pushUrl(client.household.id), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await client.credentialNow()}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: a.body,
      })
      const text = await response.text()
      if (response.status !== 200) {
        report(`batch ${a.key} sent again was answered ${String(response.status)}: ${text}`)
        continue
      }
      const first = outcomes(a.response)
      const again = outcomes(text)
      if (JSON.stringify(first) !== JSON.stringify(again)) {
        report(`batch ${a.key} sent again was answered ${JSON.stringify(again)}, first ${JSON.stringify(first)}`)
      }
    }
    const after = await this.snapshot(client.household)
    if (after !== before) report(`sending ${String(attempts.length)} batches again changed the server`)
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

/** Each mutation's outcome and version in a push's answer, in order. */
function outcomes(text: string | null): { id: string; outcome: string; version: number | null }[] {
  if (text === null) return []
  const results = (JSON.parse(text) as { results?: SyncMutationResult[] }).results ?? []
  return results.map((r) => ({ id: r.mutation_id, outcome: r.outcome, version: r.version ?? null }))
}
