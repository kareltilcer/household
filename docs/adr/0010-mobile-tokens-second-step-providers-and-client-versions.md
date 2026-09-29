# 0010 — A device's access token is checked against its live sign-in, second-step secrets are sealed under a key the database does not hold, the provider flow is checked end to end on the server, and please-update comes before the contract

- **Status:** Accepted
- **Date:** 2026-09-29
- **Plan item:** 9
- **Decides for:** [02-identity-and-access](../prd/02-identity-and-access.md) §1–2, §9 (FR-ID2–FR-ID7);
  [06-clients](../prd/06-clients.md) §7; [07-nonfunctional](../prd/07-nonfunctional.md) §4; D-7, D-14, D-15,
  D-98–D-102; [ADR 0009](0009-accounts-sessions-throttles-and-the-breach-corpus.md)'s note on responses that
  carry a secret

## Context

Plan item 9 gives the mobile client its credential, the second step, sign-in with Google and Apple,
and the please-update gate. The PRD fixes the token pair (EdDSA, 15 minutes, `sub`, `sid`, `iat`,
`exp`, `client`; rotating single-use refresh tokens with reuse detection), TOTP with recovery codes,
OIDC with PKCE keyed on `sub`, and a blocking please-update. It does not say:

1. **What an access token is checked against.** A JWT verifies without the database, but then a
   revoked device, a reset or signing out everywhere would leave it working for fifteen minutes.
2. **How the signing keys are held and rotated**, and how PowerSync (plan item 13) is to verify its
   own tokens with them.
3. **How a TOTP secret is kept**, which the server must read back, and a recovery code, which is
   forty bits.
4. **Where a "new device" is decided**, when a device's id is the client's own and no secret.
5. **How much of the provider flow the server checks**, when a provider may or may not enforce PKCE.
6. **Where please-update sits** relative to the contract's own validation, and what it answers.

## Decision

**An access token is an EdDSA JWT, and a request it signs in is checked against its device's live
sign-in** (`internal/platform/token`, `internal/platform/device`). The token carries only the five
claims D-15 names; its header says `typ: at+jwt` (RFC 9068) and names its key by the key's RFC 7638
thumbprint. It verifies against the public keys alone, and then one statement by primary key finds
its `sid` among the live sign-ins, as a web session's cookie is looked up: a revoked device, a
password reset and signing out everywhere end its requests at once. Grants are still read per
request from the membership (D-15). A token carrying an audience or an issuer is refused, so that
no token minted for PowerSync, which carries PowerSync's audience, signs anyone in to the API. A
request with a bearer token in `Authorization` is decided by it alone: the session cookie it may
also carry is not read. A header in another scheme is left to whoever asked for it, such as a proxy
guarding a staging site with Basic credentials, which a browser then sends on every request, and the
cookie decides.

**A device's sign-in is a row, `device_sessions`, and its refresh tokens hang off it.** A device is
the client's installation id, unique per user rather than globally, since a shared tablet signs
several profiles in; it holds one live sign-in, which a new sign-in on it replaces. A refresh token
is 256 random bits kept as its SHA-256; each use marks it used and names its successor. A used token
presented again revokes the sign-in, and the owner is sent the takeover notice, unless it comes
within a minute of its use while its successor is unused (D-98): then a new pair is issued and the
unused successor is retired, so that a thief who beat the device to it meets a reuse at the device's
next refresh. Refreshes of one family take turns on the sign-in's row lock. A sign-in has no expiry
of its own (D-99). Used tokens are kept while their family lives; the expiry sweep (item 17) deletes
those a month old.

