// Whether the device says it has a connection: what the offline bar is drawn by (A-37), and what
// a body that is read from the server calls offline (household/data.ts). It is the device's own
// word, which is wrong in one direction alone, as a browser's is: connected, with no way to the
// server. A request's own failure says that, and with the sync service alone away, the replica's
// own status does (D-105). Whether the internet can be reached is not asked here: what the
// device says of that it works out by asking a host that is none of the app's.
//
// Until the device has said, it is taken to have a connection: nothing is drawn for a state
// nobody has reported. It is asked as this file is loaded, with the app, so that by the time a
// household is drawn the answer is the device's.
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { useSyncExternalStore } from 'react'

let online = true
const listeners = new Set<() => void>()

function hear(state: NetInfoState): void {
  // Not known is not offline.
  const next = state.isConnected !== false
  if (next === online) return
  online = next
  for (const listener of [...listeners]) listener()
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  // The device tells whoever starts listening what it knows now, and then of each change.
  const stop = NetInfo.addEventListener(hear)
  return () => {
    listeners.delete(notify)
    stop()
  }
}

void NetInfo.fetch().then(hear, () => undefined)

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => online)
}
