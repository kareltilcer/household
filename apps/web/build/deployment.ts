// What a build is told of the deployment it is for. The web app is static files, and its policy
// is written into its page as it is built (csp.ts), so the one origin beside its own that a page
// connects to, the sync service's, is named to the build, by a variable of its environment.
//
// The API is the page's own origin and needs no naming. The sync service is PowerSync, whose
// address the API hands a replica with its credentials (postSyncCredentials): the origin named
// here is that address's, and a build made with another is refused its connection by its own
// policy, which the app shows as not receiving changes (D-105).

/** The variable that names the sync service's origin to a build: `https://sync.example`. */
export const syncOriginVar = 'HOUSEHOLD_WEB_SYNC_ORIGIN'

/** Where `pnpm run up:sync` serves PowerSync, which the end-to-end build connects to. */
export const devSyncOrigin = 'http://127.0.0.1:8081'

/**
 * The sources a page's `connect-src` names for a sync service at `origin`: the origin itself,
 * for the SDK's requests, and its WebSocket twin, for the stream. Left out, or empty, the service
 * is behind the page's own origin and nothing is added. Anything that is not an origin, a path, a
 * wildcard, a credential, is refused: a policy is widened for one origin and no more.
 */
export function syncSources(origin: string | undefined): readonly string[] {
  const named = origin?.trim() ?? ''
  if (named === '') return []
  let url: URL
  try {
    url = new URL(named)
  } catch {
    throw new Error(`${syncOriginVar} is ${JSON.stringify(named)}; want an origin, https://host`)
  }
  const plain =
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.username === '' &&
    url.password === '' &&
    (url.pathname === '' || url.pathname === '/') &&
    url.search === '' &&
    url.hash === '' &&
    !url.hostname.includes('*')
  if (!plain) {
    throw new Error(`${syncOriginVar} is ${JSON.stringify(named)}; want an origin, https://host`)
  }
  const socket = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
  return [url.origin, socket]
}

/**
 * The sync service's sources for a build made in `environment`: the one the environment names.
 * The end-to-end build, the one with the dev-only pages, connects to the development stack's
 * PowerSync where the environment names none.
 */
export function deployedSync(
  devPages: boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  return syncSources(environment[syncOriginVar] ?? (devPages ? devSyncOrigin : undefined))
}
