// What a screen that sends a person back to the sign-in tells it, so that the sign-in screen can
// say why they are there again (auth.js: every refusal offers a next action, and says what
// happened). It travels in the history entry the way back makes, with the router's own state:
// it is in no address, and it is said for as long as that entry is the one open.

/**
 * Why a person is at the sign-in again:
 *
 * - `took_too_long`: the second step's challenge ended before it was answered (ten minutes).
 * - `locked`: too many wrong codes ended every challenge and locked the authenticator, which a
 *   recovery code unlocks at the next sign-in (FR-ID5, D-100).
 * - `password_set`: a reset set a new password, and signed every browser and device out.
 */
export type Notice = (typeof notices)[number]

const notices = ['took_too_long', 'locked', 'password_set'] as const

/** The router state that carries `notice` to the sign-in screen. */
export function noticeState(notice: Notice): { readonly notice: Notice } {
  return { notice }
}

/** The notice a history entry's state carries, or undefined: the state is whatever was put there. */
export function noticeIn(state: unknown): Notice | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const { notice }: { notice?: unknown } = state
  return notices.find((known) => known === notice)
}
