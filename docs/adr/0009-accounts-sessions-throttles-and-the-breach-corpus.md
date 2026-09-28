# 0009 — Web sessions are bound to their CSRF token, sign-in throttles live in PostgreSQL, and the breach corpus is a sorted file on the server's disk

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan item:** 8
- **Decides for:** [02-identity-and-access](../prd/02-identity-and-access.md) §1–2, §9 (FR-ID1, FR-ID3, FR-ID6, FR-ID7);
  [07-nonfunctional](../prd/07-nonfunctional.md) §4; [01-architecture](../prd/01-architecture.md) §6; D-7, D-12, D-13, D-92, D-95–D-97;
  [ADR 0006](0006-sync-ready-schema-and-the-mutation-spine.md)'s open question on keys outside a household

## Context

Plan item 8 builds the accounts: registering, verifying an address, signing in on the web, resetting
and changing a password, the profile and the session list, the emails they send and the limits on
them. The PRD fixes what each does and names the controls (Argon2id, a local breach list, a
`__Host-` cookie with double-submit CSRF and an Origin allowlist, the §9 limits). It does not say:

1. **What the breach list is on disk**, or how it gets there: D-12 rules out asking a third party.
2. **How the CSRF token is checked**, and what a failed check answers: no operation declares a
   `403` for it.
3. **Where the sign-in limits keep their counts** when the API runs as several processes, and how
   they count an address that has no account without telling anyone so (D-13).
4. **Where a key outside a household lives** (ADR 0006 left it to this item), and what a request
   made before signing in, which has no caller, does with one.
5. **How the enumeration-resistant surfaces stay alike in time**, not only in shape.

## Decision

**Passwords are Argon2id with RFC 9106's second recommended parameters**: 64 MiB, three passes,
four lanes, a 16-byte salt and a 32-byte tag, stored as a PHC string, so a hash carries its
parameters and one made with others is replaced at the owner's next sign-in. A process runs at most
one hash per CPU at once, so a burst of sign-ins queues instead of taking 64 MiB each. A sign-in for
an address with no account, or an account with no password, checks the password against a hash
nobody's matches, and costs what a wrong password costs.

**The breach corpus is Have I Been Pwned's Pwned Passwords (CC BY 4.0), kept as the first 8 bytes of
each SHA-1, sorted, after a 16-byte header** (`internal/platform/breach`). The server opens it once
and answers a check with a binary search, some thirty reads of the file. Eight bytes of about a
billion hashes collide with an unbreached password about once in eighteen billion checks, and a
collision refuses a password, never admits one. `cmd/breach-dataset` builds the file from the
k-anonymity range API, all 1 048 576 ranges, or from a corpus already downloaded, and takes a
minimum count; `docs/runbooks/breached-passwords.md` says how. The full corpus is about 8 GB. The
server requires the file everywhere but development, where it serves without one and says so in
its log. Passwords are screened when they are set: registering, a reset, a change.

**A session is a 256-bit token in `__Host-hh_session`, kept as its SHA-256, with a CSRF token bound
to it** in the readable `__Host-hh_csrf` cookie, also kept as its SHA-256 on the session's row. An
unsafe request the session cookie authenticates must send the token back in `X-CSRF-Token`, equal
to the cookie *and* to the session's own token, and name an allowed origin in `Origin`, or
`Referer` without one. Binding the token to the session is what defeats a cookie planted from a
sibling subdomain, which naive double-submit does not; the `__Host-` prefix on both cookies keeps a
sibling from setting them at all. Every unsafe request that names an origin not on the allowlist is
refused too, whatever it carries, which covers the routes before sign-in, where there is no session
to check. Both refusals are `403 csrf_failed`, a new protocol-level `ProblemCode` any unsafe
operation may answer, as ADR 0006 made `409 idempotency_in_progress` for any operation that takes
a key; the response check holds it to `403` on an unsafe method. A request that names no origin and
carries no session cookie, a native client's, is not checked: it has no ambient credential to abuse.
A session lasts 30 days from its last use (D-95), slid at most once an hour so a request costs no
write; signing in again from a browser ends the session it held.

