// The mobile app's bundle budget (06-clients §8): the bytecode a production export holds for
// each platform, which is what a store's build embeds and the engine reads as the app starts.
// It is counted in its own bytes, as the binary holds it, since nothing downloads it apart from
// the binary.
//
// No source states a figure for the app, as D-153 does for the web's, so the budget is what the
// export measured when it was last set and a fifth over it. A budget is a number in this file:
// a pull request that needs more measures its export (`pnpm run export`, `pnpm run check`),
// writes what it measured here, in a line of its diff, or leaves out what it added.
import { statSync } from 'node:fs'
import { relative } from 'node:path'
import { bundlesOf } from './bundles.ts'

export const platforms = ['android', 'ios'] as const

export type Platform = (typeof platforms)[number]

/**
 * What each platform's bytecode measured, in bytes, when its budget was last set: the export of
 * 2026-10-10 with the whole of plan item 28 in it, joined: the primitives, the shell, the
 * session and the sync UI over PowerSync's SDK, which is some 870 kB of it.
 */
export const measured: Readonly<Record<Platform, number>> = {
  android: 6_221_873,
  ios: 6_004_499,
}

/** A platform's budget: what it measured and a fifth of that, in whole bytes. */
export function budgetOf(platform: Platform): number {
  return measured[platform] + Math.floor(measured[platform] / 5)
}

/** A bundle of an export that is bytecode, which is all a production export holds. */
const bytecode = /\.hbc$/

/** The platform a bundle is for, by the folder an export keeps it in, or undefined for another's. */
export function platformOf(root: string, file: string): Platform | undefined {
  const [, , , folder] = relative(root, file).split(/[\\/]/)
  return platforms.find((platform) => platform === folder)
}

export interface Measured {
  readonly platform: Platform
  /** How many files of bytecode the export holds for it. */
  readonly files: number
  readonly bytes: number
  readonly limit: number
}

/**
 * Every platform's bytecode in the export under `root`, against its budget. `size` gives a
 * file's bytes; left out, the file's own on disk.
 */
export function measure(
  root: string,
  size: (file: string) => number = (file) => statSync(file).size,
): Measured[] {
  const bundles = bundlesOf(root).filter((file) => bytecode.test(file))
  return platforms.map((platform) => {
    const own = bundles.filter((file) => platformOf(root, file) === platform)
    return {
      platform,
      files: own.length,
      bytes: own.reduce((sum, file) => sum + size(file), 0),
      limit: budgetOf(platform),
    }
  })
}

/** Bytes as a reader counts them: in thousands, to one decimal. */
export function kB(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`
}

/**
 * What is wrong with what was measured, a sentence a failure: a platform over its budget, and
 * a platform the export holds no bytecode for, which would otherwise pass by measuring nothing.
 */
export function over(all: readonly Measured[]): string[] {
  return all.flatMap(({ platform, files, bytes, limit }) => {
    if (files === 0) {
      return [
        `the export holds no bytecode for ${platform}: the budget is of both platforms, as ` +
          '`pnpm run export` writes them',
      ]
    }
    if (bytes > limit) {
      return [
        `${platform}: ${kB(bytes)} of bytecode is over its budget of ${kB(limit)} (build/budget.ts)`,
      ]
    }
    return []
  })
}
