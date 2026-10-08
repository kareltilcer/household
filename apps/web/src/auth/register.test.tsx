import { act, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paths } from '../app/paths.ts'
import { storageKey } from '../i18n/storage.ts'
import { sentState } from './sent.ts'
import { empty, invalid, open, problem, serve } from './testing.tsx'

const address = 'jana@example.test'
const password = 'a long enough password'
const register = 'POST /auth/register'
const resend = 'POST /auth/verify-email/resend'

async function fill(user: UserEvent, typed: { name?: string; email?: string; password?: string }) {
  if (typed.name !== undefined) await user.type(screen.getByLabelText('Name'), typed.name)
  if (typed.email !== undefined) await user.type(screen.getByLabelText('Email'), typed.email)
  if (typed.password !== undefined) {
    await user.type(screen.getByLabelText('Password'), typed.password)
  }
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('the register screen', () => {
  it('asks for a name, an address and a password of the contract’s length', async () => {
    open(paths.register.path)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument()
    const secret = screen.getByLabelText('Password')
    expect(secret).toHaveAttribute('autocomplete', 'new-password')
    // Twelve, the contract's minimum, where the prototype says ten.
    expect(secret).toHaveAccessibleDescription('At least 12 characters')
    expect(screen.getByRole('link', { name: 'I already have an account' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
    // The contract takes no agreement to terms, and a box nothing records is not drawn.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('registers in the language the app is shown in, and leads to the same screen whoever asked', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(register, () => empty(202))
    const { address: at } = open(paths.register.path, { backend })
    await screen.findByRole('heading', { level: 1 })
    await fill(user, { name: '  Jana Tilcerová ', email: address, password })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email' }),
    ).toBeInTheDocument()
    expect(at()).toBe(paths.verifySent.path)
    expect(
      screen.getByText(`We’ve sent a link to ${address}. It works for 24 hours.`),
    ).toBeInTheDocument()
    expect(backend.to(register)[0]?.body).toEqual({
      display_name: 'Jana Tilcerová',
      email: address,
      password,
      locale: 'en',
    })
  })

  it('leaves the language to the server where the app is shown in nobody’s', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(storageKey, 'en-XA')
    const backend = serve()
    backend.on(register, () => empty(202))
    const { container, address: at } = open(paths.register.path, { backend })
    await screen.findByRole('heading', { level: 1 })
    const [name, email] = screen.getAllByRole('textbox')
    const secret = container.querySelector('input[type="password"]')
    const submit = container.querySelector('button[type="submit"]')
    if (name === undefined || email === undefined || secret === null || submit === null) {
      throw new Error('the form is not the one this test fills')
    }
    await user.type(name, 'Jana')
    await user.type(email, address)
    await user.type(secret, password)
    await user.click(submit)
    await waitFor(() => {
      expect(at()).toBe(paths.verifySent.path)
    })
    expect(backend.to(register)[0]?.body).toEqual({
      display_name: 'Jana',
      email: address,
      password,
    })
  })

  it('refuses a breached password as information, and says what the check is', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(register, () => invalid('/password', 'invalid'))
    const { address: at } = open(paths.register.path, { backend })
    await screen.findByRole('heading', { level: 1 })
    await fill(user, { name: 'Jana', email: address, password })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This password has turned up in a breach')
    expect(alert).toHaveTextContent(
      'This password is on a public list of passwords taken from other services, so it is one of the first things anyone would try.',
    )
    // What happens: the server screened it against a list it keeps, and nobody else saw it.
    expect(alert).toHaveTextContent(
      'Household checked it against its own copy of the list, and sent your password to nobody else.',
    )
    // And not what the prototype claims, a check nothing makes.
    expect(alert).not.toHaveTextContent(/fingerprint|five characters|leave the device/)
    const secret = screen.getByLabelText('Password')
    expect(secret).toHaveAccessibleDescription(/Choose a different password\.$/)
    expect(secret).toHaveValue(password)
    expect(at()).toBe(paths.register.path)
  })

  it('asks the server nothing for what it would certainly refuse', async () => {
    const user = userEvent.setup()
    const { backend } = open(paths.register.path)
    await screen.findByRole('heading', { level: 1 })
    await fill(user, { name: '   ', email: 'jana', password: 'eleven char' })
    const name = screen.getByLabelText('Name')
    expect(name).toHaveAccessibleDescription('Add a name — it’s what appears on things you do.')
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'That email is missing something.',
    )
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      /Use at least 12 characters\.$/,
    )
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
    // A registration is one of five an hour: none was spent.
    expect(backend.to(register)).toHaveLength(0)
  })

  it('reads a 422 back onto the field it names', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(register, () =>
      problem(422, 'validation_failed', {
        errors: [
          { field: '/email', code: 'format' },
          { field: '/display_name', code: 'min_length' },
          { field: '/password', code: 'min_length' },
        ],
      }),
    )
    open(paths.register.path, { backend })
    await screen.findByRole('heading', { level: 1 })
    await fill(user, { name: 'Jana', email: address, password })
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
        'That email is missing something.',
      )
    })
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(/^Add a name/)
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      /Use at least 12 characters\.$/,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when registering may be tried again', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(register, () => problem(429, 'rate_limited', {}, { 'Retry-After': '1800' }))
    open(paths.register.path, { backend })
    await screen.findByRole('heading', { level: 1 })
    await fill(user, { name: 'Jana', email: address, password })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Too many attempts\. Try again at \d{1,2}:\d{2}/,
    )
  })
})

