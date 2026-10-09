// How an account signs in, as a member changes it: the password and each refusal the server has
// a sentence for, the second step's two confirmations, and Google and Apple where the server
// signs in with them.
import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startProvider } from '../auth/provider.ts'
import { createServer, invalid, jana, noContent, open, problem, type Server } from './testing.tsx'

// Starting a link leaves the page for the provider's own, which no test follows.
vi.mock('../auth/provider.ts', async (original) => ({
  ...(await original<typeof import('../auth/provider.ts')>()),
  startProvider: vi.fn(() => Promise.resolve()),
}))

beforeEach(() => {
  vi.mocked(startProvider).mockClear()
})

const title = 'Signing in'

async function security(server: Server = createServer()) {
  const opened = open('/account/security', server)
  await screen.findByRole('heading', { level: 1, name: title })
  return opened
}

const codes = [
  '7QK2-M4VD',
  'R8HX-2PLC',
  '94BN-TZQ6',
  'KD3F-8WMR',
  'X2VP-6JHT',
  '5MCR-QB9K',
  'TN7D-3XFW',
  'H6JQ-VZ24',
  '2PWL-8KRN',
  'B9XT-M5DQ',
]

describe('changing the password', () => {
  it('needs the current one, and says every other browser and device is signed out', async () => {
    const server = createServer()
    server.on('POST /auth/password', noContent)
    const { user } = await security(server)
    expect(
      screen.getByText(
        'Changing it signs out every other browser and device. This browser stays signed in.',
      ),
    ).toBeInTheDocument()
    const current = screen.getByLabelText('Current password')
    const next = screen.getByLabelText('New password')
    await user.type(current, 'the old password')
    await user.type(next, 'a much longer new one')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(
      await screen.findByText(
        'Password changed. Every other browser and device has been signed out.',
      ),
    ).toBeInTheDocument()
    expect(await server.body('POST /auth/password')).toEqual({
      current_password: 'the old password',
      new_password: 'a much longer new one',
    })
    expect(current).toHaveValue('')
    expect(next).toHaveValue('')
  })

  it('says a wrong current password is not the current password', async () => {
    const server = createServer()
    server.on('POST /auth/password', () => problem(401, 'invalid_credentials'))
    const { user, router } = await security(server)
    await user.type(screen.getByLabelText('Current password'), 'not the password')
    await user.type(screen.getByLabelText('New password'), 'a much longer new one')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Current password')).toHaveAccessibleDescription(
        expect.stringContaining('That isn’t your current password.'),
      )
    })
    // The focus is on the field that was refused, whose sentence is read with it.
    await waitFor(() => {
      expect(screen.getByLabelText('Current password')).toHaveFocus()
    })
    // A wrong password is not a session that ended: the member is where they were.
    expect(router.state.location.pathname).toBe('/account/security')
    expect(screen.getByLabelText('New password')).toHaveValue('a much longer new one')
  })

  it('refuses a breached password by saying what the list is, and nothing of a fingerprint', async () => {
    const server = createServer()
    server.on('POST /auth/password', () => invalid('/new_password'))
    const { user } = await security(server)
    await user.type(screen.getByLabelText('Current password'), 'the old password')
    await user.type(screen.getByLabelText('New password'), 'password1234')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => {
      expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
        expect.stringContaining(
          'This password is on a public list of passwords taken from other services, so it is one of the first things anyone would try.',
        ),
      )
    })
    expect(document.body).not.toHaveTextContent(/fingerprint/i)
  })

  it('asks for twelve characters before it asks the server', async () => {
    const server = createServer()
    const { user } = await security(server)
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByLabelText('Current password')).toHaveAccessibleDescription(
      expect.stringContaining('Enter your current password.'),
    )
    await user.type(screen.getByLabelText('Current password'), 'the old password')
    await user.type(screen.getByLabelText('New password'), 'elevenchars')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
      expect.stringContaining('Twelve characters or more.'),
    )
    expect(server.to('POST /auth/password')).toHaveLength(0)
    // Counted in characters, as the contract counts them: eleven, the last of them two units long.
    await user.clear(screen.getByLabelText('New password'))
    await user.click(screen.getByLabelText('New password'))
    await user.paste('elevenchar\u{1d4b3}')
    expect(screen.getByLabelText('New password')).toHaveValue('elevenchar\u{1d4b3}')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
      expect.stringContaining('Twelve characters or more.'),
    )
    expect(server.to('POST /auth/password')).toHaveLength(0)
  })

  it('says when to try again after too many attempts', async () => {
    const server = createServer()
    server.on('POST /auth/password', () =>
      problem(429, 'rate_limited', {}, { 'Retry-After': '120' }),
    )
    const { user } = await security(server)
    await user.type(screen.getByLabelText('Current password'), 'the old password')
    await user.type(screen.getByLabelText('New password'), 'a much longer new one')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText(/^Too many attempts\. Try again at \d/)).toBeInTheDocument()
  })

  it('says an account with no password signs in with Google or Apple, and how to set one', async () => {
    await security(createServer({ ...jana, credentials: ['google'] }))
    expect(
      screen.getByText(
        'This account signs in with Google or Apple and has no password. A password reset sets one.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reset your password' })).toHaveAttribute(
      'href',
      '/reset',
    )
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  })
})

