// What an export is made of and what is looked for in it: the functions of `check`, apart from
// the script that runs them (check.ts), so that a test asks them of a folder of its own.
import { globSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { devMarker } from '../src/dev/marker.ts'

/** The files of an export that are a bundle: bytecode, or the JavaScript it is compiled from. */
export function bundlesOf(root: string): string[] {
  return globSync('_expo/static/js/*/*.{hbc,js}', { cwd: root })
    .map((file) => join(root, file))
    .sort()
}

/**
 * Whether `bundle` holds `marker`: as it is written, or two bytes a letter, which is how
 * bytecode keeps a string that is not plain ASCII and may keep any.
 */
export function holds(bundle: Buffer, marker: string): boolean {
  return (
    bundle.includes(Buffer.from(marker, 'utf8')) || bundle.includes(Buffer.from(marker, 'utf16le'))
  )
}

/** What is wrong with the export under `root`, a sentence a failure, with the bundles it read. */
export function check(root: string): { failures: string[]; bundles: string[] } {
  const bundles = bundlesOf(root)
  const failures = bundles
    .filter((file) => holds(readFileSync(file), devMarker))
    .map(
      (file) =>
        `${relative(root, file)} holds a dev screen (${devMarker}): a dev screen is in no build a member is served`,
    )
  return { failures, bundles }
}
