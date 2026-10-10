// Push on a device: what is asked of whom and when, what the server is told, and what a
// sign-out and a sign-in that ended take with them. The web's `push.test.tsx` is its twin; the
// device's own half is stood in for (device.ts has a test of its own).
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiClient } from '@household/api'
import { catalogs } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react-native'
import { useState, type ReactNode } from 'react'
import { createProblemHub } from '../api/problems.ts'
import {
  answering,
  empty,
  json,
  problem,
  testClient,
  testQueries,
  unanswered,
} from '../api/testing.ts'
import { account, SessionFixture } from '../session/fixture.tsx'
import { forget } from '../session/forget.ts'
import { ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { Text } from '../ui/Text.tsx'
import * as device from './device.ts'
import { Push } from './Push.tsx'
import {
  forgetPush,
  pushProject,
  pushTarget,
  readPushState,
  renewPush,
  requestPushPermission,
  subscribePush,
  unsubscribePush,
} from './registration.ts'
import { usePush, usePushPrompt, type Push as PushHook } from './usePush.ts'

jest.mock('./device.ts', () => ({
  permission: jest.fn(),
  requestPermission: jest.fn(),
  ensureChannel: jest.fn(() => Promise.resolve()),
  expoToken: jest.fn(),
  showWhileOpen: jest.fn(),
  onPressed: jest.fn(() => () => undefined),
}))

// The build this file runs as belongs to a project: what one that belongs to none does is
// asked of each function by handing it none.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { variant: 'development', eas: { projectId: 'a project' } } },
  },
}))

const token = 'ExponentPushToken[abc]'
const project = 'a project'
const channel = catalogs.en['device.push.channel']
const tokenKey = `household.push.token.${ids.member}`
const offKey = `household.push.off.${ids.member}`
const registered = () => json(201, { id: ids.device, transport: 'expo' })

function allows(permission: device.Permission) {
  jest.mocked(device.permission).mockResolvedValue(permission)
  jest.mocked(device.requestPermission).mockResolvedValue(permission)
  jest.mocked(device.expoToken).mockResolvedValue(token)
}

/** A server that takes registrations and removals. */
function server(routes: Parameters<typeof answering>[0] = {}) {
  const api = answering({
    'POST /push/subscriptions': registered,
    'DELETE /push/subscriptions': () => empty(),
    ...routes,
  })
  return { api, client: testClient(api.transport) }
}

function registration(client: ReturnType<typeof testClient>) {
  return { api: client, member: ids.member, device: ids.device, channel, project }
}

beforeEach(async () => {
  await AsyncStorage.clear()
  jest.clearAllMocks()
  allows('default')
})

describe('the project a build belongs to', () => {
  it('is what the build was told, or none', () => {
    expect(pushProject({ eas: { projectId: project } })).toBe(project)
    expect(pushProject({ variant: 'development' })).toBeUndefined()
    expect(pushProject(undefined)).toBe(project)
  })
})

describe('what a device says of notifications', () => {
  it('is that it is not set up, in a build that belongs to no project, and nothing is asked', async () => {
    allows('granted')
    expect(await readPushState(ids.member, undefined)).toEqual({
      permission: 'unsupported',
      subscribed: false,
    })
    expect(await requestPushPermission(channel, undefined)).toBe('unsupported')
    expect(device.permission).not.toHaveBeenCalled()
    expect(device.requestPermission).not.toHaveBeenCalled()
  })

  it.each(['default', 'denied'] as const)(
    'is read as %s, with nothing registered',
    async (permission) => {
      allows(permission)
      await AsyncStorage.setItem(tokenKey, token)
      expect(await readPushState(ids.member, project)).toEqual({ permission, subscribed: false })
      expect(device.requestPermission).not.toHaveBeenCalled()
    },
  )

  it('is subscribed only once the server was told of its token', async () => {
    allows('granted')
    expect(await readPushState(ids.member, project)).toEqual({
      permission: 'granted',
      subscribed: false,
    })
    const { client } = server()
    await subscribePush(registration(client))
    expect(await readPushState(ids.member, project)).toEqual({
      permission: 'granted',
      subscribed: true,
    })
    // And is one member's: another profile on the same tablet has its own.
    expect(await readPushState(ids.otherMember, project)).toMatchObject({ subscribed: false })
  })

  it('puts the system’s question only when it is asked to, under the channel’s name', async () => {
    allows('granted')
    expect(await requestPushPermission(channel, project)).toBe('granted')
    expect(device.requestPermission).toHaveBeenCalledWith(channel)
  })
})

