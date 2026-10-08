// The address a visitor opened before they had signed in (04-navigation §8, the cold start): it is
// held while they sign in, through a second step or a provider's pages and back, and opened once
// they are in. Kept in this tab's own storage, so that it survives the provider's redirect and
// belongs to no other tab; a browser that refuses storage holds it for the page's life.
import { isOwnPath } from '../app/paths.ts'

const key = 'household.destination'

let inMemory: string | null = null

/** Holds `path`, the address to open after signing in. Anything but a path of the app's is not held. */
export function holdDestination(path: string): void {
  if (!isOwnPath(path)) return
  inMemory = path
  try {
    window.sessionStorage.setItem(key, path)
  } catch {
    // Held for this page alone.
  }
}

/** The address held, or null where none is. */
export function heldDestination(): string | null {
  try {
    const stored = window.sessionStorage.getItem(key)
    if (stored !== null && isOwnPath(stored)) return stored
  } catch {
    // What this page holds itself is all there is.
  }
  return inMemory
}

/** The address held, which is held no longer: it is opened once. */
export function takeDestination(): string | null {
  const held = heldDestination()
  inMemory = null
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // Nothing was kept there.
  }
  return held
}
