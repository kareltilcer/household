// Turning the second step on (A-5, A-6): the password, the square and the key, the code and its
// refusals, and the ten recovery codes, which are shown once and asked about before they go.
import { focusManager } from '@tanstack/react-query'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { squares } from './QrCode.tsx'
import { codesFile } from './RecoveryCodes.tsx'
import { grouped } from './SecondStepSetup.tsx'
import { createServer, invalid, jana, open, problem, type Server } from './testing.tsx'

const title = 'Add a second step'

const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const uri = `otpauth://totp/Household:jana%40tilcerovi.cz?secret=${secret}&issuer=Household`

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

// A test that says the page is looked at again leaves the next one a page nobody has looked at.
afterEach(() => {
  focusManager.setFocused(undefined)
})

async function setup(server: Server = createServer()) {
  const opened = open('/account/2fa', server)
  await screen.findByRole('heading', { level: 1, name: title })
  return opened
}

/** A server that enrols for any password, and the screen taken as far as the square. */
async function scanning(server: Server = createServer()) {
  server.on('POST /auth/mfa/enroll', () => Response.json({ secret, otpauth_uri: uri }))
  const opened = await setup(server)
  await opened.user.click(screen.getByRole('button', { name: 'Set it up' }))
  const dialog = screen.getByRole('dialog', { name: 'Your password, first' })
  await opened.user.type(within(dialog).getByLabelText('Password'), 'the password')
  await opened.user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  await screen.findByRole('img', { name: 'QR code to scan with your authenticator app' })
  return opened
}

