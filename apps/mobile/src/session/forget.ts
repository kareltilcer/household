// The one removal of everything a device kept of a member (FR-ID7, D-156, D-161's twin on a
// device). What a device keeps is its member's, and for no longer than their sign-in: it is
// removed when they sign out, when their sign-in ends from elsewhere, and when another member
// signs in on the device before them. A sign-in that ended is how a lost phone is dealt with, so
// nothing is kept "for the member's return".
//
// Whatever keeps something of a member's says so here (`onForget`), once, as its module is
// loaded: the session's own, the reads it kept and what it holds in memory, and the replicas
// with their files, which sync/open.ts registers. What is the device's and no member's
// content stays: how the app is shown, the order a member gave their modules (D-155), and which
// household they were last in.
type Forgetter = (member: string) => void | Promise<void>

const forgetters = new Set<Forgetter>()

/**
 * Adds to what is removed with a member: `forgetter` is called with their id each time one is
 * forgotten, until the function this returns is called.
 */
export function onForget(forgetter: Forgetter): () => void {
  forgetters.add(forgetter)
  return () => {
    forgetters.delete(forgetter)
  }
}

/**
 * Removes everything this device kept of `member`. It never rejects: each part is removed
 * whatever became of another, and one that could not be removed is its own to try again.
 */
export async function forget(member: string): Promise<void> {
  const id = member.toLowerCase()
  await Promise.allSettled([...forgetters].map(async (forgetter) => forgetter(id)))
}
