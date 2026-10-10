// The session on a device, through the providers the app stands in: who is signed in, what a
// sign-in and a sign-out do to what the device keeps, what ends a sign-in and what does not,
// and the one answer that stops every screen. The web's `session.test.tsx` is its twin.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, screen, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { useApi, useProblems } from '../api/ApiProvider.tsx'
import { createKeep, keepKey } from '../api/keep.ts'
import { unwrap } from '../api/problem.ts'
import {
  answering,
  empty,
  json,
  problem,
  testClient,
  unanswered,
  type Answering,
} from '../api/testing.ts'
import { createQueryClient } from '../api/query.ts'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { destinationKey, heldDestination, holdDestination } from '../links/destination.ts'
import { ids, people } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { Text } from '../ui/Text.tsx'
import { meKey, useSession, type Session } from './context.ts'
import { account } from './fixture.tsx'
import { onForget } from './forget.ts'
import { createServices, SessionProviders } from './Providers.tsx'
import { vaultKeys, type TokenPair } from './tokens.ts'
import { memoryVault } from './vault.ts'

// The device's own notifications are not this file's: nothing is allowed, and nothing pressed.
jest.mock('../push/device.ts', () => ({
  permission: jest.fn(() => Promise.resolve('default')),
  requestPermission: jest.fn(() => Promise.resolve('default')),
  ensureChannel: jest.fn(() => Promise.resolve()),
  expoToken: jest.fn(() => Promise.reject(new Error('no token is asked for here'))),
  showWhileOpen: jest.fn(),
  onPressed: jest.fn(() => () => undefined),
}))

const eva = account()
const jiri = account({
  id: ids.otherMember,
  email: people.member.email,
  display_name: people.member.name,
})

function pair(name: string): TokenPair {
  return { access_token: `access-${name}`, refresh_token: `refresh-${name}`, expires_in: 900 }
}

/** What a device that holds `member`'s sign-in has in its vault. */
function holding(member: string, name: string, lapsesIn = 900_000): Record<string, string> {
  return {
    [vaultKeys.signIns]: JSON.stringify({ active: member, members: [member] }),
    [vaultKeys.signIn(member)]: JSON.stringify({
      access: `access-${name}`,
      refresh: `refresh-${name}`,
      expires_at: Date.now() + lapsesIn,
    }),
  }
}

/**
 * Puts `me` where the device keeps what `me` read, as a run before this one left it: read some
 * minutes ago, so the app asks for it again as it starts.
 */
async function keptFrom(me = eva): Promise<void> {
  const before = createQueryClient()
  const keep = createKeep(me.id)
  const stop = keep.watch(before)
  before.setQueryData(meKey, me, { updatedAt: Date.now() - 5 * 60_000 })
  await keep.flush()
  stop()
  before.clear()
}

let session: Session | undefined
let asks: ReturnType<typeof useApi> | undefined

/** Says who is signed in, in words a test reads, and hands the test the session. */
function Probe({ children }: { readonly children?: ReactNode }) {
  const current = useSession()
  const { locale } = useI18n()
  session = current
  const { state } = current
  const who = state.status === 'member' ? `member ${state.me.id}` : state.status
  const notes = `ended ${String(current.ended)} left ${String(current.signedOut)} minimum ${String(current.minimumVersion)} locale ${locale}`
  return (
    <>
      <Text testID="who">{who}</Text>
      <Text testID="notes">{notes}</Text>
      {children}
    </>
  )
}

/** Takes the client a screen would: made of the build's address when it is first asked for. */
function Asks() {
  asks = useApi()
  return null
}

function the(): Session {
  if (session === undefined) throw new Error('the session was not drawn')
  return session
}

interface Device {
  readonly api: Answering
  readonly vault: ReturnType<typeof memoryVault>
}

/** The app's own services, over a vault and a server of the test's. */
function serving({ vault, api }: Device) {
  const services = createServices({
    vault,
    client: (bearer) => testClient(api.transport, bearer === undefined ? {} : { bearer }),
  })
  // A read that is still being answered as a test ends would be held for a day by a timer:
  // the app's holds it so, and a test's process is not kept open for it.
  const { queries } = services.queries.getDefaultOptions()
  services.queries.setDefaultOptions({ queries: { ...queries, gcTime: Infinity } })
  return services
}

