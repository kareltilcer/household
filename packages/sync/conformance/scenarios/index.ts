// Every scenario of PRD 10 §4, and the access-loss cases beside them, in PRD order.
//
// A scenario runs once the item named by its enabledBy has built the engine it tests, and that item
// switches it on by adding its key to `enabled` below: before then its expectations are the
// specification the item is built to, and it is reported as skipped (plan item 12). Item 13 moved
// the suite onto the engine (harness/target.ts), and items 16 and 17 add to it.

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

/**
 * The scenarios switched on, which is every one since item 17 (gate G-B): item 13's, whose engine
 * writes lww_field, state_set and additive and replicates through the generated streams; item 16's,
 * whose engine refuses a household that does not write with a 402 its connector holds, and retracts
 * nothing when it lapses; and item 17's, whose engine answers lww_row and strict_version, generates
 * the visibility and audience streams, rewrites the access a row carries, retracts for each cause of
 * access loss, and compacts.
 */
export const enabled: ReadonlySet<string> = new Set<string>([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '13-rotation',
  '14',
  '15',
  '16',
  '17',
  '18',
  'loss-grant',
  'loss-audience',
  'loss-private',
  'loss-removal',
  'loss-disabled',
  'no-loss-lapse',
  'suspension',
])
