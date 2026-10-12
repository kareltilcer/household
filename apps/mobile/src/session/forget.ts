// The one removal of everything a device kept of a member (FR-ID7, D-156, D-161's twin on a
// device). What a device keeps is its member's, and for no longer than their sign-in: it is
// removed when they sign out, when their sign-in ends from elsewhere, and when another member
// signs in on the device before them. A sign-in that ended is how a lost phone is dealt with, so
// nothing is kept "for the member's return".
//
// Whatever keeps something of a member's says so here (`onForget`), once, as its module is
// loaded: the session's own, the reads it kept and what it holds in memory, and the replicas
// with their files, which sync/open.ts registers. What is the device's and no member's
// content stays: how the app is shown, the order a member gave their modules (D-155), which
// household they were last in, the installation's own id, and the address of the screen a
// sign-in ended under, which is held for whoever signs in next (links/destination.ts): an id
// and a screen's name, and no word of its member's.
//
// And it is removed whether or not the app was running when the sign-in went (D-161: "whether
// or not a page knew them when it ended"). A device that was closed between its pair's removal
// and the rest, one whose keystore lost a pair, and one restored from a backup, which carries
// what was kept and never the pair, each start with something kept of a member the device holds
// no sign-in of. So whoever keeps something that says whose it is also says whom it keeps
// something of (`kept`), and the session removes, as the app starts, what is kept of anybody it
// holds no sign-in of (`forgetOthers`).
type Forgetter = (member: string) => void | Promise<void>

/** The members a part of the app keeps something of, by their ids. */
type Kept = () => readonly string[] | Promise<readonly string[]>

interface Keeper {
  readonly forget: Forgetter
  readonly kept: Kept | undefined
}

const keepers = new Set<Keeper>()

/**
 * Adds to what is removed with a member: `forgetter` is called with their id each time one is
 * forgotten, until the function this returns is called. `kept` says whom it keeps something of,
 * where what it keeps is named for its member on the device: what `forgetOthers` goes by.
 */
export function onForget(forgetter: Forgetter, kept?: Kept): () => void {
  const keeper: Keeper = { forget: forgetter, kept }
  keepers.add(keeper)
  return () => {
    keepers.delete(keeper)
  }
}

/**
 * Removes everything this device kept of `member`. It never rejects: each part is removed
 * whatever became of another, and one that could not be removed is its own to try again.
 */
export async function forget(member: string): Promise<void> {
  const id = member.toLowerCase()
  await Promise.allSettled([...keepers].map(async (keeper) => keeper.forget(id)))
}

/**
 * Removes everything this device keeps of any member but those in `signedIn`: asked once, as the
 * app starts, with the members the device holds a sign-in of. It never rejects, and a part that
 * could not say whom it keeps something of is passed over until the next start.
 */
export async function forgetOthers(signedIn: readonly string[]): Promise<void> {
  const here = new Set(signedIn.map((member) => member.toLowerCase()))
  const said = await Promise.allSettled(
    [...keepers].map(async (keeper) => (keeper.kept === undefined ? [] : keeper.kept())),
  )
  const others = new Set<string>()
  for (const each of said) {
    if (each.status !== 'fulfilled') continue
    for (const member of each.value) {
      const id = member.toLowerCase()
      if (!here.has(id)) others.add(id)
    }
  }
  for (const member of others) await forget(member)
}
