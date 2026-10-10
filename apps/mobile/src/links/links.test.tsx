// An address that arrives: the four situations of a link and the one that is none (04-navigation
// §8), the address a link names, what is held through a sign-in, the switch a link makes, and
// what the app does about each, by a pressed notification and by the system.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, screen } from '@testing-library/react-native'
import { router } from 'expo-router'
import { Linking } from 'react-native'
import { inHousehold, paths } from '../app/paths.ts'
import * as pushDevice from '../push/device.ts'
import type { SessionState } from '../session/context.ts'
import { account, SessionFixture } from '../session/fixture.tsx'
import { forget } from '../session/forget.ts'
import { ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { Text } from '../ui/Text.tsx'
import { addressOf, type Own } from './address.ts'
import {
  destinationKey,
  heldDestination,
  holdDestination,
  restoreDestination,
  takeDestination,
  useHeldDestination,
} from './destination.ts'
import { Links } from './Links.tsx'
import { hasScreen, householdOf, resolve } from './resolve.ts'
import {
  dismissSwitched,
  householdShown,
  linkArrived,
  resetSwitched,
  shownHousehold,
  useSwitchedByLink,
} from './switched.ts'

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
}))

// The build's own links: a scheme, and a host whose `https` links open the app.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      scheme: 'household-dev',
      extra: { variant: 'development', linkHost: 'app.household.test' },
    },
  },
}))

jest.mock('../push/device.ts', () => ({
  onPressed: jest.fn(() => () => undefined),
}))

const today = inHousehold.today(ids.household)
const elsewhere = inHousehold.today(ids.otherHousehold)
const settings = `/households/${ids.household}/settings/billing`

beforeEach(async () => {
  await AsyncStorage.clear()
  takeDestination()
  resetSwitched()
  jest.clearAllMocks()
})

describe('what an address that arrives comes to', () => {
  const here = { visitor: false, shown: ids.household }

  // The four situations of 04-navigation §8, a row each, and the one that is none of them.
  it('warm: the target itself, in the household on screen', () => {
    expect(resolve(today, here)).toEqual({ kind: 'opened', path: today })
  })

  it('cold start: held through the sign-in, for a visitor', () => {
    expect(resolve(today, { visitor: true, shown: null })).toEqual({ kind: 'held', path: today })
  })

  it('wrong household: the address is the switch, and what it switched from is known', () => {
    expect(resolve(elsewhere, here)).toEqual({
      kind: 'switched',
      path: elsewhere,
      from: ids.household,
      to: ids.otherHousehold,
    })
  })

  it('no access: an address the app has no screen for is the neutral screen’s', () => {
    expect(resolve(settings, here)).toEqual({ kind: 'notAvailable', path: settings })
    expect(resolve('/nowhere', here)).toEqual({ kind: 'notAvailable', path: '/nowhere' })
  })

  it.each([
    ['another origin’s address', 'https://household.example/households'],
    ['an address that is no path', 'households'],
    ['an address a browser would read as another host’s', '//evil.example/households'],
    ['an address written with a backslash', '/\\evil.example'],
    ['nothing', null],
    ['no word at all', 42],
  ])('opens nothing for %s', (_name, address) => {
    expect(resolve(address, here)).toEqual({ kind: 'nothing' })
    expect(resolve(address, { visitor: true, shown: null })).toEqual({ kind: 'nothing' })
  })

  it('is no switch for the first household the app opens, nor for an address of no household', () => {
    expect(resolve(elsewhere, { visitor: false, shown: null }).kind).toBe('opened')
    expect(resolve('/', here)).toEqual({ kind: 'opened', path: '/' })
  })

  it('is the same household whichever case its id is written in', () => {
    expect(
      resolve(today.toUpperCase().replace('/HOUSEHOLDS/', '/households/'), here).kind,
    ).not.toBe('switched')
    expect(householdOf(`/households/${ids.household.toUpperCase()}/today?x=1`)).toBe(ids.household)
    expect(householdOf('/sign-in')).toBeNull()
  })

  it('knows a screen by the table of routes, whatever follows its path', () => {
    expect(hasScreen(inHousehold.home(ids.household))).toBe(true)
    expect(hasScreen(`${inHousehold.sync(ids.household)}?from=push#top`)).toBe(true)
    expect(hasScreen(`${inHousehold.more(ids.household)}/`)).toBe(true)
    expect(hasScreen(paths.signIn.path)).toBe(true)
    expect(hasScreen('/')).toBe(true)
    // A module's screens are lines of their own as they are built: its catch-all is none.
    expect(hasScreen(inHousehold.module(ids.household, 'shopping', 'lists/7'))).toBe(false)
    expect(hasScreen(`/households/${ids.household}/settings`)).toBe(false)
    expect(hasScreen('/households')).toBe(false)
  })
})

