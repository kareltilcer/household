// What a build is told of the deployment it is for. The web app is static files, and its policy
// is written into its page as it is built (csp.ts), so the origins beside its own that a page
// reaches are named to the build, each by a variable of its environment: the sync service's,
// which a page connects to, and the object store's, which a picture is drawn from.
//
// The API is the page's own origin and needs no naming. The sync service is PowerSync, whose
// address the API hands a replica with its credentials (postSyncCredentials): the origin named
// here is that address's, and a build made with another is refused its connection by its own
// policy, which the app shows as not receiving changes (D-105). The object store is where the
// API's pre-signed links point (`HOUSEHOLD_OBJECT_STORE_PUBLIC_URL`, D-9): a build made with
// another origin draws a member's initials where their picture would be.

/** The variable that names the sync service's origin to a build: `https://sync.example`. */
export const syncOriginVar = 'HOUSEHOLD_WEB_SYNC_ORIGIN'

/** Where `pnpm run up:sync` serves PowerSync, which the end-to-end build connects to. */
export const devSyncOrigin = 'http://127.0.0.1:8081'

/** The variable that names the object store's public origin to a build: `https://files.example`. */
export const filesOriginVar = 'HOUSEHOLD_WEB_FILES_ORIGIN'

/** Where `pnpm run up` serves the object store, which the end-to-end build's pictures come from. */
export const devFilesOrigin = 'http://127.0.0.1:9000'

/**
 * The sources a page's `connect-src` names for a sync service at `origin`: the origin itself,
 * for the SDK's requests, and its WebSocket twin, for the stream. Left out, or empty, the service
 * is behind the page's own origin and nothing is added. Anything that is not an origin, a path, a
 * wildcard, a credential, is refused, here as for the object store: a policy is widened for one
 * origin and no more.
 */
export function syncSources(origin: string | undefined): readonly string[] {
  const url = originOf(syncOriginVar, origin)
  if (url === undefined) return []
  const socket = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
  return [url.origin, socket]
}

/**
 * The sources a page's `img-src` names for an object store at `origin`: the origin itself, which
 * a member's picture is drawn from by a link the API pre-signed. Left out, or empty, the store
 * is behind the page's own origin and nothing is added.
 */
export function fileSources(origin: string | undefined): readonly string[] {
  const url = originOf(filesOriginVar, origin)
  return url === undefined ? [] : [url.origin]
}

/** The one origin `variable` names, or undefined where it names none. */
function originOf(variable: string, origin: string | undefined): URL | undefined {
  const named = origin?.trim() ?? ''
  if (named === '') return undefined
  const refused = new Error(`${variable} is ${JSON.stringify(named)}; want an origin, https://host`)
  let url: URL
  try {
    url = new URL(named)
  } catch {
    throw refused
  }
  const plain =
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.username === '' &&
    url.password === '' &&
    (url.pathname === '' || url.pathname === '/') &&
    url.search === '' &&
    url.hash === '' &&
    !url.hostname.includes('*')
  if (!plain) throw refused
  return url
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

/** The origins beside its own that a build's policy admits, each to the one directive it is for. */
export interface Deployment {
  /** `connect-src`: the sync service (`syncSources`). */
  readonly sync: readonly string[]
  /** `img-src`: the object store (`fileSources`). */
  readonly files: readonly string[]
}

/** A deployment whose every service is behind the page's own origin. */
export const sameOrigin: Deployment = { sync: [], files: [] }

/**
 * What a build made in `environment` is told of its deployment. The end-to-end build reaches the
 * development stack's services where the environment names none.
 */
export function deployment(
  devPages: boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Deployment {
  return {
    sync: deployedSync(devPages, environment),
    files: fileSources(environment[filesOriginVar] ?? (devPages ? devFilesOrigin : undefined)),
  }
}
