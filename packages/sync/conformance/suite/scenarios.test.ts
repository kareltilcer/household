// PRD 10 §4's scenarios, each held to its own expectations and to the six invariants, idempotency
// by delivering again every batch its clients had answered, once the rest have been judged. A
// scenario not yet switched on (scenarios/index.ts) is skipped, named with the item that switches it on;
// CONFORMANCE_SCENARIOS=all runs every one the target can, switched on or not, for the item
// building its engine.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Admin } from '../harness/admin.ts'
import { adminDatabaseUrl } from '../harness/env.ts'
import { entitySpec, type TableName } from '../harness/schema.ts'
import { engine, type Target } from '../harness/target.ts'
import { World } from '../harness/world.ts'
import { enabled, scenarios } from '../scenarios/index.ts'
import type { Scenario } from '../scenarios/scenario.ts'

const target: Target = engine
const forced = process.env['CONFORMANCE_SCENARIOS'] === 'all'

let admin: Admin

beforeAll(() => {
  admin = new Admin(adminDatabaseUrl)
})

afterAll(async () => {
  await admin.close()
})

/**
 * What target lacks for s, or null: an entity it needs that the push does not write, a table its
 * streams do not replicate (the tables of those entities as well as the ones it names, since a
 * replica is held to the server's rows only on the tables the target replicates, and to nothing on
 * the others), or a capability.
 */
function lacks(s: Scenario): string | null {
  const entities = s.needs.filter((e) => !target.writes.has(e))
  if (entities.length > 0) return `its push does not write ${entities.join(', ')}`
  const needed = new Set<TableName>([
    ...s.needs.map((e) => entitySpec(e).table as TableName),
    ...(s.replicates ?? []),
  ])
  const tables = [...needed].filter((t) => !target.replicates.has(t))
  if (tables.length > 0) return `its streams do not replicate ${tables.join(', ')}`
  const capabilities = (s.capabilities ?? []).filter((c) => target[c] === undefined)
  if (capabilities.length > 0) return `it cannot ${capabilities.join(', ')}`
  return null
}

describe(`PRD 10 §4, against the ${target.name}`, () => {
  for (const [i, s] of scenarios.entries()) {
    const on = enabled.has(s.key) || (forced && lacks(s) === null)
    it.skipIf(!on)(`${s.key}. ${s.title} (item ${String(s.enabledBy)})`, async () => {
      const missing = lacks(s)
      if (missing !== null)
        throw new Error(
          `scenario ${s.key} is switched on, but the ${target.name} target cannot run it: ${missing}`,
        )
      const w = new World(target, admin, 10_000 + i, `scenario-${s.key}`)
      try {
        await s.run(w)
        const found = await w.violations(
          s.allowHeld === undefined ? {} : { allowHeld: s.allowHeld },
        )
        found.push(...(await w.idempotency()))
        expect(found).toEqual([])
      } finally {
        await w.close()
      }
    })
  }
})
