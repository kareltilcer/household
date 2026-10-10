// A replica's waiting files on a device (D-25): where a file is kept until its row has reached
// the server, and how it is sent from there. The file system is Expo's own stand-in, which
// keeps what is written in memory; the upload's native half is stood in for here, so what is
// held is what the app asks of it and what it makes of the answer. That a device sends the
// file, and from disk, is a device's to show.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Directory, File, Paths, UploadType, type UploadResult } from 'expo-file-system'
import { createProblemHub, type Problem } from '../api/problems.ts'
import { households, ids } from '../test/fixtures.ts'
import { filesOf, fileStorage, removeFiles, uploadByUri } from './files.ts'

const member = ids.member
const home = households.own.id
const row = '0198c0de-0000-7000-8000-00000000d001'
const pdf = new TextEncoder().encode('%PDF-1.7')

/** Nothing of the upload goes through the `fetch` it is handed: one that is called fails the test. */
const unused: typeof globalThis.fetch = () => {
  throw new Error('the file was sent through the replica’s fetch')
}

beforeEach(() => {
  for (const each of Paths.document.list()) each.delete()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('where a replica’s files wait', () => {
  it('is a directory of its member’s and its household’s, in the app’s own documents', () => {
    const directory = filesOf(member.toUpperCase(), home)
    expect(directory.uri).toBe(new Directory(Paths.document, 'replicas', member, home).uri)
    expect(filesOf(ids.otherMember, home).uri).not.toBe(directory.uri)
  })

  it('keeps a file under its row’s id, says how large it is, and hands it back as it was', async () => {
    const storage = fileStorage(filesOf(member, home))
    await storage.initialize()
    const place = storage.getLocalUri(row)
    expect(place).toBe(new File(filesOf(member, home), row).uri)
    expect(await storage.fileExists(place)).toBe(false)
    expect(await storage.saveFile(place, pdf.buffer)).toBe(pdf.byteLength)
    expect(await storage.fileExists(place)).toBe(true)
    expect(new Uint8Array(await storage.readFile(place))).toEqual(pdf)
    // Kept again, it is the later bytes alone.
    const later = new TextEncoder().encode('%PDF-2.0 and more')
    expect(await storage.saveFile(place, later.buffer)).toBe(later.byteLength)
    expect(new Uint8Array(await storage.readFile(place))).toEqual(later)
  })

  it('needs no directory made first, and deletes a file once, quietly the second time', async () => {
    const storage = fileStorage(filesOf(member, home))
    const place = storage.getLocalUri(row)
    await storage.saveFile(place, pdf.buffer)
    await storage.deleteFile(place)
    expect(await storage.fileExists(place)).toBe(false)
    await expect(storage.deleteFile(place)).resolves.toBeUndefined()
  })

  it('is emptied whole, and made again when it is next asked for', async () => {
    const directory = filesOf(member, home)
    const storage = fileStorage(directory)
    await storage.saveFile(storage.getLocalUri(row), pdf.buffer)
    await storage.clear()
    expect(directory.exists).toBe(false)
    await storage.initialize()
    await storage.initialize()
    expect(directory.exists).toBe(true)
    expect(directory.list()).toEqual([])
  })

  it('goes with its replica, and its member’s folder with the last of theirs', async () => {
    const [own, second] = [filesOf(member, home), filesOf(member, households.other.id)]
    const others = filesOf(ids.otherMember, home)
    for (const directory of [own, second, others]) {
      const storage = fileStorage(directory)
      await storage.saveFile(storage.getLocalUri(row), pdf.buffer)
    }
    removeFiles(member, home)
    expect(own.exists).toBe(false)
    // The member keeps another replica's files, and so their folder.
    expect(second.exists).toBe(true)
    removeFiles(member, households.other.id)
    expect(second.parentDirectory.exists).toBe(false)
    expect(others.exists).toBe(true)
    // One that was never made is no failure to remove.
    expect(() => {
      removeFiles(member, home)
    }).not.toThrow()
  })
})

describe('a file that is sent', () => {
  /** A stored file, and an upload that answers as `answer` does. */
  async function stored(answer: () => Promise<UploadResult>) {
    const storage = fileStorage(filesOf(member, home))
    const uri = storage.getLocalUri(row)
    await storage.saveFile(uri, pdf.buffer)
    const upload = jest.spyOn(File.prototype, 'upload').mockImplementation(answer)
    const told: Problem[] = []
    const problems = createProblemHub()
    problems.subscribe((problem) => told.push(problem))
    const file = { uri, contentType: 'application/pdf', fileName: 'r.pdf' }
    return { upload, told, file, send: uploadByUri({ problems }) }
  }

  const url = 'https://api.household.test/api/v1/households/h/documents/d/content'

  it('is sent from where it waits: a multipart form whose `file` field it is, named and signed', async () => {
    const { upload, send, file } = await stored(() =>
      Promise.resolve({ status: 201, headers: { 'content-type': 'application/json' }, body: '{}' }),
    )
    const response = await send(url, 'access-a', file, unused)
    expect(upload).toHaveBeenCalledTimes(1)
    // The file itself is what uploads: nothing read its bytes to hand them over.
    expect(upload.mock.contexts[0]).toMatchObject({ uri: file.uri })
    expect(upload.mock.calls[0]).toEqual([
      url,
      {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'application/pdf',
        headers: {
          Authorization: 'Bearer access-a',
          'Household-Client': expect.stringMatching(/^mobile\/\d+\.\d+\.\d+$/),
        },
        sessionType: 'foreground',
      },
    ])
    expect(response.ok).toBe(true)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({})
  })

  it('hands a refusal back whole: its status, its headers and the problem it carries', async () => {
    const { send, file, told } = await stored(() =>
      Promise.resolve({
        status: 429,
        headers: { 'retry-after': '120', 'content-type': 'application/problem+json' },
        body: JSON.stringify({ code: 'rate_limited' }),
      }),
    )
    const response = await send(url, 'access-a', file, unused)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('120')
    expect(await response.json()).toEqual({ code: 'rate_limited' })
    expect(told).toEqual([])
  })

  it('answers with no body where the server sent none', async () => {
    const { send, file } = await stored(() =>
      Promise.resolve({ status: 204, headers: {}, body: '' }),
    )
    const response = await send(url, 'access-a', file, unused)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('tells the app where the server answers that this build is too old, and still hands the answer on', async () => {
    const problem = {
      type: 'https://household.example/problems/update_required',
      title: 'update_required',
      status: 400,
      code: 'update_required',
      minimum_version: '9.0.0',
    }
    const { send, file, told } = await stored(() =>
      Promise.resolve({ status: 400, headers: {}, body: JSON.stringify(problem) }),
    )
    const response = await send(url, 'access-a', file, unused)
    expect(told).toMatchObject([{ code: 'update_required', minimum_version: '9.0.0' }])
    expect(await response.json()).toEqual(problem)
  })

  it('tells nobody of a `400` that is the file’s own, or that is no problem at all', async () => {
    const validation = await stored(() =>
      Promise.resolve({
        status: 400,
        headers: {},
        body: JSON.stringify({ code: 'validation_failed', status: 400 }),
      }),
    )
    await validation.send(url, 'access-a', validation.file, unused)
    expect(validation.told).toEqual([])
    jest.restoreAllMocks()
    const proxy = await stored(() =>
      Promise.resolve({ status: 400, headers: {}, body: '<html>Bad Request</html>' }),
    )
    const response = await proxy.send(url, 'access-a', proxy.file, unused)
    expect(proxy.told).toEqual([])
    expect(await response.text()).toBe('<html>Bad Request</html>')
  })

  it('rejects where the request got no answer, for the queue to count and try again', async () => {
    const { send, file } = await stored(() => Promise.reject(new Error('Unable to upload')))
    await expect(send(url, 'access-a', file, unused)).rejects.toThrow('Unable to upload')
  })
})
