import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { paths } from '../app/paths.ts'
import { holdDestination } from '../session/destination.ts'
import { heldChallenge } from './challenge.ts'
import { noticeState } from './notice.ts'
import { startProvider } from './provider.ts'
import { invalid, open, pending, problem, serve } from './testing.tsx'

// Starting a flow leaves the page for the provider's, which a test's document cannot.
vi.mock(import('./provider.ts'), async (original) => ({
  ...(await original()),
  startProvider: vi.fn(() => Promise.resolve()),
}))

const address = 'jana@example.test'
const password = 'a long enough password'

async function signIn(user: UserEvent, typed: { email?: string; password?: string } = {}) {
  const email = typed.email ?? address
  const secret = typed.password ?? password
  if (email !== '') await user.type(screen.getByLabelText('Email'), email)
  if (secret !== '') await user.type(screen.getByLabelText('Password'), secret)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

const challenge = {
  error: 'mfa_required',
  challenge_token: 'c1',
  methods: ['totp', 'recovery_code'],
  recovery_codes_left: 8,
}

describe('the sign-in screen', () => {
  it('is the page’s one title, in its one landmark, with the ways on from it', async () => {
    open(paths.signIn.path)
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    // A password manager is told which field is which.
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('link', { name: 'Forgot your password' })).toHaveAttribute(
      'href',
      paths.reset.path,
    )
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      paths.register.path,
    )
    // Nothing of a session that ended, of a destination, or of a refusal: none is so.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/signed out|carry on|page you opened/)).not.toBeInTheDocument()
  })

  it('signs in as a web client, asks who is signed in, and opens the app', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/login', () => {
      backend.signIn()
      return Response.json({ tokens: null })
    })
    const { address: at } = open(paths.signIn.path, { backend })
    await signIn(user, { email: `  ${address} ` })
    await waitFor(() => {
      expect(at()).toBe(paths.home.path)
    })
    expect(backend.to('POST /auth/login')).toEqual([
      {
        method: 'POST',
        path: '/auth/login',
        body: { email: address, password, client_type: 'web' },
      },
    ])
    // The session is a cookie no script reads: the app learned whose it is by asking.
    expect(backend.to('GET /me')).toHaveLength(1)
  })

  it('says that signing in leads to the page a visitor opened, and takes them there', async () => {
    const user = userEvent.setup()
    const opened = '/households/h1/sync?tab=conflicts'
    holdDestination(opened)
    const backend = serve()
    backend.on('POST /auth/login', () => {
      backend.signIn()
      return Response.json({ tokens: null })
    })
    const { address: at } = open(paths.signIn.path, { backend })
    expect(
      await screen.findByText('After you sign in, you’ll go to the page you opened.'),
    ).toBeInTheDocument()
    await signIn(user)
    await waitFor(() => {
      expect(at()).toBe(opened)
    })
  })

  it('says one sentence for a sign-in that failed, whatever its cause, and keeps what was typed', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/login', () => problem(401, 'invalid_credentials'))
    const { address: at } = open(paths.signIn.path, { backend })
    await signIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is not correct.')
    // Neither field is marked: the sentence does not say which of the two was wrong.
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByLabelText('Email')).toHaveValue(address)
    expect(screen.getByLabelText('Password')).toHaveValue(password)
    expect(at()).toBe(paths.signIn.path)
  })

  it('says when a limited sign-in may be tried again, with the reset beside it', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/login', () => problem(429, 'rate_limited', {}, { 'Retry-After': '900' }))
    open(paths.signIn.path, { backend })
    await signIn(user)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Too many attempts\. Try again at \d{1,2}:\d{2}/)
    // The server counts by address and by network: the sentence blames no device.
    expect(alert).not.toHaveTextContent(/device/i)
    expect(within(alert).getByRole('link', { name: 'Forgot your password' })).toHaveAttribute(
      'href',
      paths.reset.path,
    )
  })

  it('holds a challenge for the second step, having signed nobody in', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/login', () => Response.json(challenge, { status: 409 }))
    const { address: at } = open(paths.signIn.path, { backend })
    await signIn(user)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Enter your code' }),
    ).toBeInTheDocument()
    expect(at()).toBe(paths.secondStep.path)
    expect(heldChallenge()).toEqual({
      token: 'c1',
      methods: ['totp', 'recovery_code'],
      recoveryCodesLeft: 8,
    })
    expect(backend.to('GET /me')).toHaveLength(0)
  })

  it('goes straight to the recovery code while the authenticator is locked', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/login', () =>
      Response.json({ ...challenge, methods: ['recovery_code'] }, { status: 409 }),
    )
    const { address: at } = open(paths.signIn.path, { backend })
    await signIn(user)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Use a recovery code' }),
    ).toBeInTheDocument()
    expect(at()).toBe(paths.recoveryCode.path)
  })

  it('asks the server nothing for what it would certainly refuse, and says so on the field', async () => {
    const user = userEvent.setup()
    const { backend } = open(paths.signIn.path)
    await screen.findByRole('heading', { level: 1 })
    await signIn(user, { email: '', password: '' })
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAccessibleDescription('Enter your email address.')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password.')
    // The focus is on the first field to put right.
    await waitFor(() => {
      expect(email).toHaveFocus()
    })
    await user.type(email, 'jana')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(email).toHaveAccessibleDescription('That email is missing something.')
    expect(backend.to('POST /auth/login')).toHaveLength(0)
  })

  it('reads a 422 back onto the field it names', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/login', () => invalid('/email', 'format'))
    open(paths.signIn.path, { backend })
    await signIn(user)
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
        'That email is missing something.',
      )
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends one sign-in while the first is on its way, however it is asked for again', async () => {
    const user = userEvent.setup()
    const backend = serve()
    const answer = pending()
    backend.on('POST /auth/login', () => answer.response)
    open(paths.signIn.path, { backend })
    await signIn(user)
    const button = screen.getByRole('button', { name: 'Sign in' })
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-busy', 'true')
    })
    await user.click(button)
    await user.type(screen.getByLabelText('Password'), '{Enter}')
    expect(backend.to('POST /auth/login')).toHaveLength(1)
    answer.answer(problem(401, 'invalid_credentials'))
    await screen.findByRole('alert')
  })

  it('is asked at once though the browser says it has no connection, and is sent by nothing when one returns', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/login', () => problem(401, 'invalid_credentials'))
    open(paths.signIn.path, { backend })
    await screen.findByRole('heading', { level: 1 })
    onlineManager.setOnline(false)
    try {
      await signIn(user)
      // Not held for a connection, with a busy control and no word: it is asked, and answered.
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Email or password is not correct.',
      )
      expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-busy')
    } finally {
      onlineManager.setOnline(true)
    }
    // Nothing waited for the connection: a sign-in sent now would be nobody's.
    expect(backend.to('POST /auth/login')).toHaveLength(1)
  })

  it('says what a failure of the server’s did to what was typed', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/login', () => problem(500, 'internal'))
    open(paths.signIn.path, { backend })
    await signIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong at our end. Nothing you typed was lost. Try again.',
    )
  })
})