describe('registering a device', () => {
  it('tells the server Expo’s token for the installation, and the device it is signed in on', async () => {
    allows('granted')
    const { api, client } = server()
    expect(await subscribePush(registration(client))).toEqual({
      permission: 'granted',
      subscribed: true,
    })
    expect(device.ensureChannel).toHaveBeenCalledWith(channel)
    expect(device.expoToken).toHaveBeenCalledWith(project)
    expect(api.sent('POST /push/subscriptions')[0]?.body).toEqual({
      transport: 'expo',
      endpoint: token,
      device_id: ids.device,
    })
    expect(await AsyncStorage.getItem(tokenKey)).toBe(token)
  })

  it('keeps nothing where the server could not be told, and says so', async () => {
    allows('granted')
    const { client } = server({ 'POST /push/subscriptions': unanswered })
    await expect(subscribePush(registration(client))).rejects.toThrow('Network request failed')
    expect(await AsyncStorage.getItem(tokenKey)).toBeNull()
  })

  it('undoes a member’s own turning off', async () => {
    allows('granted')
    await AsyncStorage.setItem(offKey, '1')
    const { client } = server()
    await subscribePush(registration(client))
    expect(await AsyncStorage.getItem(offKey)).toBeNull()
  })

  it('does nothing in a build that belongs to no project', async () => {
    allows('granted')
    const { api, client } = server()
    expect(await subscribePush({ ...registration(client), project: undefined })).toEqual({
      permission: 'unsupported',
      subscribed: false,
    })
    expect(api.asked).toEqual([])
    expect(device.expoToken).not.toHaveBeenCalled()
  })
})

describe('turning notifications off on this device', () => {
  it('has the server forget the token, and keeps the choice across sign-ins', async () => {
    allows('granted')
    const { api, client } = server()
    await subscribePush(registration(client))
    expect(await unsubscribePush(client, ids.member, project)).toEqual({
      permission: 'granted',
      subscribed: false,
    })
    expect(api.sent('DELETE /push/subscriptions')[0]?.path).toBe(
      `/push/subscriptions?endpoint=${encodeURIComponent(token)}`,
    )
    expect(await AsyncStorage.getItem(tokenKey)).toBeNull()
    expect(await AsyncStorage.getItem(offKey)).toBe('1')
    expect(await readPushState(ids.member, project)).toEqual({
      permission: 'granted',
      subscribed: false,
    })
  })

  it('changes nothing where the server cannot be told', async () => {
    allows('granted')
    const { client } = server()
    await subscribePush(registration(client))
    const { client: away } = server({ 'DELETE /push/subscriptions': unanswered })
    await expect(unsubscribePush(away, ids.member, project)).rejects.toThrow(
      'Network request failed',
    )
    expect(await AsyncStorage.getItem(tokenKey)).toBe(token)
    expect(await AsyncStorage.getItem(offKey)).toBeNull()
  })
})

describe('registering again, for a member who is signed in', () => {
  it('registers a device that allows notifications already, asking nothing', async () => {
    allows('granted')
    const { api, client } = server()
    await renewPush(registration(client), createProblemHub())
    expect(api.sent('POST /push/subscriptions')).toHaveLength(1)
    expect(device.requestPermission).not.toHaveBeenCalled()
  })

  it.each(['default', 'denied'] as const)(
    'leaves a device alone that is %s',
    async (permission) => {
      allows(permission)
      const { api, client } = server()
      await renewPush(registration(client), createProblemHub())
      expect(api.asked).toEqual([])
      expect(device.requestPermission).not.toHaveBeenCalled()
      expect(device.expoToken).not.toHaveBeenCalled()
    },
  )

  it('leaves a device alone whose member turned notifications off here', async () => {
    allows('granted')
    await AsyncStorage.setItem(offKey, '1')
    const { api, client } = server()
    await renewPush(registration(client), createProblemHub())
    expect(api.asked).toEqual([])
  })

  it('leaves a build alone that belongs to no project', async () => {
    allows('granted')
    const { api, client } = server()
    await renewPush({ ...registration(client), project: undefined }, createProblemHub())
    expect(api.asked).toEqual([])
    expect(device.permission).not.toHaveBeenCalled()
  })

  it('never rejects: a device that could not be registered is tried at the next start', async () => {
    allows('granted')
    jest.mocked(device.expoToken).mockRejectedValue(new Error('Expo could not be reached'))
    const { client } = server()
    await expect(renewPush(registration(client), createProblemHub())).resolves.toBeUndefined()
    const { client: away } = server({ 'POST /push/subscriptions': unanswered })
    jest.mocked(device.expoToken).mockResolvedValue(token)
    await expect(renewPush(registration(away), createProblemHub())).resolves.toBeUndefined()
  })

  // Asked outside a query or a mutation: a refusal that is about the app is told here.
  it('tells the problem hub what the server refused it with', async () => {
    allows('granted')
    const { client } = server({
      'POST /push/subscriptions': () =>
        problem(400, 'update_required', { minimum_version: '1.6.0' }),
    })
    const hub = createProblemHub()
    const heard = jest.fn()
    hub.subscribe(heard)
    await renewPush(registration(client), hub)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard.mock.calls[0]?.[0]).toMatchObject({ code: 'update_required' })
  })

  it('forgets a token the server refused outright', async () => {
    allows('granted')
    await AsyncStorage.setItem(tokenKey, token)
    const { client } = server({
      'POST /push/subscriptions': () =>
        problem(422, 'validation_failed', { errors: [{ field: '/endpoint', code: 'invalid' }] }),
    })
    await renewPush(registration(client), createProblemHub())
    expect(await AsyncStorage.getItem(tokenKey)).toBeNull()
  })
})

