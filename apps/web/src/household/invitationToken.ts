// The token of the invitation a link opened (FR-HH3, ADR 0011), between the page that shows it
// and the same page once its visitor has signed in. A visitor reads what they are being given
// before they have an account, and answers only signed in: they leave for the sign-in and are
// brought back (session/destination.ts), and the token has to be here when they are.
//
// It is held here, in this page's memory and nowhere else, as a challenged sign-in's token is
// (auth/challenge.ts, ADR 0026). It is half a credential: whoever holds a link invitation's
// token and an account joins with it. So it is written to no storage, and it left the address
// as it was read (auth/fragment.ts). A page loaded again holds none, and an account made in
// another tab never did: the link is opened again, and an invitation sent to an address waits on
// that address's account besides.
let held: string | null = null

/** Holds `token` for the invitation's page, in place of any held before. */
export function holdInvitationToken(token: string): void {
  held = token
}

/** The token held, or null: what the page reads where its address carried none. */
export function heldInvitationToken(): string | null {
  return held
}

/** Holds no token any more: the invitation was answered, or the server said it is over. */
export function forgetInvitationToken(): void {
  held = null
}
