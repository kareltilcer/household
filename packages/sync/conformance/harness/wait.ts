// Waiting on a system the suite does not clock: PowerSync replicates in its own time, so a state
// is waited for by looking again until it holds or a deadline passes.

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** How often a waited-for state is looked at again. */
export const pollMs = 100

/**
 * Looks at holds until it returns true, first at once and then every pollMs, and returns how long
 * it took, or null when timeoutMs passed first. Waiting is not asserting: the caller decides what
 * a state that never came means, and the invariants report it.
 */
export async function until(holds: () => Promise<boolean>, timeoutMs: number): Promise<number | null> {
  const start = Date.now()
  for (;;) {
    if (await holds()) return Date.now() - start
    if (Date.now() - start >= timeoutMs) return null
    await sleep(pollMs)
  }
}