describe('turning the second step on', () => {
  it('takes the password, then the square and the key, then the codes', async () => {
    const server = createServer()
    server.on('POST /auth/mfa/activate', () => {
      server.me = { ...server.me, mfa_enabled: true, mfa_recovery_codes_left: 10 }
      return Response.json({ recovery_codes: codes })
    })
    const { user, router, container } = await scanning(server)
    expect(await server.body('POST /auth/mfa/enroll')).toEqual({ password: 'the password' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The square is drawn as rectangles: no image is fetched and no style injected.
    const square = screen.getByRole('img', { name: 'QR code to scan with your authenticator app' })
    expect(square.tagName.toLowerCase()).toBe('svg')
    expect(square.querySelectorAll('rect').length).toBeGreaterThan(50)
    expect(container.querySelector('img, [style*="data:"]')).toBeNull()
    // The key is offered beside it, in groups of four.
    const key = screen.getAllByText('JBSW')[0]?.parentElement
    expect([...(key?.children ?? [])].map((group) => group.textContent)).toEqual(grouped(secret))

    await user.type(screen.getByRole('textbox', { name: 'Code from the app' }), '417 902')
    await user.click(screen.getByRole('button', { name: 'Turn it on' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ten codes, in case the app is gone' }),
    ).toBeInTheDocument()
    expect(await server.body('POST /auth/mfa/activate')).toEqual({ code: '417902' })
    expect(
      within(screen.getByRole('list', { name: 'Recovery codes' }))
        .getAllByRole('listitem')
        .map((code) => code.textContent),
    ).toEqual(codes)
    // The account is read again: the second step is on.
    await waitFor(() => {
      expect(server.to('GET /me').length).toBeGreaterThan(1)
    })

    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(
      await screen.findByText('Tick the box once you have saved them. They are not shown again.'),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account/2fa')
    await user.click(screen.getByRole('checkbox', { name: 'I have saved them' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account/security')
    })
  })

  it('copies, downloads and prints the codes', async () => {
    const server = createServer()
    server.on('POST /auth/mfa/activate', () => Response.json({ recovery_codes: codes }))
    const { user } = await scanning(server)
    await user.type(screen.getByRole('textbox', { name: 'Code from the app' }), '417902')
    await user.click(screen.getByRole('button', { name: 'Turn it on' }))
    await screen.findByRole('list', { name: 'Recovery codes' })

    const written = vi.spyOn(window.navigator.clipboard, 'writeText').mockResolvedValue()
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(written).toHaveBeenCalledWith(codes.join('\n'))
    expect(await screen.findByText('Copied all ten')).toBeInTheDocument()

    const files: Blob[] = []
    const released: string[] = []
    vi.stubGlobal('URL', {
      createObjectURL: (file: Blob) => {
        files.push(file)
        return 'blob:codes'
      },
      revokeObjectURL: (address: string) => {
        released.push(address)
      },
    })
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      names.push(this.download)
    })
    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(names).toEqual([codesFile])
    // The file is the browser's to read once the press has returned: it is not let go of in it.
    expect(released).toEqual([])
    const text = await files[0]?.text()
    expect(text).toContain('Household recovery codes.')
    expect(text?.trim().split('\n').slice(-10)).toEqual(codes)

    const print = vi.fn()
    vi.stubGlobal('print', print)
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)

    // It is let go of with the screen that showed the codes.
    cleanup()
    expect(released).toEqual(['blob:codes'])
  })

  it('says a wrong password is wrong, where it was asked', async () => {
    const server = createServer()
    server.on('POST /auth/mfa/enroll', () => problem(401, 'invalid_credentials'))
    const { user } = await setup(server)
    await user.click(screen.getByRole('button', { name: 'Set it up' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Password'), 'not it')
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Password')).toHaveAccessibleDescription(
        expect.stringContaining('That isn’t your password.'),
      )
    })
  })

  it('explains an unverified address where the server refuses it, and sends the link again', async () => {
    const server = createServer()
    server.on('POST /auth/mfa/enroll', () => problem(403, 'account_unverified'))
    server.on('POST /auth/verify-email/resend', () => new Response(null, { status: 202 }))
    const { user } = await setup(server)
    await user.click(screen.getByRole('button', { name: 'Set it up' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Password'), 'the password')
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

    // The answer to the password just given, the question having closed: said as it arrives,
    // its words drawn a moment after the region that says them.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^Verify your email first/)
    })
    expect(
      screen.getByText(
        'A second step bound to an address nobody has proven would outlive the password reset that proves it, and lock the address’s owner out. Everything else works as normal.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set it up' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Send the verification link again' }))
    await waitFor(async () => {
      expect(await server.body('POST /auth/verify-email/resend')).toEqual({
        email: 'jana@tilcerovi.cz',
      })
    })
    expect(
      await screen.findByText(/^A link is on its way to jana@tilcerovi\.cz\./),
    ).toBeInTheDocument()
  })

  it('asks afresh once the address is verified, with nothing of that refusal left in the question', async () => {
    const server = createServer()
    server.on('POST /auth/mfa/enroll', () => problem(403, 'account_unverified'))
    const { user } = await setup(server)
    await user.click(screen.getByRole('button', { name: 'Set it up' }))
    const refused = screen.getByRole('dialog')
    await user.type(within(refused).getByLabelText('Password'), 'the password')
    await user.click(within(refused).getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // The address is proven in the tab its email's link opened, and the account is read again
    // when this page is looked at again: it is verified, as the server here always said.
    act(() => {
      focusManager.setFocused(true)
    })
    await user.click(await screen.findByRole('button', { name: 'Set it up' }))
    const password = within(screen.getByRole('dialog')).getByLabelText('Password')
    expect(password).not.toHaveAttribute('aria-invalid')
    expect(password).toHaveAccessibleDescription('')
  })

  it('says so before asking anything of an account it already knows is unverified', async () => {
    const server = createServer({ ...jana, email_verified: false })
    await setup(server)
    expect(screen.getByText('Verify your email first')).toBeInTheDocument()
    // There as the screen opened: read in its place, and announced as nothing that arrived.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set it up' })).not.toBeInTheDocument()
    expect(server.to('POST /auth/mfa/enroll')).toHaveLength(0)
  })

  it('says a wrong code is most likely one that changed', async () => {
    const server = createServer()
    server.on('POST /auth/mfa/activate', () => invalid('/code'))
    const { user } = await scanning(server)
    const code = screen.getByRole('textbox', { name: 'Code from the app' })
    await user.type(code, '000000')
    await user.click(screen.getByRole('button', { name: 'Turn it on' }))
    await waitFor(() => {
      expect(code).toHaveAccessibleDescription(
        expect.stringContaining(
          'That code isn’t right. Codes change every 30 seconds — check the app for the current one.',
        ),
      )
    })
    await waitFor(() => {
      expect(code).toHaveFocus()
    })
    expect(code).toHaveValue('000000')
  })

  it('does not spend a try on what is no code at all', async () => {
    const server = createServer()
    const { user } = await scanning(server)
    const code = screen.getByRole('textbox', { name: 'Code from the app' })
    await user.type(code, '4179')
    await user.click(screen.getByRole('button', { name: 'Turn it on' }))
    expect(code).toHaveAccessibleDescription(
      expect.stringContaining('Enter the six digits the app shows.'),
    )
    await waitFor(() => {
      expect(code).toHaveFocus()
    })
    expect(server.to('POST /auth/mfa/activate')).toHaveLength(0)
  })

  it('says when to try again after five wrong codes', async () => {
    const server = createServer()
    server.on('POST /auth/mfa/activate', () =>
      problem(429, 'rate_limited', {}, { 'Retry-After': '300' }),
    )
    const { user } = await scanning(server)
    const code = screen.getByRole('textbox', { name: 'Code from the app' })
    await user.type(code, '417902')
    await user.click(screen.getByRole('button', { name: 'Turn it on' }))
    await waitFor(() => {
      expect(code).toHaveAccessibleDescription(
        expect.stringMatching(/Too many attempts\. Try again at \d/),
      )
    })
  })

  it('says the codes were lost with the answer, and where to make new ones', async () => {
    const server = createServer()
    server.on('POST /auth/mfa/activate', () => problem(409, 'idempotency_in_progress'))
    const { user } = await scanning(server)
    await user.type(screen.getByRole('textbox', { name: 'Code from the app' }), '417902')
    await user.click(screen.getByRole('button', { name: 'Turn it on' }))
    // What became of the press, the form having gone: said as it arrives.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^The answer did not reach this page/)
    })
    expect(screen.getByRole('link', { name: 'Go to Signing in' })).toHaveAttribute(
      'href',
      '/account/security',
    )
  })

  it('says an account with no password needs one first', async () => {
    await setup(createServer({ ...jana, credentials: ['apple'] }))
    expect(
      screen.getByText(
        'This account signs in with Google or Apple and has no password, and a second step is added on top of one. A password reset sets one.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reset your password' })).toHaveAttribute(
      'href',
      '/reset',
    )
    expect(screen.queryByRole('button', { name: 'Set it up' })).not.toBeInTheDocument()
  })

  it('says setting it up again replaces what is on', async () => {
    await setup(createServer({ ...jana, mfa_enabled: true, mfa_recovery_codes_left: 9 }))
    expect(
      screen.getByText(/^The second step is on\. Setting it up again replaces/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set it up again' })).toBeInTheDocument()
  })
})

describe('the square', () => {
  it('is the code a reader expects: three finders, and the same for the same text', () => {
    const { size, bars } = squares(uri)
    // A version's side is 17 + 4 × version modules.
    expect((size - 17) % 4).toBe(0)
    // The finder at the top left: a run of seven dark modules on its first and its seventh row.
    for (const y of [0, 6]) {
      expect(bars.find((bar) => bar.y === y && bar.x === 0)?.width).toBe(7)
    }
    expect(bars.every((bar) => bar.x + bar.width <= size)).toBe(true)
    expect(squares(uri)).toEqual({ size, bars })
  })

  it('groups a key in fours', () => {
    expect(grouped('JBSWY3DPEH')).toEqual(['JBSW', 'Y3DP', 'EH'])
  })
})