describe('the address a link names', () => {
  const own: Own = { schemes: ['household-dev'], host: 'app.household.test' }

  it.each([
    ['the app’s scheme', `household-dev://households/${ids.household}/today`, today],
    ['the app’s scheme, in capitals', `HOUSEHOLD-DEV://households/${ids.household}/today`, today],
    [
      'the app’s scheme with its path from the root',
      `household-dev:///households/${ids.household}/today`,
      today,
    ],
    ['the app’s scheme with a query', 'household-dev://sign-in?next=1', '/sign-in?next=1'],
    ['the app’s scheme and nothing else', 'household-dev://', '/'],
    ['the app’s host', `https://app.household.test/households/${ids.household}/today`, today],
    ['the app’s host and nothing else', 'https://app.household.test', '/'],
    ['the app’s host with a query', 'https://APP.household.test?x=1', '/?x=1'],
  ])('is read out of a link in %s', (_name, url, address) => {
    expect(addressOf(url, own)).toBe(address)
  })

  it.each([
    ['another scheme', `exp+household://households/${ids.household}`],
    ['another host', `https://evil.example/households/${ids.household}`],
    ['the app’s host over plain http', `http://app.household.test/households/${ids.household}`],
    ['a host that only begins as the app’s', `https://app.household.test.evil.example/x`],
    ['no link at all', 'households'],
  ])('is none for %s', (_name, url) => {
    expect(addressOf(url, own)).toBeNull()
  })

  it('is none on any host, for a build that was told none', () => {
    expect(
      addressOf('https://app.household.test/x', { schemes: ['household'], host: undefined }),
    ).toBeNull()
  })

  it('never names another origin: what follows the scheme is a path of the app’s', () => {
    const address = addressOf('household-dev:////evil.example/x', own)
    expect(address).toBe('/evil.example/x')
    expect(resolve(address, { visitor: false, shown: null }).kind).toBe('notAvailable')
  })
})

describe('the address held through a sign-in', () => {
  it('is held, and taken once', async () => {
    holdDestination(today)
    expect(heldDestination()).toBe(today)
    expect(await AsyncStorage.getItem(destinationKey)).toBe(today)
    expect(takeDestination()).toBe(today)
    expect(takeDestination()).toBeNull()
    expect(await AsyncStorage.getItem(destinationKey)).toBeNull()
  })

  it('is nothing but an address of the app’s own', () => {
    holdDestination('https://evil.example/')
    holdDestination('//evil.example/')
    expect(heldDestination()).toBeNull()
  })

  // Signing in may take somebody out of the app, and the system may close it meanwhile.
  it('outlives the app being closed: the next start reads it back', async () => {
    await AsyncStorage.setItem(destinationKey, today)
    expect(heldDestination()).toBeNull()
    await restoreDestination()
    expect(heldDestination()).toBe(today)
  })

  it('is not read back over one held since the start, nor where what was kept is no address', async () => {
    await AsyncStorage.setItem(destinationKey, elsewhere)
    holdDestination(today)
    await restoreDestination()
    expect(heldDestination()).toBe(today)
    takeDestination()
    await AsyncStorage.setItem(destinationKey, 'https://evil.example/')
    await restoreDestination()
    expect(heldDestination()).toBeNull()
  })

  it('tells the sign-in screen as it is held and as it is taken', async () => {
    function Held() {
      return <Text testID="held">{String(useHeldDestination())}</Text>
    }
    await render(<Held />)
    expect(screen.getByTestId('held')).toHaveTextContent('null')
    await act(() => {
      holdDestination(today)
    })
    expect(screen.getByTestId('held')).toHaveTextContent(today)
    await act(() => {
      takeDestination()
    })
    expect(screen.getByTestId('held')).toHaveTextContent('null')
  })
})

