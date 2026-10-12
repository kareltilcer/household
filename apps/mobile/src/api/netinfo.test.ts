// What the library that says whether the device has a connection asks of the network by
// itself, and that the app's one listener stops it (query.ts, `watchConnection`).
//
// The library runs here as it is published, its own JavaScript in the place of Jest's stand-in
// for it, with only its native half stood in for: one that answers as an iPhone's does, whether
// there is a connection and of what kind, and nothing of whether the internet can be reached
// (`ios/RNCNetInfo.mm`, read: its answer has a type, `isConnected` and details). Android's says
// that too, and the library then asks nobody. So what is run is the library's half and the
// app's; that an iPhone answers so is read, and nothing here is a device.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { NetInfoState } from '@react-native-community/netinfo'

jest.mock('@react-native-community/netinfo/src/internal/nativeModule', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    getCurrentState: jest.fn(() =>
      Promise.resolve({ type: 'wifi', isConnected: true, details: {} }),
    ),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
}))
jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/src/index.ts'),
)

interface Loaded {
  readonly NetInfo: (typeof import('@react-native-community/netinfo'))['default']
  readonly watchConnection: (typeof import('./query.ts'))['watchConnection']
  readonly onlineManager: (typeof import('@tanstack/react-query'))['onlineManager']
}

/**
 * The library as it comes, and the app's listener to it, each loaded anew: the library holds
 * what it was last configured as for as long as it is loaded, and what a test before this one
 * made of it would be this one's.
 */
function load(): Loaded {
  let loaded: Loaded | undefined
  jest.isolateModules(() => {
    loaded = {
      // By its own file: by its name it is Jest's stand-in for it (jest.config.js).
      NetInfo: jest.requireActual<typeof import('@react-native-community/netinfo')>(
        '@react-native-community/netinfo/src/index.ts',
      ).default,
      watchConnection:
        jest.requireActual<typeof import('./query.ts')>('./query.ts').watchConnection,
      onlineManager:
        jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
          .onlineManager,
    }
  })
  if (loaded === undefined) throw new Error('the library was not loaded')
  return loaded
}

/** Once the native half has answered and whoever listens has been told. */
const heard = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the library that says whether the device has a connection', () => {
  const platform = globalThis.fetch
  // Never answered: what is asked is all that is read.
  const asked = jest.fn<typeof globalThis.fetch>(() => new Promise(() => undefined))
  let library: Loaded['NetInfo'] | undefined

  beforeEach(() => {
    asked.mockClear()
    globalThis.fetch = asked
  })
  afterEach(() => {
    // Configuring it ends whatever it was waiting on: a check on its way asks again every few
    // seconds for as long as it gets no answer, and a run that failed here would never end.
    library?.configure({ reachabilityShouldRun: () => false })
    library = undefined
    globalThis.fetch = platform
  })

  // The reason for the line in `watchConnection`, held to the library as it is installed: a
  // release that asks another host, or none, fails here and is read again.
  it('asks a host that is none of the app’s as soon as anything listens, left as it comes', async () => {
    const { NetInfo } = load()
    library = NetInfo
    const told: NetInfoState[] = []
    const stop = NetInfo.addEventListener((state) => told.push(state))
    await heard()
    expect(told.at(-1)?.isConnected).toBe(true)
    // Once for each time the native half answered: the one before is given up as the next begins.
    expect(asked).toHaveBeenCalled()
    expect([...new Set(asked.mock.calls.map(([address]) => address))]).toEqual([
      'https://clients3.google.com/generate_204',
    ])
    stop()
  })

  it('asks nobody once the app listens, and the app is told of the connection all the same', async () => {
    const { NetInfo, watchConnection, onlineManager } = load()
    library = NetInfo
    const stopWatching = watchConnection()
    // Beside the app's own, to read what the library then says: a test's alone.
    const told: NetInfoState[] = []
    const stop = NetInfo.addEventListener((state) => told.push(state))
    await heard()
    expect(told.at(-1)?.isConnected).toBe(true)
    expect(asked).not.toHaveBeenCalled()
    expect(onlineManager.isOnline()).toBe(true)
    stop()
    stopWatching()
  })
})
