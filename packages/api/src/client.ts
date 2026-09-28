// The typed client both apps call the API through (06-clients §1): openapi-fetch over the
// types generated from openapi.yaml, with the contract's concurrency and retry headers
// handled once, here, rather than at every call site.
import createClient, { type Client } from 'openapi-fetch'
import {
  idempotencyMiddleware,
  ifMatchMiddleware,
  retryingFetch,
  type RetryOptions,
} from './concurrency.ts'
import type { paths } from './generated/openapi.ts'
import { newId } from './ids.ts'

export type ApiClient = Client<paths>

export interface ApiClientOptions {
  /** Where `/api/v1` is served, such as `https://household.example/api/v1`. */
  readonly baseUrl: string
  /** The transport. Defaults to `globalThis.fetch`. */
  readonly fetch?: (request: Request) => Promise<Response>
  /** Mints an `Idempotency-Key` for an unsafe request that has none. Defaults to a UUIDv7. */
  readonly newIdempotencyKey?: () => string
  /** How a request whose response was lost is resent; see retryingFetch. */
  readonly retry?: RetryOptions
  /** Sent with every request. The web client authenticates by cookie and needs none. */
  readonly headers?: Readonly<Record<string, string>>
}

/**
 * A client for the contract's operations. Every unsafe request carries an `Idempotency-Key`
 * (the caller's, or a new one), an `If-Match` is held to entity-tag syntax, and a request
 * whose response was lost is resent with the key it left with. Errors come back in `error`,
 * and `problemOf` reads them as the contract's problem documents.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.fetch ?? ((request: Request) => globalThis.fetch(request))
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    fetch: retryingFetch(base, options.retry),
    ...(options.headers === undefined ? {} : { headers: { ...options.headers } }),
  })
  client.use(ifMatchMiddleware, idempotencyMiddleware(options.newIdempotencyKey ?? newId))
  return client
}
