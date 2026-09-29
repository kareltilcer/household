// A scenario of PRD 10 §4 as an executable specification: what it does, the outcome it expects
// beyond the six invariants every run is held to, and the plan item that switches it on.

import { expect } from 'vitest'
import type { Household, Member } from '../harness/admin.ts'
import type { Client } from '../harness/client.ts'
import type { HoldReason } from '../harness/connector.ts'
import type { SyncMutationResult } from '../harness/mutation.ts'
import type { EntityType, TableName } from '../harness/schema.ts'
import type { Capability } from '../harness/target.ts'
import { sleep } from '../harness/wait.ts'
import type { World } from '../harness/world.ts'

export interface Scenario {
  /** PRD 10 §4's number, or a name for the parts and the access-loss cases beside them. */
  readonly key: string
  readonly title: string
  /** PRD 10 §4's expected outcome, as this scenario asserts it. */
  readonly expected: string
  /** The plan item whose engine the scenario waits for, and which switches it on. */
  readonly enabledBy: 13 | 14 | 18
  /** The entities the target's push must write. */
  readonly needs: readonly EntityType[]
  /** The tables the target's streams must replicate beyond those of the entities it needs. */
  readonly replicates?: readonly TableName[]
  /** What else the target must be able to do. */
  readonly capabilities?: readonly Capability[]
  /** Held mutations the scenario leaves held on purpose. */
  readonly allowHeld?: readonly HoldReason[]
  run(w: World): Promise<void>
}

export interface Family {
  readonly jana: Member
  readonly petr: Member
  readonly eva: Member
  readonly home: Household
  readonly milk: string
  readonly bread: string
  readonly eggs: string
}

/**
 * The household most scenarios start from, after fixtures.js: Jana owns it, Petr and Eva
 * contribute to the conformance module, and Milk, Bread and Eggs are on the list.
 */
export async function family(w: World): Promise<Family> {
  const jana = await w.member('Jana')
  const petr = await w.member('Petr')
  const eva = await w.member('Eva')
  const home = await w.household('Novákovi', [
    { member: jana, role: 'owner' },
    { member: petr, role: 'member', level: 'contribute' },
    { member: eva, role: 'member', level: 'contribute' },
  ])
  const [milk, bread, eggs] = [w.rng.uuid(), w.rng.uuid(), w.rng.uuid()]
  await w.admin.insert('conformance_items', home, [
    { id: milk, title: 'Milk' },
    { id: bread, title: 'Bread' },
    { id: eggs, title: 'Eggs' },
  ])
  return { jana, petr, eva, home, milk, bread, eggs }
}

/** Brings clients online and waits until the run settles, which it must. */
export async function online(w: World, ...clients: Client[]): Promise<void> {
  await Promise.all(clients.map((c) => c.online()))
  expect(await w.settle(), 'the clients settle').toBe(true)
}

export async function offline(...clients: Client[]): Promise<void> {
  await Promise.all(clients.map((c) => c.offline()))
}

/** The answers client's connector ended mutations with, in order. */
export function answersOf(w: World, client: Client): SyncMutationResult[] {
  return w.recorder.answers.filter((a) => a.client === client.name).map((a) => a.result)
}

/** Asserts that nothing is sent for quietMs: no retry loop, no echo. */
export async function staysQuiet(w: World, quietMs = 1_500): Promise<void> {
  const before = w.recorder.attempts.length
  await sleep(quietMs)
  expect(w.recorder.attempts.length, 'requests made after the run settled').toBe(before)
}

/** The audit events household recorded about entity, as their actions. */
export async function eventsAbout(
  w: World,
  household: Household,
  entity: string,
): Promise<string[]> {
  const result = await w.admin.pool.query<{ action: string }>(
    `SELECT module || '.' || action AS action FROM audit_events WHERE household_id = $1 AND entity_id = $2 ORDER BY occurred_at`,
    [household.id, entity],
  )
  return result.rows.map((r) => r.action)
}
