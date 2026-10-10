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
 * - `android`: does what only Android lets a flow do. A link is one such thing: iOS asks
 *   before it opens one that came from outside the app, in a dialog no `testID` finds. Taking
 *   the device's connection away is the other, which Maestro does on Android alone.
 */
export const tags = ['awaiting', 'stack', 'android'] as const

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
export function leftOut(run: Pick<Run, 'platform' | 'stack'>): Tag[] {
  const taken: Readonly<Record<Tag, boolean>> = {
    awaiting: false,
    stack: run.stack,
    android: run.platform === 'android',
  }
  return tags.filter((tag) => !taken[tag])
}

/** Maestro's arguments for `run`, as `maestro test` of the pinned version takes them. */
export function test(run: Run): string[] {
  return [
    'test',
    '--platform',
    run.platform,
    ...(run.device === undefined ? [] : ['--device', run.device]),
    // One file for whoever reads the run on a page, and beside it a folder a flow, by the
    // flow's name and with none named for the minute: the screenshots it took, and of a
    // failure the screen, the hierarchy Maestro saw and what the device logged meanwhile.
    '--format',
    'junit',
    '--output',
    join(run.output, 'report.xml'),
    '--debug-output',
    join(run.output, 'debug'),
    '--flatten-debug-output',
    '--exclude-tags',
    leftOut(run).join(','),
    ...Object.entries(run.told).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    run.flows,
  ]
}

/** What a run's report says became of its flows, each by its name. */
export interface Outcome {
  /** Every flow that did not pass. */
  readonly failed: readonly string[]
  /**
   * Those of them that failed for no reason of their own: Maestro's driver on the device was
   * gone, and every flow after says so at its first step.
   */
  readonly lost: readonly string[]
}

/**
 * Reads Maestro's JUnit report. A flow that the driver's death took says so in its failure,
 * by the name of Maestro's own exception, and is told apart from one that failed for itself:
 * an assertion that did not hold, an element that never came.
 *
 * The driver dies on iOS when the app under it has crashed: Xcode hands its runner the crash's
 * report a minute or two later, in the middle of whichever flow is then running, and the
 * runner falls over reading it (run 38066536920: one crash, in one flow, and the three flows
 * after it failed with it). Such flows are run again (run.ts), so that one failure is one.
 */
export function outcome(report: string): Outcome {
  const failed: string[] = []
  const lost: string[] = []
  for (const [, attributes = '', , body = ''] of report.matchAll(
    /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const name = /\bname="([^"]*)"/.exec(attributes)?.[1]
    if (name === undefined || !body.includes('<failure')) continue
    failed.push(name)
    if (body.includes('DeviceUnreachableException')) lost.push(name)
  }
  return { failed, lost }
}
