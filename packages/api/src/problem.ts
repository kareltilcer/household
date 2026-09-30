// Problem documents (RFC 9457) as the client reads them. Clients switch on `code`, never on
// `detail` (docs/api/README.md), so a problem is typed by its code: narrowing on `code` is
// what gives a `409` its `current` or a `402` its `remedy`, and a switch over ApiProblem's
// codes is exhaustive against the contract's ProblemCode, which the build regenerates.
import type { components } from './generated/openapi.ts'
import { problemCodes } from './generated/problem-codes.ts'

type Schemas = components['schemas']

/** The contract's ProblemCode: every code a server built from this contract can send. */
export type ProblemCode = Schemas['ProblemCode']

export { problemCodes }

/**
 * `values` as a set, held to the contract's union `U` in both directions: a value outside it
 * fails the build, and so does a member the list leaves out, which makes the argument `never`.
 * A list kept here cannot fall behind the contract the build regenerates `U` from.
 */
function every<U extends string>() {
  return <const T extends readonly U[]>(
    values: T & ([Exclude<U, T[number]>] extends [never] ? unknown : never),
  ): ReadonlySet<string> => new Set(values)
}

const known = every<ProblemCode>()(problemCodes)

type EntitlementState = Schemas['EntitlementState']
type Remedy = Schemas['EntitlementProblem']['remedy']

const entitlementStates = every<EntitlementState>()([
  'trialing',
  'active',
  'past_due',
  'grace',
  'read_only',
  'restricted',
  'canceled',
  'suspended',
])
const remedies = every<Remedy>()([
  'subscribe',
  'update_payment_method',
  'free_storage',
  'contact_owner',
])

/** Whether `value` is a code this build of the client knows. */
export function isProblemCode(value: unknown): value is ProblemCode {
  return isMember(known, value)
}

/** The members every problem document carries, whatever its code. */
type Envelope = Omit<Schemas['Problem'], 'code'>

/**
 * `409 version_conflict`: the `If-Match` version did not match. `current` is the server's
 * representation and `current_version` its version, so the client can merge or re-present
 * the member's change.
 */
export type VersionConflict = Envelope & {
  code: 'version_conflict'
  current: unknown
  current_version: number
}

/**
 * `409 idempotency_in_progress`: a repeated `Idempotency-Key` whose first request is still
 * running, or took effect without its response being kept. It carries no `current`. Any
 * operation that accepts `Idempotency-Key` can answer it, whether or not it declares a `409`.
 */
export type IdempotencyInProgress = Envelope & { code: 'idempotency_in_progress' }

/**
 * `402`: the household's entitlement state refuses the request. `entitlement_read_only` is
 * "somebody needs to pay"; `entitlement_restricted` is "an owner turned writing off".
 */
export type EntitlementRefusal = Envelope &
  Omit<Schemas['EntitlementProblem'], keyof Schemas['Problem']> & {
    code: 'entitlement_read_only' | 'entitlement_restricted'
  }

/**
 * `402 storage_ceiling_reached`: an upload that would take the household past the most it may
 * store (FR-FL4, D-33). It carries what an entitlement refusal does, the state and the remedy,
 * `free_storage`, with by how much the upload is over, `over_by_bytes`, and the blocks the ceiling
 * is at, `blocks_at_ceiling`. Unlike the entitlement gate's, it refuses uploads alone: reading,
 * downloading and every other write go on.
 */
export type StorageCeilingReached = Envelope &
  Omit<Schemas['EntitlementProblem'], keyof Schemas['Problem']> & {
    code: 'storage_ceiling_reached'
    over_by_bytes: number
    blocks_at_ceiling: number
  }

/** `422 validation_failed`, naming each failure in `errors`. */
export type ValidationFailure = Envelope &
  Omit<Schemas['ValidationProblem'], keyof Schemas['Problem']> & {
    code: 'validation_failed'
  }

/** Every other code, which carries only the envelope's members for certain. */
export type PlainProblem = Envelope & {
  code: Exclude<
    ProblemCode,
    | VersionConflict['code']
    | IdempotencyInProgress['code']
    | EntitlementRefusal['code']
    | StorageCeilingReached['code']
    | ValidationFailure['code']
  >
}

