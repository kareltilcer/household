// What a device's own HTTP cache holds of what the app was answered, as an emulator is asked
// for it (run.ts, `--cache`; D-197, ADR 0029). The client the app's `fetch` asks through keeps
// a cache on disk by itself, React Native's OkHttp client under the app's cache directory
// (`OkHttpClientProvider.kt`: `File(context.cacheDir, "http-cache")`, which Expo's
// `ExpoFetchModule.kt` builds its client from), and nothing of the app's empties it when a
// sign-in ends. What keeps it empty is the API's own header, `Cache-Control: no-store` on
// every answer: that the header is there is held on the server, and that a device's client
// heeds it is a device's to show.
//
// The folder is the app's own, and a release build lets nobody else read it (no `run-as`): the
// emulator is asked as root, by `su`, which the image CI boots has (`target: default`) and one
// with Google Play has not. Not by `adb root`, which starts the device's adb again, under
// whatever is following its log and before the suite's flows *(that `su` is there and takes a
// command so was recalled of Android's own images; CI's seventeenth run, 38178021709, showed
// it: root answered, and the folder was there)*.
//
// What OkHttp writes there is recalled, its source being in no file of the repository: a
// `journal` (with `journal.tmp` and `journal.bkp` while it is rewritten) from the client's
// first `GET` on, and two files an answer it keeps, `<key>.0` for what the answer was of, whose
// first line is its address, and `<key>.1` for its body, each `.tmp` while it is written.

/** The folder React Native's OkHttp client keeps its cache in, for the app `appId` names. */
export function folderOf(appId: string): string {
  // It goes into a line a shell reads, and an application's id is letters, digits and dots.
  if (!/^[A-Za-z]\w*(\.[A-Za-z]\w*)+$/.test(appId)) {
    throw new Error(`cache: ${JSON.stringify(appId)} is no application's id`)
  }
  return `/data/data/${appId}/cache/http-cache`
}

/**
 * What the device's shell is asked (`adb shell <this>`): who answers, which must be root, then
 * the folder itself where it is there, and every file in it. A folder that is not there is
 * asked nothing more: a client that has kept nothing has made none.
 */
export function asking(appId: string): string {
  const folder = folderOf(appId)
  return `su 0 sh -c 'id -u; [ -d ${folder} ] || exit 0; echo ${folder}; find ${folder} -type f'`
}

/**
 * What the device's shell is asked for what the kept answers were of: the first line of each
 * entry's own file. Only where there is one, to say which route's answer it is.
 */
export function naming(appId: string): string {
  return `su 0 sh -c 'for entry in ${folderOf(appId)}/*.0; do head -n 1 "$entry"; done'`
}

export interface Held {
  /** Whether the folder is there: where it is not, the client has kept no cache at all. */
  readonly there: boolean
  /** The files in it that are an answer's, or part of one: every file but the journal's own. */
  readonly answers: string[]
}

const lines = (written: string): string[] =>
  written
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

/**
 * What the cache holds, read off what the device wrote for `asking`. Undefined where it was
 * not root that answered, or nobody: a folder nobody was let into reads as an empty one, and
 * is not taken for it.
 */
export function held(appId: string, written: string): Held | undefined {
  const [who, ...rest] = lines(written)
  if (who !== '0') return undefined
  const folder = folderOf(appId)
  const journal = /^journal(\.tmp|\.bkp)?$/
  return {
    there: rest[0] === folder,
    answers: rest.filter(
      (file) => file.startsWith(`${folder}/`) && !journal.test(file.slice(folder.length + 1)),
    ),
  }
}

/**
 * The addresses the device wrote for `naming`, each without its query: a link the object store
 * signed carries its signature there, and a job's log is public.
 */
export function addresses(written: string): string[] {
  return lines(written).map((address) => address.replace(/\?.*$/, '?…'))
}
