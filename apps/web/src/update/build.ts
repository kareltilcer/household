// The build a page is, and the build that is live (06-clients §7): the web app is deployed
// continuously, and a page left open keeps running the build it loaded. index.html names its
// build in a <meta>, the build writes the same id to build.json beside it (build/plugin.ts), and
// a page that reads a different id there knows a newer build is live.

/** The `<meta name>` index.html carries its build's id under: build/plugin.ts writes it. */
export const buildMeta = 'household-build'

/** What the meta holds where no build wrote one: the development server's page. */
export const buildPlaceholder = 'development'

/** The file that names the live build, beside index.html. */
export const buildFile = '/build.json'

/** This page's build, or undefined for a page no build made. */
export function ownBuild(page: Document = document): string | undefined {
  const id = page.querySelector(`meta[name="${buildMeta}"]`)?.getAttribute('content')
  return id === null || id === undefined || id === '' || id === buildPlaceholder ? undefined : id
}

/**
 * The build that is live, or undefined when it cannot be read: no connection, a server that is
 * mid-deploy, a file that is not what the build writes. Not knowing is never a newer build.
 */
export async function liveBuild(
  fetch: (url: string, init: RequestInit) => Promise<Response> = (url, init) =>
    globalThis.fetch(url, init),
): Promise<string | undefined> {
  try {
    const response = await fetch(buildFile, { cache: 'no-store', credentials: 'omit' })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    const id = typeof body === 'object' && body !== null && 'id' in body ? body.id : null
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

/** How often an open page asks, in ms. It also asks when it is looked at again. */
export const checkEvery = 15 * 60 * 1000

export interface UpdateWatch {
  /** Stops asking. */
  readonly stop: () => void
}

/**
 * Tells `onUpdate`, once, when a build other than `own` is live. It asks when the page becomes
 * visible and every `checkEvery` while it stays so, and at once when the page fails to load one
 * of its own files, which is what a page meets first after its build's files are gone.
 */
export function watchForUpdate(
  own: string | undefined,
  onUpdate: () => void,
  live: () => Promise<string | undefined> = liveBuild,
): UpdateWatch {
  if (own === undefined) return { stop: () => undefined }
  let told = false
  const tell = () => {
    if (told) return
    told = true
    onUpdate()
  }
  const check = () => {
    if (told || document.visibilityState !== 'visible') return
    void live().then((id) => {
      if (id !== undefined && id !== own) tell()
    })
  }
  const timer = setInterval(check, checkEvery)
  document.addEventListener('visibilitychange', check)
  // Vite raises this when a lazily loaded file of the page's build is no longer served.
  window.addEventListener('vite:preloadError', tell)
  return {
    stop: () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('vite:preloadError', tell)
    },
  }
}
