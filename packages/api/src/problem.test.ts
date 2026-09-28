import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  isAbsent,
  isConcurrencyConflict,
  isEntitlementRefusal,
  isGone,
  isProblemCode,
  problemCodes,
  problemOf,
  readProblem,
  type ApiProblem,
  type ProblemCode,
  type UnreadableProblem,
} from './problem.ts'

function problem(code: string, status: number, extra: Record<string, unknown> = {}) {
  return { type: `urn:household:problem:${code}`, title: 'Title', status, code, ...extra }
}

describe('a problem document', () => {
  it('with version_conflict carries the current representation', () => {
    const read = readProblem(
      409,
      problem('version_conflict', 409, { current: { name: 'Lidl' }, current_version: 8 }),
    )
    expect(read.code).toBe('version_conflict')
    if (read.code !== 'version_conflict') throw new Error('not a conflict')
    expect(read.current).toEqual({ name: 'Lidl' })
    expect(read.current_version).toBe(8)
    expect(isConcurrencyConflict(read)).toBe(true)
  })

  it('with version_conflict but no current version is unreadable, not a conflict', () => {
    const read = readProblem(409, problem('version_conflict', 409, { current: {} }))
    expect(read.code).toBeUndefined()
  })

  it('with idempotency_in_progress is a 409 without current', () => {
    const read = readProblem(409, problem('idempotency_in_progress', 409))
    expect(read.code).toBe('idempotency_in_progress')
    expect(isConcurrencyConflict(read)).toBe(true)
    expect('current' in read).toBe(false)
  })

  it('from the entitlement gate carries its state and remedy', () => {
    const read = readProblem(
      402,
      problem('entitlement_read_only', 402, { state: 'read_only', remedy: 'subscribe' }),
    )
    expect(isEntitlementRefusal(read)).toBe(true)
    if (!isEntitlementRefusal(read)) throw new Error('not a refusal')
    expect(read.remedy).toBe('subscribe')
    expect(readProblem(402, problem('entitlement_read_only', 402)).code).toBeUndefined()
  })

  it('with validation_failed names its failures', () => {
    const errors = [{ field: '/name', code: 'required' }]
    const read = readProblem(422, problem('validation_failed', 422, { errors }))
    if (read.code !== 'validation_failed') throw new Error('not a validation failure')
    expect(read.errors).toEqual(errors)
  })

  it('answering 404 or 410 is absent or gone, whatever its code', () => {
    expect(isAbsent(readProblem(404, problem('not_found', 404)))).toBe(true)
    expect(isAbsent(readProblem(404, problem('no_income', 404)))).toBe(true)
    expect(isGone(readProblem(410, problem('token_expired', 410)))).toBe(true)
    expect(isGone(readProblem(410, problem('resnapshot_required', 410)))).toBe(true)
    expect(isAbsent(readProblem(404, '<html>Not Found</html>'))).toBe(false)
  })

  it('takes the status of the response it came with', () => {
    expect(readProblem(404, problem('not_found', 500)).status).toBe(404)
  })

  it('with a code this build does not know is unreadable, not mistyped', () => {
    const body = problem('a_code_from_a_newer_server', 409)
    expect(readProblem(409, body)).toEqual({ code: undefined, status: 409, body })
  })

  it.each([null, 'Bad Gateway', [], { code: 'not_found' }])('%j is unreadable', (body) => {
    expect(readProblem(502, body).code).toBeUndefined()
  })
})

describe('an openapi-fetch result', () => {
  it('holds no problem when it succeeded', () => {
    expect(problemOf({ response: new Response(null, { status: 204 }) })).toBeUndefined()
  })

  it('holds its error as a problem', () => {
    const read = problemOf({
      error: problem('forbidden', 403),
      response: new Response(null, { status: 403 }),
    })
    expect(read?.code).toBe('forbidden')
  })
})

describe('the problem codes', () => {
  it('are the contract’s, each once', () => {
    expect(new Set(problemCodes).size).toBe(problemCodes.length)
    expect(problemCodes).toContain('idempotency_in_progress')
    expect(problemCodes.every(isProblemCode)).toBe(true)
    expect(isProblemCode('toString')).toBe(false)
  })

  it('are a closed set, so a switch over them can be exhaustive', () => {
    // An open `string` here would make a `never` default unreachable, and a code added to
    // the contract would reach a client's switch unhandled instead of failing its build.
    expectTypeOf<ApiProblem['code']>().toEqualTypeOf<ProblemCode>()
    expectTypeOf<string>().not.toExtend<ProblemCode>()
    expectTypeOf<UnreadableProblem['code']>().toBeUndefined()
  })
})
