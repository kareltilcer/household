// How a file is uploaded on Node and in a browser: a multipart form, the file as its `file` field,
// which the files pipeline receives (files.Receive). React Native's FormData takes a file by its URI,
// and its app sends its own way.

import type { UploadTransport } from './attachments.ts'

export const multipart: UploadTransport = (url, credential, file, fetch) => {
  const form = new FormData()
  form.append('file', new Blob([file.data], { type: file.contentType }), file.fileName)
  return fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}` },
    body: form,
  })
}
