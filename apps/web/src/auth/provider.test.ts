import { describe, expect, it, vi } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { ApiProblemError } from '../api/problem.ts'
import {
  challengeOf,
  isProvider,
  newVerifier,
  redirectUri,
  startProvider,
  takePendingFlow,
} from './provider.ts'

const origin = 'https://household.example'

describe('a PKCE verifier', () => {
  it('is 64 characters of the unreserved set, and never the same twice', () => {
    const made = new Set(Array.from({ length: 50 }, newVerifier))
    expect(made.size).toBe(50)
    // The contract's own pattern for `code_verifier`.
    for (const verifier of made) expect(verifier).toMatch(/^[A-Za-z0-9._~-]{64}$/)
  })

  it('has the challenge RFC 7636 gives its example', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
    // And the shape the contract holds `code_challenge` to, for one of the app's own.
    expect(await challengeOf(newVerifier())).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('where a provider sends a person back', () => {
  it('is the web client for Google, and the API for Apple, whose answer is a form', () => {
    expect(redirectUri('google', origin)).toBe(`${origin}/sign-in/google`)
    expect(redirectUri('apple', origin)).toBe(`${origin}/api/v1/auth/oauth/apple/return`)
  })

  it('is asked of the two providers Household signs in with, and no other', () => {
    expect(isProvider('google')).toBe(true)
    expect(isProvider('apple')).toBe(true)
    for (const value of ['facebook', '', undefined, 'Google']) expect(isProvider(value)).toBe(false)
  })
})

describe('a flow begun with a provider', () => {
  function client(respond: (request: Request) => Response) {
    const sent: Request[] = []
    const api = createWebClient({
      origin,
      cookies: () => '',
      fetch: (request) => {
        sent.push(request)
        return Promise.resolve(respond(request))
      },
    })
    return { api, sent }
  }

  it('asks the server to start it, keeps what its return needs, and leaves for the provider', async () => {
    const authorization = 'https://accounts.example/authorize?state=the-state'
    const { api, sent } = client(() =>
      Response.json({ authorization_url: authorization, state: 'the-state' }),
    )
    const leave = vi.fn()
    await startProvider({
      api,
      provider: 'google',
      intent: 'link',
      returnTo: '/account/security',
      leave,
    })

    const [request] = sent
    expect(request?.url).toBe(`${origin}/api/v1/auth/oauth/google/start`)
    const body = (await request?.json()) as Record<string, string>
    expect(body.redirect_uri).toBe(redirectUri('google'))
    expect(body.client_type).toBe('web')
    expect(leave).toHaveBeenCalledWith(authorization)

    const kept = takePendingFlow()
    expect(kept).toMatchObject({
      provider: 'google',
      state: 'the-state',
      intent: 'link',
      returnTo: '/account/security',
    })
    // The verifier is the one whose challenge the server was sent, and has left for nowhere.
    expect(await challengeOf(kept?.verifier ?? '')).toBe(body.code_challenge)
    expect(JSON.stringify(body)).not.toContain(kept?.verifier ?? 'none')
    // A return is completed once.
    expect(takePendingFlow()).toBeNull()
  })

  it('keeps nothing, and leaves for nowhere, where the server refuses the start', async () => {
    const { api } = client(() =>
      Response.json(
        { type: 'about:blank', title: 'not found', status: 404, code: 'not_found' },
        { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    )
    const leave = vi.fn()
    await expect(
      startProvider({ api, provider: 'apple', intent: 'sign-in', leave }),
    ).rejects.toThrow(ApiProblemError)
    expect(leave).not.toHaveBeenCalled()
    expect(takePendingFlow()).toBeNull()
  })

  it('is not taken from what this tab kept that is no flow', () => {
    for (const stored of [
      '',
      'not json',
      '{}',
      '{"provider":"github","state":"s","verifier":"v","intent":"link"}',
    ]) {
      window.sessionStorage.setItem('household.provider', stored)
      expect(takePendingFlow(), stored).toBeNull()
    }
  })
})
