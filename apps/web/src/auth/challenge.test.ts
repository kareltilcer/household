import { readProblem } from '@household/api'
import { describe, expect, it } from 'vitest'
import { ApiProblemError } from '../api/problem.ts'
import { challengeIn, dropChallenge, heldChallenge, holdChallenge } from './challenge.ts'
import { noticeIn, noticeState } from './notice.ts'
import { sentState, sentTo } from './sent.ts'

/** What `unwrap` throws for a response of `status` whose body is `body`. */
function refusal(status: number, body: unknown): ApiProblemError {
  return new ApiProblemError(readProblem(status, body))
}

describe('a sign-in’s challenge', () => {
  const challenge = {
    error: 'mfa_required',
    challenge_token: 'c1',
    methods: ['totp', 'recovery_code'],
    recovery_codes_left: 8,
  }

  it('is read from the 409 that is plain JSON and no problem document', () => {
    expect(challengeIn(refusal(409, challenge))).toEqual({
      token: 'c1',
      methods: ['totp', 'recovery_code'],
      recoveryCodesLeft: 8,
    })
  })

  it('offers only the ways this build knows, and no count the server did not give', () => {
    const read = challengeIn(
      refusal(409, {
        error: 'mfa_required',
        challenge_token: 'c1',
        methods: ['recovery_code', 'passkey'],
      }),
    )
    expect(read).toEqual({ token: 'c1', methods: ['recovery_code'], recoveryCodesLeft: undefined })
    expect(
      challengeIn(refusal(409, { ...challenge, recovery_codes_left: -1 }))?.recoveryCodesLeft,
    ).toBeUndefined()
  })

  it('is none of the other things a sign-in is refused with', () => {
    const problem = (status: number, code: string) =>
      refusal(status, { type: 'about:blank', title: code, status, code })
    for (const error of [
      // A `409` that is a problem: the provider's sign-in, and a first attempt still running.
      problem(409, 'link_required'),
      problem(409, 'idempotency_in_progress'),
      problem(401, 'invalid_credentials'),
      // The body of a challenge under another status is no challenge.
      refusal(401, challenge),
      refusal(409, { ...challenge, error: 'other' }),
      refusal(409, { ...challenge, challenge_token: 7 }),
      refusal(409, { error: 'mfa_required', challenge_token: 'c1' }),
      refusal(409, 'mfa_required'),
      new Error('no connection'),
      undefined,
    ]) {
      expect(challengeIn(error)).toBeUndefined()
    }
  })

  it('is held in the page’s memory alone, until it is dropped', () => {
    expect(heldChallenge()).toBeNull()
    const read = challengeIn(refusal(409, challenge))
    if (read === undefined) throw new Error('no challenge was read')
    holdChallenge(read)
    expect(heldChallenge()).toBe(read)
    // Half a credential: written to no storage a reload, or another tab, could read.
    expect(window.sessionStorage).toHaveLength(0)
    expect(window.localStorage).toHaveLength(0)
    dropChallenge()
    expect(heldChallenge()).toBeNull()
  })
})

describe('what a history entry carries to a screen', () => {
  it('is a notice the sign-in knows, and nothing else that was put there', () => {
    expect(noticeIn(noticeState('locked'))).toBe('locked')
    for (const state of [undefined, null, 'locked', {}, { notice: 'other' }, { notice: 1 }]) {
      expect(noticeIn(state)).toBeUndefined()
    }
  })

  it('is the address a link was sent to, where it is one', () => {
    expect(sentTo(sentState('jana@example.test'))).toBe('jana@example.test')
    for (const state of [undefined, null, 'jana@example.test', {}, { email: '' }, { email: 1 }]) {
      expect(sentTo(state)).toBeUndefined()
    }
  })
})