**Sign-in throttles keep their counts in PostgreSQL; the API's buckets keep theirs in memory**
(`internal/platform/ratelimit`). A throttle guards a surface that takes a password or an address:
few requests, each worth an attacker's while, which every process must count together and a
restart must not forget. It is a row per surface and subject in `auth_throttles`, keyed by the
SHA-256 of the two so the table names nobody, updated under a row lock. A sign-in counts as a
failure against its network and its address, in one transaction, *before* its password is checked,
and a success takes it back: counted only once each had failed, a burst of attempts sent at once
would all read the counts as they stood before any, and all be checked. An address's throttle
counts the address typed, whether or not an account has it, so a `429` says nothing about which
addresses do. The account's sign-in limit backs off rather than locking (FR-ID3): the tenth failure
in fifteen minutes blocks for a minute, each after it for twice as long, up to an hour, and the count
restarts once the address has been quiet for fifteen minutes past its block. A client's network is
its IPv4 address, or its IPv6 `/64`, found past the proxies the server is told to trust
(`HOUSEHOLD_TRUSTED_PROXIES`) and never from an address a client claims for itself. The API's
per-user and per-household limits (D-96) count every request, so they are token buckets in memory,
one per process: with N processes a user may make up to N times the limit, which is a bound on
abuse, not an accounting.

**A signed-in user's Idempotency-Key lives on their account** (`account_idempotency_keys`, keyed
by user and key), with the same states, fingerprint, lease and stored `2xx` as a member's key in
their household; `idempotency.AccountMiddleware` serves `/me` and the signed-in `/auth` routes, and
each account write commits the key in its own transaction. **`POST /auth/password` keeps none**
(D-97): a key's fingerprint is a SHA-256 of the body, and its body is the current and the new
password, which the fingerprint would keep for a week, a fast hash beside the slow one; anyone who
knew the old password could read the new one out of a backup. A repeat of a change that was made
answers `401`, the current password being the new one. Item 20's `POST /me/deletion`, whose body
carries the password, keeps none for the same reason. **A request made before signing in keeps
no key** (D-97): it has no caller whose key it could be, and each such operation is safe to repeat
as it stands. The three that answer `202` send at most another email, which their limits cap; a
sign-in mints a new session each time, and a stored response could not carry the `Set-Cookie` it
needs, nor may it keep item 9's token pair; verifying a link answers `204` again while the address
it confirmed stands, and a spent reset link answers as spent. Keeping such keys would have meant
storing a fingerprint of a body that holds a password, which a fast hash turns back into the
password.

**What would tell an address with an account from one without runs after the response.** A
registration hashes the password either way and answers `202` either way; which email it sends is
decided in its transaction, and the email is sent later. A resend and a reset request answer `202`
at once, and the lookup that decides whether an email goes out runs later. The later work runs on
`identity.Background`, a few goroutines with a queue, each job with its own deadline: not durable,
so a job queued when the process stops is lost, and the person asks again. An email's link carries
its token in the fragment, `/verify-email#token=…` and `/reset/set#token=…`, which a browser sends
to no server, so it stays out of access logs and `Referer`s; the web client reads it.

**Account writes go through `tenant.AccountTx`**, a transaction as the request role with the caller
and no household, where row-level security admits no household's rows. They are not the mutation
spine's: an account's changes are no household's history. Architecture test 4 now fails a module
that names `AccountTx`, as it does `InWriteTx`. The spine, for its part, labels each audit event
with the actor's display name, read in the mutation's own transaction, whichever front door let
the request in.

