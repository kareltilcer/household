// The Content-Security-Policy the web app sets (PRD 07 §4): strict, with no 'unsafe-inline' and no
// 'unsafe-eval'. Everything a page loads comes from its own origin: its scripts and stylesheets as
// files the build wrote, its workers among them, the fonts self-hosted (N8), and the API
// same-origin behind the session cookie. The build writes the policy into index.html as a <meta>,
// so the app carries it whoever serves it, and the preview server the end-to-end suite runs
// against sends it as a header too, with the one directive a <meta> cannot carry.
//
// A directive is widened here, in the pull request that needs it and for the origin it needs.
// Item 25 widened three (ADR 0026). Two are the replica's: `script-src` admits compiling
// WebAssembly, which the replica's SQLite is, and `connect-src` the sync service's origin. The
// third is a picture's: `img-src` admits the object store's origin, where the API's pre-signed
// links point. A build is told both origins (deployment.ts). The payment processor's frame is
// item 27's.
import { deployment, type Deployment } from './deployment.ts'

/**
 * Lets a page compile WebAssembly, and nothing else: no string is evaluated as script under it,
 * which is what 'unsafe-eval' would allow with it. The module compiled is a file of the page's
 * own origin, fetched under `connect-src`.
 */
export const wasm = "'wasm-unsafe-eval'"

/** The directives a `<meta http-equiv>` carries, for a page of the deployment `of`. */
export function directivesFor(of: Deployment) {
  return {
    'default-src': ["'none'"],
    'script-src': ["'self'", wasm],
    'style-src': ["'self'"],
    'img-src': ["'self'", ...of.files],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...of.sync],
    'manifest-src': ["'self'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
  } as const satisfies Record<string, readonly string[]>
}

/**
 * What only a response header can say: a `<meta>` policy ignores `frame-ancestors`. Whoever serves
 * the app sends the whole policy as its header, so that no other site can frame it.
 */
export const headerOnly = {
  'frame-ancestors': ["'none'"],
} as const satisfies Record<string, readonly string[]>

function serialise(policy: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(policy)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ')
}

/** The policy as index.html's `<meta http-equiv="Content-Security-Policy">` states it. */
export function metaPolicyFor(of: Deployment): string {
  return serialise(directivesFor(of))
}

/** The policy as the `Content-Security-Policy` response header states it. */
export function headerPolicyFor(of: Deployment): string {
  return serialise({ ...directivesFor(of), ...headerOnly })
}

/** The deployment this process's environment names. */
const deployed = deployment(false)

/** The directives of a build made in this environment. */
export const directives = directivesFor(deployed)

/** The `<meta>` policy of a build made in this environment, which build/check.ts holds one to. */
export const metaPolicy = metaPolicyFor(deployed)

/** The header's policy for a build made in this environment. */
export const headerPolicy = headerPolicyFor(deployed)

/** The sources that would let inline or evaluated code or style through: none may appear. */
export const unsafeSources = ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'"] as const