/** Starts the app on a device that holds `kept`, whose server answers by `routes`. */
async function start(
  kept: Record<string, string>,
  routes: Parameters<typeof answering>[0],
  children?: ReactNode,
): Promise<Device> {
  const vault = memoryVault(kept)
  const api = answering(routes)
  const services = serving({ vault, api })
  await render(
    <SessionProviders services={services}>
      <Probe>{children}</Probe>
    </SessionProviders>,
  )
  return { api, vault }
}

async function who(text: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('who')).toHaveTextContent(text)
  })
}

const forgotten = jest.fn<(member: string) => void>()
let stopForgetting: () => void = () => undefined

beforeEach(async () => {
  await AsyncStorage.clear()
  session = undefined
  asks = undefined
  forgotten.mockClear()
  stopForgetting = onForget(forgotten)
})

afterEach(() => {
  stopForgetting()
})

describe('who is signed in', () => {
  it('is nobody on a device that holds no sign-in, and the server is asked nothing', async () => {
    const { api } = await start({}, {})
    await who('visitor')
    expect(api.asked).toEqual([])
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended false left false minimum null/)
  })

  it('is not known until the device has been read', async () => {
    const vault = memoryVault(holding(ids.member, 'a'))
    let read: () => void = () => undefined
    const reading = new Promise<void>((resolve) => {
      read = resolve
    })
    const get = vault.get
    jest.spyOn(vault, 'get').mockImplementation(async (key) => {
      await reading
      return get(key)
    })
    const api = answering({ 'GET /me': () => json(200, eva) })
    const services = serving({ vault, api })
    await render(
      <SessionProviders services={services}>
        <Probe />
      </SessionProviders>,
    )
    expect(screen.getByTestId('who')).toHaveTextContent('unknown')
    await act(() => {
      read()
    })
    await who(`member ${ids.member}`)
  })

  it('is the member whose sign-in the device holds, asked for with it', async () => {
    const { api } = await start(holding(ids.member, 'a'), { 'GET /me': () => json(200, eva) })
    expect(screen.getByTestId('who')).toHaveTextContent('unknown')
    await who(`member ${ids.member}`)
    expect(api.sent('GET /me')[0]?.headers.get('Authorization')).toBe('Bearer access-a')
  })

  it('is the member as the device kept them, where the server cannot be asked', async () => {
    await keptFrom()
    const { api } = await start(holding(ids.member, 'a'), { 'GET /me': unanswered })
    await who(`member ${ids.member}`)
    // Asked again all the same: what was kept stands in for a server that cannot be asked.
    await waitFor(() => {
      expect(api.sent('GET /me').length).toBeGreaterThan(0)
    })
    expect(screen.getByTestId('who')).toHaveTextContent(`member ${ids.member}`)
  })

  it('could not be read where the server cannot be asked and nothing is kept, until it can', async () => {
    let reachable = false
    await start(holding(ids.member, 'a'), {
      'GET /me': () => (reachable ? json(200, eva) : unanswered()),
    })
    await who('unreachable')
    reachable = true
    await act(() => {
      the().retry()
    })
    await who(`member ${ids.member}`)
  })

  it('is asked for with a sign-in renewed first, where the token the device holds has lapsed', async () => {
    const { api, vault } = await start(holding(ids.member, 'a', -1000), {
      'POST /auth/token': () => json(200, pair('b')),
      'GET /me': () => json(200, eva),
    })
    await who(`member ${ids.member}`)
    expect(api.sent('POST /auth/token')[0]?.body).toEqual({ refresh_token: 'refresh-a' })
    // The renewal itself is signed with nothing: the token in its body is what it proves.
    expect(api.sent('POST /auth/token')[0]?.headers.get('Authorization')).toBeNull()
    expect(api.sent('GET /me')[0]?.headers.get('Authorization')).toBe('Bearer access-b')
    expect(JSON.parse(vault.held()[vaultKeys.signIn(ids.member)] ?? '')).toMatchObject({
      refresh: 'refresh-b',
    })
  })

  it('takes the account’s language', async () => {
    await start(holding(ids.member, 'a'), {
      'GET /me': () => json(200, account({ locale: 'cs-CZ' })),
    })
    await waitFor(() => {
      expect(screen.getByTestId('notes')).toHaveTextContent(/locale cs$/)
    })
  })
})

