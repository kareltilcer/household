// A device with no connection, through the providers the app stands in and the index it opens
// at: a read asked without a connection is not sent, it waits; where nothing is kept of it that
// is drawn as could not be read, never as a wait; and it is asked when the connection returns.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react-native'
import { createKeep } from '../api/keep.ts'
import { createQueryClient } from '../api/query.ts'
import { answering, json, testClient, type Answering } from '../api/testing.ts'
import { Home } from '../app/Home.tsx'
import { inHousehold } from '../app/paths.ts'
import { households, ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { meKey } from './context.ts'
import { account } from './fixture.tsx'
import { createServices, SessionProviders } from './Providers.tsx'
import { vaultKeys } from './tokens.ts'
import { memoryVault } from './vault.ts'

// The router's own: a redirect is drawn as where it leads.
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react')
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    Redirect: ({ href }: { readonly href: string }) =>
      createElement(View, { testID: `redirect:${href}` }),
    usePathname: () => '/',
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  }
})

// The device's own notifications are not this file's.
jest.mock('../push/device.ts', () => ({
  permission: jest.fn(() => Promise.resolve('default')),
  requestPermission: jest.fn(() => Promise.resolve('default')),
  ensureChannel: jest.fn(() => Promise.resolve()),
  expoToken: jest.fn(() => Promise.reject(new Error('no token is asked for here'))),
  showWhileOpen: jest.fn(),
  onPressed: jest.fn(() => () => undefined),
}))

const eva = account()
const offline = { isConnected: false, isInternetReachable: false } as NetInfoState
const online = { isConnected: true, isInternetReachable: true } as NetInfoState
/** A device that has not found out yet, as it starts. */
const unknown = { isConnected: null, isInternetReachable: null } as NetInfoState

/** What the device is told of its connection, as a test says it. */
let tell: (state: NetInfoState) => void = () => undefined
const stopped = jest.fn()

/** The device says `first` as soon as it is asked, and whatever a test tells it after. */
function connection(first: NetInfoState): void {
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    tell = listener
    listener(first)
    return stopped
  })
}

/** Starts the app at its index, on a device that holds `eva`'s sign-in. */
async function start(): Promise<Answering> {
  const api = answering({
    'GET /me': () => json(200, eva),
    'GET /households': () => json(200, { items: [households.own] }),
  })
  const services = createServices({
    vault: memoryVault({
      [vaultKeys.signIns]: JSON.stringify({ active: ids.member, members: [ids.member] }),
      [vaultKeys.signIn(ids.member)]: JSON.stringify({
        access: 'access-a',
        refresh: 'refresh-a',
        expires_at: Date.now() + 900_000,
      }),
    }),
    client: (bearer) => testClient(api.transport, bearer === undefined ? {} : { bearer }),
  })
  // A read still being answered as a test ends would be held for a day by a timer.
  const { queries } = services.queries.getDefaultOptions()
  services.queries.setDefaultOptions({ queries: { ...queries, gcTime: Infinity } })
  await render(
    <SessionProviders services={services}>
      <Home />
    </SessionProviders>,
  )
  await settled()
  return api
}

/**
 * Lets what follows of itself happen where React is watching: the device is read, the account
 * is asked for where there is a connection, and the index asks the device where its member was
 * last.
 */
async function settled(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25)
    })
  })
}

/** The connection returns. */
async function returns(): Promise<void> {
  await act(() => {
    tell(online)
  })
  await settled()
}

/** The app has opened: the index leads to its member's household. */
async function opened(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(`redirect:${inHousehold.home(ids.household)}`)).toBeOnTheScreen()
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  jest.clearAllMocks()
  jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  onlineManager.setOnline(true)
})

describe('a read asked with no connection', () => {
  it('is not sent, and is drawn as could not be read where nothing is kept, never as a wait', async () => {
    connection(offline)
    const api = await start()
    await waitFor(() => {
      expect(
        screen.getByRole('header', { name: catalogs.en['session.unreachable.title'] }),
      ).toBeOnTheScreen()
    })
    expect(screen.getByText(catalogs.en['session.unreachable.body'])).toBeOnTheScreen()
    expect(screen.queryByTestId('skeleton')).toBeNull()
    // It waits: nothing left the device.
    expect(api.asked).toEqual([])
  })

  it('is asked when the connection returns, and the app opens', async () => {
    connection(offline)
    const api = await start()
    await waitFor(() => {
      expect(screen.getByTestId('unread')).toBeOnTheScreen()
    })
    await returns()
    await opened()
    expect(api.sent('GET /me')).toHaveLength(1)
    expect(api.sent('GET /households')).toHaveLength(1)
  })

  it('draws what the device kept, and says of what it did not keep that it could not be read', async () => {
    // The account was read on a run before this one; the households were not.
    const before = createQueryClient()
    const keep = createKeep(ids.member)
    const stop = keep.watch(before)
    before.setQueryData(meKey, eva, { updatedAt: Date.now() - 5 * 60_000 })
    await keep.flush()
    stop()
    before.clear()

    connection(offline)
    const api = await start()
    await waitFor(() => {
      expect(
        screen.getByRole('header', { name: catalogs.en['shell.households.error.title'] }),
      ).toBeOnTheScreen()
    })
    expect(api.asked).toEqual([])
    await returns()
    await opened()
  })
})

describe('what the device says of its connection', () => {
  // Believed in one direction only: one that says it has none has none.
  it('is taken for a connection where the device does not know yet', async () => {
    connection(unknown)
    const api = await start()
    await opened()
    expect(api.sent('GET /me')).toHaveLength(1)
    expect(onlineManager.isOnline()).toBe(true)
  })

  it('is heard at each change', async () => {
    connection(online)
    const api = await start()
    await opened()
    expect(onlineManager.isOnline()).toBe(true)
    await act(() => {
      tell(offline)
    })
    expect(onlineManager.isOnline()).toBe(false)
    // And what had gone stale meanwhile is asked for again.
    const before = api.sent('GET /households').length
    await returns()
    expect(onlineManager.isOnline()).toBe(true)
    await waitFor(() => {
      expect(api.sent('GET /households').length).toBeGreaterThan(before)
    })
    await settled()
  })

  it('is listened to for as long as the app’s providers stand', async () => {
    connection(offline)
    const api = answering({})
    const services = createServices({
      vault: memoryVault(),
      client: () => testClient(api.transport),
    })
    const view = await render(
      <SessionProviders services={services}>
        <Home />
      </SessionProviders>,
    )
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1)
    expect(stopped).not.toHaveBeenCalled()
    await view.unmount()
    expect(stopped).toHaveBeenCalledTimes(1)
    // Told nothing from then on, the query client takes it that there is a connection.
    expect(onlineManager.isOnline()).toBe(true)
  })
})