**The keys are lists in the environment, the first signing or sealing and every one verifying or
opening.** `HOUSEHOLD_TOKEN_KEYS` holds Ed25519 seeds; `HOUSEHOLD_MFA_KEYS` holds 32-byte AES keys.
A key is rotated by putting its successor first and dropping it once nothing it made is live: fifteen
minutes for a token key. An MFA key stays listed while any secret or recovery code made under it is
kept: a secret is sealed again under the first key each time its code is accepted, and a set of
recovery codes is made under the first key whenever a new one is, so the old key's share only
shrinks, and a key dropped early locks those accounts out of their second step until support
resets it.
Development defaults to published keys, which every other environment is refused. The public token
keys are exported as a JWKS (`token.Keys.JWKS`) for item 13 to publish. `docs/runbooks/sign-in-keys-and-providers.md`
says how to make and rotate them.

**A TOTP secret is sealed with AES-256-GCM under the MFA key, bound to its owner's id; a recovery code
is kept as an HMAC-SHA-256 under the same key** (`internal/platform/mfa`). A copy of the database
alone yields no second factor: the secret needs the key, and a forty-bit code under a fast unkeyed
hash would fall to a day of guessing. The key's id, four bytes of its SHA-256, prefixes a sealed
secret, and a recovery code is looked up under every configured key. A code is accepted once: the
last accepted time step is kept, and a code from it or an older one is refused (RFC 6238 §5.2). An
account turns the second step on only once its address is verified (D-100): one bound before would
outlive the reset that proves the address and hands the account to its owner (D-102).

**"New device" is "not trusted", and a trust is a token the browser or device holds.** A device id
names no secret, so trusting it by id would let anyone with the password and the id skip the step.
A browser holds its trust in `__Host-hh_trust` (HttpOnly, Secure, Lax), a device in `trust_token`,
which the sign-in's body sends back; each is 256 random bits kept by its hash, for 30 days (D-100).
A sign-in whose first factor passes, with a password or with a provider, goes through one path
(`identity.admit`): a challenge, a row whose token `/auth/mfa/verify` takes with the code, when the
second step is on and the attempt is not trusted; the credential otherwise. The challenge keeps what
the sign-in was for, a browser or a device and which, so its answer signs in exactly as the sign-in
would have. Wrong codes are counted per account, five in five minutes (D-101) through item 8's
throttles, and ten since the last right one lock the authenticator on its row. The first code, which
turns an enrolment on and is answered with the recovery codes, counts against the same limit.

**The provider flow is checked on the server end to end** (`internal/platform/federation`). The
client sends its S256 challenge to `/start`; the server keeps it with a state and a nonce of its
own, and the redirect URI, which must be one registered exactly. At the callback the server checks
the verifier against the challenge itself before it redeems the code, since a provider that ignores
PKCE would otherwise let an intercepted code through; it then redeems the code with the verifier and
its client secret, and verifies the ID token's signature against the provider's published keys, its
issuer, audience and expiry, and the nonce. A state is spent before anything else is checked, so it
is used once whatever follows. A start made signed in records the account, and only that account
may complete it as a link. A sign-in holds the credential it found until it commits, and a link
takes the account's row, as a reset does, and checks that the session it came with is still live,
so that a reset that unlinks the providers (D-102) is outlived by neither. Discovery documents are
fetched on first use and kept, so the server starts without reaching Google or Apple. Apple's client secret is a JWT the team's key signs for each
exchange, and Apple is asked for `form_post`, which it requires for the email and name scopes.
`federationtest` is a provider in a test server that holds every step to the same rules, which the
tests run the whole flow against.

**Please-update is `400 update_required`, answered before the contract is checked**
(`internal/platform/clientversion`). A client names itself in `Household-Client: <type>/<version>`;
the minimum for each type is deploy-time configuration. A client too old to be served is the one most
likely to send a request the contract no longer admits, so the gate runs first, where a `422` would
otherwise tell it nothing it can act on. The problem carries `minimum_version`, an
`UpdateRequiredProblem`, and like the other protocol-level codes it is declared on no operation. A
request naming no client is held to no minimum: the header is a promise about Household's own
clients, and a probe or a script is not one.

