// Where *please update* leads (06-clients §7, A-21): the app's own page in the store of the
// device it runs on. A build is told the page for each platform (`extra.storeUrl`), and one that
// was told none has no control to draw: a control that cannot act is absent.
//
// A store's update is the only one that lifts the refusal, because it is the only update there
// is: the app links nothing that replaces its JavaScript alone. The version the server holds a
// client to is the one the app names itself by (api/client.ts), which is read from this
// package's manifest as the bundle is made and so is in the bundle: an update of the
// JavaScript alone would change it, and name a version whose native half is still the old one.
import { Linking, Platform } from 'react-native'
import { buildSettings, setting } from '../api/client.ts'

/** The store page of this build on `os`, or undefined where the build was told none. */
export function storeUrl(
  extra: unknown = buildSettings(),
  os: string = Platform.OS,
): string | undefined {
  return setting(extra, 'storeUrl', os)
}

/**
 * Opens the store at the app's page. It rejects where the device has nothing that opens the
 * address, which its caller says.
 */
export async function openStore(url: string): Promise<void> {
  await Linking.openURL(url)
}
