// The household's frame: what stands in a household's place while it is read, where it could not
// be, and where its address opens nothing; and once it is read, the bars above its screens, the
// notice of a switch a link made, and what it hands every screen under it. The web's
// `household.test.tsx` is its twin.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs, createTranslator } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, userEvent, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { answering, json, problem, testClient, testQueries, unanswered } from '../api/testing.ts'
import { inHousehold } from '../app/paths.ts'
import { householdKey, lastHousehold, type HouseholdSummary } from '../household/data.ts'
import { linkArrived, householdShown, resetSwitched, shownHousehold } from '../links/switched.ts'
import { SessionFixture } from '../session/fixture.tsx'
import { elementsOf, expectAccessible } from '../test/a11y.ts'
import { householdOf, households, ids, summaryOf } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { Button } from '../ui/Button.tsx'
import { arrangementKey } from './arrangement.ts'
import { useArrangement, useHouseholdShown } from './HouseholdContext.tsx'
import { HouseholdFrame } from './HouseholdFrame.tsx'
import type { Arrangement } from './navigation.ts'

/** Whether the frame's own screen is the one in front, as a test says. */
const mockFront = { is: true }

// The router's own: where a control leads is read, and which screen is in front is the test's.
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
  useIsFocused: () => mockFront.is,
  usePathname: () => '/',
  Redirect: () => null,
}))

// The bars above the screens (sync/HouseholdBars.tsx), as a mark of where the frame draws them
// and for which household: what they say has a test of its own.
jest.mock('../sync/HouseholdBars.tsx', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react')
  const { View: Mark } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    HouseholdBars: ({ household }: { readonly household: { readonly id: string } }) =>
      createElement(Mark, { testID: `bars:${household.id}` }),
  }
})

const en = catalogs.en
const t = createTranslator('en')

const own = householdOf({ my_role: 'owner', my_grants: { dashboard: 'view', tasks: 'manage' } })

const route = `GET /households/${ids.household}`
type Answer = () => Response | Promise<Response>

/** Every arrangement a screen under the frame was drawn with, the first one first. */
const handed: unknown[] = []

/** What a screen under the frame is handed: the household's name, and its member's arrangement. */
function Inside() {
  const household = useHouseholdShown()
  const [arrangement, arrange] = useArrangement()
  handed.push(arrangement)
  const pinned: Arrangement = { pinned: ['tasks'], order: [], hidden: [] }
  return (
    <View testID="inside">
      <View testID={`inside:name:${household.name}`} />
      <View testID={`inside:arrangement:${JSON.stringify(arrangement)}`} />
      <Button
        testID="inside:pin"
        onPress={() => {
          arrange(pinned)
        }}
      >
        {en['shell.arrange.pin']}
      </Button>
    </View>
  )
}

function Frame({
  api,
  household = ids.household,
  children = <Inside />,
}: {
  readonly api: ReturnType<typeof answering>
  readonly household?: string
  readonly children?: ReactNode
}) {
  return (
    <SessionFixture api={testClient(api.transport)}>
      <HouseholdFrame household={household}>{children}</HouseholdFrame>
    </SessionFixture>
  )
}

/** The frame of the fixtures' household, whose own address the server answers with `answer`. */
async function opened(answer: Answer, others: readonly HouseholdSummary[] = [summaryOf(own)]) {
  const api = answering({ [route]: answer, 'GET /households': () => json(200, { items: others }) })
  await render(<Frame api={api} />)
  return api
}

async function drawn(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('inside')).toBeOnTheScreen()
  })
  // What the frame asks for once it is drawn, its member's other households, is answered
  // before a test reads on.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

let said: jest.SpiedFunction<typeof announcer.announce>

