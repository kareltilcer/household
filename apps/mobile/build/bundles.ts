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

/**
 * What stands in for the server and the replica, and the words a test draws, where they are
 * written outside src/dev: a dev screen and a test both draw over them, and a test may import
 * nothing of src/dev. Each file is named with words it alone holds, which a bundle is searched
 * for as the dev screens' marker is: no source says that a screen a member is served imports
 * none of them, so the export is what is asked.
 */
export const standIns: Readonly<Record<string, string>> = {
  'src/sync/standIn.ts': 'StandInNeedsConnection',
  'src/sync/sync.fixtures.ts': 'no registry the server serves',
  'src/api/testing.ts': 'api.household.test',
  'src/test/fixtures.ts': 'eva@dum.test',
  'src/ui/controls.fixtures.ts': 'The server refused the reading.',
}

/** What is wrong with the export under `root`, a sentence a failure, with the bundles it read. */
export function check(root: string): { failures: string[]; bundles: string[] } {
  const bundles = bundlesOf(root)
  const failures = bundles.flatMap((file) => {
    const bundle = readFileSync(file)
    return [
      ...(holds(bundle, devMarker)
        ? [
            `${relative(root, file)} holds a dev screen (${devMarker}): a dev screen is in no build a member is served`,
          ]
        : []),
      ...Object.entries(standIns)
        .filter(([, words]) => holds(bundle, words))
        .map(
          ([source]) =>
            `${relative(root, file)} holds ${source}: what stands in for the server, the replica or a member in a test is in no build a member is served`,
        ),
    ]
  })
  return { failures, bundles }
}