describe('a household a link switched to', () => {
  it('is the household whose frame was drawn last, in whichever case its id is written', () => {
    householdShown(ids.household)
    linkArrived(ids.otherHousehold.toUpperCase())
    householdShown(ids.otherHousehold.toUpperCase())
    expect(shownHousehold()).toBe(ids.otherHousehold)
  })

  function Frame({
    household,
    inFront,
  }: {
    readonly household: string
    readonly inFront?: boolean
  }) {
    const switched = useSwitchedByLink(household, inFront)
    const said = switched === null ? 'none' : `from ${switched.from}`
    return <Text testID="switched">{said}</Text>
  }

  /** A household's frame, which a test then draws for another household, or behind another. */
  async function framed(household: string) {
    const view = await render(<Frame household={household} />)
    return {
      opens: (next: string, inFront = true) =>
        view.rerender(<Frame household={next} inFront={inFront} />),
    }
  }

  it('draws nothing for the first household the app opens', async () => {
    await framed(ids.household)
    expect(screen.getByTestId('switched')).toHaveTextContent('none')
  })

  it('draws the switch a link made, in the household it opened', async () => {
    const frame = await framed(ids.household)
    linkArrived(ids.otherHousehold)
    await frame.opens(ids.otherHousehold)
    expect(screen.getByTestId('switched')).toHaveTextContent(`from ${ids.household}`)
  })

  it('draws none for a household its member chose themselves', async () => {
    const frame = await framed(ids.household)
    await frame.opens(ids.otherHousehold)
    expect(screen.getByTestId('switched')).toHaveTextContent('none')
  })

  it('puts the notice away when it is dismissed, and when its member goes back', async () => {
    const frame = await framed(ids.household)
    linkArrived(ids.otherHousehold)
    await frame.opens(ids.otherHousehold)
    await act(() => {
      dismissSwitched()
    })
    expect(screen.getByTestId('switched')).toHaveTextContent('none')

    linkArrived(ids.household)
    await frame.opens(ids.household)
    expect(screen.getByTestId('switched')).toHaveTextContent(`from ${ids.otherHousehold}`)
    // Back is their own choice, and no link.
    await frame.opens(ids.otherHousehold)
    expect(screen.getByTestId('switched')).toHaveTextContent('none')
  })

  // A stack keeps the screen a link was opened over: the frame underneath is drawn again, with
  // no link, when its member comes back to it.
  it('says nothing of a link whose household was never drawn, once its member is back', async () => {
    const frame = await framed(ids.household)
    // A link to a household that answered not found: what stood over this frame drew no
    // household, and its member went back.
    linkArrived(ids.otherHousehold)
    await frame.opens(ids.household, false)
    await frame.opens(ids.household)
    // Later they open that household themselves.
    await frame.opens(ids.otherHousehold)
    expect(screen.getByTestId('switched')).toHaveTextContent('none')
  })

  it('is not the household on screen while another’s frame stands over it', async () => {
    const frame = await framed(ids.household)
    householdShown(ids.otherHousehold)
    await frame.opens(ids.household, false)
    expect(shownHousehold()).toBe(ids.otherHousehold)
    await frame.opens(ids.household)
    expect(shownHousehold()).toBe(ids.household)
  })

  it('begins again with whoever signs in next: which household was on screen is gone with its member', async () => {
    householdShown(ids.household)
    await forget(ids.member)
    expect(shownHousehold()).toBeNull()
  })
})

