// @household/api as the mobile app uses it (plan item 28): what the app says of itself to the
// API, where it finds it, and the client that asks. A device's sign-in is a token pair (ADR
// 0010), so the client signs every request with the access token the session holds and renews
// it where the server says it has lapsed (transport.ts). An error is the contract's problem
// document, typed by its code and thrown as an ApiProblemError, which the query client and a
// screen switch on (problem.ts).
import { createApiClient, readProblem, type ApiClient, type ApiClientOptions } from '@household/api'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { version } from '../../package.json'
import type { ProblemHub } from './problems.ts'
import { bearing, platform, type Bearer, type Transport } from './transport.ts'

/**
 * The app as `Household-Client` names it, which the server holds to its minimum version and
 * keeps beside a device and a replica's report (ADR 0010, D-178): `mobile/` and this package's
 * own version, which is the version a store shows (app.config.ts). Every request the app sends
 * carries it, the replica's own among them, which @household/sync sends through the `fetch` it
 * is handed. The version is raised by the pull request after which a deployment must refuse the
 * builds before it, and by a release.
 */
export function clientName(): string {
  return `mobile/${version}`
}

/**
 * Where a development build finds the API when it is told nowhere: the developer's own machine,
 * `pnpm run dev:api` on its loopback, which an Android emulator reaches at 10.0.2.2 and an iOS
 * simulator at its own loopback. A device in the hand is told the machine's address on its
 * network instead (`HOUSEHOLD_MOBILE_API_URL`, read as `pnpm start` evaluates app.config.ts).
 */
function developmentApi(): string {
  return Platform.OS === 'android' ? 'http://10.0.2.2:8080/api/v1' : 'http://127.0.0.1:8080/api/v1'
}

/**
 * One of the settings a build was given (app.config.ts's `Extra`), or undefined for none: a
 * word, or a member of one of its groups, `eas.projectId`. Whatever is there and is no word is
 * no setting.
 */
export function setting(extra: unknown, ...names: readonly string[]): string | undefined {
  let value: unknown = extra
  for (const name of names) {
    if (typeof value !== 'object' || value === null || !(name in value)) return undefined
    value = (value as Record<string, unknown>)[name]
  }
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** What this build was given, as Expo hands it to the app. Under Jest, nothing. */
export function buildSettings(): unknown {
  return Constants.expoConfig?.extra
}

/**
 * The API's base, `https://…/api/v1` with no slash after it, as @household/api and the replica
 * take it, read from what the build was given (`extra`, which is the configuration's own). A
 * build other than development's is refused as it is configured when it names none, so one that
 * reaches here without is no build of this app's.
 */
export function apiUrl(extra: unknown = buildSettings()): string {
  const told = setting(extra, 'apiUrl')
  if (told !== undefined) return told.replace(/\/+$/, '')
  if (setting(extra, 'variant') === 'development') return developmentApi()
  throw new Error('this build was told no API (HOUSEHOLD_MOBILE_API_URL)')
}

export interface MobileClientOptions extends Pick<ApiClientOptions, 'retry'> {
  /** The API's base. Left out, the build's own (`apiUrl`). */
  readonly baseUrl?: string
  /** The `fetch` a request leaves by. Left out, the platform's; a test gives one it answers. */
  readonly fetch?: Transport
  /**
   * The device's sign-in, which every request is signed with. Left out, nothing is: the client
   * the sign-in itself is renewed through, which a refused token must not send round again.
   */
  readonly bearer?: Bearer
}

/** The client every screen of the mobile app asks the API through. */
export function createMobileClient(options: MobileClientOptions = {}): ApiClient {
  const sent = platform(options.fetch)
  return createApiClient({
    baseUrl: options.baseUrl ?? apiUrl(),
    fetch: options.bearer === undefined ? sent : bearing(sent, options.bearer),
    headers: { 'Household-Client': clientName() },
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  })
}

export interface NamedFetchOptions {
  /** Where a problem that is about the app, and not about what was sent, is told. */
  readonly problems: ProblemHub
  /** The `fetch` a request leaves by. Left out, the platform's. */
  readonly fetch?: Transport
}

/**
 * A `fetch` for @household/sync, which sends each of its own requests, the credentials, the
 * push, its report, a file, with the bearer it is given and nothing that names the app: this one
 * names it, as every request of the app's does, or a household's clients would list the device
 * with no type and no version (D-178). And it tells the app where the server answers that this
 * build is too old to be served, which is not the replica's to act on. The bearer is left as the
 * library set it: a device's request is authenticated by it alone.
 */
export function namedFetch({ problems, fetch }: NamedFetchOptions): typeof globalThis.fetch {
  const sent = platform(fetch)
  return async (input, init) => {
    const asked = new Request(input instanceof URL ? input.href : input, init)
    const headers = new Headers(asked.headers)
    headers.set('Household-Client', clientName())
    const response = await sent(new Request(asked, { headers }))
    if (response.status === 400) {
      // Read from a copy: the answer is the library's to read, whatever it is.
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => undefined)
      const problem = readProblem(response.status, body)
      if (problem.code === 'update_required') problems.report(problem)
    }
    return response
  }
}
