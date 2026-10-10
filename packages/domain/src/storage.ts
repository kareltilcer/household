// Storage blocks (PRD 04 §4, FR-BI3): a household's allowance is 5 GB, then whole 10 GB blocks
// added as the month's daily average needs them, 20 at most. The storage screen previews the
// block count and the charge from the same arithmetic the invoice is billed from (FR-BI4), so
// an invoice is never the first place a household learns the number.
//
// The server's twin is server/internal/platform/storage. Both are held to
// packages/test-vectors/vectors/storage.json (D-37).

/** What a household may store: `baseBytes` included, then blocks of `blockBytes`, `maxBlocks` at most. */
export interface StorageAllowance {
  readonly baseBytes: number
  readonly blockBytes: number
  readonly maxBlocks: number
}

/** A gigabyte as storage is sold: a thousand million bytes. */
export const gigabyte = 1_000_000_000

/** PRD 04 §4's allowance: 5 GB, then 10 GB blocks, up to 20 of them, 205 GB in all (D-33, D-34). */
export const storageAllowance: StorageAllowance = {
  baseBytes: 5 * gigabyte,
  blockBytes: 10 * gigabyte,
  maxBlocks: 20,
}

/**
 * The mean of a period's daily samples of stored bytes, rounded down, and 0 of none: the daily
 * average the blocks are computed from, never the peak (D-31).
 */
export function averageBytes(samples: readonly number[]): number {
  if (samples.length === 0) return 0
  return Math.floor(samples.reduce((sum, bytes) => sum + bytes, 0) / samples.length)
}

/**
 * How many whole blocks a daily average of `average` bytes needs:
 * `ceil(max(0, average − base) / block)`, never more than the allowance's `maxBlocks`.
 */
export function storageBlocks(
  average: number,
  allowance: StorageAllowance = storageAllowance,
): number {
  const over = average - allowance.baseBytes
  if (over <= 0) return 0
  return Math.min(Math.ceil(over / allowance.blockBytes), allowance.maxBlocks)
}

/** The blocks `average` needs and what they cost at `unitAmountMinor` a block, in minor units. */
export function storageCharge(
  average: number,
  unitAmountMinor: number,
  allowance: StorageAllowance = storageAllowance,
): { readonly blocks: number; readonly amount_minor: number } {
  const blocks = storageBlocks(average, allowance)
  return { blocks, amount_minor: blocks * unitAmountMinor }
}

/**
 * Whether `stored` is at or above four fifths of `allowance`, both in bytes: where a household's
 * owners are first told that it is filling (the server's `fairuse.Warns`). In whole numbers,
 * with nothing rounded, so that the screen and the notice agree to the byte.
 */
export function storageWarns(stored: number, allowance: number): boolean {
  return stored * 5 >= allowance * 4
}

/**
 * The average a period ends on if the household goes on storing `current` bytes for each of its
 * `remaining` days not sampled yet: the mean of the samples and those days, rounded down, and
 * `current` when there is neither (FR-BI4).
 */
export function projectedAverageBytes(
  samples: readonly number[],
  current: number,
  remaining: number,
): number {
  const left = Math.max(0, remaining)
  const days = samples.length + left
  if (days === 0) return current
  return Math.floor((samples.reduce((sum, bytes) => sum + bytes, 0) + current * left) / days)
}
