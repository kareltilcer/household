import type { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { signedInKey } from '../account/common.ts'
import { deviceTimeZone } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { closingAt } from './DeletionCancel.tsx'
import { empty, invalid, open, pending, problem, serve } from './testing.tsx'

const address = 'jana@example.test'
const password = 'a long enough password'

describe('the link a verification email carries', () => {
  const verify = 'POST /auth/verify-email'
  const link = `${paths.verifyEmail.path}#token=t1`

  it('is spent as the page opens, its token out of the address at once', async () => {
    const backend = serve()
    const answer = pending()
    backend.on(verify, () => answer.response)
    const { address: at } = open(link, { backend })
    // The page has its title from the first paint.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Verifying your email' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(at()).toBe(paths.verifyEmail.path)
    })
    answer.answer(empty(204))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your email is verified' }),
    ).toBeInTheDocument()
    expect(backend.to(verify)).toEqual([
      { method: 'POST', path: '/auth/verify-email', body: { token: 't1' } },
    ])
    // A visitor's way on is to sign in, and nothing was asked of a session there is none of.
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
    expect(backend.to('GET /me')).toHaveLength(0)
  })

  it('is spent once, though React’s strict mode runs every effect twice', async () => {
    const backend = serve()
    backend.on(verify, () => empty(204))
    open(link, { backend, strict: true })
    await screen.findByRole('heading', { level: 1, name: 'Your email is verified' })
    expect(backend.to(verify)).toHaveLength(1)
  })

  it('has a member’s account read again, and leads them home', async () => {
    const backend = serve()
    backend.signIn()
    const answer = pending()
    backend.on(verify, () => answer.response)
    open(link, { backend })
    await waitFor(() => {
      expect(backend.to('GET /me')).toHaveLength(1)
    })
    answer.answer(empty(204))
    expect(await screen.findByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      paths.home.path,
    )
    await waitFor(() => {
      expect(backend.to('GET /me')).toHaveLength(2)
    })
  })

  it.each([
    ['carries no token', paths.verifyEmail.path, undefined],
    ['carries a token nobody issued', link, () => problem(404, 'not_found')],
  ])('verifies nothing where it %s, and says how that happens', async (_, opened, respond) => {
    const backend = serve()
    if (respond !== undefined) backend.on(verify, respond)
    open(opened, { backend })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link doesn’t verify anything' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'It may have been copied incompletely. Open the link from the email again, or ask for a new one.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute(
      'href',
      paths.verifySent.path,
    )
    expect(backend.to(verify)).toHaveLength(respond === undefined ? 0 : 1)
  })

  it('says an expired link lasted a day, and sends a new one to the address typed', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(verify, () => problem(410, 'token_expired'))
    backend.on('POST /auth/verify-email/resend', () => empty(202))
    open(link, { backend })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Verification links last 24 hours. Enter your email address and we’ll send a new one.',
      ),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), address)
    await user.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect(
      await screen.findByText(
        'If that address has an account waiting to be verified, a new link is on its way.',
      ),
    ).toBeInTheDocument()
    expect(backend.to('POST /auth/verify-email/resend')[0]?.body).toEqual({ email: address })
  })

  it('says a used link was used, with the way to sign in', async () => {
    const backend = serve()
    backend.on(verify, () => problem(410, 'token_already_used'))
    open(link, { backend })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link has already been used' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('keeps a link the server could not answer for, to be tried again', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(verify, () => problem(500, 'internal'))
    open(link, { backend })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your email isn’t verified yet' }),
    ).toBeInTheDocument()
    backend.on(verify, () => empty(204))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your email is verified' }),
    ).toBeInTheDocument()
    expect(backend.to(verify).map((request) => request.body)).toEqual([
      { token: 't1' },
      { token: 't1' },
    ])
  })
})

describe('asking for a password reset', () => {
  const request = 'POST /auth/password-reset'

  it('says the one thing that is so whether or not the address has an account, and keeps the form', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(request, () => empty(202))
    open(paths.reset.path, { backend })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Reset your password' }),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), address)
    await user.click(screen.getByRole('button', { name: 'Send the link' }))
    const notice = await screen.findByText(
      'If that address has an account, a reset link is on its way. It works for one hour.',
    )
    expect(notice).toBeInTheDocument()
    expect(screen.getByText('Sent')).toBeInTheDocument()
    // A notice on the same screen: a mistyped address is corrected here.
    expect(screen.getByLabelText('Email')).toHaveValue(address)
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument()
    expect(backend.to(request)[0]?.body).toEqual({ email: address })
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
  })

  it('says when it may be asked again, and asks nothing for an address that is none', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(request, () => problem(429, 'rate_limited', {}, { 'Retry-After': '600' }))
    open(paths.reset.path, { backend })
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Send the link' }))
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter your email address.')
    expect(backend.to(request)).toHaveLength(0)
    await user.type(screen.getByLabelText('Email'), address)
    await user.click(screen.getByRole('button', { name: 'Send the link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Too many attempts\. Try again at \d{1,2}:\d{2}/,
    )
  })
})