describe('a sign-out', () => {
  it('removes the registration at the server with the token the device kept, asking Expo nothing', async () => {
    allows('granted')
    const { api, client } = server()
    await subscribePush(registration(client))
    jest.mocked(device.expoToken).mockClear()
    await forgetPush(client, ids.member)
    expect(api.sent('DELETE /push/subscriptions')).toHaveLength(1)
    expect(device.expoToken).not.toHaveBeenCalled()
    expect(await AsyncStorage.getItem(tokenKey)).toBeNull()
    // The member's own choice is not touched.
    expect(await AsyncStorage.getItem(offKey)).toBeNull()
  })

  it('asks the server nothing for a device that was never registered', async () => {
    const { api, client } = server()
    await forgetPush(client, ids.member)
    expect(api.asked).toEqual([])
  })

  // The sign-out follows at once and is told its own refusal.
  it('never rejects, and tells nobody what it was refused with', async () => {
    await AsyncStorage.setItem(tokenKey, token)
    const { client } = server({
      'DELETE /push/subscriptions': () => problem(401, 'unauthenticated'),
    })
    await expect(forgetPush(client, ids.member)).resolves.toBeUndefined()
    // The sign-in's end removes it at the server, and the device has let go of it.
    expect(await AsyncStorage.getItem(tokenKey)).toBeNull()
    await AsyncStorage.setItem(tokenKey, token)
    const { client: away } = server({ 'DELETE /push/subscriptions': unanswered })
    await expect(forgetPush(away, ids.member)).resolves.toBeUndefined()
  })
})

describe('a sign-in that ended', () => {
  it('takes the device’s registration with it, and leaves its member’s choice', async () => {
    await AsyncStorage.setItem(tokenKey, token)
    await AsyncStorage.setItem(offKey, '1')
    await forget(ids.member.toUpperCase())
    expect(await AsyncStorage.getItem(tokenKey)).toBeNull()
    expect(await AsyncStorage.getItem(offKey)).toBe('1')
  })
})

describe('what a pressed notification asks the app to open', () => {
  it('is the address the server put in it', () => {
    expect(pushTarget({ url: '/households/a/today', household_id: 'a' })).toBe(
      '/households/a/today',
    )
  })

  it.each([
    ['another origin’s address', { url: 'https://evil.example/' }],
    ['an address a browser would read as another host’s', { url: '//evil.example/' }],
    ['no address', { household_id: 'a' }],
    ['an address that is no word', { url: 7 }],
    ['nothing', null],
    ['no data at all', 'a word'],
  ])('is nothing for %s', (_name, data) => {
    expect(pushTarget(data)).toBeNull()
  })
})

