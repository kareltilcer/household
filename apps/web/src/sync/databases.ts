// The replicas this browser keeps, as databases: each household's is one IndexedDB database
// (@household/sync/web, D-4), named for the household. This file knows their names and removes
// them, with nothing of the SDK's imported: a member who signs out, or whose session ended, has
// what this browser kept of their households removed whether or not a replica was ever opened on
// this page (session/SessionProvider.tsx).

const prefix = 'household-'
const suffix = '.db'

/** The database a household's replica is kept in. */
export function replicaDatabase(household: string): string {
  return `${prefix}${household.toLowerCase()}${suffix}`
}

const named = /^household-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/

/** Whether `name` is a replica's database, by its name. The persisted cache's is not. */
export function isReplicaDatabase(name: string): boolean {
  return named.test(name)
}

/** Where the households whose replicas this browser opened are listed, for a browser that lists no databases. */
const opened = 'household.replicas'

function listed(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(opened) ?? '[]')
    return Array.isArray(value) ? value.filter((name) => typeof name === 'string') : []
  } catch {
    return []
  }
}

/** Notes that this browser keeps a replica of `household`, before it is opened. */
export function noteReplica(household: string): void {
  const name = replicaDatabase(household)
  const known = listed()
  if (known.includes(name)) return
  try {
    window.localStorage.setItem(opened, JSON.stringify([...known, name]))
  } catch {
    // The browser's own list of its databases is all there is.
  }
}

/**
 * Removes every replica this browser keeps. A database that is open, in this tab or another, is
 * removed once it has been closed, and whatever asks to open it meanwhile waits for that: the
 * removal is asked for here and not waited on, since a tab that never closes its replica would
 * otherwise hold up the sign-in that follows.
 */
export async function forgetReplicas(): Promise<void> {
  const names = new Set(listed().filter(isReplicaDatabase))
  try {
    // Every browser the app supports lists its databases; the note above is for one that fails to.
    for (const { name } of await window.indexedDB.databases()) {
      if (name !== undefined && isReplicaDatabase(name)) names.add(name)
    }
  } catch {
    // The databases that were noted are the ones removed.
  }
  for (const name of names) {
    try {
      window.indexedDB.deleteDatabase(name)
    } catch {
      // A browser that refuses storage keeps no replica either.
    }
  }
  try {
    window.localStorage.removeItem(opened)
  } catch {
    // Nothing was noted there.
  }
}
