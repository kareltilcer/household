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

  it('from the entitlement gate with a state or remedy this build does not know is unreadable', () => {
    const newer = [
      { state: 'read_only', remedy: 'upgrade_plan' },
      { state: 'frozen', remedy: 'subscribe' },
    ]
    for (const extra of newer) {
      expect(readProblem(402, problem('entitlement_restricted', 402, extra)).code).toBeUndefined()
    }
  })

  it('from an upload past the storage ceiling carries by how much, and is no gate refusal', () => {
    const members = {
      state: 'trialing',
      remedy: 'free_storage',
      over_by_bytes: 600,
      blocks_at_ceiling: 20,
    }
    const read = readProblem(402, problem('storage_ceiling_reached', 402, members))
    if (read.code !== 'storage_ceiling_reached') throw new Error('not a ceiling refusal')
    expect(read.over_by_bytes).toBe(600)
    expect(read.blocks_at_ceiling).toBe(20)
    expect(read.remedy).toBe('free_storage')
    expect(isEntitlementRefusal(read)).toBe(false)
    const unreadable = [
      { state: 'trialing', remedy: 'free_storage', blocks_at_ceiling: 20 },
      { ...members, state: 'frozen' },
      { ...members, over_by_bytes: '600' },
    ]
    for (const extra of unreadable) {
      expect(readProblem(402, problem('storage_ceiling_reached', 402, extra)).code).toBeUndefined()
    }
  })

  it('from the gate of a restricted household tells its owner to lift it', () => {
    const read = readProblem(
      402,
      problem('entitlement_restricted', 402, { state: 'restricted', remedy: 'lift_restriction' }),
    )
    if (!isEntitlementRefusal(read)) throw new Error('not a refusal')
    expect(read.remedy).toBe('lift_restriction')
  })

  it('from a fair-use ceiling names what it counts, and its ceiling', () => {
    const read = readProblem(
      403,
      problem('fair_use_ceiling', 403, { resource: 'rows', ceiling: 250000, module: 'shopping' }),
    )
    if (read.code !== 'fair_use_ceiling') throw new Error('not a fair-use refusal')
    expect(read.resource).toBe('rows')
    expect(read.ceiling).toBe(250000)
    expect(read.module).toBe('shopping')
    const owned = readProblem(403, problem('household_limit_reached', 403, { ceiling: 5 }))
    if (owned.code !== 'household_limit_reached')
      throw new Error('not the households a user may own')
    expect(owned.ceiling).toBe(5)
    const unreadable: [string, Record<string, unknown>][] = [
      ['fair_use_ceiling', { resource: 'rows' }],
      ['fair_use_ceiling', { resource: 'messages', ceiling: 500000 }],
      ['household_limit_reached', {}],
    ]
    for (const [code, extra] of unreadable) {
      expect(readProblem(403, problem(code, 403, extra)).code).toBeUndefined()
    }
  })

  it('from a server that no longer serves the client names the oldest version it does', () => {
    const read = readProblem(400, problem('update_required', 400, { minimum_version: '1.6.0' }))
    if (read.code !== 'update_required') throw new Error('not an update the server asks for')
    expect(read.minimum_version).toBe('1.6.0')
    // One that names no version is no answer a client could act on by its type.
    expect(readProblem(400, problem('update_required', 400, {})).code).toBeUndefined()
    expect(
      readProblem(400, problem('update_required', 400, { minimum_version: 16 })).code,
    ).toBeUndefined()
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

  it('that is not absent or gone keeps every type it might be', () => {
    const read = readProblem(409, problem('idempotency_in_progress', 409))
    if (isAbsent(read) || isGone(read)) throw new Error('a 409 read as absent or gone')
    // A guard that named only the type would leave UnreadableProblem here, and the 409
    // would be typed as having no code.
    expectTypeOf(read).toEqualTypeOf<ApiProblem | UnreadableProblem>()
    expect(isConcurrencyConflict(read)).toBe(true)
    const absent = readProblem(404, problem('not_found', 404))
    if (!isAbsent(absent)) throw new Error('a 404 not read as absent')
    expectTypeOf(absent.code).toEqualTypeOf<ProblemCode>()
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
