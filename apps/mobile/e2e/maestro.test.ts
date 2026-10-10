// What Maestro is asked, read with no device to ask it on: which flows a run takes, where it
// writes, and what it tells them. That Maestro takes these arguments is seen by CI's two jobs.
import { describe, expect, it } from '@jest/globals'
import { join } from 'node:path'
import { leftOut, outcome, test, type Run } from './maestro.ts'

const run: Run = {
  platform: 'android',
  stack: false,
  flows: 'flows',
  output: 'out',
  told: { CLIENT: 'mobile/1.2.3' },
}

describe('a run of the flows', () => {
  it('leaves out what is written ahead of its screens, and what needs a stack it has not', () => {
    expect(leftOut({ platform: 'android', stack: false })).toEqual(['awaiting', 'stack'])
    expect(leftOut({ platform: 'android', stack: true })).toEqual(['awaiting'])
  })

  it('leaves out on iOS what only Android lets a flow do', () => {
    expect(leftOut({ platform: 'ios', stack: false })).toEqual(['awaiting', 'stack', 'android'])
  })

  it('asks Maestro for every flow of the folder but those, on the platform it names', () => {
    const asked = test(run)
    expect(asked.slice(0, 3)).toEqual(['test', '--platform', 'android'])
    expect(asked.at(-1)).toBe('flows')
    expect(asked[asked.indexOf('--exclude-tags') + 1]).toBe('awaiting,stack')
    expect(asked).not.toContain('--device')
  })

  it('names the one device where it is told one', () => {
    const asked = test({ ...run, platform: 'ios', device: 'A1B2' })
    expect(asked[asked.indexOf('--device') + 1]).toBe('A1B2')
  })

  it('keeps the report and everything a flow left under one folder', () => {
    const asked = test(run)
    expect(asked[asked.indexOf('--output') + 1]).toBe(join('out', 'report.xml'))
    expect(asked[asked.indexOf('--debug-output') + 1]).toBe(join('out', 'debug'))
    expect(asked).toContain('--flatten-debug-output')
  })

  it('tells the flows each thing by its name, whole, whatever is in it', () => {
    const asked = test({ ...run, stack: true, told: { CLIENT: 'mobile/1.2.3', EMAIL: 'a=b@c.d' } })
    expect(asked.filter((_, at) => asked[at - 1] === '-e')).toEqual([
      'CLIENT=mobile/1.2.3',
      'EMAIL=a=b@c.d',
    ])
  })
})

/** A report as Maestro writes one: the shapes of run 38066536920's, on the simulator. */
function report(cases: readonly string[]): string {
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    '<testsuites>',
    '  <testsuite name="Test Suite" device="household-e2e" tests="4" failures="3" time="755.3">',
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n')
}

const passed = (name: string) =>
  `    <testcase id="${name}" name="${name}" classname="${name}" file="e2e/flows/${name}.yaml" time="34.8" status="SUCCESS"/>`

const tagged = (name: string) =>
  [
    `    <testcase id="${name}" name="${name}" classname="${name}" time="31.1" status="SUCCESS">`,
    '      <properties>',
    '        <property name="tags" value="stack"/>',
    '      </properties>',
    '    </testcase>',
  ].join('\n')

const failedWith = (name: string, failure: string) =>
  [
    `    <testcase id="${name}" name="${name}" classname="${name}" time="58.0" status="ERROR">`,
    `      <failure>${failure}</failure>`,
    '    </testcase>',
  ].join('\n')

/** What a flow says once Maestro's driver on the device is gone, as far as its first lines. */
const unreachable = [
  'maestro.DeviceUnreachableException: Device became unreachable during touch',
  '\tat maestro.drivers.IOSDriver.runDeviceCall(IOSDriver.kt:645)',
  'Caused by: java.net.ConnectException: Failed to connect to /127.0.0.1:50336',
].join('\n')

describe('what a report says became of the flows', () => {
  it('is nothing to run again where every flow passed', () => {
    expect(outcome(report([passed('launch'), tagged('stack')]))).toEqual({ failed: [], lost: [] })
  })

  it('tells a flow that failed for itself from those the driver’s death took after it', () => {
    const read = outcome(
      report([
        passed('engine'),
        failedWith('resolvers', 'Assertion is false: id: household-dev-screen:sync is visible'),
        failedWith('shell', unreachable),
        failedWith('hold', unreachable),
        passed('theme'),
        failedWith('launch', unreachable),
      ]),
    )
    expect(read.failed).toEqual(['resolvers', 'shell', 'hold', 'launch'])
    expect(read.lost).toEqual(['shell', 'hold', 'launch'])
  })

  it('reads a report that is none as one that names no flow', () => {
    expect(outcome('')).toEqual({ failed: [], lost: [] })
  })
})