**A handler can mark its response unstorable** (`idempotency.Unstorable`), as ADR 0009 said item 9
would: the response goes to the client, its key stays committed, and a repeat answers `409
idempotency_in_progress`. Activating the second step, whose answer carries the recovery codes, uses
it. Enrolling, turning off and making new codes take the password in their body, and keep no key at
all (D-97).

**The contract changes with it** (`docs/api/openapi.yaml`): `update_required` joins `ProblemCode`
beside `UpdateRequiredProblem` and the `Household-Client` section; `LoginRequest` gains `trust_token`
and a `DeviceSignIn` that requires its id; `LoginResult` gains `trust_token`; `MfaChallenge` names
its required members and `recovery_codes_left`; `Me` gains `mfa_recovery_codes_left`; the callback
takes an `OauthCallbackRequest` with the device, the trust token and a name for Apple, and answers
`401` and a `409` that is either `link_required` or an `MfaChallenge`; the link answers `422`; the
start answers `429` and a `422 redirect_uri_not_registered` that names the field; a new operation,
`POST /auth/mfa/recovery-codes`, makes a new set (A-6), which no operation did; and the descriptions
say what each does to devices, trusts and keys.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A stateless access token, checked by signature alone | A revoked device, a reset or signing out everywhere would leave it working for fifteen minutes; FR-ID7 and FR-ID6 expect them to end it |
| A deny-list of revoked `sid`s instead of a live-list | The same one lookup per request, with a list that must be swept and that forgets a revocation when it is |
| Device ids unique globally | A shared tablet signs in several profiles on one installation; and one client's id could collide with, or be claimed against, another user's |
| A family that lives on the device row | A device signed in again would revive the tokens of its earlier sign-in that were never used |
| Refresh tokens with an idle expiry | Rejected in D-99 |
| TOTP secrets in the clear, relying on the database's encryption at rest | A backup, a dump or a replica would hand over every second factor |
| Recovery codes under Argon2id | Ten slow hashes a verification, 64 MiB each, for a value a keyed hash protects as well once the key is outside the database |
| Trust by device id, or by a device's live sign-in | The id is no secret; a signed-out device has no sign-in, and a trust is what lets it back in without the step |
| Trusting the provider to enforce PKCE | Apple's documentation does not promise it, and the server holds the challenge anyway |
| Discovery at start-up | A provider outage would stop the server starting |
| `426 Upgrade Required` for please-update | RFC 9110 makes it a protocol upgrade, which must carry an `Upgrade` header naming a protocol |
| `410 Gone` | Says the resource is gone for everyone; it is this client that is too old |
| Please-update behind the contract's validation | An old client's request the contract has since changed would be answered `422`, which it cannot act on |
| Declaring `Household-Client` on every operation | 490 operations for a header a generated client sets once; the edge would still have to answer before validating |

## Consequences

**What gets easier:**
- Item 13 signs PowerSync's tokens with the same keys and publishes `JWKS()`; its tokens carry an
  audience, which this API refuses.
- Item 11's child sign-in ends in the same `admit`, for a device's token pair.
- Item 17 fills `devices.push_token` and sweeps `refresh_tokens`, `device_sessions`, `mfa_challenges`,
  `mfa_trusts` and `oauth_states`.
- Items 25 and 29 build the screens on operations that already say what each answer means.

**What gets harder:**
- Every deployment holds two more secrets, and rotates them by the runbook.
- Every request an access token signs in costs one indexed read, as a web session's does.
- An MFA key once used stays listed until the accounts sealed under it have all signed in with a
  code and made new recovery codes; there is no job that re-seals them all at once.
- Native sign-in with Apple on iOS, and Google's native SDK, hand the client an ID token rather than a
  code and a PKCE verifier; item 29 adds an exchange for them if it uses them. Apple's `form_post`
  needs a receiver the web client (item 25) provides, or Apple's JS in its popup mode.

**Revisit this when** the lookup per request shows in item 90's measurements, or a provider's native
flow becomes the only one a store accepts.
