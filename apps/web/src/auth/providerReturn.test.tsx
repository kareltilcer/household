import type { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { signedInKey } from '../account/common.ts'
import { paths } from '../app/paths.ts'
import { holdDestination } from '../session/destination.ts'
import { heldChallenge } from './challenge.ts'
import type { PendingFlow } from './provider.ts'
import { empty, invalid, jana, open, pending, problem, serve } from './testing.tsx'

const verifier = 'v'.repeat(64)

/** A flow this tab began, as provider.ts keeps one until its return. */
function begun(flow: Partial<PendingFlow> = {}): void {
  window.sessionStorage.setItem(
    'household.provider',
    JSON.stringify({ provider: 'google', state: 's1', verifier, intent: 'sign-in', ...flow }),
  )
}

const callback = 'POST /auth/oauth/google/callback'
const link = 'POST /auth/oauth/google/link'
const returned = '/sign-in/google?code=c1&state=s1'

/** A server whose callback signs the browser in. */
function admitting(route = callback) {
  const backend = serve()
  backend.on(route, () => {
    backend.signIn()
    return Response.json({ tokens: null })
  })
  return backend
}

const unfinished = 'That sign-in didn’t finish'

describe('a return from a provider, to sign in', () => {
  it('redeems Google’s code with the verifier this tab kept, and opens the app', async () => {
    begun()
    const backend = admitting()
    const { address } = open(returned, { backend })
    await waitFor(() => {
      expect(address()).toBe(paths.home.path)
    })
    expect(backend.to(callback)).toEqual([
      {
        method: 'POST',
        path: '/auth/oauth/google/callback',
        body: { code: 'c1', state: 's1', code_verifier: verifier, locale: 'en' },
      },
    ])
    // A return is completed once: the flow is kept no longer.
    expect(window.sessionStorage.getItem('household.provider')).toBeNull()
  })

  it('says it is finishing from the first paint, with the code already out of the address', async () => {
    begun()
    const backend = serve()
    const answer = pending()
    backend.on(callback, () => answer.response)
    const { address } = open(returned, { backend })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Finishing your sign-in' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(address()).toBe('/sign-in/google')
    })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    answer.answer(problem(401, 'invalid_credentials'))
    await screen.findByRole('heading', { level: 1, name: unfinished })
  })

  it('reads Apple’s answer from the fragment, with the name Apple gives once', async () => {
    begun({ provider: 'apple' })
    const backend = admitting('POST /auth/oauth/apple/callback')
    const { address } = open('/sign-in/apple#code=c1&name=Jana+Tilcerov%C3%A1&state=s1', {
      backend,
    })
    await waitFor(() => {
      expect(address()).toBe(paths.home.path)
    })
    expect(backend.to('POST /auth/oauth/apple/callback')[0]?.body).toEqual({
      code: 'c1',
      state: 's1',
      code_verifier: verifier,
      display_name: 'Jana Tilcerová',
      locale: 'en',
    })
  })

  it('sends the completion once, though React’s strict mode runs every effect twice', async () => {
    begun()
    const backend = admitting()
    const { address } = open(returned, { backend, strict: true })
    await waitFor(() => {
      expect(address()).toBe(paths.home.path)
    })
    expect(backend.to(callback)).toHaveLength(1)
  })

  it('goes on to the page the visitor opened', async () => {
    const opened = '/account/devices'
    holdDestination(opened)
    begun()
    const { address } = open(returned, { backend: admitting() })
    await waitFor(() => {
      expect(address()).toBe(opened)
    })
  })

  it.each([
    ['no flow was begun in this tab', undefined, returned],
    ['the state is not the one the flow began with', {}, '/sign-in/google?code=c1&state=other'],
    ['the flow was begun with the other provider', { provider: 'apple' as const }, returned],
    [
      'the provider says the person turned it down',
      {},
      '/sign-in/google?error=access_denied&state=s1',
    ],
    ['no code came back', {}, '/sign-in/google?state=s1'],
  ])('completes nothing where %s, and offers to begin again', async (_, flow, address) => {
    if (flow !== undefined) begun(flow)
    const { backend, address: at } = open(address)
    expect(await screen.findByRole('heading', { level: 1, name: unfinished })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start again' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
    // Nothing was sent: not the code, and not the verifier.
    expect(backend.sent.filter((request) => request.method === 'POST')).toEqual([])
    // And what came back is in the address no longer.
    await waitFor(() => {
      expect(at()).toBe('/sign-in/google')
    })
  })

  it('goes to the second step where the account has it on', async () => {
    begun()
    const backend = serve()
    backend.on(callback, () =>
      Response.json(
        { error: 'mfa_required', challenge_token: 'c9', methods: ['totp', 'recovery_code'] },
        { status: 409 },
      ),
    )
    const { address } = open(returned, { backend })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Enter your code' }),
    ).toBeInTheDocument()
    expect(address()).toBe(paths.secondStep.path)
    expect(heldChallenge()?.token).toBe('c9')
  })

  it('never links silently: an address that has an account signs in as it always has', async () => {
    begun()
    const backend = serve()
    backend.on(callback, () => problem(409, 'link_required'))
    open(returned, { backend })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This address already has an account' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'An account already uses the email address Google gave us. Sign in the way you usually do, then connect Google from your account.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
  })

  it('begins again where the provider did not vouch for the sign-in', async () => {
    begun()
    const backend = serve()
    backend.on(callback, () => problem(401, 'invalid_credentials'))
    open(returned, { backend })
    expect(await screen.findByRole('heading', { level: 1, name: unfinished })).toBeInTheDocument()
    expect(screen.getByText('Nothing was changed. You can start it again.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start again' })).toBeInTheDocument()
  })

  it('opens nothing at an address that names no provider', async () => {
    begun()
    const { backend } = open('/sign-in/facebook?code=c1&state=s1')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    expect(backend.sent.filter((request) => request.method === 'POST')).toEqual([])
    // The flow was another address's to complete.
    expect(window.sessionStorage.getItem('household.provider')).not.toBeNull()
  })
})

