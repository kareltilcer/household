// Where a device keeps what signs it in: the keychain on iOS and the keystore on Android,
// through expo-secure-store (PRD 01, FR-ID3). The token store reads and writes through this and
// nothing else does, so a test hands it a vault of its own.
//
// What is kept is this device's alone, and readable while it is unlocked: a token pair restored
// from a backup on to another phone would be one sign-in held by two devices, and the first
// renewal of either would end the other as a token used twice.
import * as SecureStore from 'expo-secure-store'

export interface Vault {
  /** What is kept under `key`, or null: where nothing is, and where the device will not say. */
  readonly get: (key: string) => Promise<string | null>
  /** Keeps `value` under `key`. It rejects where the device will not keep it. */
  readonly set: (key: string, value: string) => Promise<void>
  /** Removes what is kept under `key`. It never rejects: what cannot be reached is not there. */
  readonly remove: (key: string) => Promise<void>
}

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

/** The device's own. */
export function secureVault(): Vault {
  return {
    get: async (key) => {
      try {
        // A device that holds nothing under a key says null; whatever else it says is no value.
        const value: unknown = await SecureStore.getItemAsync(key, options)
        return typeof value === 'string' ? value : null
      } catch {
        // A keystore whose key was lost, as after a restore, reads as holding nothing.
        return null
      }
    },
    set: async (key, value) => {
      await SecureStore.setItemAsync(key, value, options)
    },
    remove: async (key) => {
      try {
        await SecureStore.deleteItemAsync(key, options)
      } catch {
        // It was not there to remove.
      }
    },
  }
}

/** A vault in memory: a test's, and what a component test's session is kept in. */
export function memoryVault(kept: Readonly<Record<string, string>> = {}): Vault & {
  /** Everything it holds, by key. */
  readonly held: () => Readonly<Record<string, string>>
} {
  const items = new Map(Object.entries(kept))
  return {
    get: (key) => Promise.resolve(items.get(key) ?? null),
    set: (key, value) => {
      items.set(key, value)
      return Promise.resolve()
    },
    remove: (key) => {
      items.delete(key)
      return Promise.resolve()
    },
    held: () => Object.fromEntries(items),
  }
}
