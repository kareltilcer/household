// An API error as the app carries it. A request that the server refused throws an ApiProblemError
// holding the contract's problem document, typed by its `code`: a screen switches on the code,
// never on `detail` (docs/api/README.md), and says what happened in its own words, from the
// catalogs.
import { problemOf, type ApiProblem, type UnreadableProblem } from '@household/api'

export class ApiProblemError extends Error {
  override readonly name = 'ApiProblemError'
  readonly problem: ApiProblem | UnreadableProblem
  /**
   * When asking again may be answered, where the response said: a `429`'s `Retry-After`, counted
   * from when the answer was read. A screen says the time, and does not ask before it.
   */
  readonly retryAt: Date | undefined

  constructor(problem: ApiProblem | UnreadableProblem, retryAt?: Date) {
    super(`${String(problem.status)} ${problem.code ?? 'unreadable'}`)
    this.problem = problem
    this.retryAt = retryAt
  }

  /** The response's status. */
  get status(): number {
    return this.problem.status
  }
}

/**
 * What a request answered: its data, or an ApiProblemError thrown for anything but a `2xx`. A
 * query or a mutation function returns this, so that TanStack Query holds either the data or the
 * typed problem.
 */
export function unwrap<Data>(result: {
  readonly data?: Data
  readonly error?: unknown
  readonly response: Response
}): Data {
  const problem = problemOf(result)
  if (problem !== undefined) throw new ApiProblemError(problem, retryAt(result.response))
  // A `204` has no body: its operation's data type says so, and `undefined` is its value.
  return result.data as Data
}

/**
 * When `response` says to ask again: its `Retry-After`, in seconds as the contract sends it or as
 * a date, from now. Undefined where it names none, or none that can be read.
 */
export function retryAt(response: Response, now: () => number = Date.now): Date | undefined {
  const value = response.headers.get('Retry-After')?.trim() ?? ''
  if (value === '') return undefined
  if (/^\d+$/.test(value)) return new Date(now() + Number(value) * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : new Date(date)
}

/** The problem `error` carries, or undefined for any other failure: a lost connection, a bug. */
export function problemIn(error: unknown): ApiProblem | UnreadableProblem | undefined {
  return error instanceof ApiProblemError ? error.problem : undefined
}

/**
 * Whether asking again now could help. A problem the server stated will be stated again, but for
 * a `5xx`, which is the server's own failure, and a `409 idempotency_in_progress`, which says the
 * first attempt is still running. A `429` is one that will: it clears when the time its
 * `Retry-After` names has come, and a request sent before then is refused again and counted
 * against the limit it met. A request that got no answer at all may get one: that is a member's
 * to ask again, since the transport has already resent it and the query client does not
 * (query.ts).
 */
export function isRetryable(error: unknown): boolean {
  const problem = problemIn(error)
  if (problem === undefined) return true
  return problem.status >= 500 || problem.code === 'idempotency_in_progress'
}