describe('check your email', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** The wait is a clock's: the test moves the clock, and nothing else the page waits on. */
  function holdTheClock() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  }

  function pass(milliseconds: number) {
    act(() => {
      vi.advanceTimersByTime(milliseconds)
    })
  }

  const sent = { pathname: paths.verifySent.path, state: sentState(address) }

  it('says where the link went, and leads on', async () => {
    open(sent)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(`We’ve sent a link to ${address}. It works for 24 hours.`),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Use a different address' })).toHaveAttribute(
      'href',
      paths.register.path,
    )
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
    // A web page opens no mail app, and the address is not asked for twice.
    expect(screen.queryByText(/mail app/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('counts the minute down on the control, which takes no press until it is over', async () => {
    holdTheClock()
    const user = userEvent.setup()
    const backend = serve()
    backend.on(resend, () => empty(202))
    open(sent, { backend })
    const control = await screen.findByRole('button', { name: 'Send it again in 60 s' })
    expect(control).toHaveAttribute('aria-disabled', 'true')
    await user.click(control)
    expect(backend.to(resend)).toHaveLength(0)

    pass(17_000)
    expect(control).toHaveAccessibleName('Send it again in 43 s')
    pass(43_000)
    expect(control).toHaveAccessibleName('Send it again')
    expect(control).not.toHaveAttribute('aria-disabled')
    // A wait is no refusal: nothing was said as one.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(control)
    // The address waits its minute again.
    await waitFor(() => {
      expect(control).toHaveAccessibleName('Send it again in 60 s')
    })
    expect(backend.to(resend)).toEqual([
      { method: 'POST', path: '/auth/verify-email/resend', body: { email: address } },
    ])
    // What was done is said, of the system and not of the address. A notice that arrives is
    // drawn before its words, which come two frames later, on the clock this test holds.
    pass(100)
    expect(
      screen.getByText(
        'If that address has an account waiting to be verified, a new link is on its way.',
      ),
    ).toBeInTheDocument()
    expect(control).toHaveAccessibleName('Send it again in 60 s')
  })

  it('takes a limit for the wait it is, for as long as the server says', async () => {
    holdTheClock()
    const user = userEvent.setup()
    const backend = serve()
    backend.on(resend, () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }))
    open(sent, { backend })
    const control = await screen.findByRole('button', { name: 'Send it again in 60 s' })
    pass(60_000)
    await user.click(control)
    await waitFor(() => {
      expect(control).toHaveAccessibleName('Send it again in 30 s')
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // A wait too long to count down is said as the time it ends.
    backend.on(resend, () => problem(429, 'rate_limited', {}, { 'Retry-After': '3000' }))
    pass(30_000)
    await user.click(control)
    await waitFor(() => {
      expect(control).toHaveAccessibleName(/^Send it again at \d{1,2}:\d{2}/)
    })
    expect(control).toHaveAttribute('aria-disabled', 'true')
  })

  it('asks for the address where the page has none, with the same control', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(resend, () => empty(202))
    // Loaded again, or opened cold: no history entry carries the address.
    open(paths.verifySent.path, { backend })
    expect(
      await screen.findByText(
        'Enter your email address and we’ll send the link again. It works for 24 hours.',
      ),
    ).toBeInTheDocument()
    const control = screen.getByRole('button', { name: 'Send it again' })
    expect(control).not.toHaveAttribute('aria-disabled')
    await user.click(control)
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter your email address.')
    expect(backend.to(resend)).toHaveLength(0)

    await user.type(screen.getByLabelText('Email'), address)
    await user.click(control)
    expect(
      await screen.findByText(
        'If that address has an account waiting to be verified, a new link is on its way.',
      ),
    ).toBeInTheDocument()
    expect(backend.to(resend)[0]?.body).toEqual({ email: address })
  })

  it('says what a failure of the server’s did, and keeps the control', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on(resend, () => problem(500, 'internal'))
    open(paths.verifySent.path, { backend })
    await user.type(await screen.findByLabelText('Email'), address)
    await user.click(screen.getByRole('button', { name: 'Send it again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Something went wrong at our end\./)
    expect(screen.getByRole('button', { name: 'Send it again' })).not.toHaveAttribute(
      'aria-disabled',
    )
  })
})