describe('a return from a provider, to link it to the account', () => {
  const account = '/account/security'

  it('links it, and goes back to where the link was begun', async () => {
    begun({ intent: 'link', returnTo: account })
    const backend = serve()
    backend.signIn()
    backend.on(link, () => empty(204))
    const { address } = open(returned, { backend })
    await waitFor(() => {
      expect(address()).toBe(account)
    })
    expect(backend.to(link)[0]?.body).toEqual({ code: 'c1', state: 's1', code_verifier: verifier })
    expect(backend.to(callback)).toHaveLength(0)
  })

  it('reads the account again once the link is made, before it goes back to say so', async () => {
    begun({ intent: 'link', returnTo: account })
    const backend = serve()
    backend.signIn()
    backend.on(link, () => {
      // The account signs in with Google from here on, which the page it opened with did not say.
      backend.signIn({ ...jana, credentials: ['password', 'google'] })
      return empty(204)
    })
    const { address } = open(returned, { backend })
    await waitFor(() => {
      expect(address()).toBe(account)
    })
    const asked = backend.sent.map((request) => `${request.method} ${request.path}`)
    expect(asked.lastIndexOf('GET /me')).toBeGreaterThan(asked.indexOf(link))
  })

  it('reads the account alone again: what else this browser kept under its key is as it was', async () => {
    begun({ intent: 'link', returnTo: account })
    const backend = serve()
    backend.signIn()
    backend.on(link, () => empty(204))
    // Where the account is signed in, as an earlier visit read it and this browser kept it. No
    // screen of this page reads it, so nothing here has the way to ask for it again.
    const caches: QueryClient[] = []
    const { address } = open(returned, {
      backend,
      kept: (queries) => {
        caches.push(queries)
        queries.setQueryData(signedInKey, { sessions: [], devices: [] })
      },
    })
    await waitFor(() => {
      expect(address()).toBe(account)
    })
    expect(caches[0]?.getQueryState(signedInKey)).toMatchObject({ status: 'success', error: null })
  })

  it('goes back to the account’s security where the flow names no path of the app’s own', async () => {
    begun({ intent: 'link', returnTo: '//elsewhere.example/account' })
    const backend = serve()
    backend.signIn()
    backend.on(link, () => empty(204))
    const { address } = open(returned, { backend })
    await waitFor(() => {
      expect(address()).toBe(paths.accountSecurity.path)
    })
  })

  it.each([
    [
      'the identity is another account’s, or the account has one already',
      () => problem(409, 'identity_already_linked'),
      'That Google account is already connected to a Household account, or your account already has another one connected. Nothing was changed.',
    ],
    [
      'the state or the code is refused',
      () => invalid('/state', 'invalid'),
      'The connection didn’t finish, and nothing was changed. Start it again from your account.',
    ],
    [
      'the session ended while it ran',
      () => problem(401, 'unauthenticated'),
      'You were signed out before the connection finished, and nothing was changed. Sign in and start it again from your account.',
    ],
    [
      'the account is a child profile',
      () => problem(403, 'forbidden'),
      'A child profile signs in with its PIN alone, so nothing can be connected to it.',
    ],
    [
      // A `403` too, and no child profile's: the code says which.
      'the request was not taken for the app’s own',
      () => problem(403, 'csrf_failed'),
      'Something went wrong at our end. Nothing you typed was lost. Try again.',
    ],
    [
      'the server failed',
      () => problem(500, 'internal'),
      'Something went wrong at our end. Nothing you typed was lost. Try again.',
    ],
  ])('says so where %s, with the way back', async (_, respond, sentence) => {
    begun({ intent: 'link', returnTo: account })
    const backend = serve()
    backend.signIn()
    backend.on(link, respond)
    open(returned, { backend })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Google wasn’t connected' }),
    ).toBeInTheDocument()
    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your account' })).toHaveAttribute(
      'href',
      account,
    )
  })

  it('leads back to the account where the return completes nothing', async () => {
    begun({ intent: 'link', returnTo: account })
    const { backend } = open('/sign-in/google?error=access_denied&state=s1')
    expect(await screen.findByRole('heading', { level: 1, name: unfinished })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your account' })).toHaveAttribute(
      'href',
      account,
    )
    expect(backend.to(link)).toHaveLength(0)
  })
})
