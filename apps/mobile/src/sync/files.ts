// A replica's waiting files on a device (D-25, ADR 0019): where a file taken offline is kept
// until the server holds its row, and how it is sent then. Both are the app's: the library
// ships neither for React Native.
//
// A file waits in the app's own sandbox, in a directory of its replica's (databases.ts), under
// the id of the row it belongs to. It is sent from there, by where it is: the library hands the
// transport its place and none of its bytes, and `expo-file-system` uploads it from disk, a
// multipart form whose `file` field it is (files.Receive). A file may be a hundred megabytes
// (FR-FL1), and nothing here or in the queue holds one whole.
//
// It is not sent through the `fetch` the replica's other requests leave by. On a device that is
// Expo's (`expo/fetch`), which builds every body in memory and takes no file by its place, and
// React Native's own, which does, builds the whole form in memory on iOS. So this request names
// the app itself, and tells the app itself where the server answers that this build is too old
// (api/client.ts does both for every other).
//
// The form's part is named for the file as it is stored, which is its row's id: the upload
// names a part by the path it sends and by nothing else. The row carries the file's own name,
// and has reached the server before its bytes are sent.
import { readProblem } from '@household/api'
import type { AttachmentOptions, StoredTransport } from '@household/sync'
import { Directory, File, Paths, UploadType } from 'expo-file-system'
import { clientName } from '../api/client.ts'
import type { ProblemHub } from '../api/problems.ts'
import { replicaFiles } from './databases.ts'

/** The directory a member's replica of a household keeps its waiting files in. */
export function filesOf(member: string, household: string): Directory {
  return new Directory(Paths.document, ...replicaFiles(member, household))
}

/** `bytes` as a buffer of its own: what a view was cut from may be longer than it. */
function bufferOf(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/** Where a replica's files wait: `directory`, as the library's queue asks for it. */
export function fileStorage(directory: Directory): AttachmentOptions['storage'] {
  const make = (made: Directory) => {
    made.create({ intermediates: true, idempotent: true })
  }
  return {
    initialize: () => {
      make(directory)
      return Promise.resolve()
    },
    getLocalUri: (filename) => new File(directory, filename).uri,
    saveFile: (path, data) => {
      const file = new File(path)
      file.create({ intermediates: true, overwrite: true })
      file.write(typeof data === 'string' ? data : new Uint8Array(data))
      return Promise.resolve(file.size)
    },
    // The way out reads nothing (the transport below is handed the file's place): this is for
    // whoever asks for a file's bytes by name.
    readFile: async (path) => bufferOf(await new File(path).bytes()),
    deleteFile: (path) => {
      const file = new File(path)
      if (file.exists) file.delete()
      return Promise.resolve()
    },
    fileExists: (path) => Promise.resolve(new File(path).exists),
    makeDir: (path) => {
      make(new Directory(path))
      return Promise.resolve()
    },
    rmDir: (path) => {
      const gone = new Directory(path)
      if (gone.exists) gone.delete()
      return Promise.resolve()
    },
    clear: () => {
      if (directory.exists) directory.delete()
      return Promise.resolve()
    },
  }
}

/**
 * Deletes the directory a replica's files waited in, with whatever is still in it, and its
 * member's own once nothing of theirs is left there.
 */
export function removeFiles(member: string, household: string): void {
  const directory = filesOf(member, household)
  if (directory.exists) directory.delete()
  const members = directory.parentDirectory
  if (members.exists && members.list().length === 0) members.delete()
}

export interface UploadOptions {
  /** Where a problem that is about the app, and not about the file, is told. */
  readonly problems: ProblemHub
}

/**
 * Sends a file from where it waits. An answer, whatever it is, is handed back as a response the
 * queue reads as any other; a file that could not be read and a request that got no answer
 * reject, which the queue counts as a try and makes again.
 */
export function uploadByUri({ problems }: UploadOptions): StoredTransport {
  return async (url, credential, file) => {
    const answer = await new File(file.uri).upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.contentType,
      headers: { Authorization: `Bearer ${credential}`, 'Household-Client': clientName() },
      // A run of the queue is the app's own, while it is open: a transfer that outlived it
      // would be answered to nobody, and its file sent whole again at the next run.
      sessionType: 'foreground',
    })
    if (answer.status === 400) {
      let body: unknown
      try {
        body = JSON.parse(answer.body)
      } catch {
        // No problem document: whatever answered was not the API.
      }
      const problem = readProblem(answer.status, body)
      if (problem.code === 'update_required') problems.report(problem)
    }
    // An answer with no body is one with none, and not an empty one: a `204` takes no other.
    return new Response(answer.body === '' ? null : answer.body, {
      status: answer.status,
      headers: answer.headers,
    })
  }
}