describe('a sign-in the server answered', () => {
  it('signs its member in at once: the pair is kept under them, and nothing more is asked', async () => {
    const { api, vault } = await start({}, {})
    await who('visitor')
    await act(() => the().signedIn({ user: eva, tokens: pair('a') }))
    await who(`member ${ids.member}`)
    expect(api.asked).toEqual([])
    expect(JSON.parse(vault.held()[vaultKeys.signIns] ?? '')).toEqual({
      active: ids.member,
      members: [ids.member],
    })
    expect(JSON.parse(vault.held()[vaultKeys.signIn(ids.member)] ?? '')).toMatchObject({
      access: 'access-a',
      refresh: 'refresh-a',
    })
  })

  it('keeps what its member reads under their name, for the next start', async () => {
    await start({}, {})
    await who('visitor')
    await act(() => the().signedIn({ user: eva, tokens: pair('a') }))
    await waitFor(
      async () => {
        expect(await AsyncStorage.getItem(keepKey(ids.member))).toContain(people.owner.email)
      },
      { timeout: 3000 },
    )
  })

  // D-161's twin: what a device kept is its member's, and not the next one's to find.
  it('of another member removes what the device kept of the first, before it keeps anything of theirs', async () => {
    await keptFrom()
    const { vault } = await start(holding(ids.member, 'a'), { 'GET /me': () => json(200, eva) })
    await who(`member ${ids.member}`)
    const order: string[] = []
    forgotten.mockImplementation((member) => {
      order.push(`forgot ${member}`)
      order.push(
        `holds ${Object.keys(vault.held())
          .filter((key) => key.startsWith('household.signin.'))
          .join()}`,
      )
    })
    await act(() => the().signedIn({ user: jiri, tokens: pair('b') }))
    await who(`member ${ids.otherMember}`)
    // The first one's pair was gone already, and the second's not yet kept.
    expect(order).toEqual([`forgot ${ids.member}`, 'holds '])
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeUndefined()
    expect(await AsyncStorage.getItem(keepKey(ids.member))).toBeNull()
    expect(JSON.parse(vault.held()[vaultKeys.signIns] ?? '')).toEqual({
      active: ids.otherMember,
      members: [ids.otherMember],
    })
  })

  it('names its device: the installation’s own id, made once', async () => {
    const { vault } = await start({}, {})
    await who('visitor')
    const device = await the().device()
    expect(device.id).toBe(vault.held()[vaultKeys.device])
    expect(device).toMatchObject({
      platform: 'ios',
      app_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    })
    expect((await the().device()).id).toBe(device.id)
  })
})

describe('signing out', () => {
  async function signedIn(routes: Parameters<typeof answering>[0]): Promise<Device> {
    await keptFrom()
    const device = await start(holding(ids.member, 'a'), {
      'GET /me': () => json(200, eva),
      ...routes,
    })
    await who(`member ${ids.member}`)
    return device
  }

  it('ends the sign-in at the server, and only then removes what the device kept', async () => {
    let keptAtLogout: string | null = null
    const { api, vault } = await signedIn({
      'POST /auth/logout': async () => {
        keptAtLogout = await AsyncStorage.getItem(keepKey(ids.member))
        return empty()
      },
    })
    holdDestination(`/households/${ids.household}/today`)
    await act(() => the().signOut())
    await who('visitor')
    expect(api.sent('POST /auth/logout')[0]?.headers.get('Authorization')).toBe('Bearer access-a')
    // Still there while the server was asked.
    expect(keptAtLogout).not.toBeNull()
    expect(await AsyncStorage.getItem(keepKey(ids.member))).toBeNull()
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeUndefined()
    expect(forgotten).toHaveBeenCalledWith(ids.member)
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended false left true/)
    // Whoever signs in next is not sent to where this member was going.
    expect(heldDestination()).toBeNull()
    expect(await AsyncStorage.getItem(destinationKey)).toBeNull()
  })

  it('removes the device’s push registration first, while the server can still be told', async () => {
    await AsyncStorage.setItem(`household.push.token.${ids.member}`, 'ExponentPushToken[abc]')
    const { api } = await signedIn({
      'DELETE /push/subscriptions': () => empty(),
      'POST /auth/logout': () => empty(),
    })
    await act(() => the().signOut())
    await who('visitor')
    const order = api.asked
      .map((each) => `${each.method} ${each.path}`)
      .filter((each) => !each.startsWith('GET'))
    expect(order).toEqual([
      `DELETE /push/subscriptions?endpoint=${encodeURIComponent('ExponentPushToken[abc]')}`,
      'POST /auth/logout',
    ])
  })

  it('leaves its member signed in, with everything kept, where the server could not be told', async () => {
    const { vault } = await signedIn({ 'POST /auth/logout': unanswered })
    let failure: unknown
    await act(async () => {
      failure = await the()
        .signOut()
        .catch((error: unknown) => error)
    })
    expect(failure).toBeInstanceOf(TypeError)
    expect(screen.getByTestId('who')).toHaveTextContent(`member ${ids.member}`)
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended false left false/)
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeDefined()
    expect(await AsyncStorage.getItem(keepKey(ids.member))).not.toBeNull()
    expect(forgotten).not.toHaveBeenCalled()
  })

  it('is done where the server no longer knows the sign-in, and is not said to have ended', async () => {
    const { vault } = await signedIn({
      'POST /auth/logout': () => problem(401, 'unauthenticated'),
      'POST /auth/token': () => problem(401, 'refresh_token_invalid'),
    })
    await act(() => the().signOut())
    await who('visitor')
    // Its member asked to leave: the sign-in screen says nothing of a sign-in that ended.
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended false left true/)
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeUndefined()
  })
})

