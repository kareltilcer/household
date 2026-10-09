// A client's version, as far as anything can be said of it (C-57; PRD 06 §7). A client names
// itself `MAJOR.MINOR.PATCH` with, for a web build, its build's id after a `+`
// (api/client.ts). Two things are told from that and no third: whether it is under the oldest
// version the deployment serves, by its three numbers alone as the server compares them, and
// whether a browser runs the very build this page is. Nothing says which version is the newest,
// so no client is ever *behind*.

/** The three numbers `version` begins with, or undefined where it does not begin with three. */
export function numbersOf(version: string): readonly [number, number, number] | undefined {
  const found = /^(\d+)\.(\d+)\.(\d+)(?![\d.])/.exec(version.trim())
  if (found === null) return undefined
  return [Number(found[1]), Number(found[2]), Number(found[3])]
}

/**
 * Whether `version` is under `minimum`: by their three numbers, a pre-release or build suffix
 * read past. A version or a minimum that is not three numbers is under nothing: what cannot be
 * compared is not said to be refused.
 */
export function isUnder(version: string, minimum: string): boolean {
  const own = numbersOf(version)
  const least = numbersOf(minimum)
  if (own === undefined || least === undefined) return false
  for (const index of [0, 1, 2] as const) {
    if (own[index] !== least[index]) return own[index] < least[index]
  }
  return false
}

/**
 * This page's own version as a report of it names it: what `clientName()` says after its type,
 * `0.1.0+008f0f94379a5b41`, or the version alone for a page no build made.
 */
export function ownVersion(clientName: string): string {
  return clientName.slice(clientName.indexOf('/') + 1)
}
