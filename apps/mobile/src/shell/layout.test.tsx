// A household's layout on the router itself, and no stand-in for it: the guard, the frame, the
// tab navigator and the bar, as expo-router draws them for an address. What each screen and the
// bar draw has tests of its own (shell.test.tsx, TabBar.test.tsx, frame.test.tsx); this holds
// what only the navigator can show: which slot is open at which address, where a press leads,
// and what going back comes to.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs, createTranslator } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, fireEvent, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { router, Stack } from 'expo-router'
import { renderRouter } from 'expo-router/testing-library'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { answering, json, problem, testClient } from '../api/testing.ts'
import { HouseholdNotAvailable, NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import type { Household } from '../household/data.ts'
import { heldDestination, takeDestination } from '../links/destination.ts'
import { linkArrived, resetSwitched } from '../links/switched.ts'
import type { SessionState } from '../session/context.ts'
import { SessionFixture } from '../session/fixture.tsx'
import { households, ids } from '../test/fixtures.ts'
import { TestProviders } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { Screen } from '../ui/Screen.tsx'
import { Arrange } from './Arrange.tsx'
import { HouseholdHome } from './Home.tsx'
import { HouseholdLayout } from './HouseholdLayout.tsx'
import { HouseholdsLayout } from './HouseholdsLayout.tsx'
import { More } from './More.tsx'
import { Today } from './Today.tsx'
import type { Place } from './tabs.ts'

// The sync group's two, which this layout stands in and draws: neither is this test's to open.
jest.mock('../sync/ReplicaProvider.tsx', () => ({
  ReplicaProvider: ({ children }: { readonly children: unknown }) => children,
}))
jest.mock('../sync/HouseholdBars.tsx', () => ({ HouseholdBars: () => null }))

const en = catalogs.en
const t = createTranslator('en')

const household = (of: { id: string; name: string }): Household => ({
  ...of,
  country: 'CZ',
  timezone: 'Europe/Prague',
  base_currency: 'CZK',
  locale: 'cs',
  my_role: 'owner',
  my_grants: { dashboard: 'view', tasks: 'manage', chat: 'view' },
  entitlement: { state: 'active', can_write: true },
})
const own = household(households.own)
const other = household(households.other)
/** A household the member is not in, by an id that is one. */
const strangers = '0198c0de-0000-7000-8000-00000000a009'

const home = inHousehold.home(ids.household)
const more = inHousehold.more(ids.household)
const arrange = inHousehold.arrange(ids.household)

interface Opening {
  readonly state?: SessionState
  readonly signOut?: () => Promise<void>
}

/** The app at `address`, for a member of the fixtures' two households. */
async function opened(address: string, { state, signOut }: Opening = {}) {
  const api = answering({
    [`GET /households/${ids.household}`]: () => json(200, own),
    [`GET /households/${ids.otherHousehold}`]: () => json(200, other),
    [`GET /households/${strangers}`]: () => problem(404, 'not_found'),
    'GET /households': () => json(200, { items: [own, other] }),
  })
  function Root() {
    return (
      <TestProviders>
        <SessionFixture
          api={testClient(api.transport)}
          {...(state ? { state } : {})}
          {...(signOut ? { signOut } : {})}
        >
          <Stack screenOptions={{ headerShown: false }} />
        </SessionFixture>
      </TestProviders>
    )
  }
  await renderRouter(
    {
      _layout: Root,
      index: () => <Screen testID="route:home" />,
      'sign-in': () => <Screen testID="route:signIn" />,
      'households/_layout': HouseholdsLayout,
      'households/[household]/_layout': HouseholdLayout,
      'households/[household]/index': HouseholdHome,
      'households/[household]/today': Today,
      'households/[household]/more': More,
      'households/[household]/arrange': Arrange,
      'households/[household]/[...rest]': HouseholdNotAvailable,
      '+not-found': NotAvailable,
    },
    { initialUrl: address },
  )
  return api
}

async function shows(testID: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(testID)).toBeOnTheScreen()
  })
}

