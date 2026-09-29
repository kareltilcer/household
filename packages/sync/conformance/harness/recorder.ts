// What a run did, as its clients report it: every mutation a client wrote, every request its
// connector made, every answer it ended a mutation with, and every checkpoint its replica was
// seen at. The invariants are judged on it.

import type { Attempt } from './connector.ts'
import type { SyncMutation, SyncMutationResult } from './mutation.ts'
import type { TableName } from './schema.ts'

export interface Written {
  readonly mutationId: string
  readonly table: TableName
  readonly entityId: string
  readonly op: 'create' | 'update' | 'delete' | 'action'
}

export interface Answer {
  readonly client: string
  readonly mutation: SyncMutation
  readonly result: SyncMutationResult
}

export class Recorder {
  readonly written = new Map<string, Written & { readonly client: string }>()
  readonly attempts: (Attempt & { readonly client: string })[] = []
  /** Every answer a connector ended a mutation with, in the order they came. */
  readonly answers: Answer[] = []
  readonly malformedResponses: { readonly client: string; readonly attempt: Attempt; readonly reason: string }[] = []
  /** The highest op each client's replica was seen to have applied in each bucket. */
  private readonly checkpoints = new Map<string, Map<string, number>>()
  /** A bucket seen at a lower op than it had been: a checkpoint that moved backwards. */
  readonly regressions: { readonly client: string; readonly bucket: string; readonly from: number; readonly to: number }[] = []

  wrote(client: string, w: Written): void {
    this.written.set(w.mutationId, { ...w, client })
  }

  attempted(client: string, attempt: Attempt): void {
    this.attempts.push({ ...attempt, client })
  }

  answered(client: string, mutation: SyncMutation, result: SyncMutationResult): void {
    this.answers.push({ client, mutation, result })
  }

  malformed(client: string, attempt: Attempt, reason: string): void {
    this.malformedResponses.push({ client, attempt, reason })
  }

  /** Records the ops client's replica has applied, bucket by bucket (invariant 5). */
  sampled(client: string, buckets: readonly { readonly name: string; readonly last_applied_op: number }[]): void {
    let seen = this.checkpoints.get(client)
    if (seen === undefined) {
      seen = new Map()
      this.checkpoints.set(client, seen)
    }
    for (const b of buckets) {
      const op = b.last_applied_op
      const before = seen.get(b.name)
      if (before !== undefined && op < before) this.regressions.push({ client, bucket: b.name, from: before, to: op })
      seen.set(b.name, Math.max(op, before ?? op))
    }
  }

  /** The answers mutationId was ended with. */
  answersTo(mutationId: string): Answer[] {
    return this.answers.filter((a) => a.mutation.mutation_id === mutationId)
  }

  /** The requests that carried mutationId. */
  attemptsAt(mutationId: string): (Attempt & { readonly client: string })[] {
    return this.attempts.filter((a) => a.mutationIds.includes(mutationId))
  }
}
