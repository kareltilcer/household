// The dev screens' own sign-in: what it sends, what it does with the answer, and what a refusal
// comes to for whoever cannot see it. Its words are fixtures, so a test reads it by `testID`,
// as the end-to-end flow does.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs, pseudolocalize } from '@household/i18n'
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'
import { version } from '../../../package.json'
import { clientName } from '../../api/client.ts'
import {
  answering,
  json,
  problem,
  testClient,
  unanswered,
  type Answering,
} from '../../api/testing.ts'
import { paths } from '../../app/paths.ts'
import type { SignedIn } from '../../session/context.ts'
import { account, SessionFixture } from '../../session/fixture.tsx'
import { expectAccessible } from '../../test/a11y.ts'
import { ids, people } from '../../test/fixtures.ts'
import { render } from '../../test/render.tsx'
import * as announcer from '../../ui/announce.ts'
import { devMarker } from '../marker.ts'
import { words } from './fixtures.ts'
import DevSignIn from './index.tsx'

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
}))

const me = account()
const tokens = { access_token: 'access-a', refresh_token: 'refresh-a', expires_in: 900 } as const
const typed: { readonly email: string; readonly password: string } = {
  email: people.owner.email,
  password: 'a password nobody uses',
}

const signedIn = jest.fn<(answer: SignedIn) => Promise<void>>()

/** The form for a visitor, whose server answers a sign-in by `login`. */
async function form(
  login: Parameters<typeof answering>[0][string],
  options: Parameters<typeof render>[1] = {},
): Promise<Answering> {
  const api = answering({ 'POST /auth/login': login })
  await render(
    <SessionFixture
      state={{ status: 'visitor' }}
      api={testClient(api.transport)}
      signedIn={signedIn}
    >
      <DevSignIn />
    </SessionFixture>,
    options,
  )
  return api
}

/** Types an address and a password, and presses the form's one button. */
async function submit(values = typed): Promise<void> {
  await fireEvent.changeText(screen.getByTestId('dev-sign-in:email'), values.email)
  await fireEvent.changeText(screen.getByTestId('dev-sign-in:password'), values.password)
  await userEvent.press(screen.getByTestId('dev-sign-in:submit'))
}

const spies = () => ({
  focus: jest.spyOn(announcer, 'focusOn').mockReturnValue(true),
  urgent: jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined),
  polite: jest.spyOn(announcer, 'announce').mockImplementation(() => undefined),
})

