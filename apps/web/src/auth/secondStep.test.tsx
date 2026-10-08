import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { paths } from '../app/paths.ts'
import { holdDestination } from '../session/destination.ts'
import { heldChallenge, holdChallenge, type Challenge } from './challenge.ts'
import { open, problem, serve } from './testing.tsx'

const challenge: Challenge = {
  token: 'c1',
  methods: ['totp', 'recovery_code'],
  recoveryCodesLeft: 8,
}

const verify = 'POST /auth/mfa/verify'

/** A server whose second step answers a right code by signing the browser in. */
function admitting() {
  const backend = serve()
  backend.on(verify, () => {
    backend.signIn()
    return Response.json({ tokens: null })
  })
  return backend
}

describe('the second step', () => {
  it('has nothing to answer without a challenge, and begins the sign-in again', async () => {
    // A page loaded again: the challenge was in the memory of the one before it.
    const { address } = open(paths.secondStep.path)
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(address()).toBe(paths.signIn.path)
  })

  it('asks for six digits, and trusts nothing it was not told to', async () => {
    holdChallenge(challenge)
    open(paths.secondStep.path)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Enter your code' }),
    ).toBeInTheDocument()
    const code = screen.getByLabelText('Six-digit code')
    expect(code).toHaveAttribute('inputmode', 'numeric')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    // Trust is opt-in and dated, never the default.
    expect(
      screen.getByRole('checkbox', { name: 'Trust this browser for 30 days' }),
    ).not.toBeChecked()
    // A browser is challenged whenever it is not trusted: the screen does not call it new.
    expect(screen.queryByText(/signed in before/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Use a recovery code instead' })).toHaveAttribute(
      'href',
      paths.recoveryCode.path,
    )
  })

  it('signs in with the code as it was read off the app, untrusted unless the box is ticked', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const backend = admitting()
    const { address } = open(paths.secondStep.path, { backend })
    await user.type(await screen.findByLabelText('Six-digit code'), '417 902')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(address()).toBe(paths.home.path)
    })
    expect(backend.to(verify)).toEqual([
      {
        method: 'POST',
        path: '/auth/mfa/verify',
        body: { challenge_token: 'c1', code: '417902', remember_device: false },
      },
    ])
    // Spent: it answers nothing again.
    expect(heldChallenge()).toBeNull()
  })

  it('trusts the browser where the member asks, and goes on to the page they opened', async () => {
    const user = userEvent.setup()
    const opened = '/households/h1'
    holdDestination(opened)
    holdChallenge(challenge)
    const backend = admitting()
    const { address } = open(paths.secondStep.path, { backend })
    expect(
      await screen.findByText('After you sign in, you’ll go to the page you opened.'),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('Six-digit code'), '417902')
    await user.click(screen.getByRole('checkbox', { name: 'Trust this browser for 30 days' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(address()).toBe(opened)
    })
    expect(backend.to(verify)[0]?.body).toMatchObject({ remember_device: true })
  })

  it('says a wrong code is wrong, with its commonest cause, and leaves the challenge standing', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const backend = serve()
    backend.on(verify, () => problem(401, 'invalid_credentials'))
    const { address } = open(paths.secondStep.path, { backend })
    const code = await screen.findByLabelText('Six-digit code')
    await user.type(code, '000000')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(code).toHaveAccessibleDescription(
        'That code isn’t right. Codes change every 30 seconds — check the app for the current one.',
      )
    })
    await waitFor(() => {
      expect(code).toHaveFocus()
    })
    expect(address()).toBe(paths.secondStep.path)
    expect(heldChallenge()).toBe(challenge)
  })

  it('does not spend an attempt on what is no six digits', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const { backend } = open(paths.secondStep.path)
    const code = await screen.findByLabelText('Six-digit code')
    await user.type(code, '41790')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(code).toHaveAccessibleDescription('Enter the six digits the app shows now.')
    expect(backend.to(verify)).toHaveLength(0)
  })

  it('begins the sign-in again, and says why, when the challenge has ended', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const backend = serve()
    backend.on(verify, () => problem(401, 'unauthenticated'))
    const { address } = open(paths.secondStep.path, { backend })
    await user.type(await screen.findByLabelText('Six-digit code'), '417902')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('That sign-in took too long, so it was stopped. Sign in again.'),
    ).toBeInTheDocument()
    expect(address()).toBe(paths.signIn.path)
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(heldChallenge()).toBeNull()
  })

  it('says a locked authenticator is locked, and what unlocks it', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const backend = serve()
    backend.on(verify, () => problem(423, 'mfa_locked'))
    const { address } = open(paths.secondStep.path, { backend })
    await user.type(await screen.findByLabelText('Six-digit code'), '417902')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText(
        /^Too many wrong codes were entered.*Sign in again and use a recovery code: it unlocks them\.$/,
      ),
    ).toBeInTheDocument()
    expect(address()).toBe(paths.signIn.path)
    expect(heldChallenge()).toBeNull()
  })

  it('says when codes may be tried again', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const backend = serve()
    backend.on(verify, () => problem(429, 'rate_limited', {}, { 'Retry-After': '300' }))
    const { address } = open(paths.secondStep.path, { backend })
    await user.type(await screen.findByLabelText('Six-digit code'), '417902')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Too many attempts\. Try again at \d{1,2}:\d{2}/,
    )
    expect(address()).toBe(paths.secondStep.path)
  })

  it('offers no recovery code where the challenge takes none, and no code where it takes none', async () => {
    holdChallenge({ ...challenge, methods: ['totp'] })
    const first = open(paths.secondStep.path)
    await screen.findByRole('heading', { level: 1, name: 'Enter your code' })
    expect(
      screen.queryByRole('link', { name: 'Use a recovery code instead' }),
    ).not.toBeInTheDocument()
    first.unmount()

    // A locked authenticator: the code's address leads to the recovery code's.
    holdChallenge({ ...challenge, methods: ['recovery_code'] })
    const { address } = open(paths.secondStep.path)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Use a recovery code' }),
    ).toBeInTheDocument()
    expect(address()).toBe(paths.recoveryCode.path)
    expect(screen.queryByRole('link', { name: 'Back to the code' })).not.toBeInTheDocument()
  })
})

