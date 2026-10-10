// What a build asks of its device, held to its reasons: the reading of `aapt2`'s list and the
// judging of it, on lists written here. That a real build asks for exactly these is seen by
// CI's Android job, which builds one.
import { describe, expect, it } from '@jest/globals'
import { asked, developmentAsked, judge, ownPermission, read } from './asked.ts'

const identifier = 'com.kareltilcer.household.dev'

/** A list as `aapt2 dump permissions` prints one, of a build that uses `names`. */
function dump(names: readonly string[]): string {
  return [
    `package: ${identifier}`,
    ...names.map((name) => `uses-permission: name='${name}'`),
    `permission: ${identifier}.${ownPermission}`,
    `uses-permission: name='${identifier}.${ownPermission}'`,
    '',
  ].join('\n')
}

const member = Object.keys(asked)
const development = [...member, ...Object.keys(developmentAsked)]

describe('what a build asks of its device', () => {
  it('is read off the list by name, whatever else a line says', () => {
    const printed =
      `package: ${identifier}\n` +
      "uses-permission: name='android.permission.INTERNET'\n" +
      "uses-permission: name='android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32'\n" +
      `permission: ${identifier}.${ownPermission}\n`
    expect(read(printed)).toEqual({
      identifier,
      names: ['android.permission.INTERNET', 'android.permission.READ_EXTERNAL_STORAGE'],
    })
  })

  it('passes a build that asks for what has a reason and nothing else', () => {
    expect(judge(dump(development), 'development')).toEqual([])
    expect(judge(dump(member), 'staging')).toEqual([])
    expect(judge(dump(member), 'production')).toEqual([])
  })

  it('fails a permission that has no reason, by name: a new library’s, until it is decided', () => {
    const failures = judge(dump([...development, 'android.permission.CAMERA']), 'development')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('android.permission.CAMERA')
  })

  it('fails a build a member installs that draws over other apps', () => {
    const failures = judge(dump(development), 'production')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('android.permission.SYSTEM_ALERT_WINDOW')
  })

  it('fails a reason for a permission the build does not ask for', () => {
    const failures = judge(dump(member.slice(1)), 'production')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain(`does not ask for ${String(member[0])}`)
  })

  it('fails a file that is no list at all, which would otherwise pass by naming nothing', () => {
    expect(judge('', 'development')).toHaveLength(1)
  })
})
