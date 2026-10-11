// The replicas this device keeps, by name, and their removal (FR-ID7, D-156, D-161's twin). A
// replica is one member's copy of one household: its SQLite file and the directory its waiting
// files are in are named for the member and the household both, where the web's are named for
// the household alone. A shared tablet holds several profiles signed in at once (D-104), each
// seeing other rows, and a device removes a member's own whenever their sign-in ends, so the
// web's objection to the member in the name, a copy that stays until its member returns, does
// not hold here.
//
// What a device keeps is its member's for no longer than their sign-in (session/forget.ts). A
// browser is rid of a database it was asked to delete; a device is rid of a file only if the
// deletion went through, so each replica is noted before it is opened, a member's are marked as
// leaving the moment their sign-in ends, and whatever could not be removed then is tried again
// at the next start. Removal is two steps, each kept once it is done: the replica is emptied
// (wiped through the library, which is the removal that counts), and then its file and its
// files' directory are deleted. One that could not be emptied has its file deleted all the
// same, and is gone if that went through. And a replica whose note could not be written is not
// opened at all.
//
// Notes the device will not read are never taken for no notes. Read as none, the next note
// written would be written over every other, and a replica with no note is one that nothing
// marks when its member's sign-in ends: its file would stay for good. So whatever reads the
// notes fails where they could not be read, and nothing is written over them.
//
// This file knows the names and keeps the notes, with nothing of the library's imported, nor of
// the file system's: what empties a replica and what deletes its files is handed in (open.ts).
import AsyncStorage from '@react-native-async-storage/async-storage'

/** The SQLite file a member's replica of a household is kept in. */
export function replicaDatabase(member: string, household: string): string {
  return `household.${member.toLowerCase()}.${household.toLowerCase()}.db`
}

/** Where a replica's waiting files are kept, as the folders under the app's own documents. */
export function replicaFiles(member: string, household: string): readonly [string, string, string] {
  return ['replicas', member.toLowerCase(), household.toLowerCase()]
}

/** A replica this device noted, and how far its removal has come. */
export interface KeptReplica {
  readonly member: string
  readonly household: string
  /** Its member's sign-in ended: it is to be removed, and is nobody's to open as it is. */
  readonly leaving?: true
  /** It was emptied: what is left of it is an empty file to delete. */
  readonly emptied?: true
}

/** What removes a replica, each step of it (open.ts). */
export interface Removal {
  /** Empties the replica, wherever it is open or not: wiped, and closed. */
  readonly empty: (member: string, household: string) => Promise<void>
  /** Deletes its database's file and the directory of its waiting files. */
  readonly remove: (member: string, household: string) => Promise<void>
}

/** Where the replicas this device keeps are noted. */
const notes = 'household.replicas'

function isKept(value: unknown): value is KeptReplica {
  if (typeof value !== 'object' || value === null) return false
  const { member, household } = value as Record<string, unknown>
  return typeof member === 'string' && typeof household === 'string'
}

/**
 * The notes, as the device holds them. It rejects where the device would not say what it holds,
 * which is not that it holds none; a note nobody could have written is no note.
 */
async function read(): Promise<KeptReplica[]> {
  const text = await AsyncStorage.getItem(notes)
  try {
    const value: unknown = JSON.parse(text ?? '[]')
    return Array.isArray(value) ? value.filter(isKept) : []
  } catch {
    return []
  }
}

/** Writes the notes, and answers whether the device kept them. */
async function write(kept: readonly KeptReplica[]): Promise<boolean> {
  try {
    if (kept.length === 0) await AsyncStorage.removeItem(notes)
    else await AsyncStorage.setItem(notes, JSON.stringify(kept))
    return true
  } catch {
    // A device that keeps no note keeps what it noted before: the next start reads that.
    return false
  }
}

function same(one: KeptReplica, member: string, household: string): boolean {
  return one.member === member.toLowerCase() && one.household === household.toLowerCase()
}

// One step at a time: a note read and written again, and a removal, are never interleaved with
// another's, and a replica is not opened while one of its name is being removed.
let last: Promise<unknown> = Promise.resolve()
function inTurn<Answer>(step: () => Promise<Answer>): Promise<Answer> {
  const answer = last.then(step, step)
  last = answer.catch(() => undefined)
  return answer
}