describe('an address that arrives while the app is open', () => {
  const member: SessionState = { status: 'member', me: account() }
  let listeners: ((event: { url: string }) => void)[] = []

  beforeEach(() => {
    listeners = []
    jest.spyOn(Linking, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener)
      return { remove: jest.fn() } as unknown as ReturnType<typeof Linking.addEventListener>
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  /** The other household's frame, saying what it was switched from. */
  function Switched() {
    const switched = useSwitchedByLink(ids.otherHousehold)
    const said = switched?.from ?? 'none'
    return <Text testID="switched">{said}</Text>
  }

  async function open(state: SessionState) {
    await render(
      <SessionFixture state={state}>
        <Links />
      </SessionFixture>,
    )
    const pressed = jest.mocked(pushDevice.onPressed).mock.calls[0]?.[0]
    if (pressed === undefined) throw new Error('nothing listens for a pressed notification')
    return { pressed }
  }

  it('by a pressed notification is opened on the stack, by the app’s own router', async () => {
    householdShown(ids.household)
    const { pressed } = await open(member)
    pressed({ url: today, household_id: ids.household, notification_id: 'a notification' })
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith(today)
    expect(heldDestination()).toBeNull()
  })

  it('by a pressed notification opens the neutral screen where the app has no screen for it', async () => {
    householdShown(ids.household)
    const { pressed } = await open(member)
    pressed({ url: settings })
    expect(router.push).toHaveBeenCalledWith(settings)
  })

  it('by a pressed notification opens nothing where it is no address of the app’s', async () => {
    const { pressed } = await open(member)
    pressed({ url: 'https://evil.example/' })
    pressed({ url: 7 })
    pressed(null)
    pressed('a word')
    expect(router.push).not.toHaveBeenCalled()
    expect(router.navigate).not.toHaveBeenCalled()
    expect(heldDestination()).toBeNull()
  })

  it('by a pressed notification is held for a visitor, who is led to sign in', async () => {
    const { pressed } = await open({ status: 'visitor' })
    pressed({ url: today })
    expect(heldDestination()).toBe(today)
    expect(router.navigate).toHaveBeenCalledWith(paths.signIn.path)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('by a pressed notification is held though the last member signed out themselves', async () => {
    await render(
      <SessionFixture state={{ status: 'visitor' }} signedOut>
        <Links />
      </SessionFixture>,
    )
    jest.mocked(pushDevice.onPressed).mock.calls[0]?.[0]({ url: today })
    expect(heldDestination()).toBe(today)
  })

  it('to another household is opened, and noted as the switch it is', async () => {
    householdShown(ids.household)
    const { pressed } = await open(member)
    pressed({ url: elsewhere })
    expect(router.push).toHaveBeenCalledWith(elsewhere)
    // Its frame then says so.
    await render(<Switched />)
    expect(screen.getByTestId('switched')).toHaveTextContent(ids.household)
  })

  it('is opened as a member’s while it is not yet known who is signed in: its route waits', async () => {
    const { pressed } = await open({ status: 'unknown' })
    pressed({ url: today })
    expect(router.push).toHaveBeenCalledWith(today)
    expect(heldDestination()).toBeNull()
  })

  // expo-router opens the system's links itself: this does what the router does not know to.
  it('by the system is left to the router to open, and noted as the switch it is', async () => {
    householdShown(ids.household)
    await open(member)
    expect(listeners).toHaveLength(1)
    listeners[0]?.({ url: `household-dev://households/${ids.otherHousehold}/today` })
    expect(router.push).not.toHaveBeenCalled()
    expect(router.navigate).not.toHaveBeenCalled()
    // Its frame then says so.
    await render(<Switched />)
    expect(screen.getByTestId('switched')).toHaveTextContent(ids.household)
  })

  it('by the system is held for a visitor, whoever was here before', async () => {
    await render(
      <SessionFixture state={{ status: 'visitor' }} signedOut>
        <Links />
      </SessionFixture>,
    )
    listeners[0]?.({ url: `https://app.household.test${today}` })
    expect(heldDestination()).toBe(today)
    // The router leads there itself, and the screen it reaches sends a visitor to sign in.
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it('by the system does nothing where the link is none of the app’s own', async () => {
    await open({ status: 'visitor' })
    listeners[0]?.({ url: `https://evil.example${today}` })
    listeners[0]?.({ url: `exp+household://expo-development-client/?url=x` })
    expect(heldDestination()).toBeNull()
  })

  it('stops listening as it is taken down', async () => {
    const stop = jest.fn()
    jest.mocked(pushDevice.onPressed).mockReturnValueOnce(stop)
    const view = await render(
      <SessionFixture state={member}>
        <Links />
      </SessionFixture>,
    )
    await view.unmount()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