describe('a sign-in the server will not renew', () => {
  it('has ended: everything the device kept of its member is removed, and it is said so', async () => {
    await keptFrom()
    const { api, vault } = await start(
      holding(ids.member, 'a'),
      {
        'GET /me': () => json(200, eva),
        'GET /households': () => problem(401, 'unauthenticated'),
        'POST /auth/token': () => problem(401, 'refresh_token_invalid'),
      },
      <Asks />,
    )
    await who(`member ${ids.member}`)
    const answer = await act(() => asks?.GET('/households'))
    expect(answer?.response.status).toBe(401)
    await who('visitor')
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended true left false/)
    expect(api.sent('POST /auth/token')).toHaveLength(1)
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeUndefined()
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(keepKey(ids.member))).toBeNull()
    })
    expect(forgotten).toHaveBeenCalledTimes(1)
    expect(forgotten).toHaveBeenCalledWith(ids.member)
  })

  it('is over until someone signs in again, who is then signed in and told nothing of it', async () => {
    const { api } = await start(holding(ids.member, 'a', -1000), {
      'POST /auth/token': () => problem(401, 'refresh_token_invalid'),
    })
    await who('visitor')
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended true/)
    // Nobody is asked about again: there is nobody to ask for.
    expect(api.sent('GET /me').length).toBeLessThanOrEqual(1)
    await act(() => the().signedIn({ user: jiri, tokens: pair('b') }))
    await who(`member ${ids.otherMember}`)
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended false left false/)
  })

  // D-98: a renewal that could not reach the server is no refusal.
  it('has not ended where the renewal got no answer: the member stays, as the device kept them', async () => {
    await keptFrom()
    const { api, vault } = await start(holding(ids.member, 'a', -1000), {
      'POST /auth/token': unanswered,
      'GET /me': unanswered,
    })
    await who(`member ${ids.member}`)
    // Asked, and unanswered: the request it was for then left with the token the device held.
    await waitFor(() => {
      expect(api.sent('GET /me')).toHaveLength(1)
    })
    expect(api.sent('POST /auth/token')[0]?.body).toEqual({ refresh_token: 'refresh-a' })
    expect(api.sent('GET /me')[0]?.headers.get('Authorization')).toBe('Bearer access-a')
    expect(screen.getByTestId('who')).toHaveTextContent(`member ${ids.member}`)
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended false left false/)
    expect(JSON.parse(vault.held()[vaultKeys.signIn(ids.member)] ?? '')).toMatchObject({
      refresh: 'refresh-a',
    })
    expect(forgotten).not.toHaveBeenCalled()
  })

  it('has not ended where the renewal was refused for now', async () => {
    await keptFrom()
    const { api, vault } = await start(holding(ids.member, 'a', -1000), {
      'POST /auth/token': () => problem(429, 'rate_limited'),
      'GET /me': () => problem(401, 'unauthenticated'),
    })
    await who(`member ${ids.member}`)
    // Asked before the request and again once it was refused, and refused both times.
    await waitFor(() => {
      expect(api.sent('POST /auth/token')).toHaveLength(2)
    })
    expect(api.sent('GET /me')).toHaveLength(1)
    expect(forgotten).not.toHaveBeenCalled()
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeDefined()
    expect(screen.getByTestId('who')).toHaveTextContent(`member ${ids.member}`)
    expect(screen.getByTestId('notes')).toHaveTextContent(/^ended false/)
  })
})