describe('the link a reset email carries', () => {
  const confirm = 'POST /auth/password-reset/confirm'
  const link = `${paths.resetSet.path}#token=r1`
  const submit = 'Set password and sign out everywhere'

  it('says what setting a password signs out, before the button and in it', async () => {
    const { backend, address: at } = open(link)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose a new password' }),
    ).toBeInTheDocument()
    expect(screen.getByText('This signs you out everywhere')).toBeInTheDocument()
    expect(
      screen.getByText(/^Every phone, tablet and browser signed into this account/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: submit })).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', paths.signIn.path)
    // The token is read and out of the address, and spent by nothing but the button.
    await waitFor(() => {
      expect(at()).toBe(paths.resetSet.path)
    })
    expect(backend.to(confirm)).toHaveLength(0)
  })

  it('sets the password, and sends the visitor to sign in with it', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(confirm, () => empty(204))
    const { address: at } = open(link, { backend })
    await user.type(await screen.findByLabelText('New password'), password)
    await user.click(screen.getByRole('button', { name: submit }))
    expect(
      await screen.findByText(
        'Your password is set, and every browser and device was signed out. Sign in with the new password.',
      ),
    ).toBeInTheDocument()
    expect(at()).toBe(paths.signIn.path)
    expect(backend.to(confirm)[0]?.body).toEqual({ token: 'r1', password })
    // Nobody was signed in here: nothing was asked that the server would refuse.
    expect(backend.to('GET /me')).toHaveLength(0)
  })

  it('learns that a session in this browser ended with it, before it leads to the sign-in', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.signIn()
    backend.on(confirm, () => {
      backend.end()
      return empty(204)
    })
    const { address: at } = open(link, { backend })
    await user.type(await screen.findByLabelText('New password'), password)
    await waitFor(() => {
      expect(backend.to('GET /me')).toHaveLength(1)
    })
    await user.click(screen.getByRole('button', { name: submit }))
    // The sign-in is a visitor's alone: a member still taken for one would be sent on from it.
    expect(
      await screen.findByText(
        /^Your password is set, and every browser and device was signed out\./,
      ),
    ).toBeInTheDocument()
    expect(at()).toBe(paths.signIn.path)
    expect(backend.to('GET /me').length).toBeGreaterThan(1)
    // One sentence says why they are here, not two.
    expect(screen.queryByText(/You were signed out/)).not.toBeInTheDocument()
  })

  it('asks who is signed in, and for nothing else this browser kept under the account’s key', async () => {
    const user = userEvent.setup()
    const backend = serve()
    // Somebody else is signed in to this browser, and the reset ends no session of theirs.
    backend.signIn()
    backend.on(confirm, () => empty(204))
    // Where their account is signed in, as an earlier visit read it and this browser kept it. No
    // screen of this page reads it, so nothing here has the way to ask for it again.
    const caches: QueryClient[] = []
    const { address: at } = open(link, {
      backend,
      kept: (queries) => {
        caches.push(queries)
        queries.setQueryData(signedInKey, { sessions: [], devices: [] })
      },
    })
    await user.type(await screen.findByLabelText('New password'), password)
    await user.click(screen.getByRole('button', { name: submit }))
    // Still a member, they are sent on from the sign-in, which is a visitor's alone.
    await waitFor(() => {
      expect(at()).toBe(paths.home.path)
    })
    expect(caches[0]?.getQueryState(signedInKey)).toMatchObject({ status: 'success', error: null })
  })

  it.each([
    ['carries no token', paths.resetSet.path, undefined],
    ['carries a token nobody issued', link, () => problem(404, 'not_found')],
  ])('opens nothing where it %s', async (_, opened, respond) => {
    const user = userEvent.setup()
    const backend = serve()
    if (respond !== undefined) {
      backend.on(confirm, respond)
      open(opened, { backend })
      await user.type(await screen.findByLabelText('New password'), password)
      await user.click(screen.getByRole('button', { name: submit }))
    } else {
      open(opened, { backend })
    }
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link doesn’t open anything' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute(
      'href',
      paths.reset.path,
    )
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('says an expired reset link lasted one hour, and a used one worked once', async () => {
    const user = userEvent.setup()
    const expired = serve()
    expired.on(confirm, () => problem(410, 'token_expired'))
    const first = open(link, { backend: expired })
    await user.type(await screen.findByLabelText('New password'), password)
    await user.click(screen.getByRole('button', { name: submit }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeInTheDocument()
    // One hour: the day the prototype's sentence gives every link is the verification link's.
    expect(screen.getByText('Reset links last one hour. Ask for a new one.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute(
      'href',
      paths.reset.path,
    )
    first.unmount()

    const used = serve()
    used.on(confirm, () => problem(410, 'token_already_used'))
    open(link, { backend: used })
    await user.type(await screen.findByLabelText('New password'), password)
    await user.click(screen.getByRole('button', { name: submit }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link has already been used' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument()
  })

  it('refuses a password too short without asking, and a breached one as register does', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(confirm, () => invalid('/password', 'invalid'))
    open(link, { backend })
    const secret = await screen.findByLabelText('New password')
    await user.type(secret, 'short')
    await user.click(screen.getByRole('button', { name: submit }))
    expect(secret).toHaveAccessibleDescription(/Use at least 12 characters\.$/)
    expect(backend.to(confirm)).toHaveLength(0)

    await user.clear(secret)
    await user.type(secret, password)
    await user.click(screen.getByRole('button', { name: submit }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This password has turned up in a breach',
    )
    expect(secret).toHaveAccessibleDescription(/Choose a different password\.$/)
    // The link is as good as it was: the form is still here.
    expect(screen.getByRole('button', { name: submit })).toBeInTheDocument()
  })
})

describe('the link a graduation carries', () => {
  const confirm = 'POST /auth/graduation/confirm'
  const link = `${paths.graduate.path}#token=g1`

  async function choose(backend = serve()) {
    const user = userEvent.setup()
    const opened = open(link, { backend })
    await user.type(await screen.findByLabelText('Password'), password)
    await user.click(screen.getByRole('button', { name: 'Set my password' }))
    return opened
  }

  it('says in plain words what choosing a password does', async () => {
    const { address: at, backend } = open(link)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose your password' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This makes your profile an account of your own. From now on you sign in with the email address this link came to and the password you choose here, and your PIN stops working. Everything you made stays yours.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('At least 12 characters')
    await waitFor(() => {
      expect(at()).toBe(paths.graduate.path)
    })
    expect(backend.to(confirm)).toHaveLength(0)
  })

  it('makes the account, and leads to the sign-in', async () => {
    const backend = serve()
    backend.on(confirm, () => empty(204))
    await choose(backend)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your account is ready' }),
    ).toBeInTheDocument()
    expect(backend.to(confirm)[0]?.body).toEqual({ token: 'g1', password })
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
  })

  it('says a household that takes no changes is a wait, and that the link still works', async () => {
    const backend = serve()
    backend.on(confirm, () =>
      problem(402, 'entitlement_read_only', { state: 'read_only', remedy: 'contact_owner' }),
    )
    await choose(backend)
    // A wait and no failure: it is said politely, and not as an alert.
    expect(
      await screen.findByText(
        'Your household can’t take changes just now. Ask an owner of your household about it. This link still works, so you can try again later.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set my password' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue(password)
  })

  it('opens nothing without a token, or with one nobody issued', async () => {
    const none = open(paths.graduate.path)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link doesn’t open anything' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/ask an owner of your household to send a new one\.$/),
    ).toBeInTheDocument()
    none.unmount()

    const backend = serve()
    backend.on(confirm, () => problem(404, 'not_found'))
    await choose(backend)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link doesn’t open anything' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it.each([
    [
      'another account has the address',
      () => problem(409, 'email_taken'),
      'This email address is taken',
      'Another account already uses the email address this link was sent to. Ask an owner of your household to send a link to a different address.',
    ],
    [
      'the link has expired',
      () => problem(410, 'token_expired'),
      'This link has expired',
      'These links last 14 days. Ask an owner of your household to send a new one.',
    ],
    [
      'the link was used, replaced or withdrawn',
      () => problem(410, 'token_already_used'),
      'This link no longer works',
      'It was used already, replaced by a newer link, or taken back. If you already chose your password with it, sign in. Otherwise ask an owner of your household for a new one.',
    ],
  ])('says who to ask where %s', async (_, respond, title, sentence) => {
    const backend = serve()
    backend.on(confirm, respond)
    await choose(backend)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('refuses a breached password as register does', async () => {
    const backend = serve()
    backend.on(confirm, () => invalid('/password', 'invalid'))
    await choose(backend)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This password has turned up in a breach',
    )
    expect(screen.getByRole('button', { name: 'Set my password' })).toBeInTheDocument()
  })
})

describe('the link an account deletion’s email carries', () => {
  const cancel = 'POST /auth/deletion/cancel'
  const link = `${paths.deletionCancel.path}#token=d1`
  const keep = 'Keep my account'

  it('says what keeping the account does, and cancels nothing until it is asked to', async () => {
    const { backend, address: at } = open(link)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Keep your account' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Keeping it puts your account back as it was, and you sign in as before. Browsers and devices that were signed out stay signed out until you sign in on them again.',
      ),
    ).toBeInTheDocument()
    // The email's link names no day, and the page says none.
    expect(screen.queryByText(/switched off/)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(at()).toBe(paths.deletionCancel.path)
    })
    expect(backend.to(cancel)).toHaveLength(0)
  })

  it('says the day the account closes first, where it was sent here straight after scheduling', async () => {
    const closes = '2026-11-07T12:00:00+01:00'
    const fragment = new URLSearchParams({ token: 'd1', at: closes }).toString()
    const { address: at } = open(`${paths.deletionCancel.path}#${fragment}`)
    const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: deviceTimeZone() })
    expect(
      await screen.findByText(
        `Your account is switched off now, and it will be deleted for good on ${day.format(new Date(closes))}. Signing in does not cancel that.`,
      ),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(at()).toBe(paths.deletionCancel.path)
    })
  })

  it('keeps the account on the press, and leads to the sign-in', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(cancel, () => empty(204))
    open(link, { backend })
    await user.click(await screen.findByRole('button', { name: keep }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your account is kept' }),
    ).toBeInTheDocument()
    expect(backend.to(cancel)).toEqual([
      { method: 'POST', path: '/auth/deletion/cancel', body: { token: 'd1' } },
    ])
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
    expect(screen.queryByRole('button', { name: keep })).not.toBeInTheDocument()
  })

  it('cancels nothing without a token, or with one a newer link replaced', async () => {
    const user = userEvent.setup()
    const none = open(paths.deletionCancel.path)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link doesn’t cancel anything' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: keep })).not.toBeInTheDocument()
    none.unmount()

    const backend = serve()
    backend.on(cancel, () => problem(404, 'not_found'))
    open(link, { backend })
    await user.click(await screen.findByRole('button', { name: keep }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link doesn’t cancel anything' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/a newer link may have been sent since/)).toBeInTheDocument()
    // Asking for a reset at the account's address sends the link again.
    expect(screen.getByRole('link', { name: 'Ask for the link again' })).toHaveAttribute(
      'href',
      paths.reset.path,
    )
  })

  it('says the thirty days have passed, or that the link was used', async () => {
    const user = userEvent.setup()
    const expired = serve()
    expired.on(cancel, () => problem(410, 'token_expired'))
    const first = open(link, { backend: expired })
    await user.click(await screen.findByRole('button', { name: keep }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The 30 days have passed, and the account can no longer be kept.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      paths.register.path,
    )
    first.unmount()

    const used = serve()
    used.on(cancel, () => problem(410, 'token_already_used'))
    open(link, { backend: used })
    await user.click(await screen.findByRole('button', { name: keep }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link has already been used' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument()
  })

  it('keeps the control where the server could not answer', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(cancel, () => problem(500, 'internal'))
    open(link, { backend })
    await user.click(await screen.findByRole('button', { name: keep }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Something went wrong at our end\./)
    expect(screen.getByRole('button', { name: keep })).toBeInTheDocument()
  })

  it('reads the instant an address carries, and nothing else for one', () => {
    expect(closingAt('2026-11-07T12:00:00Z')?.toISOString()).toBe('2026-11-07T12:00:00.000Z')
    // An offset's plus written bare into a fragment is read back as a space.
    expect(closingAt('2026-11-07T12:00:00 01:00')?.toISOString()).toBe('2026-11-07T11:00:00.000Z')
    for (const at of [null, '', 'soon', '2026-11-07', '2026-13-45T99:00:00Z', '1730980800']) {
      expect(closingAt(at)).toBeUndefined()
    }
  })
})