beforeEach(async () => {
  await AsyncStorage.clear()
  jest.clearAllMocks()
  handed.length = 0
  resetSwitched()
  mockFront.is = true
  said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
  jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a household’s frame, while its household is not read', () => {
  it('draws a wait and nothing of the shell while it is read for the first time', async () => {
    const api = await opened(() => new Promise<Response>(() => undefined))
    await waitFor(() => {
      expect(api.sent(route)).toHaveLength(1)
    })
    expect(screen.getByTestId('waiting')).toBeOnTheScreen()
    expect(screen.queryByTestId('household-frame')).toBeNull()
    expect(screen.queryByTestId('inside')).toBeNull()
    expect(screen.queryByTestId(`bars:${ids.household}`)).toBeNull()
  })

  it('says it could not be read where nothing is kept of it, and asks again', async () => {
    let reachable = false
    const api = await opened(() => (reachable ? json(200, own) : unanswered()))
    await waitFor(() => {
      expect(
        screen.getByRole('header', { name: en['shell.household.error.title'] }),
      ).toBeOnTheScreen()
    })
    expect(screen.getByText(en['shell.household.error.body'])).toBeOnTheScreen()
    expect(screen.queryByTestId('household-frame')).toBeNull()
    expectAccessible()
    reachable = true
    await userEvent.press(screen.getByRole('button', { name: en['ui.retry'] }))
    await drawn()
    expect(api.sent(route)).toHaveLength(2)
  })

  // F-17: a household they left, one that never was and one the platform suspended read the same.
  it('is not available where the server answers that it is not found, and says no more', async () => {
    await opened(() => problem(404, 'not_found'))
    await waitFor(() => {
      expect(screen.getByTestId('route:notFound')).toBeOnTheScreen()
    })
    expect(screen.getByRole('header', { name: en['ui.not_available.title'] })).toBeOnTheScreen()
    expect(screen.queryByTestId('household-frame')).toBeNull()
    expect(screen.queryByText(households.own.name)).toBeNull()
    // No retry: the answer is the answer.
    expect(screen.queryByRole('button', { name: en['ui.retry'] })).toBeNull()
    // The way out is the app's own: there is no household here to go home to.
    await userEvent.press(screen.getByRole('button', { name: en['ui.not_available.home'] }))
    expect(jest.mocked(router.replace).mock.calls).toEqual([['/']])
    // And it is no household its member was last in.
    expect(await lastHousehold(ids.member)).toBeNull()
  })

  // A kept read stands in for a server that cannot be asked, never for one that answered.
  it('is not available over whatever the device kept, once the server says so', async () => {
    let gone = false
    const api = answering({
      [route]: () => (gone ? problem(404, 'not_found') : json(200, own)),
      'GET /households': () => json(200, { items: [summaryOf(own)] }),
    })
    const queries = testQueries()
    await render(
      <QueryClientProvider client={queries}>
        <Frame api={api} />
      </QueryClientProvider>,
    )
    await drawn()
    gone = true
    await act(async () => {
      await queries.invalidateQueries({ queryKey: householdKey(ids.household) })
    })
    await waitFor(() => {
      expect(screen.getByTestId('route:notFound')).toBeOnTheScreen()
    })
    expect(screen.queryByTestId('inside')).toBeNull()
    expect(screen.queryByTestId('household-frame')).toBeNull()
  })

  it('asks the server nothing of an address that is no household’s id', async () => {
    const api = answering({})
    await render(<Frame api={api} household="settings" />)
    expect(screen.getByTestId('route:notFound')).toBeOnTheScreen()
    expect(api.asked).toHaveLength(0)
  })
})

describe('a household’s frame, once its household is read', () => {
  it('draws the screens, and above them the household’s bars', async () => {
    await opened(() => json(200, own))
    await drawn()
    const frame = screen.getByTestId('household-frame')
    const order = elementsOf(frame).map((element) => String(element.props.testID))
    // The household's bars first, told whose they are; the screens under them.
    expect(order.indexOf(`bars:${ids.household}`)).toBeGreaterThan(-1)
    expect(order.indexOf(`bars:${ids.household}`)).toBeLessThan(order.indexOf('inside'))
    expect(screen.getByTestId(`inside:name:${households.own.name}`)).toBeOnTheScreen()
    expectAccessible()
  })

  it('takes the top of the device for the bars, so no screen under it does', async () => {
    const api = answering({
      [route]: () => json(200, own),
      'GET /households': () => json(200, { items: [summaryOf(own)] }),
    })
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <Frame api={api} />
      </SafeAreaProvider>,
    )
    await drawn()
    const style = StyleSheet.flatten(
      screen.getByTestId('household-frame').props.style as StyleProp<ViewStyle>,
    )
    expect(style).toMatchObject({ flex: 1, paddingTop: 47 })
  })

  // Where the app opens next (D-162).
  it('remembers the household as the one its member was last in on this device', async () => {
    await opened(() => json(200, own))
    await drawn()
    await waitFor(async () => {
      expect(await lastHousehold(ids.member)).toBe(ids.household)
    })
  })

  it('hands down the arrangement this device kept', async () => {
    const kept: Arrangement = { pinned: [], order: ['tasks'], hidden: ['shopping'] }
    await AsyncStorage.setItem(arrangementKey(ids.member, ids.household), JSON.stringify(kept))
    await opened(() => json(200, own))
    await drawn()
    expect(screen.getByTestId(`inside:arrangement:${JSON.stringify(kept)}`)).toBeOnTheScreen()
  })

  // A device's storage answers when it answers: no list is drawn in the product's order for a
  // moment, or in none, and then in its member's.
  it('draws nothing of the shell until the device has said how its member arranged the modules', async () => {
    const kept: Arrangement = { pinned: ['tasks'], order: [], hidden: [] }
    const key = arrangementKey(ids.member, ids.household)
    // The device's storage as a test has it, which answers at once: this one question it is
    // made to answer when the test says.
    const getItem = jest.mocked(AsyncStorage.getItem)
    const atOnce = getItem.getMockImplementation() ?? (() => Promise.resolve(null))
    let answer: (stored: string | null) => void = () => undefined
    getItem.mockImplementation((asked, ...rest) =>
      asked === key
        ? new Promise<string | null>((resolve) => {
            answer = resolve
          })
        : atOnce(asked, ...rest),
    )
    try {
      const api = await opened(() => json(200, own))
      await waitFor(() => {
        expect(api.sent(route)).toHaveLength(1)
      })
      // The household has been read, and the device has not answered yet.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(screen.getByTestId('waiting')).toBeOnTheScreen()
      expect(screen.queryByTestId('household-frame')).toBeNull()
      expect(handed).toEqual([])

      await act(async () => {
        answer(JSON.stringify(kept))
        await Promise.resolve()
      })
      await drawn()
      expect(handed[0]).toEqual(kept)
    } finally {
      getItem.mockImplementation(atOnce)
    }
  })

  it('keeps a change to the arrangement on this device, for this member and this household', async () => {
    await opened(() => json(200, own))
    await drawn()
    await userEvent.press(screen.getByTestId('inside:pin'))
    const pinned = JSON.stringify({ pinned: ['tasks'], order: [], hidden: [] })
    // Its member's at once, and the device's as soon as it has written it.
    expect(screen.getByTestId(`inside:arrangement:${pinned}`)).toBeOnTheScreen()
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(arrangementKey(ids.member, ids.household))).toBe(pinned)
    })
    expect(await AsyncStorage.getItem(arrangementKey(ids.otherMember, ids.household))).toBeNull()
  })
})

