// What Maestro is asked, apart from the script that asks it (run.ts), so that a test reads the
// command with no device to run it on.
import { join } from 'node:path'

/** The two devices a flow runs on: CI's emulator and its simulator (plan item 28). */
export const platforms = ['android', 'ios'] as const

export type Platform = (typeof platforms)[number]

/**
 * What a flow may be tagged, and nothing else (flows.test.ts):
 *
 * - `awaiting`: written ahead of the screens it reads, against the `testID`s they were promised
 *   under. No run takes it until its screens are merged and the tag is taken off, which is also
 *   when its names are first held to the sources.
 * - `stack`: needs the API, the sync service and a member to sign in as. Only a run that says
 *   it has them takes it: CI's Android job, which has Docker; a macOS runner has none.
 */
export const tags = ['awaiting', 'stack'] as const

export type Tag = (typeof tags)[number]

export interface Run {
  readonly platform: Platform
  /** The one device to run on, where more than one is up: a simulator's id, an emulator's serial. */
  readonly device?: string
  /** Whether the stack is up and `told` names a member of it. */
  readonly stack: boolean
  /** Where the flows are: a folder, every flow of which is run but for the tags left out. */
  readonly flows: string
  /** Where everything the run writes goes: the report, the logs and the screenshots. */
  readonly output: string
  /** What the flows are told, each read in a flow as `${NAME}`. */
  readonly told: Readonly<Record<string, string>>
}

/** The tags a run leaves out. */
export function leftOut(run: Pick<Run, 'stack'>): Tag[] {
  return tags.filter((tag) => tag !== 'stack' || !run.stack)
}

/** Maestro's arguments for `run`, as `maestro test` of the pinned version takes them. */
export function test(run: Run): string[] {
  return [
    'test',
    '--platform',
    run.platform,
    ...(run.device === undefined ? [] : ['--device', run.device]),
    // One file for whoever reads the run on a page, and everything else beside it, flat: a
    // failure's screenshot and its log are found by name, with no folder named for the minute.
    '--format',
    'junit',
    '--output',
    join(run.output, 'report.xml'),
    '--debug-output',
    join(run.output, 'debug'),
    '--flatten-debug-output',
    // What a flow itself keeps, its `takeScreenshot`s.
    '--test-output-dir',
    join(run.output, 'kept'),
    '--exclude-tags',
    leftOut(run).join(','),
    ...Object.entries(run.told).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    run.flows,
  ]
}