describe('the providers on the sign-in screen', () => {
  it('are the ones the server signs in with, and no other', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('GET /auth/oauth', () => Response.json({ providers: ['google'] }))
    open(paths.signIn.path, { backend })
    const google = await screen.findByRole('button', { name: 'Continue with Google' })
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).not.toBeInTheDocument()
    expect(screen.getByText('Or')).toBeInTheDocument()
    await user.click(google)
    expect(startProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', intent: 'sign-in' }),
    )
  })

  it('are Google before Apple where the server has both', async () => {
    const backend = serve()
    backend.on('GET /auth/oauth', () => Response.json({ providers: ['apple', 'google'] }))
    open(paths.signIn.path, { backend })
    await screen.findByRole('button', { name: 'Continue with Apple' })
    const names = screen
      .getAllByRole('button', { name: /^Continue with/ })
      .map((button) => button.textContent)
    expect(names).toEqual(['Continue with Google', 'Continue with Apple'])
  })

  it('are not drawn, nor the word before them, where the server has none or cannot say', async () => {
    const none = open(paths.signIn.path)
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => {
      expect(none.backend.to('GET /auth/oauth')).toHaveLength(1)
    })
    expect(screen.queryByRole('button', { name: /^Continue with/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Or')).not.toBeInTheDocument()
    none.unmount()

    const failing = serve()
    failing.on('GET /auth/oauth', () => problem(404, 'not_found'))
    open(paths.signIn.path, { backend: failing })
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => {
      expect(failing.to('GET /auth/oauth')).toHaveLength(1)
    })
    expect(screen.queryByRole('button', { name: /^Continue with/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Or')).not.toBeInTheDocument()
  })

  it('take a press again on a page the browser kept and shows again, back from the provider’s', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('GET /auth/oauth', () => Response.json({ providers: ['google'] }))
    open(paths.signIn.path, { backend })
    const google = await screen.findByRole('button', { name: 'Continue with Google' })
    const before = vi.mocked(startProvider).mock.calls.length
    await user.click(google)
    // The start is answered and the page is leaving for the provider's: the control stays busy.
    await waitFor(() => {
      expect(google).toHaveAttribute('aria-busy', 'true')
    })
    // Back, to the page as the browser kept it and not one loaded again: the start is put back.
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await waitFor(() => {
      expect(google).not.toHaveAttribute('aria-busy', 'true')
    })
    await user.click(google)
    expect(vi.mocked(startProvider).mock.calls.length - before).toBe(2)
  })

  // Put away while it is on its way, a sign-in's control would be busy no longer and take a
  // second press, and a start's refusal would be said nowhere.
  it('take no press while a sign-in is on its way, which is sent once', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('GET /auth/oauth', () => Response.json({ providers: ['google'] }))
    const answer = pending()
    backend.on('POST /auth/login', () => answer.response)
    open(paths.signIn.path, { backend })
    const google = await screen.findByRole('button', { name: 'Continue with Google' })
    const before = vi.mocked(startProvider).mock.calls.length
    await signIn(user)
    const button = screen.getByRole('button', { name: 'Sign in' })
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-busy', 'true')
    })
    expect(google).toHaveAttribute('aria-disabled', 'true')
    await user.click(google)
    expect(vi.mocked(startProvider).mock.calls.length - before).toBe(0)
    // The sign-in on its way is its control's still, and takes no second press.
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    expect(backend.to('POST /auth/login')).toHaveLength(1)

    answer.answer(problem(401, 'invalid_credentials'))
    await screen.findByRole('alert')
    expect(google).not.toHaveAttribute('aria-disabled')
  })

  it('hold the form and each other while a flow is being started, and say why it could not be', async () => {
    const user = userEvent.setup()
    let fail: (reason: Error) => void = () => undefined
    vi.mocked(startProvider).mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject
        }),
    )
    const backend = serve()
    backend.on('GET /auth/oauth', () => Response.json({ providers: ['google', 'apple'] }))
    backend.on('POST /auth/login', () => problem(401, 'invalid_credentials'))
    open(paths.signIn.path, { backend })
    const google = await screen.findByRole('button', { name: 'Continue with Google' })
    const apple = screen.getByRole('button', { name: 'Continue with Apple' })
    const before = vi.mocked(startProvider).mock.calls.length
    await user.click(google)
    await waitFor(() => {
      expect(google).toHaveAttribute('aria-busy', 'true')
    })
    expect(apple).toHaveAttribute('aria-disabled', 'true')
    await user.click(apple)
    // Asked by whatever submits a form without pressing anything, as a password manager may, by
    // its button, or by Enter in a field, the form sends nothing over the start.
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toHaveAttribute('aria-busy')
    await user.type(screen.getByLabelText('Email'), address)
    await user.type(screen.getByLabelText('Password'), password)
    const form = button.closest('form')
    if (form === null) throw new Error('no form')
    fireEvent.submit(form)
    await user.click(button)
    await user.type(screen.getByLabelText('Password'), '{Enter}')
    expect(backend.to('POST /auth/login')).toHaveLength(0)
    expect(vi.mocked(startProvider).mock.calls.length - before).toBe(1)
    expect(google).toHaveAttribute('aria-busy', 'true')

    fail(new Error('no connection'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    // Answered, the form is a way in again.
    await user.click(button)
    await waitFor(() => {
      expect(backend.to('POST /auth/login')).toHaveLength(1)
    })
  })

  // The page is leaving for the provider's. Where it did not after all, a navigation stopped,
  // nothing else of the screen may be held for a start that has nothing left to answer.
  it('hold nothing once a start is answered, and leave the form a way in', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('GET /auth/oauth', () => Response.json({ providers: ['google', 'apple'] }))
    backend.on('POST /auth/login', () => problem(401, 'invalid_credentials'))
    open(paths.signIn.path, { backend })
    const google = await screen.findByRole('button', { name: 'Continue with Google' })
    const apple = screen.getByRole('button', { name: 'Continue with Apple' })
    const button = screen.getByRole('button', { name: 'Sign in' })
    await user.click(google)
    // Its own control stays busy, and the others are there to be pressed.
    await waitFor(() => {
      expect(apple).not.toHaveAttribute('aria-disabled')
    })
    expect(google).toHaveAttribute('aria-busy', 'true')
    expect(button).not.toHaveAttribute('aria-disabled')
    await signIn(user)
    await waitFor(() => {
      expect(backend.to('POST /auth/login')).toHaveLength(1)
    })
  })

  it('say why a flow could not be started', async () => {
    const user = userEvent.setup()
    vi.mocked(startProvider).mockRejectedValueOnce(new Error('no connection'))
    const backend = serve()
    backend.on('GET /auth/oauth', () => Response.json({ providers: ['apple'] }))
    open(paths.signIn.path, { backend })
    await user.click(await screen.findByRole('button', { name: 'Continue with Apple' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
  })
})

describe('a person sent back to the sign-in', () => {
  it('is told why, by the screen that sent them', async () => {
    open({ pathname: paths.signIn.path, state: noticeState('locked') })
    expect(await screen.findByText(/a recovery code: it unlocks them\.$/)).toBeInTheDocument()
  })

  /** A member on a page anyone is drawn, once the app knows they are one. */
  async function memberAtReset() {
    const backend = serve()
    backend.signIn()
    open(paths.reset.path, { backend })
    await screen.findByRole('heading', { level: 1, name: 'Reset your password' })
    await waitFor(() => {
      expect(backend.to('GET /me')).toHaveLength(1)
    })
    return backend
  }

  it('is told calmly that their session ended', async () => {
    const user = userEvent.setup()
    const backend = await memberAtReset()
    // The session ended elsewhere, and the app hears of it from the answer its request gets.
    backend.on('POST /auth/password-reset', () => problem(401, 'unauthenticated'))
    await user.type(screen.getByLabelText('Email'), address)
    await user.click(screen.getByRole('button', { name: 'Send the link' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('link', { name: 'Back to sign in' }))
    expect(
      await screen.findByText('You were signed out. Sign in again to carry on.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
  })

  it('is told that nothing was lost where a request could not prove it was the app’s own', async () => {
    const user = userEvent.setup()
    const backend = await memberAtReset()
    backend.on('POST /auth/password-reset', () => problem(403, 'csrf_failed'))
    await user.type(screen.getByLabelText('Email'), address)
    await user.click(screen.getByRole('button', { name: 'Send the link' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('link', { name: 'Back to sign in' }))
    expect(
      await screen.findByText('Sign in again to carry on. Nothing was lost.'),
    ).toBeInTheDocument()
  })
})
