// Who a screen is drawn for, and what stands in a screen's place while that is not known or
// could not be read. The web's guards are their twin (apps/web/src/app/guards.tsx).
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { screen, userEvent } from '@testing-library/react-native'
import { paths } from '../app/paths.ts'
import { heldDestination, holdDestination, takeDestination } from '../links/destination.ts'
import { expectAccessible } from '../test/a11y.ts'
import { ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { Screen } from '../ui/Screen.tsx'
import type { SessionState } from './context.ts'
import { account, SessionFixture } from './fixture.tsx'
import { Signed, Unread, VisitorOnly, Waiting } from './guards.tsx'

/** Where the router says the app is, as a test moves it. */
const mockAt = { path: '/' }

// The router's own: a redirect is drawn as where it leads, and the address is the test's.
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react')
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    Redirect: ({ href }: { readonly href: string }) =>
      createElement(View, { testID: `redirect:${href}` }),
    usePathname: () => mockAt.path,
  }
})

const today = `/households/${ids.household}/today`
const member: SessionState = { status: 'member', me: account() }

beforeEach(async () => {
  await AsyncStorage.clear()
  takeDestination()
  mockAt.path = today
  jest.restoreAllMocks()
})

function Inside() {
  return <Screen testID="inside" />
}

describe('a household’s screen', () => {
  it('is drawn for a member', async () => {
    await render(
      <SessionFixture state={member}>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    expect(screen.getByTestId('inside')).toBeOnTheScreen()
  })

  it('is a wait while it is not known who is signed in, and nothing of the screen', async () => {
    await render(
      <SessionFixture state={{ status: 'unknown' }}>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    expect(screen.getByTestId('waiting')).toBeOnTheScreen()
    expect(screen.queryByTestId('inside')).toBeNull()
    // The shape of a screen, said once as loading: never a spinner, and no word drawn.
    expect(screen.getByTestId('skeleton')).toHaveProp(
      'accessibilityLabel',
      catalogs.en['ui.loading'],
    )
    expect(screen.queryByText(catalogs.en['ui.loading'])).toBeNull()
    expectAccessible()
  })

  it('says the server could not be asked, with the way to ask again', async () => {
    const retry = jest.fn()
    await render(
      <SessionFixture state={{ status: 'unreachable' }} retry={retry}>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    expect(
      screen.getByRole('header', { name: catalogs.en['session.unreachable.title'] }),
    ).toBeOnTheScreen()
    expect(screen.getByText(catalogs.en['session.unreachable.body'])).toBeOnTheScreen()
    await userEvent.press(screen.getByRole('button', { name: catalogs.en['ui.retry'] }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('inside')).toBeNull()
    expectAccessible()
  })

  // The cold start: the address somebody was on their way to is held while they sign in.
  it('sends a visitor to sign in, with the address held for them', async () => {
    await render(
      <SessionFixture state={{ status: 'visitor' }}>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    expect(screen.getByTestId(`redirect:${paths.signIn.path}`)).toBeOnTheScreen()
    expect(screen.queryByTestId('inside')).toBeNull()
    expect(heldDestination()).toBe(today)
  })

  // The router says where the app is for every screen alike: as this one gives way to the
  // sign-in, the address it reads is the sign-in's own.
  it('does not take the sign-in’s own address for where somebody was going', async () => {
    const view = await render(
      <SessionFixture state={{ status: 'visitor' }}>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    mockAt.path = paths.signIn.path
    await view.rerender(
      <SessionFixture state={{ status: 'visitor' }}>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    expect(heldDestination()).toBe(today)
  })

  it('holds the address for a member whose sign-in ended under them', async () => {
    await render(
      <SessionFixture state={{ status: 'visitor' }} ended>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    expect(heldDestination()).toBe(today)
  })

  // They were on their way out, and the next person to sign in is not sent to where they were.
  it('holds nothing for a member who signed out themselves', async () => {
    await render(
      <SessionFixture state={{ status: 'visitor' }} signedOut>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    expect(screen.getByTestId(`redirect:${paths.signIn.path}`)).toBeOnTheScreen()
    expect(heldDestination()).toBeNull()
  })

  it('takes the held address once a member has reached a screen: it is opened once', async () => {
    holdDestination(today)
    await render(
      <SessionFixture state={member}>
        <Signed>
          <Inside />
        </Signed>
      </SessionFixture>,
    )
    expect(heldDestination()).toBeNull()
  })
})

describe('a visitor’s screen', () => {
  it('is drawn for a visitor, and while it is not known who is signed in', async () => {
    for (const status of ['visitor', 'unknown', 'unreachable'] as const) {
      const view = await render(
        <SessionFixture state={{ status }}>
          <VisitorOnly>
            <Inside />
          </VisitorOnly>
        </SessionFixture>,
      )
      expect(screen.getByTestId('inside')).toBeOnTheScreen()
      await view.unmount()
    }
  })

  it('sends a member on to the address held for them', async () => {
    holdDestination(today)
    await render(
      <SessionFixture state={member}>
        <VisitorOnly>
          <Inside />
        </VisitorOnly>
      </SessionFixture>,
    )
    expect(screen.getByTestId(`redirect:${today}`)).toBeOnTheScreen()
    expect(screen.queryByTestId('inside')).toBeNull()
  })

  it('sends a member on to where the app opens, where nothing is held', async () => {
    await render(
      <SessionFixture state={member}>
        <VisitorOnly>
          <Inside />
        </VisitorOnly>
      </SessionFixture>,
    )
    expect(screen.getByTestId(`redirect:${paths.home.path}`)).toBeOnTheScreen()
  })
})

describe('what could not be read', () => {
  const title = catalogs.en['shell.households.error.title']
  const body = catalogs.en['shell.households.error.body']

  it('is said aloud as it arrives, at once, and is a header with one way on', async () => {
    const said = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    const retry = jest.fn()
    await render(<Unread title={title} body={body} retry={retry} />)
    expect(said).toHaveBeenCalledTimes(1)
    expect(said).toHaveBeenCalledWith(`${title} ${body}`)
    expect(screen.getByRole('header', { name: title })).toBeOnTheScreen()
    await userEvent.press(screen.getByRole('button', { name: catalogs.en['ui.retry'] }))
    expect(retry).toHaveBeenCalledTimes(1)
    // Asked again with nothing changed, it stands as it was and is not said again.
    expect(said).toHaveBeenCalledTimes(1)
    expectAccessible()
  })

  it('is said again where it is drawn anew, having given way to a wait', async () => {
    const said = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    const unread = <Unread title={title} body={body} retry={() => undefined} />
    const view = await render(unread)
    await view.rerender(<Waiting />)
    await view.rerender(unread)
    expect(said).toHaveBeenCalledTimes(2)
  })

  it('survives the largest text', async () => {
    await render(<Unread title={title} body={body} retry={() => undefined} />, { scale: 2 })
    expectAccessible()
  })
})