describe('a recovery code in the second step’s place', () => {
  it('has nothing to answer without a challenge', async () => {
    const { address } = open(paths.recoveryCode.path)
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(address()).toBe(paths.signIn.path)
  })

  it('says how many are left before one is spent, and that its use is emailed', async () => {
    holdChallenge(challenge)
    open(paths.recoveryCode.path)
    expect(
      await screen.findByText(
        'You have 8 recovery codes left, and this uses one. We’ll email you to say it was used.',
      ),
    ).toBeInTheDocument()
    // Nothing asks for a new set at two.
    expect(screen.queryByText(/new set/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the code' })).toHaveAttribute(
      'href',
      paths.secondStep.path,
    )
  })

  it('says the last one is the last, and says no number the challenge did not give', async () => {
    holdChallenge({ ...challenge, recoveryCodesLeft: 1 })
    const one = open(paths.recoveryCode.path)
    expect(
      await screen.findByText(
        'You have 1 recovery code left, and this uses it. We’ll email you to say it was used.',
      ),
    ).toBeInTheDocument()
    one.unmount()

    holdChallenge({ ...challenge, recoveryCodesLeft: undefined })
    open(paths.recoveryCode.path)
    expect(
      await screen.findByText(
        'This uses one of your recovery codes. We’ll email you to say it was used.',
      ),
    ).toBeInTheDocument()
  })

  it('signs in with the code as it was typed, and trusts no browser by it', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const backend = admitting()
    const { address } = open(paths.recoveryCode.path, { backend })
    await user.type(await screen.findByLabelText('Recovery code'), ' r8hx-2plc ')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(address()).toBe(paths.home.path)
    })
    expect(backend.to(verify)[0]?.body).toEqual({
      challenge_token: 'c1',
      code: 'r8hx-2plc',
      remember_device: false,
    })
    expect(heldChallenge()).toBeNull()
  })

  it('says a code that is wrong or spent in one sentence', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const backend = serve()
    backend.on(verify, () => problem(401, 'invalid_credentials'))
    open(paths.recoveryCode.path, { backend })
    const code = await screen.findByLabelText('Recovery code')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(code).toHaveAccessibleDescription('Enter a recovery code.')
    expect(backend.to(verify)).toHaveLength(0)
    await user.type(code, 'AAAA-AAAA')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(code).toHaveAccessibleDescription(
        'That code isn’t right, or it has already been used.',
      )
    })
  })

  it('answers as the code’s screen does when the challenge has ended', async () => {
    const user = userEvent.setup()
    holdChallenge(challenge)
    const backend = serve()
    backend.on(verify, () => problem(401, 'unauthenticated'))
    const { address } = open(paths.recoveryCode.path, { backend })
    await user.type(await screen.findByLabelText('Recovery code'), 'R8HX-2PLC')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('That sign-in took too long, so it was stopped. Sign in again.'),
    ).toBeInTheDocument()
    expect(address()).toBe(paths.signIn.path)
  })
})