/** The name of what each call gave the focus to. */
function focused(spy: ReturnType<typeof spies>['focus']): (string | undefined)[] {
  return spy.mock.calls.map(([target]) => {
    const props: Readonly<Record<string, unknown>> = { ...target.current?.props }
    return typeof props.accessibilityLabel === 'string' ? props.accessibilityLabel : undefined
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  signedIn.mockResolvedValue(undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the dev sign-in form', () => {
  it('is a dev screen, with a field for an address, one for a password, and one button', async () => {
    await form(() => json(200, { user: me, tokens }))
    expect(screen.getByTestId(`${devMarker}:sign-in`)).toBeOnTheScreen()
    expect(screen.getByTestId('dev-sign-in:email')).toBeOnTheScreen()
    expect(screen.getByTestId('dev-sign-in:password')).toBeOnTheScreen()
    expect(screen.getByTestId('dev-sign-in:submit')).toBeOnTheScreen()
    expect(screen.queryByTestId('dev-sign-in:refused')).toBeNull()
    expectAccessible()
  })

  // The contract's device sign-in: `client_type: mobile` names its device, or is refused `422`.
  it('sends the contract’s device sign-in, naming the installation as the session describes it', async () => {
    const api = await form(() => json(200, { user: me, tokens }))
    await submit()
    await waitFor(() => {
      expect(signedIn).toHaveBeenCalledTimes(1)
    })
    expect(api.asked).toHaveLength(1)
    expect(api.asked[0]?.body).toEqual({
      email: typed.email,
      password: typed.password,
      client_type: 'mobile',
      device: { id: ids.device, platform: 'ios', app_version: '0.0.0' },
    })
    expect(api.asked[0]?.headers.get('Household-Client')).toBe(clientName())
    expect(clientName()).toBe(`mobile/${version}`)
  })

  it('hands the answer to the session, then leads to where the app opens', async () => {
    const order: string[] = []
    signedIn.mockImplementation(() => {
      order.push('signed in')
      return Promise.resolve()
    })
    jest.mocked(router.replace).mockImplementation(() => {
      order.push('led on')
    })
    await form(() => json(200, { user: me, tokens }))
    await submit()
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(paths.home.path)
    })
    expect(signedIn).toHaveBeenCalledWith({ user: me, tokens })
    expect(order).toEqual(['signed in', 'led on'])
    // Busy still: idle, it would take a second press that signs in a second time.
    expect(screen.getByTestId('dev-sign-in:submit')).toBeBusy()
  })

  it('is busy while the server is asked, and sends one sign-in for two presses', async () => {
    let answer: (response: Response) => void = () => undefined
    const api = await form(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    await submit()
    const button = screen.getByTestId('dev-sign-in:submit')
    expect(button).toBeBusy()
    await userEvent.press(button)
    await waitFor(() => {
      expect(api.asked).toHaveLength(1)
    })
    await act(() => {
      answer(json(200, { user: me, tokens }))
    })
    await waitFor(() => {
      expect(signedIn).toHaveBeenCalledTimes(1)
    })
  })
})

describe('a sign-in that is refused', () => {
  // D-166's twin: a sentence that arrives beside a field a screen reader is not on is said to
  // nobody who cannot see it.
  it('for a field marks the field in words and moves the focus to it, and announces nothing', async () => {
    const { focus, urgent, polite } = spies()
    await form(() =>
      problem(422, 'validation_failed', { errors: [{ field: '/email', code: 'format' }] }),
    )
    await submit({ email: 'no address', password: typed.password })
    await waitFor(() => {
      expect(focused(focus)).toEqual([words.email])
    })
    expect(screen.getByText(words.emailRefused)).toBeOnTheScreen()
    expect(screen.getByTestId('dev-sign-in:email')).toHaveProp(
      'accessibilityHint',
      words.emailRefused,
    )
    // A field's own sentence is no alert, and no banner stands over the form.
    expect(screen.queryByTestId('dev-sign-in:refused')).toBeNull()
    expect(urgent).not.toHaveBeenCalled()
    expect(polite).not.toHaveBeenCalled()
    expect(signedIn).not.toHaveBeenCalled()
    expect(screen.getByTestId('dev-sign-in:submit')).not.toBeBusy()
    expectAccessible()
  })

  it('for both fields gives the focus to the first of them', async () => {
    const { focus } = spies()
    await form(() =>
      problem(422, 'validation_failed', {
        errors: [
          { field: '/password', code: 'required' },
          { field: '/email', code: 'required' },
        ],
      }),
    )
    await submit({ email: '', password: '' })
    await waitFor(() => {
      expect(focused(focus)).toEqual([words.email])
    })
    expect(screen.getByText(words.passwordRefused)).toBeOnTheScreen()
  })

  it('for no field is said in a banner, at once, and moves no focus', async () => {
    const { focus, urgent } = spies()
    await form(() => problem(401, 'invalid_credentials'))
    await submit()
    await waitFor(() => {
      expect(screen.getByTestId('dev-sign-in:refused')).toHaveTextContent(words.nobody)
    })
    expect(urgent).toHaveBeenCalledTimes(1)
    expect(urgent).toHaveBeenCalledWith(words.nobody)
    expect(focus).not.toHaveBeenCalled()
    expect(signedIn).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expectAccessible()
  })

  it('is said again where it is refused again', async () => {
    const { urgent } = spies()
    await form(() => problem(401, 'invalid_credentials'))
    await submit()
    await waitFor(() => {
      expect(urgent).toHaveBeenCalledTimes(1)
    })
    await userEvent.press(screen.getByTestId('dev-sign-in:submit'))
    await waitFor(() => {
      expect(urgent).toHaveBeenCalledTimes(2)
    })
  })

  // The server's `409`, whose body is a challenge and no problem document.
  it('by an account that asks for a second step says this form answers none', async () => {
    const { urgent } = spies()
    await form(() =>
      json(409, {
        error: 'mfa_required',
        challenge_token: 'a challenge',
        methods: ['totp'],
        recovery_codes_left: 8,
      }),
    )
    await submit()
    await waitFor(() => {
      expect(screen.getByTestId('dev-sign-in:refused')).toHaveTextContent(words.secondStep)
    })
    expect(urgent).toHaveBeenCalledTimes(1)
    expect(signedIn).not.toHaveBeenCalled()
  })

  it('says the server could not be reached where the sign-in got no answer', async () => {
    spies()
    await form(unanswered)
    await submit()
    await waitFor(() => {
      expect(screen.getByTestId('dev-sign-in:refused')).toHaveTextContent(
        catalogs.en['ui.problem.unreachable'],
      )
    })
    expect(screen.getByTestId('dev-sign-in:submit')).not.toBeBusy()
  })

  it('says a refusal for now as the wait it is', async () => {
    spies()
    await form(() => problem(429, 'rate_limited'))
    await submit()
    await waitFor(() => {
      expect(screen.getByTestId('dev-sign-in:refused')).toHaveTextContent(
        catalogs.en['ui.problem.rate_limited'],
      )
    })
  })
})

describe('the form’s words', () => {
  // D-154: a dev screen's words are fixtures, accented as a catalog's are under the pseudo-locale.
  it('are fixtures, accented under the pseudo-locale', async () => {
    await form(() => json(200, { user: me, tokens }), { locale: 'en-XA' })
    expect(screen.getByRole('header')).toHaveTextContent(pseudolocalize(words.title))
    expect(screen.getByTestId('dev-sign-in:submit')).toHaveTextContent(pseudolocalize(words.submit))
  })

  it('survive the largest text', async () => {
    spies()
    await form(() => problem(401, 'invalid_credentials'), { scale: 2 })
    await submit()
    await waitFor(() => {
      expect(screen.getByTestId('dev-sign-in:refused')).toBeOnTheScreen()
    })
    expectAccessible()
  })
})
