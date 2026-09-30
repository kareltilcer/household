// Every scenario of PRD 10 §4, and the access-loss cases beside them, in PRD order.
//
// A scenario runs once the item named by its enabledBy has built the engine it tests, and that item
// switches it on by adding its key to `enabled` below: before then its expectations are the
// specification the item is built to, and it is reported as skipped (plan item 12). Items 13, 14
// and 18 each move the suite from the stand-ins onto what they build (harness/target.ts).

import { access } from './access.ts'
import { admission } from './admission.ts'
import { delivery } from './delivery.ts'
import { merge } from './merge.ts'
import type { Scenario } from './scenario.ts'

/** A scenario's place: PRD 10 §4's number, a part just after its scenario, a named case last. */
function rank(key: string): number {
  const n = Number.parseInt(key, 10)
  if (Number.isNaN(n)) return Number.MAX_SAFE_INTEGER
  return key === String(n) ? n : n + 0.5
}

export const scenarios: readonly Scenario[] = [...merge, ...delivery, ...access, ...admission].sort(
  (a, b) => rank(a.key) - rank(b.key),
)

/** The scenarios switched on: none until item 13's engine exists. */
export const enabled: ReadonlySet<string> = new Set<string>([])
