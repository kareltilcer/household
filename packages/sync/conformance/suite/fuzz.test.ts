// Seeded random schedules over the six invariants (PRD 10 §4). A short run on each change, the
// default; the nightly workflow runs a long one (CONFORMANCE_FUZZ_RUNS, CONFORMANCE_FUZZ_STEPS),
// and a failing seed is run again alone with CONFORMANCE_FUZZ_SEED=<seed> CONFORMANCE_FUZZ_RUNS=1.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Admin } from '../harness/admin.ts'
import { adminDatabaseUrl, fuzz as settings } from '../harness/env.ts'
import { fuzz } from '../harness/fuzz.ts'
import { standIn } from '../harness/target.ts'

let admin: Admin

beforeAll(() => {
  admin = new Admin(adminDatabaseUrl)
})

afterAll(async () => {
  await admin.close()
})

describe(`the fuzzer, against the ${standIn.name}`, () => {
  for (let i = 0; i < settings.runs; i++) {
    const seed = settings.seed + i
    it(`seed ${String(seed)}, ${String(settings.steps)} steps`, async () => {
      const result = await fuzz({ seed, steps: settings.steps, target: standIn, admin })
      expect(
        result.violations,
        `run it again with CONFORMANCE_FUZZ_SEED=${String(seed)} CONFORMANCE_FUZZ_RUNS=1; its schedule:\n${result.log.join('\n')}`,
      ).toEqual([])
    })
  }
})
