// The address a registration was made with, carried to *Check your email* (A-3) so that the
// screen can say where the link went. It travels in the history entry's state and in no
// address: an email address in a URL is in every log the URL passes through. A page loaded
// again may have it no longer, and the screen then asks for it.

/** The router state that carries `email` to the screen that says a link was sent to it. */
export function sentState(email: string): { readonly email: string } {
  return { email }
}

/** The address a history entry's state carries, or undefined: the state is whatever was put there. */
export function sentTo(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const { email }: { email?: unknown } = state
  return typeof email === 'string' && email !== '' ? email : undefined
}