async function goes(address: string): Promise<void> {
  await act(async () => {
    router.navigate(address)
    await Promise.resolve()
  })
}

/** The slots that say they are open. */
function open(): string[] {
  return screen
    .getAllByRole('tab', { selected: true })
    .map((slot) => String(slot.props.testID).replace('tab-bar:', ''))
}

async function isOpen(place: Place | null): Promise<void> {
  await waitFor(() => {
    expect(
      screen
        .queryAllByRole('tab', { selected: true })
        .map((slot) => String(slot.props.testID).replace('tab-bar:', '')),
    ).toEqual(place === null ? [] : [place])
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  resetSwitched()
  takeDestination()
  jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
  jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
  jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('a household’s layout', () => {
  // This build has no capture surface and no Chat: the bar is three slots (tabs.ts).
  it('draws the household’s Home under its name, with the bar of what its member has', async () => {
    await opened(home)
    await shows('route:household')
    expect(screen.getByTestId('household-frame')).toBeOnTheScreen()
    expect(screen.getByTestId('app-bar:household')).toHaveTextContent(households.own.name)
    expect(screen.getAllByRole('tab').map((slot) => slot.props.testID as string)).toEqual([
      'tab-bar:home',
      'tab-bar:today',
      'tab-bar:more',
    ])
    expect(open()).toEqual(['home'])
  })

  it('opens the place whose slot is pressed, and says which one is open', async () => {
    await opened(home)
    await shows('route:household')
    await userEvent.press(screen.getByRole('tab', { name: en['nav.today'] }))
    await shows('route:today')
    await isOpen('today')
    await userEvent.press(screen.getByRole('tab', { name: en['device.nav.more'] }))
    await shows('route:more')
    await isOpen('more')
    await userEvent.press(screen.getByRole('tab', { name: en['nav.home'] }))
    await isOpen('home')
  })

  it('keeps More open over what is reached from it, and goes back to it', async () => {
    await opened(more)
    await shows('route:more')
    await goes(arrange)
    await shows('route:arrange')
    await isOpen('more')
    // There is something behind it now, and the bar says so.
    const back = await waitFor(() =>
      within(screen.getByTestId('route:arrange')).getByRole('button', {
        name: en[controls.back.labelKey],
      }),
    )
    await userEvent.press(back)
    await isOpen('more')
    expect(router.canGoBack()).toBe(false)
  })

  // Opened by a link with the app closed: nothing is behind it, and the bar is the way on.
  it('draws no way back on a screen that was opened with nothing behind it', async () => {
    await opened(arrange)
    await shows('route:arrange')
    await isOpen('more')
    expect(
      within(screen.getByTestId('route:arrange')).queryByRole('button', {
        name: en[controls.back.labelKey],
      }),
    ).toBeNull()
    await userEvent.press(screen.getByRole('tab', { name: en['nav.home'] }))
    await shows('route:household')
    await isOpen('home')
  })

  // F-17 inside a household: its frame and its bar stay, and no slot says it is open.
  it('draws not available in the household’s frame for an address it has no screen for', async () => {
    await opened(`${home}/settings/members`)
    await shows('route:householdNotFound')
    expect(screen.getByTestId('household-frame')).toBeOnTheScreen()
    await isOpen(null)
    await userEvent.press(screen.getByRole('button', { name: en['ui.not_available.home'] }))
    await shows('route:household')
    await isOpen('home')
  })

  it('draws nothing of the shell for a household the server says is not found', async () => {
    await opened(inHousehold.today(strangers))
    await shows('route:notFound')
    expect(screen.queryByTestId('tab-bar')).toBeNull()
    expect(screen.queryByTestId('household-frame')).toBeNull()
  })

  // The cold start: everything of a household is a member's.
  it('sends a visitor to sign in, with the address held for them', async () => {
    await opened(arrange, { state: { status: 'visitor' } })
    await shows('route:signIn')
    expect(screen.queryByTestId('tab-bar')).toBeNull()
    expect(heldDestination()).toBe(arrange)
  })

  /** The household named in the app bar of the screen in front. */
  const named = () => screen.getAllByTestId('app-bar:household').at(-1)

  // The household is in the address (D-4): a link that names another is the switch.
  it('opens another household over the one on screen for a link that names it, and goes back', async () => {
    await opened(more)
    await shows('route:more')
    // What a pressed notification does (links/Links.tsx).
    linkArrived(ids.otherHousehold)
    await act(async () => {
      router.push(inHousehold.today(ids.otherHousehold))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(named()).toHaveTextContent(households.other.name)
    })
    // The other household's own frame, at the screen the link named, and the switch is said.
    expect(
      within(screen.getByTestId('switched')).getByText(en['shell.switched.body']),
    ).toBeOnTheScreen()
    expect(
      screen.getByRole('button', {
        name: t('shell.switched.back', { household: households.own.name }),
      }),
    ).toBeOnTheScreen()
    expect(screen.getAllByTestId('route:today').length).toBeGreaterThan(0)

    // Back returns to where its member was: the household underneath, as it was left.
    await act(async () => {
      router.back()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(named()).toHaveTextContent(households.own.name)
    })
    expect(screen.getByTestId('route:more')).toBeOnTheScreen()
    expect(screen.queryByTestId('switched')).toBeNull()
  })

  // The banner's own way back, and whatever else leads to another household with no link: the
  // router opens that household on top as well, and nothing is said of it.
  it('opens another household over the one on screen when its member goes there themselves', async () => {
    await opened(more)
    await shows('route:more')
    await goes(inHousehold.today(ids.otherHousehold))
    await waitFor(() => {
      expect(named()).toHaveTextContent(households.other.name)
    })
    expect(screen.queryByTestId('switched')).toBeNull()
    // The household that was open is underneath, as it was left, and is gone back to.
    expect(router.canGoBack()).toBe(true)
    await act(async () => {
      router.back()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(named()).toHaveTextContent(households.own.name)
    })
    expect(screen.getByTestId('route:more')).toBeOnTheScreen()
  })

  /** Says of the bar in front that its slots stand `height` high. */
  async function stands(height: number): Promise<void> {
    const front = screen.getAllByTestId('tab-bar:tabs').at(-1)
    if (front === undefined) throw new Error('no bar is drawn')
    await fireEvent(front, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
    })
  }

  /** How far from the foot of the screen a toast is drawn, once signing out has failed. */
  async function toastStands(): Promise<unknown> {
    await userEvent.press(screen.getByRole('button', { name: en['shell.sign_out.action'] }))
    const toast = await waitFor(() => screen.getByTestId('toast'))
    return StyleSheet.flatten(toast.parent?.props.style as StyleProp<ViewStyle>).paddingBottom
  }

  const refused = () => Promise.reject(new Error('no answer'))

  // A toast stands above the bar, whose height is the bar's to say: it grows with the text.
  it('tells the toasts how high its bar stands', async () => {
    await opened(more, { signOut: refused })
    await shows('route:more')
    await stands(61)
    // The toasts' own room, and the bar's 61 under it.
    expect(await toastStands()).toBe(16 + 61)
  })

  // Two households' bars are drawn at once, one under the other: the toasts are told by one.
  it('keeps the toasts above the bar in front when another household was opened over it and left', async () => {
    await opened(more, { signOut: refused })
    await shows('route:more')
    await stands(61)
    await act(async () => {
      router.push(inHousehold.today(ids.otherHousehold))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(named()).toHaveTextContent(households.other.name)
    })
    await stands(80)
    await act(async () => {
      router.back()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(named()).toHaveTextContent(households.own.name)
    })
    expect(await toastStands()).toBe(16 + 61)
  })
})