**The contract changes with it** (`docs/api/openapi.yaml`): `csrf_failed` and
`invalid_credentials`, which FR-ID3 names, join `ProblemCode`; `format: email` is held at the edge
to a bare address SMTP can carry, which kin-openapi does not check by default; `Me` and `MeUpdate`
gain `first_day_of_week` and a nullable `timezone`, the member's overrides of PRD 03 §9;
`display_name` must hold something; a reset link answers `410` when expired or spent, as a
verification link does; the sign-in's `403`, which the PRD's one generic failure contradicts, is
gone; and the descriptions say what the limits and the pre-sign-in keys do.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| The breach corpus in PostgreSQL | About 8 GB of hashes in the application database, in every backup and every test template, for a lookup a file answers as fast |
| A Bloom or binary fuse filter | Smaller, but a filter's false positives are a tuning parameter and it needs a library or code of its own; a sorted file of truncated hashes is exact enough, simple to build in order and to check by hand |
| Only hashes seen more than once | Halves the file, but NIST 800-63B asks for passwords from breach corpora, not popular ones. `-min-count` exists for a deployment that must trade |
| Naive double-submit: the header equals the cookie | A sibling subdomain, or a man in the middle on plain HTTP, can plant a matching pair. The token bound to the session is what the attacker cannot supply |
| `401` for a failed CSRF check | Would send the web client to the sign-in screen for a request an attacker made, and leaves the routes before sign-in, which have no session, with no answer to an origin not allowed |
| `403 forbidden` for it | Every operation would then be free to answer an undeclared `403 forbidden`, and the response check would lose the operations that declare one for their own reasons |
| All limits in memory | Each process would count on its own: with three processes an address gets thirty guesses in fifteen minutes, not ten |
| All limits in PostgreSQL | A write on every signed-in request, for a limit that bounds abuse rather than accounts for anything |
| An address's throttle keyed by account | A `429` for an address with an account and none for one without is the oracle D-13 forbids |
| Anonymous Idempotency-Keys before sign-in, keyed by the key alone | A stored sign-in would be a stored credential or a response without its cookie; a fingerprint of a registration or a reset is a fast hash of its password |
| A password change keeping its key on the account, as every other account request does | The same fast hash, of the new password and the old, kept seven days |
| Checking a sign-in's throttle, and counting it only once the password failed | Every attempt already sent passes the check before the first failure is counted: a burst is checked whole |
| A durable email outbox | The outbox would hold every verification and reset token in the clear until sent. Item 17's notification transport owns durability, and a lost email is asked for again |
| Sending the email before answering | The time an SMTP server takes to answer would tell an address that gets mail from one that does not |
| The token in the link's query string | It would be in the web server's access log and every `Referer` the page sends |
| An absolute session lifetime | Rejected in D-95: a household app in daily use would sign its members out on a date that means nothing to them |

## Consequences

**What gets easier:**
- Items 9 and 11 add credentials (`google`, `apple`, `child_pin`) to the table and the enum this item
  made, and hash a PIN with the same `password.Hasher`.
- Item 10 counts invitations with the same throttles (20 a day per household) and checks
  `users.email_verified_at` before an invitation leaves; item 17 sends through `mail.SMTP` and
  sweeps `sessions`, `email_tokens`, `auth_throttles` and `account_idempotency_keys`.
- Any later limit on a surface an attacker cares about is a `ratelimit.Limit` and two calls.

**What gets harder:**
- A deployment carries an 8 GB file the server needs at start, refreshed when the corpus grows
  (item 88).
- A response that carries a secret, item 9's TOTP enrolment and recovery codes, must not be kept
  by an account key: the middleware keeps every `2xx` it sees, so item 9 adds a way for a handler
  to mark its response unstorable, and a repeat of such a request answers `409`.
- The per-user and per-household limits are per process, so the effective limit grows with the
  number of processes until item 90 revisits them.
- An email queued when the process stops is lost.

**Revisit this when** the API runs as more than a handful of processes (the in-memory buckets), when
item 17 builds a durable transport (the background runner), or when the corpus outgrows a file
lookup.
