// The address a registration was made with, carried to *Check your email* (A-3) so that the
// screen can say where the link went, and when it went, so that the screen knows what is left
// of the minute the address waits before another (Resend.tsx). They travel in the history
// entry's state and in no address: an email address in a URL is in every log the URL passes
// through. A page loaded again may have them no longer, and the screen then asks for the address.

/** The router state that carries `email` to the screen that says a link was sent to it just now. */
export function sentState(email: string): { readonly email: string; readonly at: number } {
  return { email, at: Date.now() }
}

/** The address a history entry's state carries, or undefined: the state is whatever was put there. */
export function sentTo(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const { email }: { email?: unknown } = state
  return typeof email === 'string' && email !== '' ? email : undefined
}

/** When the link was sent, as `Date.now()` counts, where a history entry's state says. */
export function sentAt(state: unknown): number | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const { at }: { at?: unknown } = state
  return typeof at === 'number' && Number.isFinite(at) ? at : undefined
}
