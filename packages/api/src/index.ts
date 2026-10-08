/**
 * @household/api — the typed HTTP client generated from docs/api/openapi.yaml, shared by
 * both clients. A contract change that breaks a client breaks the build (06-clients §1): the
 * types are regenerated from the committed contract by this package's `gen`, which runs
 * before every typecheck.
 */
export type { components, operations, paths } from './generated/openapi.ts'
export { createApiClient, type ApiClient, type ApiClientOptions } from './client.ts'
export {
  entityTag,
  idempotencyMiddleware,
  ifMatchMiddleware,
  isUnsafeMethod,
  retryingFetch,
  versionOf,
  type RetryOptions,
} from './concurrency.ts'
export { isUuid, newId } from './ids.ts'
export {
  isAbsent,
  isConcurrencyConflict,
  isEntitlementRefusal,
  isGone,
  isProblemCode,
  problemCodes,
  problemOf,
  readProblem,
  type ApiProblem,
  type EntitlementRefusal,
  type IdempotencyInProgress,
  type PlainProblem,
  type ProblemCode,
  type StorageCeilingReached,
  type UnreadableProblem,
  type UpdateRequired,
  type ValidationFailure,
  type VersionConflict,
} from './problem.ts'
