// Entity-tags and idempotency keys: the two headers the contract uses for concurrency and
// retries (docs/api/README.md). A representation's `version` travels as its `ETag` and comes
// back in `If-Match`; an unsafe request carries an `Idempotency-Key`, so a retry of a request
// whose response was lost cannot apply its effect twice.
import type { Middleware } from 'openapi-fetch'
import { newId } from './ids.ts'

// An entity-tag as the contract's IfMatch pattern admits one: not empty.
const quoted = /^(W\/)?"([^"]+)"$/
const decimal = /^(0|[1-9][0-9]*)$/

/** The entity-tag a representation of `version` carries: the version in decimal, quoted. */
export function entityTag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError(`entityTag: ${String(version)} is not a version`)
  }
  return `"${String(version)}"`
}

/**
 * The version an `ETag` header names, or undefined when there is none or it names no version
 * this contract issues. A weak tag names the same version.
 */
export function versionOf(etag: string | null | undefined): number | undefined {
  const match = quoted.exec(etag?.trim() ?? '')
  const digits = match?.[2]
  if (digits === undefined || !decimal.test(digits)) return undefined
  const version = Number(digits)
  return Number.isSafeInteger(version) ? version : undefined
}

/** Methods that change state (RFC 9110 §9.2.1). */
const unsafe = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Whether a request by `method` is unsafe: one that changes state, which carries an
 * `Idempotency-Key`, and from a browser's session the token that proves it the app's own. One
 * list, so that no method carries the one and not the other.
 */
export function isUnsafeMethod(method: string): boolean {
  return unsafe.has(method)
}

/**
 * Holds an outgoing `If-Match` to the contract's entity-tag. A bare version (`42`, from
 * `String(version)`) is quoted, since RFC 9110 defines `If-Match` over entity-tags and an
 * intermediary may drop the malformed header, turning an edit into an unconditional
 * overwrite. A weak tag of a version (`W/"42"`, an `ETag` a compressing proxy weakened) is
 * sent strong: `If-Match` compares strongly, so the server would refuse it on every edit,
 * and versionOf reads it as the same version. Anything else that is not an entity-tag is a
 * programming error and throws.
 */
export const ifMatchMiddleware: Middleware = {
  onRequest({ request }) {
    const value = request.headers.get('If-Match')?.trim()
    if (value === undefined) return undefined
    const tag = quoted.exec(value)
    // A strong tag, or a weak one that names no version, is sent as it is.
    if (tag !== null && (tag[1] === undefined || !decimal.test(tag[2] ?? ''))) return undefined
    const digits = tag === null ? value : (tag[2] ?? '')
    if (!decimal.test(digits)) {
      throw new TypeError(`If-Match: ${JSON.stringify(value)} is not an entity-tag`)
    }
    const headers = new Headers(request.headers)
    headers.set('If-Match', `"${digits}"`)
    return new Request(request, { headers })
  },
}

/**
 * Gives every unsafe request an `Idempotency-Key` unless the caller set one. A caller that
 * retries a request itself passes the first attempt's key in the operation's
 * `Idempotency-Key` header parameter; the transport's own retry (retryingFetch) resends the
 * request as it left, key included.
 */
export function idempotencyMiddleware(newKey: () => string = newId): Middleware {
  return {
    onRequest({ request }) {
      if (!unsafe.has(request.method) || request.headers.has('Idempotency-Key')) return undefined
      const headers = new Headers(request.headers)
      headers.set('Idempotency-Key', newKey())
      return new Request(request, { headers })
    },
  }
}

export interface RetryOptions {
  /**
   * How long to wait before each retry, in milliseconds: its length is the number of retries.
   * Defaults to two retries, after 250 ms and 1 s.
   */
  readonly delays?: readonly number[]
  /**
   * Waits `ms` milliseconds, or until `signal` aborts if that is sooner. Tests pass one that
   * does not wait.
   */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/**
 * Wraps `fetch` to resend a request whose response was lost: `fetch` rejected, and the caller
 * did not abort it. Only a request that is safe to repeat is resent: a safe method, or an
 * unsafe one carrying an `Idempotency-Key`, which the server answers with the first
 * attempt's stored `2xx` instead of applying it again. A response, whatever its status, is
 * returned as it is: a `409 idempotency_in_progress` is the caller's to wait out. A caller
 * that aborts, even while a retry waits, gets what `fetch` rejects an aborted request with:
 * the signal's reason, not the network error before it.
 */
export function retryingFetch(
  base: (request: Request) => Promise<Response>,
  { delays = [250, 1000], sleep = wait }: RetryOptions = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const repeatable = !unsafe.has(request.method) || request.headers.has('Idempotency-Key')
    // A body can be read once, so each attempt sends a copy. The request itself is never
    // sent: it is what every copy is taken from, and the one body buffered for a retry.
    let attempt = repeatable ? request.clone() : request
    // Read afresh each time: the caller may abort while a retry waits.
    const aborted = () => request.signal.aborted
    for (let retry = 0; ; retry++) {
      try {
        return await base(attempt)
      } catch (error) {
        if (aborted()) throw abortReason(request.signal)
        const delay = delays[retry]
        if (!repeatable || delay === undefined || isAbort(error)) throw error
        await sleep(delay, request.signal)
        if (aborted()) throw abortReason(request.signal)
        attempt = request.clone()
      }
    }
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * What `fetch` rejects with once `signal` has aborted: its reason, or an AbortError where the
 * platform's AbortSignal predates `reason`, as React Native's does: its types declare none, so
 * it is asked for as a member the signal may not have.
 */
function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = 'reason' in signal ? signal.reason : undefined
  if (reason !== undefined) return reason
  const error = new Error('The request was aborted')
  error.name = 'AbortError'
  return error
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
  })
}
