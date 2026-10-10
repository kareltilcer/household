// What Maestro is asked, read with no device to ask it on: which flows a run takes, where it
// writes, and what it tells them. That Maestro takes these arguments is seen by CI's two jobs.
import { describe, expect, it } from '@jest/globals'
import { join } from 'node:path'
import { leftOut, test, type Run } from './maestro.ts'

const run: Run = {
  platform: 'android',
  stack: false,
  flows: 'flows',
  output: 'out',
  told: { CLIENT: 'mobile/1.2.3' },
}

describe('a run of the flows', () => {
  it('leaves out what is written ahead of its screens, and what needs a stack it has not', () => {
    expect(leftOut({ stack: false })).toEqual(['awaiting', 'stack'])
    expect(leftOut({ stack: true })).toEqual(['awaiting'])
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

  it('keeps the report, the logs and the screenshots under one folder', () => {
    const asked = test(run)
    expect(asked[asked.indexOf('--output') + 1]).toBe(join('out', 'report.xml'))
    expect(asked[asked.indexOf('--debug-output') + 1]).toBe(join('out', 'debug'))
    expect(asked[asked.indexOf('--test-output-dir') + 1]).toBe(join('out', 'kept'))
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
