// The second step a sign-in was challenged for (FR-ID5, ADR 0010). A sign-in the server answers
// `409` with an `MfaChallenge` has signed nobody in: the challenge is answered at
// `/auth/mfa/verify` within ten minutes, with a code from the authenticator or a recovery code.
//
// It is held here, in this page's memory and nowhere else. It is half a credential, so it is
// written to no storage; a page loaded again holds none, and the second-step screens send it
// back to the sign-in. Nothing here counts the ten minutes: the server ends the challenge, and
// says so to the screen that answers it.
import { ApiProblemError } from '../api/problem.ts'

/** A way the second step may be answered. */
export type Method = (typeof methods)[number]

const methods = ['totp', 'recovery_code'] as const

export interface Challenge {
  /** What `/auth/mfa/verify` is answered with, beside the code. */
  readonly token: string
  /** The ways it may be answered now: `totp` is left out while the authenticator is locked. */
  readonly methods: readonly Method[]
  /** How many unused recovery codes the account holds, where the challenge says. */
  readonly recoveryCodesLeft: number | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The challenge `error` carries, or undefined for any other failure. A sign-in's `409` with the
 * second step due is the contract's `MfaChallenge` as plain JSON, not a problem document, so it
 * reaches a screen as a problem nothing could read, its body the challenge. A `409` that is a
 * problem, `link_required` or a first attempt still running, is none.
 */
export function challengeIn(error: unknown): Challenge | undefined {
  if (!(error instanceof ApiProblemError) || error.status !== 409) return undefined
  const { problem } = error
  if (problem.code !== undefined) return undefined
  const { body } = problem
  if (!isRecord(body) || body.error !== 'mfa_required') return undefined
  if (typeof body.challenge_token !== 'string' || !Array.isArray(body.methods)) return undefined
  const offered: readonly unknown[] = body.methods
  const left = body.recovery_codes_left
  return {
    token: body.challenge_token,
    // A way this build does not know is one it cannot offer.
    methods: methods.filter((method) => offered.includes(method)),
    recoveryCodesLeft:
      typeof left === 'number' && Number.isSafeInteger(left) && left >= 0 ? left : undefined,
  }
}

let held: Challenge | null = null

/** Holds `challenge` for the second-step screens, in place of any held before. */
export function holdChallenge(challenge: Challenge): void {
  held = challenge
}

/**
 * The challenge held, or null. A screen reads it once, as it opens, and answers that one until
 * it leaves: what becomes of the challenge while the screen is drawn, spent or ended, is that
 * screen's own doing, and it is on its way elsewhere by then.
 */
export function heldChallenge(): Challenge | null {
  return held
}

/** Holds no challenge any more: it was answered, or the server ended it. */
export function dropChallenge(): void {
  held = null
}
