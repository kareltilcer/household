// The six invariants PRD 10 §4 asserts after every scenario, as checks that return what they
// found wrong rather than throwing, so that a negative control can assert which one failed.
//
//   1. Convergence: every replica equals the rows its member may see on the server, field for
//      field. A replica is compared with the suite's own statement of the access predicate
//      (Admin.visible), never with a stream's, so a stream that disagrees with it is caught.
//   2. No acknowledged write is lost: the row an `applied` or `merged` answer names is on the
//      server at the version it answered, or later.
//   3. Idempotency: a batch delivered again changes nothing and is answered alike (replay).
//   4. Retraction completeness: no replica holds a row its member may not see. A row of another
//      household is reported as `isolation`, FR-NF4's read-path twin (D-4).
//   5. Monotonicity: no replica's checkpoint moves backwards, bucket by bucket (Recorder.sampled).
//   6. Terminality: every mutation a client wrote ends in exactly one of applied, merged,
//      conflict and rejected, surfaced once; none is left queued, held or retried without end;
//      and every answer is one the contract allows, every outcome but `applied` with a code.

import type { Admin } from './admin.ts'
import type { Client } from './client.ts'
import type { HoldReason } from './connector.ts'
import { terminal } from './mutation.ts'
import type { Recorder } from './recorder.ts'
import {
  canonicalRow,
  entitySpec,
  tableSpec,
  type Canonical,
  type CanonicalRow,
  type TableName,
} from './schema.ts'
import type { Target } from './target.ts'

export type Invariant =
  | 'convergence'
  | 'no-acknowledged-write-lost'
  | 'idempotency'
  | 'retraction'
  | 'isolation'
  | 'monotonicity'
  | 'terminality'

export interface Violation {
  readonly invariant: Invariant
  readonly client?: string
  readonly detail: string
}

function same(a: Canonical, b: Canonical): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * How client's replica differs from what its member may see (invariants 1 and 4): a row it lacks
 * or holds otherwise than the server, a row the server never took or has deleted, a row of its
 * household its member may not see, and a row of another household.
 */
export async function compareReplica(
  client: Client,
  target: Target,
  admin: Admin,
): Promise<Violation[]> {
  const out: Violation[] = []
  const report = (invariant: Invariant, detail: string): void => {
    out.push({ invariant, client: client.name, detail })
  }
  for (const table of target.replicates) {
    const spec = tableSpec(table)
    const expected = await admin.visible(table, client.household, client.member, target.tombstones)
    const held = new Map<string, CanonicalRow>()
    for (const row of await client.rows(table)) {
      const c = canonicalRow(spec, row)
      held.set(c.id, c)
    }
    let server: Map<string, CanonicalRow> | null = null
    for (const [id, row] of held) {
      const want = expected.get(id)
      if (want === undefined) {
        server ??= await admin.rows(table, client.household)
        const there = server.get(id)
        if (there === undefined) {
          const other = await admin.householdOf(table, id)
          if (other === null)
            report('convergence', `holds ${table} ${id}, which the server never took`)
          else report('isolation', `holds ${table} ${id} of household ${other}`)
        } else if (there['deleted_at'] !== null && target.tombstones === 'dropped') {
          report('convergence', `holds ${table} ${id}, which the server has deleted`)
        } else {
          report('retraction', `holds ${table} ${id}, which ${client.member.name} may not see`)
        }
        continue
      }
      const differing = Object.keys(spec.columns).filter(
        (name) => !same(row[name] ?? null, want[name] ?? null),
      )
      if (differing.length > 0) {
        report(
          'convergence',
          `holds ${table} ${id} otherwise than the server: ${differing
            .map((n) => `${n} ${JSON.stringify(row[n])} for ${JSON.stringify(want[n])}`)
            .join(', ')}`,
        )
      }
    }
    for (const id of expected.keys()) {
      if (!held.has(id)) report('convergence', `lacks ${table} ${id}`)
    }
  }
  return out
}