describe('the notice that a link changed the household', () => {
  const others = [summaryOf(own), summaryOf(households.other)]
  const back = t('shell.switched.back', { household: households.other.name })

  /** A link arrives for the fixtures' household while the other one is on screen. */
  function arrive() {
    householdShown(ids.otherHousehold)
    linkArrived(ids.household)
  }

  it('says the switch as it arrives, with the way back and a control that puts it away', async () => {
    arrive()
    await opened(() => json(200, own), others)
    await drawn()
    await waitFor(() => {
      expect(screen.getByTestId('switched')).toBeOnTheScreen()
    })
    expect(screen.getByText(en['shell.switched.body'])).toBeOnTheScreen()
    // Said aloud, once the screen reader has finished: everything else on screen changed.
    expect(said).toHaveBeenCalledWith(en['shell.switched.body'])
    // Above the screens, in the frame, under the bars' place.
    const order = elementsOf(screen.getByTestId('household-frame')).map((element) =>
      String(element.props.testID),
    )
    expect(order.indexOf(`bars:${ids.household}`)).toBeLessThan(order.indexOf('switched'))
    expect(order.indexOf('switched')).toBeLessThan(order.indexOf('inside'))
    expectAccessible()

    await userEvent.press(screen.getByRole('button', { name: back }))
    expect(jest.mocked(router.navigate).mock.calls).toEqual([
      [inHousehold.home(ids.otherHousehold)],
    ])
    await userEvent.press(screen.getByRole('button', { name: en[controls.dismiss.labelKey] }))
    expect(screen.queryByTestId('switched')).toBeNull()
  })

  it('is not drawn for the first household the app opens, nor for one its member chose', async () => {
    await opened(() => json(200, own), others)
    await drawn()
    expect(screen.queryByTestId('switched')).toBeNull()
    expect(said).not.toHaveBeenCalled()
    expect(shownHousehold()).toBe(ids.household)
  })

  // One they have left since is named to nobody, and one suspended since opens no household.
  it.each([
    ['is theirs no longer', [summaryOf(own)]],
    ['the platform has suspended', [summaryOf(own), summaryOf(households.other, 'suspended')]],
  ])('names no household that %s', async (_, list) => {
    arrive()
    await opened(() => json(200, own), list)
    await drawn()
    await waitFor(() => {
      expect(shownHousehold()).toBe(ids.household)
    })
    expect(screen.queryByTestId('switched')).toBeNull()
    expect(screen.queryByText(households.other.name)).toBeNull()
  })

  // A stack keeps the household a link was opened over underneath the one it opened.
  it('is the frame in front’s to say: one underneath does not say its household is on screen', async () => {
    householdShown(ids.otherHousehold)
    mockFront.is = false
    await opened(() => json(200, own), others)
    await drawn()
    expect(shownHousehold()).toBe(ids.otherHousehold)
  })
})
