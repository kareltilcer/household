// Signing in with Google or Apple on the web, and linking one to an account (FR-ID2, ADR 0010,
// ADR 0026). The flow leaves the app for the provider's pages and comes back to a route of the
// app's own, so what it needs on its return is kept in this tab's storage meanwhile: the PKCE
// verifier, which never leaves the browser until the callback, the state to compare the
// returned one against, and what the flow was begun for.
//
// Google sends the person back to the web client with a query. Apple answers with a form its
// own page posts, which static files cannot receive, so the web client's redirect URI for Apple
// is the API's (`postAuthOauthAppleReturn`), which sends the browser on to the same route with
// what Apple sent in the fragment. A deployment registers these two addresses with the
// providers and with the server, exactly (docs/runbooks/sign-in-keys-and-providers.md).
import type { ApiClient } from '@household/api'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '../api/ApiProvider.tsx'
import { apiPath } from '../api/client.ts'
import { unwrap } from '../api/problem.ts'
import { fill, paths } from '../app/paths.ts'

export const providers = ['google', 'apple'] as const
export type Provider = (typeof providers)[number]

export function isProvider(value: unknown): value is Provider {
  return providers.some((provider) => provider === value)
}

/**
 * The providers this server signs in with (`getAuthOauth`), for a screen that offers those and
 * no other (FR-ID2). What the server is configured for today: asked each time, and kept nowhere.
 */
export function useOfferedProviders() {
  const api = useApi()
  return useQuery({
    queryKey: ['auth', 'oauth'] as const,
    queryFn: async ({ signal }) => unwrap(await api.GET('/auth/oauth', { signal })).providers,
    meta: { persist: false },
  })
}

/** What a flow was begun for: to sign in, or to link the provider to the account signed in. */
export type Intent = 'sign-in' | 'link'

/** A flow that left for the provider's pages, as this tab keeps it until it returns. */
export interface PendingFlow {
  readonly provider: Provider
  readonly state: string
  readonly verifier: string
  readonly intent: Intent
  /** Where a link goes back to once it is made: a path of the app's own. */
  readonly returnTo?: string
}

const key = 'household.provider'

/** The address the provider sends the person back to, which the server holds to its list, exactly. */
export function redirectUri(provider: Provider, origin: string = window.location.origin): string {
  return provider === 'apple'
    ? new URL(`${apiPath}/auth/oauth/apple/return`, origin).href
    : new URL(fill(paths.providerReturn.path, { provider }), origin).href
}

const unreserved = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

/** A PKCE verifier (RFC 7636 §4.1): 64 characters of the unreserved set, from the platform's randomness. */
export function newVerifier(): string {
  // Bytes over 197 are drawn again: 198 is the largest multiple of the alphabet's 66 under 256,
  // and a byte taken modulo 66 from the whole range would favour its first characters.
  let verifier = ''
  while (verifier.length < 64) {
    for (const byte of crypto.getRandomValues(new Uint8Array(64))) {
      if (byte < 198 && verifier.length < 64)
        verifier += unreserved.charAt(byte % unreserved.length)
    }
  }
  return verifier
}

/** The S256 challenge of `verifier`: the base64url of its SHA-256, without padding. */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function keep(flow: PendingFlow): void {
  window.sessionStorage.setItem(key, JSON.stringify(flow))
}

/**
 * The flow this tab began, which is kept no longer: a return is completed once. Null where none
 * was begun here, as when the provider's page was opened in another tab, or what is kept is not
 * a flow.
 */
export function takePendingFlow(): PendingFlow | null {
  let stored: string | null
  try {
    stored = window.sessionStorage.getItem(key)
    window.sessionStorage.removeItem(key)
  } catch {
    return null
  }
  if (stored === null) return null
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const flow: Partial<Record<string, unknown>> = { ...value }
  if (
    !isProvider(flow.provider) ||
    typeof flow.state !== 'string' ||
    typeof flow.verifier !== 'string' ||
    (flow.intent !== 'sign-in' && flow.intent !== 'link')
  ) {
    return null
  }
  const returnTo = typeof flow.returnTo === 'string' ? flow.returnTo : undefined
  return {
    provider: flow.provider,
    state: flow.state,
    verifier: flow.verifier,
    intent: flow.intent,
    ...(returnTo === undefined ? {} : { returnTo }),
  }
}

export interface StartOptions {
  readonly api: ApiClient
  readonly provider: Provider
  readonly intent: Intent
  /** For a link: the path of the app's to go back to once it is made. */
  readonly returnTo?: string
  /** Leaves for the provider's page. Defaults to the window's own navigation. */
  readonly leave?: (url: string) => void
}

/**
 * Begins a flow with `provider` and leaves for its page. A start made signed in records the
 * account, which a link needs; the server answers `404` for a provider it is not configured for,
 * which a screen that offers only what `getAuthOauth` lists does not meet. It throws what the
 * start was refused with, as `unwrap` does, and nothing is kept.
 */
export async function startProvider({
  api,
  provider,
  intent,
  returnTo,
  leave = (url) => {
    window.location.assign(url)
  },
}: StartOptions): Promise<void> {
  const verifier = newVerifier()
  const begun = unwrap(
    await api.POST('/auth/oauth/{provider}/start', {
      params: { path: { provider } },
      body: {
        redirect_uri: redirectUri(provider),
        code_challenge: await challengeOf(verifier),
        client_type: 'web',
      },
    }),
  )
  keep({
    provider,
    state: begun.state,
    verifier,
    intent,
    ...(returnTo === undefined ? {} : { returnTo }),
  })
  leave(begun.authorization_url)
}