/** Invariant 2: the row every `applied` or `merged` answer names is on the server at its version or later. */
export async function acknowledgedWrites(
  recorder: Recorder,
  admin: Admin,
  clients: readonly Client[],
): Promise<Violation[]> {
  const out: Violation[] = []
  const householdOf = new Map(clients.map((c) => [c.name, c.household]))
  const cache = new Map<string, Map<string, CanonicalRow>>()
  for (const a of recorder.answers) {
    const { result, mutation } = a
    if (
      (result.outcome !== 'applied' && result.outcome !== 'merged') ||
      result.version === null ||
      result.version === undefined
    )
      continue
    const household = householdOf.get(a.client)
    if (household === undefined) continue
    const table = entitySpec(mutation.entity_type).table as TableName
    const rowId = rowIdOf(result.row) ?? mutation.entity_id
    const key = `${household.id} ${table}`
    let rows = cache.get(key)
    if (rows === undefined) {
      rows = await admin.rows(table, household)
      cache.set(key, rows)
    }
    const there = rows.get(rowId)
    if (there === undefined) {
      out.push({
        invariant: 'no-acknowledged-write-lost',
        client: a.client,
        detail: `${mutation.mutation_id} was ${result.outcome} as ${table} ${rowId}, which the server does not hold`,
      })
    } else if (Number(there['version']) < result.version) {
      out.push({
        invariant: 'no-acknowledged-write-lost',
        client: a.client,
        detail: `${mutation.mutation_id} was ${result.outcome} at version ${String(result.version)} of ${table} ${rowId}, which the server holds at ${String(there['version'])}`,
      })
    }
  }
  return out
}

function rowIdOf(row: unknown): string | null {
  const id = (row as { id?: unknown } | null | undefined)?.id
  return typeof id === 'string' ? id.toLowerCase() : null
}

/** Invariant 5: every checkpoint regression the recorder saw. */
export function monotonicity(recorder: Recorder): Violation[] {
  return recorder.regressions.map((r) => ({
    invariant: 'monotonicity' as const,
    client: r.client,
    detail: `bucket ${r.bucket} went back from op ${String(r.from)} to ${String(r.to)}`,
  }))
}

export interface TerminalityOptions {
  /** Held mutations a scenario leaves held on purpose: scenario 14's, before the subscription resumes. */
  readonly allowHeld?: readonly HoldReason[]
}

/** Invariant 6: every mutation ended once; none left queued, held or unanswered; every answer well formed. */
export async function terminality(
  recorder: Recorder,
  clients: readonly Client[],
  options: TerminalityOptions = {},
): Promise<Violation[]> {
  const out: Violation[] = []
  const allowHeld = new Set(options.allowHeld ?? [])
  const held = new Map<string, HoldReason>()
  for (const client of clients) {
    for (const h of await client.held()) held.set(h.mutation.mutation_id, h.reason)
    const pending = await client.pending()
    if (pending > 0)
      out.push({
        invariant: 'terminality',
        client: client.name,
        detail: `${String(pending)} writes are still queued`,
      })
  }
  for (const [id, w] of recorder.written) {
    const ended = recorder.answersTo(id).filter((a) => terminal.has(a.result.outcome))
    const outcomes = [...new Set(ended.map((a) => a.result.outcome))]
    if (ended.length === 0) {
      const reason = held.get(id)
      if (reason !== undefined && allowHeld.has(reason)) continue
      const tries = recorder.attemptsAt(id).length
      out.push({
        invariant: 'terminality',
        client: w.client,
        detail: `${w.op} of ${w.table} ${w.entityId} (${id}) never ended${reason === undefined ? '' : `, held for ${reason}`}: ${String(tries)} requests carried it`,
      })
    } else if (outcomes.length > 1) {
      out.push({
        invariant: 'terminality',
        client: w.client,
        detail: `${id} ended ${outcomes.join(' and ')}`,
      })
    } else if (ended.length > 1) {
      out.push({
        invariant: 'terminality',
        client: w.client,
        detail: `${id} was answered ${outcomes.join('')} ${String(ended.length)} times, not once`,
      })
    }
  }
  for (const m of recorder.malformedResponses) {
    out.push({
      invariant: 'terminality',
      client: m.client,
      detail: `a response outside the contract: ${m.reason}`,
    })
  }
  return out
}