describe('push as a screen holds it', () => {
  let push: PushHook | undefined

  function Held() {
    const held = usePush()
    push = held
    const state = held.state
    const said = `${state?.permission ?? 'unread'} ${String(state?.subscribed)} failed ${String(held.askError !== null)}`
    return <Text testID="push">{said}</Text>
  }

  /**
   * A member's screen, on a query client of the test's own: the harness's holds a write for
   * five minutes after its screen is gone, by a timer that would hold the test's process too.
   */
  function Screened({
    client,
    children,
  }: {
    readonly client?: ApiClient
    readonly children: ReactNode
  }) {
    const [queries] = useState(testQueries)
    return (
      <QueryClientProvider client={queries}>
        <SessionFixture
          state={{ status: 'member', me: account() }}
          {...(client === undefined ? {} : { api: client })}
        >
          {children}
        </SessionFixture>
      </QueryClientProvider>
    )
  }

  async function held(client = server().client) {
    await render(
      <Screened client={client}>
        <Held />
      </Screened>,
    )
  }

  async function says(text: RegExp): Promise<void> {
    await waitFor(() => {
      expect(screen.getByTestId('push')).toHaveTextContent(text)
    })
  }

  it('is read as the screen opens, with nothing asked and nothing registered', async () => {
    allows('default')
    const { api, client } = server()
    await held(client)
    await says(/^default false/)
    expect(device.requestPermission).not.toHaveBeenCalled()
    expect(api.asked).toEqual([])
  })

  it('asks in the press, and registers a device that then allows notifications', async () => {
    allows('default')
    const { api, client } = server()
    await held(client)
    await says(/^default false/)
    jest.mocked(device.requestPermission).mockResolvedValue('granted')
    let answer: unknown
    await act(async () => {
      answer = await push?.ask()
    })
    expect(device.requestPermission).toHaveBeenCalledTimes(1)
    expect(device.requestPermission).toHaveBeenCalledWith(channel)
    expect(answer).toEqual({ permission: 'granted', subscribed: true })
    expect(api.sent('POST /push/subscriptions')[0]?.body).toEqual({
      transport: 'expo',
      endpoint: token,
      device_id: ids.device,
    })
    await says(/^granted true failed false/)
  })

  it('registers nothing for a member who answers no, and reads what the device says', async () => {
    allows('default')
    const { api, client } = server()
    await held(client)
    await says(/^default false/)
    allows('denied')
    await act(async () => {
      await push?.ask()
    })
    expect(api.asked).toEqual([])
    await says(/^denied false failed false/)
  })

  it('says that registering failed, and reads as not subscribed', async () => {
    allows('granted')
    const { client } = server({ 'POST /push/subscriptions': unanswered })
    await held(client)
    await says(/^granted false/)
    await act(async () => {
      await push?.ask().catch(() => undefined)
    })
    await says(/^granted false failed true/)
    expect(await AsyncStorage.getItem(tokenKey)).toBeNull()
  })

  it('turns off by its member’s choice, which is kept', async () => {
    allows('granted')
    await AsyncStorage.setItem(tokenKey, token)
    const { api, client } = server()
    await held(client)
    await says(/^granted true/)
    await act(async () => {
      await push?.turnOff()
    })
    expect(api.sent('DELETE /push/subscriptions')).toHaveLength(1)
    expect(await AsyncStorage.getItem(offKey)).toBe('1')
    await says(/^granted false/)
  })

  it('hands a module the state and the question, to ask in context', async () => {
    allows('default')
    let prompt: ReturnType<typeof usePushPrompt> | undefined
    function Prompt() {
      prompt = usePushPrompt()
      return null
    }
    await render(
      <Screened>
        <Prompt />
      </Screened>,
    )
    await waitFor(() => {
      expect(prompt?.state).toEqual({ permission: 'default', subscribed: false })
    })
    expect(typeof prompt?.ask).toBe('function')
    expect(device.requestPermission).not.toHaveBeenCalled()
  })
})

describe('what the app does about push wherever it is open', () => {
  it('shows a notification that arrives while it is open, and registers nobody while nobody is signed in', async () => {
    allows('granted')
    const { api, client } = server()
    await render(
      <SessionFixture api={client} state={{ status: 'visitor' }}>
        <Push />
      </SessionFixture>,
    )
    expect(device.showWhileOpen).toHaveBeenCalledTimes(1)
    expect(api.asked).toEqual([])
    expect(device.permission).not.toHaveBeenCalled()
  })

  it('registers a device that allows notifications already for the member who is here, once', async () => {
    allows('granted')
    const { api, client } = server()
    await render(
      <SessionFixture api={client}>
        <Push />
      </SessionFixture>,
    )
    await waitFor(() => {
      expect(api.sent('POST /push/subscriptions')).toHaveLength(1)
    })
    expect(api.sent('POST /push/subscriptions')[0]?.body).toMatchObject({ device_id: ids.device })
    expect(device.requestPermission).not.toHaveBeenCalled()
    expect(await AsyncStorage.getItem(tokenKey)).toBe(token)
  })

  // Never at sign-in: the system's question is a press's alone.
  it('asks nothing of a member as they sign in', async () => {
    allows('default')
    const { api, client } = server()
    await render(
      <SessionFixture api={client}>
        <Push />
      </SessionFixture>,
    )
    await waitFor(() => {
      expect(device.permission).toHaveBeenCalled()
    })
    expect(device.requestPermission).not.toHaveBeenCalled()
    expect(api.asked).toEqual([])
  })
})
