// Where a visitor stands until the sign-in's own screens are built: the app's name, the notice
// of a sign-in that ended, and that signing in leads somewhere.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, screen, userEvent } from '@testing-library/react-native'
import { router } from 'expo-router'
import { inHousehold, paths } from '../app/paths.ts'
import { holdDestination, takeDestination } from '../links/destination.ts'
import { expectAccessible } from '../test/a11y.ts'
import { ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { account, SessionFixture } from './fixture.tsx'
import { SignIn } from './SignIn.tsx'

// The router's own: a redirect is drawn as where it leads.
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react')
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    Redirect: ({ href }: { readonly href: string }) =>
      createElement(View, { testID: `redirect:${href}` }),
    usePathname: () => '/sign-in',
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  }
})

const today = inHousehold.today(ids.household)
const ended = catalogs.en['device.session.ended']

/** The sign-in screen for a visitor, whose sign-in ended or did not. */
function visitor(over: { readonly ended?: boolean } = {}) {
  return (
    <SessionFixture state={{ status: 'visitor' }} ended={over.ended ?? false}>
      <SignIn />
    </SessionFixture>
  )
}

beforeEach(async () => {
  await AsyncStorage.clear()
  takeDestination()
  jest.clearAllMocks()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the sign-in screen', () => {
  it('is the app’s, by name, and says nothing else to a visitor who only arrived', async () => {
    await render(visitor())
    expect(screen.getByTestId('route:signIn')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: catalogs.en['app.name'] })).toBeOnTheScreen()
    expect(screen.queryByTestId('sign-in:ended')).toBeNull()
    expect(screen.queryByTestId('sign-in:destination')).toBeNull()
    expectAccessible()
  })

  it('sends a member on: to the address held for them, or to where the app opens', async () => {
    const member = { status: 'member', me: account() } as const
    const view = await render(
      <SessionFixture state={member}>
        <SignIn />
      </SessionFixture>,
    )
    expect(screen.getByTestId(`redirect:${paths.home.path}`)).toBeOnTheScreen()
    expect(screen.queryByTestId('route:signIn')).toBeNull()
    await view.unmount()
    holdDestination(today)
    await render(
      <SessionFixture state={member}>
        <SignIn />
      </SessionFixture>,
    )
    expect(screen.getByTestId(`redirect:${today}`)).toBeOnTheScreen()
  })
})

describe('a sign-in that ended', () => {
  it('is said in one calm sentence, which names no cause', async () => {
    await render(visitor({ ended: true }))
    expect(screen.getByTestId('sign-in:ended')).toHaveTextContent(ended)
    // Calm is the decision: no failure's tone, and no word of why.
    expect(screen.queryByTestId('banner:danger')).toBeNull()
    expect(ended).not.toMatch(/password|reused|another device|stolen|security/i)
    expect(ended).toMatch(/signed out on this device/)
    expect(ended).toMatch(/removed/)
    expectAccessible()
  })

  // A screen that opens with it reads it in its place, as it reads everything on it.
  it('is not announced where the screen opened with it', async () => {
    const said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    const urgent = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    await render(visitor({ ended: true }))
    expect(said).not.toHaveBeenCalled()
    expect(urgent).not.toHaveBeenCalled()
  })

  it('is announced, politely, where it arrives while its reader is on the screen', async () => {
    const said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    const urgent = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    const view = await render(visitor())
    expect(said).not.toHaveBeenCalled()
    await view.rerender(visitor({ ended: true }))
    expect(screen.getByTestId('sign-in:ended')).toBeOnTheScreen()
    expect(said).toHaveBeenCalledTimes(1)
    expect(said).toHaveBeenCalledWith(ended)
    expect(urgent).not.toHaveBeenCalled()
  })

  it('survives the largest text, in the longest language', async () => {
    holdDestination(today)
    await render(visitor({ ended: true }), { locale: 'de', scale: 2 })
    expect(screen.getByTestId('sign-in:ended')).toHaveTextContent(
      catalogs.de['device.session.ended'],
    )
    expectAccessible()
  })
})

describe('an address held through the sign-in', () => {
  it('is said to lead somewhere, for as long as it is held', async () => {
    holdDestination(today)
    await render(visitor())
    expect(screen.getByTestId('sign-in:destination')).toHaveTextContent(
      catalogs.en['device.links.destination'],
    )
    await act(() => {
      takeDestination()
    })
    expect(screen.queryByTestId('sign-in:destination')).toBeNull()
  })

  it('is said as it arrives: a notification pressed while the screen is drawn', async () => {
    await render(visitor())
    expect(screen.queryByTestId('sign-in:destination')).toBeNull()
    await act(() => {
      holdDestination(today)
    })
    expect(screen.getByTestId('sign-in:destination')).toBeOnTheScreen()
  })
})

describe('the way to the dev screens’ sign-in', () => {
  it('is drawn in a build that holds the dev screens, and leads there', async () => {
    await render(visitor())
    await userEvent.press(screen.getByTestId('sign-in:dev'))
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith(paths.devSignIn.path)
  })

  // D-154: a dev-only screen is in no build a store serves, and neither is a way to one.
  it('is absent from a build that does not', async () => {
    Object.assign(globalThis, { __DEV__: false })
    try {
      await render(visitor())
      expect(screen.getByTestId('route:signIn')).toBeOnTheScreen()
      expect(screen.queryByTestId('sign-in:dev')).toBeNull()
      expect(screen.queryByRole('button')).toBeNull()
    } finally {
      Object.assign(globalThis, { __DEV__: true })
    }
  })
})