/** A problem document from this contract, discriminated by `code`. */
export type ApiProblem =
  | VersionConflict
  | IdempotencyInProgress
  | EntitlementRefusal
  | StorageCeilingReached
  | ValidationFailure
  | PlainProblem

/**
 * An error response that is not a problem document this build can read: a code added to the
 * contract after this build (an app in the field meets a newer server), a problem missing the
 * members its code promises or giving one a value this build does not know, or a body that is
 * no problem at all, such as a proxy's HTML page. Its `code` is undefined, so a switch over
 * ApiProblem's codes has a case for it.
 */
export interface UnreadableProblem {
  readonly code: undefined
  readonly status: number
  readonly body: unknown
}

/**
 * The problem an error response carries. `status` is the response's; `body` its parsed JSON,
 * as openapi-fetch returns it in `error`. A known code whose extension members are missing
 * or mistyped is unreadable rather than typed as having them.
 */
export function readProblem(status: number, body: unknown): ApiProblem | UnreadableProblem {
  const unreadable: UnreadableProblem = { code: undefined, status, body }
  if (!isRecord(body) || !isProblemCode(body.code)) return unreadable
  if (typeof body.type !== 'string' || typeof body.title !== 'string') return unreadable
  const problem = { ...body, status }
  switch (body.code) {
    case 'version_conflict':
      return 'current' in body && isInteger(body.current_version)
        ? (problem as VersionConflict)
        : unreadable
    case 'entitlement_read_only':
    case 'entitlement_restricted':
      // A state or remedy added after this build is unreadable too: typed as one of the
      // contract's, it would reach a switch over them unhandled.
      return isMember(entitlementStates, body.state) && isMember(remedies, body.remedy)
        ? (problem as EntitlementRefusal)
        : unreadable
    case 'storage_ceiling_reached':
      return isMember(entitlementStates, body.state) &&
        isMember(remedies, body.remedy) &&
        isInteger(body.over_by_bytes) &&
        isInteger(body.blocks_at_ceiling)
        ? (problem as StorageCeilingReached)
        : unreadable
    case 'validation_failed':
      return Array.isArray(body.errors) ? (problem as ValidationFailure) : unreadable
    default:
      return problem as PlainProblem | IdempotencyInProgress
  }
}

/**
 * The problem an openapi-fetch result carries, or undefined for a success. It reads the
 * response itself, so a status the operation does not declare (a `409` from the
 * idempotency layer, a `405`, a `500`) is typed all the same.
 */
export function problemOf(result: {
  readonly error?: unknown
  readonly response: Response
}): ApiProblem | UnreadableProblem | undefined {
  return result.response.ok ? undefined : readProblem(result.response.status, result.error)
}

/** A `402` the entitlement gate answered. */
export function isEntitlementRefusal(
  problem: ApiProblem | UnreadableProblem,
): problem is EntitlementRefusal {
  return problem.code === 'entitlement_read_only' || problem.code === 'entitlement_restricted'
}

/**
 * A `404`: absent, or not visible to the caller, which the contract makes indistinguishable
 * (a module held at `none`, a private item, a conversation the caller is not in). The guard
 * names the status as well as the type: `problem is ApiProblem` alone would narrow a `false`
 * to UnreadableProblem, though a `409` takes that branch too.
 */
export function isAbsent(
  problem: ApiProblem | UnreadableProblem,
): problem is ApiProblem & { readonly status: 404 } {
  return problem.code !== undefined && problem.status === 404
}

/** A `409` of either kind the contract's concurrency layer answers. */
export function isConcurrencyConflict(
  problem: ApiProblem | UnreadableProblem,
): problem is VersionConflict | IdempotencyInProgress {
  return problem.code === 'version_conflict' || problem.code === 'idempotency_in_progress'
}

/**
 * A `410`: a token or link that has expired or been used, or a cursor past compaction. Like
 * isAbsent, it names the status, so a `false` leaves every other problem as it was.
 */
export function isGone(
  problem: ApiProblem | UnreadableProblem,
): problem is ApiProblem & { readonly status: 410 } {
  return problem.code !== undefined && problem.status === 410
}

function isMember(set: ReadonlySet<string>, value: unknown): value is string {
  return typeof value === 'string' && set.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
