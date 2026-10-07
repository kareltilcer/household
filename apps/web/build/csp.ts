// The Content-Security-Policy the web app sets (PRD 07 §4): strict, with no 'unsafe-inline' and no
// 'unsafe-eval'. Everything a page loads comes from its own origin: its scripts and stylesheets as
// files the build wrote, the fonts self-hosted (N8), and the API same-origin behind the session
// cookie. The build writes the policy into index.html as a <meta>, so the app carries it whoever
// serves it, and the preview server the end-to-end suite runs against sends it as a header too,
// with the one directive a <meta> cannot carry.
//
// A directive is widened here, in the pull request that needs it and for the origin it needs: the
// payment processor's frame (item 27), the sync service (item 25), a pre-signed file link.

/** The directives a `<meta http-equiv>` carries. */
export const directives = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'"],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'manifest-src': ["'self'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
} as const satisfies Record<string, readonly string[]>

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
export const metaPolicy = serialise(directives)

/** The policy as the `Content-Security-Policy` response header states it. */
export const headerPolicy = serialise({ ...directives, ...headerOnly })

/** The sources that would let inline or evaluated code or style through: none may appear. */
export const unsafeSources = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'unsafe-hashes'",
  "'wasm-unsafe-eval'",
] as const
