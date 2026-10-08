// Whether the browser says it has a connection: what the offline bar is drawn by (A-37), and what
// a screen whose writes are asked at once says before its member presses. It is the browser's own
// word, which is wrong in one direction alone: online with no way to the server. A request's own
// failure says that.
import { useSyncExternalStore } from 'react'

function subscribeToConnection(notify: () => void): () => void {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeToConnection, () => window.navigator.onLine)
}
