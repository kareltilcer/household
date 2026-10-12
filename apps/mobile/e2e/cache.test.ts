// What an emulator is asked of its HTTP cache, and how its answer is read, with no device to
// ask: that the device's shell takes the line, and what OkHttp writes there, are CI's Android
// job's to show (run.ts, `--cache`).
import { describe, expect, it } from '@jest/globals'
import { addresses, asking, folderOf, held, naming } from './cache.ts'

const appId = 'com.example.household.dev'
const folder = '/data/data/com.example.household.dev/cache/http-cache'

describe("a device's HTTP cache", () => {
  it("is React Native's, under the app's own cache directory", () => {
    expect(folderOf(appId)).toBe(folder)
  })

  it('is asked of no name a shell would read as more than a name', () => {
    for (const name of ['', 'household', 'com.example; rm -rf /', "com.example'", 'com..dev']) {
      expect(() => folderOf(name)).toThrow()
      expect(() => asking(name)).toThrow()
      expect(() => naming(name)).toThrow()
    }
  })

  it('is asked as root, for who answers and then for every file of the folder', () => {
    expect(asking(appId)).toBe(
      `su 0 sh -c 'id -u; [ -d ${folder} ] || exit 0; echo ${folder}; find ${folder} -type f'`,
    )
  })

  it('holds nothing where its folder is not there', () => {
    expect(held(appId, '0\n')).toEqual({ there: false, answers: [] })
  })

  it("holds nothing where the journal is all there is, whichever of the journal's files", () => {
    const written = [
      '0',
      folder,
      `${folder}/journal`,
      `${folder}/journal.tmp`,
      `${folder}/journal.bkp`,
    ]
    expect(held(appId, `${written.join('\n')}\n`)).toEqual({ there: true, answers: [] })
  })

  it('holds an answer by each of its files, one still being written among them', () => {
    const entry = `${folder}/9d5ed678fe57bcca610140957afab571`
    const written = ['0', folder, `${folder}/journal`, `${entry}.0`, `${entry}.1`, `${entry}.1.tmp`]
    expect(held(appId, written.join('\r\n'))).toEqual({
      there: true,
      answers: [`${entry}.0`, `${entry}.1`, `${entry}.1.tmp`],
    })
  })

  it("counts a file named for the journal that is not the cache's own", () => {
    const written = ['0', folder, `${folder}/journal.0`, `${folder}/deeper/journal`]
    expect(held(appId, written.join('\n'))?.answers).toEqual([
      `${folder}/journal.0`,
      `${folder}/deeper/journal`,
    ])
  })

  it('is not read where it was not root that answered, or nobody', () => {
    expect(held(appId, '')).toBeUndefined()
    expect(held(appId, `2000\n${folder}\n`)).toBeUndefined()
    expect(held(appId, '/system/bin/sh: su: inaccessible or not found\n')).toBeUndefined()
  })

  it('names what a kept answer was of without its query', () => {
    expect(naming(appId)).toContain(`${folder}/*.0`)
    expect(
      addresses('http://10.0.2.2:8080/api/v1/me\nhttp://10.0.2.2:9000/h/a/b?X-Amz-Signature=1\n'),
    ).toEqual(['http://10.0.2.2:8080/api/v1/me', 'http://10.0.2.2:9000/h/a/b?…'])
  })
})
