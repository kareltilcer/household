// Where the app opens: it has no screen of its own, and leads to sign-in or to a household,
// drawing a wait meanwhile, and what could not be read where nothing is kept of it.
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, screen, userEvent, waitFor } from '@testing-library/react-native'
import { answering, json, testClient, unanswered } from '../api/testing.ts'
import { rememberHousehold, type HouseholdSummary } from '../household/data.ts'
import { SessionFixture } from '../session/fixture.tsx'
import { expectAccessible } from '../test/a11y.ts'
import { households, ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { Home } from './Home.tsx'
import { inHousehold, paths } from './paths.ts'

// The router's own: a redirect is drawn as where it leads.
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react')
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    Redirect: ({ href }: { readonly href: string }) =>
      createElement(View, { testID: `redirect:${href}` }),
    usePathname: () => '/',
  }
})

const own: HouseholdSummary = { ...households.own, entitlement: { state: 'active' } }
const other: HouseholdSummary = { ...households.other, entitlement: { state: 'trialing' } }
const suspended = (household: HouseholdSummary): HouseholdSummary => ({
  ...household,
  entitlement: { state: 'suspended' },
})

/** The index for a member whose list of households the server answers with `items`. */
async function opened(items: readonly HouseholdSummary[]) {
  const api = answering({ 'GET /households': () => json(200, { items }) })
  await render(
    <SessionFixture api={testClient(api.transport)}>
      <Home />
    </SessionFixture>,
  )
  return api
}

async function leadsTo(address: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(`redirect:${address}`)).toBeOnTheScreen()
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  jest.restoreAllMocks()
  jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
})

describe('where the app opens', () => {
  it('is sign-in, for a visitor', async () => {
    await render(
      <SessionFixture state={{ status: 'visitor' }}>
        <Home />
      </SessionFixture>,
    )
    expect(screen.getByTestId(`redirect:${paths.signIn.path}`)).toBeOnTheScreen()
  })

  it('is a wait while it is not known who is signed in', async () => {
    await render(
      <SessionFixture state={{ status: 'unknown' }}>
        <Home />
      </SessionFixture>,
    )
    expect(screen.getByTestId('waiting')).toBeOnTheScreen()
    expect(screen.queryByTestId(/^redirect:/)).toBeNull()
  })

  it('says so where the server could not be asked who is signed in, with the way to ask again', async () => {
    const retry = jest.fn()
    await render(
      <SessionFixture state={{ status: 'unreachable' }} retry={retry}>
        <Home />
      </SessionFixture>,
    )
    await userEvent.press(screen.getByRole('button', { name: catalogs.en['ui.retry'] }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('is a member’s first household, on a device they were in none on', async () => {
    await opened([own, other])
    await leadsTo(inHousehold.home(ids.household))
  })

  it('is a wait while a member’s households are read for the first time', async () => {
    let answer: (response: Response) => void = () => undefined
    const api = answering({
      'GET /households': () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    })
    await render(
      <SessionFixture api={testClient(api.transport)}>
        <Home />
      </SessionFixture>,
    )
    expect(screen.getByTestId('waiting')).toBeOnTheScreen()
    await waitFor(() => {
      expect(api.sent('GET /households')).toHaveLength(1)
    })
    await act(() => {
      answer(json(200, { items: [own] }))
    })
    await leadsTo(inHousehold.home(ids.household))
  })

  it('is the household they were last in on this device', async () => {
    rememberHousehold(ids.member, ids.otherHousehold.toUpperCase())
    await opened([own, other])
    await leadsTo(inHousehold.home(ids.otherHousehold))
  })

  it('is their first, where the one they were last in is theirs no longer', async () => {
    rememberHousehold(ids.member, ids.otherHousehold)
    await opened([own])
    await leadsTo(inHousehold.home(ids.household))
  })

  it('is another member’s last household for nobody but them', async () => {
    rememberHousehold(ids.otherMember, ids.otherHousehold)
    await opened([own, other])
    await leadsTo(inHousehold.home(ids.household))
  })

  // D-162: a suspension is no reason to hold a member away from a household that works.
  it('passes over a suspended household while another opens, though it was the last', async () => {
    rememberHousehold(ids.member, ids.household)
    await opened([suspended(own), other])
    await leadsTo(inHousehold.home(ids.otherHousehold))
  })

  it('is the first suspended household, for a member in none that opens', async () => {
    await opened([suspended(own)])
    await leadsTo(inHousehold.home(ids.household))
  })

  it('says a member is in no household, and leads nowhere', async () => {
    await opened([])
    await waitFor(() => {
      expect(
        screen.getByRole('header', { name: catalogs.en['account.households.empty.title'] }),
      ).toBeOnTheScreen()
    })
    expect(screen.queryByTestId(/^redirect:/)).toBeNull()
    expectAccessible()
  })

  it('says the households could not be read where nothing is kept of them, and asks again', async () => {
    let reachable = false
    const api = answering({
      'GET /households': () => (reachable ? json(200, { items: [own] }) : unanswered()),
    })
    await render(
      <SessionFixture api={testClient(api.transport)}>
        <Home />
      </SessionFixture>,
    )
    await waitFor(() => {
      expect(
        screen.getByRole('header', { name: catalogs.en['shell.households.error.title'] }),
      ).toBeOnTheScreen()
    })
    expect(screen.getByText(catalogs.en['shell.households.error.body'])).toBeOnTheScreen()
    reachable = true
    await userEvent.press(screen.getByRole('button', { name: catalogs.en['ui.retry'] }))
    await leadsTo(inHousehold.home(ids.household))
    expect(api.sent('GET /households')).toHaveLength(2)
  })
})