describe('a build the server no longer serves', () => {
  it('draws *please update* in every screen’s place, whichever request was told so', async () => {
    await start(holding(ids.member, 'a'), {
      'GET /me': () => problem(400, 'update_required', { minimum_version: '1.6.0' }),
    })
    await waitFor(() => {
      expect(screen.getByTestId('update-required')).toBeOnTheScreen()
    })
    // And nothing else: no screen stands beside it.
    expect(screen.queryByTestId('who')).toBeNull()
  })

  it('is told by the renewal too, which ends nothing by it', async () => {
    await keptFrom()
    const { vault } = await start(holding(ids.member, 'a', -1000), {
      'POST /auth/token': () => problem(400, 'update_required', { minimum_version: '2.0.0' }),
      'GET /me': () => problem(400, 'update_required', { minimum_version: '2.0.0' }),
    })
    await waitFor(() => {
      expect(screen.getByTestId('update-required')).toBeOnTheScreen()
    })
    expect(the().ended).toBe(false)
    // D-99: what the phone holds is still there for the build that can send it.
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeDefined()
    expect(forgotten).not.toHaveBeenCalled()
  })

  // The replica's own requests, and any other made outside a query, tell the hub themselves.
  it('is told by whatever tells the problem hub, with nobody signed in as with somebody', async () => {
    let hub: ReturnType<typeof useProblems> | undefined
    function Hub() {
      hub = useProblems()
      return null
    }
    await start({}, {}, <Hub />)
    await who('visitor')
    await act(() => {
      hub?.report({
        type: '',
        title: '',
        status: 400,
        code: 'update_required',
        minimum_version: '1.6.0',
      })
    })
    expect(screen.getByTestId('update-required')).toBeOnTheScreen()
    expect(screen.queryByTestId('who')).toBeNull()
  })
})

describe('the sign-in as a replica is given it', () => {
  class Gone extends Error {}

  it('hands out a live token, and renews it where a request of the replica’s was refused', async () => {
    const { api } = await start(holding(ids.member, 'a'), {
      'GET /me': () => json(200, eva),
      'POST /auth/token': () => json(200, pair('b')),
    })
    await who(`member ${ids.member}`)
    const credential = the().credential(() => new Gone())
    expect(await credential.current()).toBe('access-a')
    await act(() => credential.renew())
    expect(await credential.current()).toBe('access-b')
    expect(api.sent('POST /auth/token')).toHaveLength(1)
  })

  it('renews nothing a second time for the token another request already replaced', async () => {
    const { api } = await start(holding(ids.member, 'a'), {
      'GET /me': () => json(200, eva),
      'POST /auth/token': () => json(200, pair('b')),
    })
    await who(`member ${ids.member}`)
    const one = the().credential(() => new Gone())
    const other = the().credential(() => new Gone())
    await one.current()
    await other.current()
    await act(() => one.renew())
    await act(() => other.renew())
    expect(api.sent('POST /auth/token')).toHaveLength(1)
    expect(await other.current()).toBe('access-b')
  })

  it('throws what tells the replica its sign-in is gone, where the renewal is refused, and the session ends', async () => {
    await start(holding(ids.member, 'a'), {
      'GET /me': () => json(200, eva),
      'POST /auth/token': () => problem(401, 'refresh_token_invalid'),
    })
    await who(`member ${ids.member}`)
    const credential = the().credential(() => new Gone())
    await credential.current()
    let thrown: unknown
    await act(async () => {
      thrown = await credential.renew().catch((error: unknown) => error)
    })
    expect(thrown).toBeInstanceOf(Gone)
    await who('visitor')
    expect(the().ended).toBe(true)
    await expect(credential.current()).rejects.toBeInstanceOf(Gone)
  })

  it('rejects with what it met, and ends nothing, where the server could not be asked', async () => {
    await start(holding(ids.member, 'a'), {
      'GET /me': () => json(200, eva),
      'POST /auth/token': unanswered,
    })
    await who(`member ${ids.member}`)
    const credential = the().credential(() => new Gone())
    await credential.current()
    const thrown = await credential.renew().catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(TypeError)
    expect(thrown).not.toBeInstanceOf(Gone)
    expect(the().ended).toBe(false)
  })
})

describe('a request through the client every screen has', () => {
  it('is answered as the problem it stated, which a screen switches on', async () => {
    await start(
      holding(ids.member, 'a'),
      { 'GET /me': () => json(200, eva), 'GET /households': () => problem(404, 'not_found') },
      <Asks />,
    )
    await who(`member ${ids.member}`)
    const answer = await asks?.GET('/households')
    expect(() => unwrap(answer ?? { response: empty() })).toThrow('404 not_found')
  })
})
