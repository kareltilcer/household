// A link the system hands the app, read as the address it names. The app answers to its own
// scheme (`household://…`, a variant's own beside it) and, where a build was told one, to the
// `https` links of its host (app.config.ts). expo-router opens such a link by itself, at the
// route its path names; this file reads the same path out of it, for what the app has to know
// of an arrival beside where it leads (Links.tsx).
import Constants from 'expo-constants'
import { buildSettings, setting } from '../api/client.ts'

/** What a link must be for the app to read an address out of it. */
export interface Own {
  /** The schemes the build answers to. */
  readonly schemes: readonly string[]
  /** The host whose `https` links open the app, where a build was told one. */
  readonly host: string | undefined
}

/** This build's own, as its configuration says. */
export function ownLinks(): Own {
  const scheme = Constants.expoConfig?.scheme
  const schemes = typeof scheme === 'string' ? [scheme] : (scheme ?? [])
  return { schemes, host: setting(buildSettings(), 'linkHost') }
}

/**
 * The address `url` names, a path from the root with its query, or null for a link that is not
 * the app's own: another scheme's, another host's. In the app's scheme everything after `://`
 * is the path, what a URL would call its host included: `household://households/…` names
 * `/households/…`.
 */
export function addressOf(url: string, own: Own = ownLinks()): string | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^#]*)/.exec(url)
  if (match === null) return null
  const [, scheme = '', rest = ''] = match
  if (own.schemes.some((each) => each.toLowerCase() === scheme.toLowerCase())) {
    return `/${rest.replace(/^\/+/, '')}`
  }
  if (scheme.toLowerCase() !== 'https' || own.host === undefined) return null
  const slash = rest.search(/[/?]/)
  const host = slash === -1 ? rest : rest.slice(0, slash)
  if (host.toLowerCase() !== own.host.toLowerCase()) return null
  const path = slash === -1 ? '' : rest.slice(slash)
  return path.startsWith('/') ? path : `/${path}`
}