describe('the second step', () => {
  it('leads to setting it up while it is off', async () => {
    await security()
    expect(screen.getByRole('link', { name: 'Add a second step' })).toHaveAttribute(
      'href',
      '/account/2fa',
    )
    expect(screen.queryByRole('button', { name: 'Turn it off' })).not.toBeInTheDocument()
  })

  it('says how many recovery codes are left, and no more of them than that', async () => {
    await security(createServer({ ...jana, mfa_enabled: true, mfa_recovery_codes_left: 8 }))
    expect(screen.getByText('8 recovery codes left')).toBeInTheDocument()
    expect(screen.queryByText('Make a new set before they run out.')).not.toBeInTheDocument()
  })

  it('says to make a new set when they are nearly gone', async () => {
    await security(createServer({ ...jana, mfa_enabled: true, mfa_recovery_codes_left: 1 }))
    expect(screen.getByText('1 recovery code left')).toBeInTheDocument()
    expect(screen.getByText('Make a new set before they run out.')).toBeInTheDocument()
  })

  it('makes new recovery codes for the password, shows them once, and asks again before it lets go', async () => {
    const server = createServer({ ...jana, mfa_enabled: true, mfa_recovery_codes_left: 2 })
    server.on('POST /auth/mfa/recovery-codes', () => {
      server.me = { ...server.me, mfa_recovery_codes_left: 10 }
      return Response.json({ recovery_codes: codes })
    })
    const { user } = await security(server)
    await user.click(screen.getByRole('button', { name: 'Make new recovery codes' }))
    const dialog = screen.getByRole('dialog', { name: 'Make new recovery codes?' })
    expect(dialog).toHaveAccessibleDescription(
      'The codes you have now stop working the moment the new ten are made. Your password confirms it is you.',
    )
    await user.type(within(dialog).getByLabelText('Password'), 'the password')
    await user.click(within(dialog).getByRole('button', { name: 'Make new codes' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ten codes, in case the app is gone' }),
    ).toBeInTheDocument()
    expect(await server.body('POST /auth/mfa/recovery-codes')).toEqual({ password: 'the password' })
    const list = screen.getByRole('list', { name: 'Recovery codes' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((code) => code.textContent),
    ).toEqual(codes)

    // Finish is there before the box is ticked, and asks again rather than sitting dead.
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(
      await screen.findByText('Tick the box once you have saved them. They are not shown again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'I have saved them' })).toHaveFocus()
    await user.click(screen.getByRole('checkbox', { name: 'I have saved them' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    // Afterwards the account says how many are left, and lists none.
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(await screen.findByText('10 recovery codes left')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(codes[0] ?? '')
  })

  it('says a wrong password is wrong, and keeps the question open', async () => {
    const server = createServer({ ...jana, mfa_enabled: true, mfa_recovery_codes_left: 8 })
    server.on('POST /auth/mfa/recovery-codes', () => problem(401, 'invalid_credentials'))
    const { user } = await security(server)
    await user.click(screen.getByRole('button', { name: 'Make new recovery codes' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Make new codes' }))
    expect(within(dialog).getByLabelText('Password')).toHaveAccessibleDescription(
      expect.stringContaining('Enter your password.'),
    )
    // The focus is on the field each time it is refused, from the control that asked.
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Password')).toHaveFocus()
    })
    await user.type(within(dialog).getByLabelText('Password'), 'not it')
    await user.click(within(dialog).getByRole('button', { name: 'Make new codes' }))
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Password')).toHaveAccessibleDescription(
        expect.stringContaining('That isn’t your password.'),
      )
    })
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Password')).toHaveFocus()
    })
    expect(within(dialog).getByLabelText('Password')).toHaveValue('not it')
  })

  it('turns it off for the password, saying what goes, with no undo', async () => {
    const server = createServer({ ...jana, mfa_enabled: true, mfa_recovery_codes_left: 8 })
    server.on('POST /auth/mfa/disable', () => {
      server.me = { ...server.me, mfa_enabled: false, mfa_recovery_codes_left: null }
      return noContent()
    })
    const { user } = await security(server)
    await user.click(screen.getByRole('button', { name: 'Turn it off' }))
    const dialog = screen.getByRole('dialog', { name: 'Turn off the second step?' })
    expect(dialog).toHaveAccessibleDescription(
      'The authenticator app, its recovery codes and every trusted browser and device go. Signing in will ask for your password alone. This cannot be undone: turning it on again is setting it up again.',
    )
    await user.type(within(dialog).getByLabelText('Password'), 'the password')
    await user.click(within(dialog).getByRole('button', { name: 'Turn off the second step' }))

    expect(await screen.findByText('The second step is off.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(await server.body('POST /auth/mfa/disable')).toEqual({ password: 'the password' })
    // The account is read again, and the section says what is so.
    expect(await screen.findByRole('link', { name: 'Add a second step' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the question without asking the server', async () => {
    const server = createServer({ ...jana, mfa_enabled: true, mfa_recovery_codes_left: 8 })
    const { user } = await security(server)
    await user.click(screen.getByRole('button', { name: 'Turn it off' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to('POST /auth/mfa/disable')).toHaveLength(0)
  })
})

describe('Google and Apple', () => {
  function configured(server: Server, providers: readonly string[]) {
    server.on('GET /auth/oauth', () => Response.json({ providers }))
  }

  it('are offered only where the server signs in with them', async () => {
    const server = createServer()
    configured(server, ['google'])
    await security(server)
    const list = await screen.findByRole('list', { name: 'Google and Apple' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByRole('button', { name: 'Connect Google' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect Apple' })).not.toBeInTheDocument()
  })

  it('are not drawn at all where the server signs in with neither', async () => {
    const server = createServer()
    configured(server, [])
    await security(server)
    await waitFor(() => {
      expect(server.to('GET /auth/oauth')).toHaveLength(1)
    })
    expect(screen.queryByRole('heading', { name: 'Google and Apple' })).not.toBeInTheDocument()
  })

  it('begin a link that comes back to this screen', async () => {
    const server = createServer()
    configured(server, ['google', 'apple'])
    const { user } = await security(server)
    await user.click(await screen.findByRole('button', { name: 'Connect Apple' }))
    await waitFor(() => {
      expect(startProvider).toHaveBeenCalledTimes(1)
    })
    expect(vi.mocked(startProvider).mock.calls[0]?.[0]).toMatchObject({
      provider: 'apple',
      intent: 'link',
      returnTo: '/account/security',
    })
  })

  it('take a press again on a page the browser kept and shows again, back from the provider’s', async () => {
    const server = createServer()
    configured(server, ['google'])
    const { user } = await security(server)
    const connect = await screen.findByRole('button', { name: 'Connect Google' })
    await user.click(connect)
    // The page is leaving for the provider's, and its control stays busy meanwhile.
    await waitFor(() => {
      expect(connect).toHaveAttribute('aria-busy', 'true')
    })
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await waitFor(() => {
      expect(connect).not.toHaveAttribute('aria-busy', 'true')
    })
    await user.click(connect)
    expect(startProvider).toHaveBeenCalledTimes(2)
  })

  it('disconnect one that is connected, and say so', async () => {
    const server = createServer({ ...jana, credentials: ['password', 'google'] })
    configured(server, ['google', 'apple'])
    server.on('DELETE /auth/oauth/google', () => {
      server.me = { ...server.me, credentials: ['password'] }
      return noContent()
    })
    const { user } = await security(server)
    await user.click(await screen.findByRole('button', { name: 'Disconnect Google' }))
    expect(
      await screen.findByText('Google is disconnected and no longer signs you in.'),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Connect Google' })).toBeInTheDocument()
  })

  it('refuse to disconnect the only way an account signs in, and say what to do first', async () => {
    const server = createServer({ ...jana, credentials: ['google'] })
    configured(server, ['google'])
    server.on('DELETE /auth/oauth/google', () => problem(409, 'only_credential'))
    const { user } = await security(server)
    await user.click(await screen.findByRole('button', { name: 'Disconnect Google' }))
    expect(
      await screen.findByText(
        'Google is the only way you sign in, so it can’t be disconnected. Set a password first: a password reset sets one.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Reset your password' })[0]).toHaveAttribute(
      'href',
      '/reset',
    )
  })

  // Put away while it is on its way, a disconnection's control would be busy no longer, and a
  // refusal of it would be said nowhere.
  it('take no press while one is being disconnected, and say what became of it', async () => {
    const server = createServer({ ...jana, credentials: ['google'] })
    configured(server, ['google', 'apple'])
    let refuse: () => void = () => undefined
    server.on(
      'DELETE /auth/oauth/google',
      () =>
        new Promise<Response>((resolve) => {
          refuse = () => {
            resolve(problem(409, 'only_credential'))
          }
        }),
    )
    const { user } = await security(server)
    const disconnect = await screen.findByRole('button', { name: 'Disconnect Google' })
    const connect = screen.getByRole('button', { name: 'Connect Apple' })
    await user.click(disconnect)
    await waitFor(() => {
      expect(server.to('DELETE /auth/oauth/google')).toHaveLength(1)
    })
    expect(disconnect).toHaveAttribute('aria-busy', 'true')
    expect(connect).toHaveAttribute('aria-disabled', 'true')
    await user.click(connect)
    await user.click(disconnect)
    expect(startProvider).not.toHaveBeenCalled()
    expect(disconnect).toHaveAttribute('aria-busy', 'true')

    refuse()
    expect(
      await screen.findByText(
        'Google is the only way you sign in, so it can’t be disconnected. Set a password first: a password reset sets one.',
      ),
    ).toBeInTheDocument()
    expect(server.to('DELETE /auth/oauth/google')).toHaveLength(1)
    // Answered, the other is there to be pressed.
    expect(connect).not.toHaveAttribute('aria-disabled')
  })

  it('take no press while a link is being begun, and say why it could not be', async () => {
    const server = createServer({ ...jana, credentials: ['password', 'google'] })
    configured(server, ['google', 'apple'])
    let fail: (reason: Error) => void = () => undefined
    vi.mocked(startProvider).mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject
        }),
    )
    const { user } = await security(server)
    const connect = await screen.findByRole('button', { name: 'Connect Apple' })
    const disconnect = screen.getByRole('button', { name: 'Disconnect Google' })
    await user.click(connect)
    await waitFor(() => {
      expect(connect).toHaveAttribute('aria-busy', 'true')
    })
    expect(disconnect).toHaveAttribute('aria-disabled', 'true')
    await user.click(disconnect)
    expect(server.to('DELETE /auth/oauth/google')).toHaveLength(0)
    expect(connect).toHaveAttribute('aria-busy', 'true')

    fail(new Error('no connection'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    expect(startProvider).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveAttribute('aria-disabled')
  })

  it('are said not to have been read, and said again where asking again comes to nothing', async () => {
    const server = createServer()
    // A server that cannot be reached, each request failing when the test says it has.
    let fail: () => void = () => undefined
    server.on(
      'GET /auth/oauth',
      () =>
        new Promise<Response>((_, reject) => {
          fail = () => {
            reject(new TypeError('offline'))
          }
        }),
    )
    const { user } = await security(server)
    const unread = 'The ways to sign in could not be read. Nothing was changed.'
    await waitFor(() => {
      expect(server.to('GET /auth/oauth')).toHaveLength(1)
    })
    fail()
    // An alert, as a body that could not be read is: nothing moved the focus to it.
    const said = await screen.findByRole('alert')
    expect(said).toHaveTextContent(unread)

    await user.click(within(said).getByRole('button', { name: 'Try again' }))
    // Nothing of the section is drawn while it is asked again.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(server.to('GET /auth/oauth')).toHaveLength(2)
    fail()
    // Drawn anew, which is what says it a second time: that is what the press came to.
    expect(await screen.findByRole('alert')).toHaveTextContent(unread)
  })
})

describe('a child profile', () => {
  it('has a PIN and none of this', async () => {
    await security(
      createServer({ ...jana, email: null, is_child: true, credentials: ['child_pin'] }),
    )
    expect(
      screen.getByText(
        'This profile signs in with its PIN, which an owner of its household sets. It has no password and no second step.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
