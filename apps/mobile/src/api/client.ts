// What the app says of itself to the API, and where it finds it (plan item 28). The client that
// asks, with a device's bearer, is built on these.
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { version } from '../../package.json'

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

/** One of the settings a build was given (app.config.ts's `Extra`), or undefined for none. */
function setting(extra: unknown, name: 'variant' | 'apiUrl' | 'linkHost'): string | undefined {
  if (typeof extra !== 'object' || extra === null || !(name in extra)) return undefined
  const value: unknown = (extra as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * The API's base, `https://…/api/v1` with no slash after it, as @household/api and the replica
 * take it, read from what the build was given (`extra`, which is the configuration's own). A
 * build other than development's is refused as it is configured when it names none, so one that
 * reaches here without is no build of this app's.
 */
export function apiUrl(extra: unknown = Constants.expoConfig?.extra): string {
  const told = setting(extra, 'apiUrl')
  if (told !== undefined) return told.replace(/\/+$/, '')
  if (setting(extra, 'variant') === 'development') return developmentApi()
  throw new Error('this build was told no API (HOUSEHOLD_MOBILE_API_URL)')
}
