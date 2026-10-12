// Where the display modes are kept on a device: AsyncStorage, under one key, as one JSON object.
// They outlive a sign-out: they are the device's, and nobody's account's (D-155's neighbour). A
// device that will not give or take them keeps none, and the modes last as long as the app is
// open.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { defaults, parsePreferences, storageKey, type DisplayPreferences } from './modes.ts'

/** The modes this device keeps, read before the first screen is drawn (app/Root.tsx). */
export async function readPreferences(): Promise<DisplayPreferences> {
  try {
    return parsePreferences(await AsyncStorage.getItem(storageKey))
  } catch {
    return defaults
  }
}

export function writePreferences(preferences: DisplayPreferences): void {
  AsyncStorage.setItem(storageKey, JSON.stringify(preferences)).catch(() => undefined)
}