/** Removes `replica` as far as it goes, and answers what is left to note of it: nothing, once it is gone. */
async function leave(replica: KeptReplica, removal: Removal): Promise<KeptReplica | null> {
  let left = replica
  if (left.emptied !== true) {
    try {
      await removal.empty(left.member, left.household)
      left = { ...left, emptied: true }
    } catch {
      // It could not be emptied, and its file is deleted all the same. A wipe that fails may fail
      // at every start, on a device with no room left or over a file that is damaged: left for
      // the wipe alone, the rows would stay for good, and so would the household be shut to its
      // member, for whom it is not opened while it holds what an ended sign-in left.
    }
  }
  try {
    await removal.remove(left.member, left.household)
    return null
  } catch {
    // Kept as far as it came: the next start goes on from there.
    return left
  }
}

/**
 * Removes every replica that is leaving, one after another, noting each as it goes. It rejects
 * where the notes could not be read to begin with: nothing is known to be leaving.
 */
async function removeLeaving(removal: Removal): Promise<void> {
  for (const replica of await read()) {
    if (replica.leaving !== true) continue
    const left = await leave(replica, removal)
    // Noted over the notes as they are now, and not at all where the device will not say what
    // they are: this one stays noted as leaving, and the next start finds how far it came.
    const kept = await read().catch(() => undefined)
    if (kept === undefined) continue
    await write(
      kept.flatMap((each) =>
        same(each, replica.member, replica.household) ? (left === null ? [] : [left]) : [each],
      ),
    )
  }
}

/**
 * Marks every replica of `member` as leaving: their sign-in has ended. It answers once that is
 * noted, which is all a sign-out waits for; the removal itself is `removeLeft`'s. It rejects
 * where the notes could not be read, and nothing is marked: the next start, which holds no
 * sign-in of theirs, marks them (session/forget.ts).
 */
export function markLeaving(member: string): Promise<void> {
  const id = member.toLowerCase()
  return inTurn(async () => {
    const kept = await read()
    if (!kept.some((each) => each.member === id && each.leaving !== true)) return
    await write(kept.map((each) => (each.member === id ? { ...each, leaving: true } : each)))
  })
}

/**
 * Removes what is marked as leaving: asked as a sign-in ends, and again as the app starts, for
 * whatever a run before this one could not remove. It never rejects: notes that could not be
 * read are read at the next start.
 */
export function removeLeft(removal: Removal): Promise<void> {
  return inTurn(() => removeLeaving(removal).catch(() => undefined))
}

/**
 * Notes that `member` keeps a replica of `household` from now on, before it is opened, and
 * answers whether it may be opened. One that is still leaving is removed first; where that
 * leaves it emptied, an empty file, it is the member's to open again, and where it could be
 * neither emptied nor deleted it holds what an ended sign-in left and is not opened. Nor is one
 * whose note the device would not keep: a replica with no note is one that nothing marks when
 * its member's sign-in ends, and that nothing would ever remove. It rejects where the notes
 * could not be read, and the replica is not opened then either: its note would be written over
 * every other.
 */
export function claimReplica(
  member: string,
  household: string,
  removal: Removal,
): Promise<boolean> {
  return inTurn(async () => {
    await removeLeaving(removal)
    const kept = await read()
    const found = kept.find((each) => same(each, member, household))
    if (found?.leaving === true && found.emptied !== true) return false
    // Noted already as its member's to keep: nothing is written, so a device that will write
    // nothing just now does not shut a replica it holds the note of.
    if (found !== undefined && found.leaving !== true) return true
    const mine: KeptReplica = { member: member.toLowerCase(), household: household.toLowerCase() }
    return write([...kept.filter((each) => !same(each, member, household)), mine])
  })
}

/**
 * The replicas this device has noted. Whose they are is what the session goes by as the app
 * starts, to remove what is kept of a member it holds no sign-in of (session/forget.ts, through
 * open.ts); a test reads the notes themselves. It rejects where they could not be read, which
 * the session passes over until the next start.
 */
export function keptReplicas(): Promise<KeptReplica[]> {
  return inTurn(read)
}
