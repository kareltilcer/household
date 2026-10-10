// The address somebody was on their way to before they had signed in (04-navigation §8, the
// cold start): a pressed notification's, a link's, or the screen a sign-in ended under. It is
// held while they sign in and opened once they are in. Held in memory, and kept on the device
// until it is taken: signing in may take them out of the app, to a password manager or a
// provider's own screen, and the system may close an app that is not in front.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useSyncExternalStore } from 'react'
import { isOwnPath } from '../app/paths.ts'

export const destinationKey = 'household.destination'

let held: string | null = null
const listeners = new Set<() => void>()

function set(path: string | null): void {
  if (held === path) return
  held = path
  for (const listener of [...listeners]) listener()
  const written =
    path === null
      ? AsyncStorage.removeItem(destinationKey)
      : AsyncStorage.setItem(destinationKey, path)
  // Held for this run alone, where the device will not keep it.
  written.catch(() => undefined)
}

/**
 * Reads the address the device kept from a run before this one: asked once, as the app starts,
 * before anybody is known to be signed in. One held since the start stands.
 */
export async function restoreDestination(): Promise<void> {
  try {
    const kept = await AsyncStorage.getItem(destinationKey)
    if (held === null && kept !== null && isOwnPath(kept)) {
      held = kept
      for (const listener of [...listeners]) listener()
    }
  } catch {
    // What this run holds itself is all there is.
  }
}

/** Holds `address`, the one to open after signing in. Anything but a path of the app's is not held. */
export function holdDestination(address: string): void {
  if (isOwnPath(address)) set(address)
}

/** The address held, or null where none is. */
export function heldDestination(): string | null {
  return held
}

/** The address held, which is held no longer: it is opened once. */
export function takeDestination(): string | null {
  const taken = held
  set(null)
  return taken
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The address held, for the sign-in screen, which says that signing in leads somewhere
 * (`device.links.destination`): it names no place, the address being no words.
 */
export function useHeldDestination(): string | null {
  return useSyncExternalStore(subscribe, heldDestination)
}
