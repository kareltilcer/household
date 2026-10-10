// The one request that renews a device's sign-in (`postAuthToken`, PRD 02 FR-ID4), as the token
// store asks it (tokens.ts). It leaves by a client that signs nothing: the refresh token in its
// body is what it proves itself with, and a client that answered a `401` by renewing would send
// this one round again.
//
// A renewal whose answer was lost is resent by @household/api as any other request is, with the
// token it left with: within a minute the server takes that for the retry it is, and answers
// with a new pair (D-98).
import { problemOf, type ApiClient } from '@household/api'
import { ApiProblemError, retryAt } from '../api/problem.ts'
import type { ProblemHub } from '../api/problems.ts'
import type { Exchange } from './tokens.ts'

/**
 * Asks for a new pair with `refresh`. Only `401 refresh_token_invalid` is the sign-in's end: the
 * token opens no live sign-in, whatever ended it, which the answer does not say (Q18). Any other
 * answer is thrown as the problem it is, and told to `problems` first, this being a request no
 * query or mutation makes: a build too old to be served is refused here as anywhere.
 */
export async function exchange(
  api: ApiClient,
  problems: ProblemHub,
  refresh: string,
): Promise<Exchange> {
  const answer = await api.POST('/auth/token', { body: { refresh_token: refresh } })
  const problem = problemOf(answer)
  if (problem === undefined) {
    if (answer.data === undefined) throw new Error('renewal: the server answered with no pair')
    return { kind: 'renewed', tokens: answer.data }
  }
  if (problem.status === 401 && problem.code === 'refresh_token_invalid') return { kind: 'ended' }
  problems.report(problem)
  throw new ApiProblemError(problem, retryAt(answer.response))
}
