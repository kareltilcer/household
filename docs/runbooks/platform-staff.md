# Platform staff: the staff role, the first `platform_admin`, and the platform's log

The platform's staff are accounts with a platform role, `support` or `platform_admin`
([PRD 02 §8](../prd/02-identity-and-access.md), [ADR 0022](../adr/0022-platform-staff-their-role-their-log-flags-and-ceilings.md)).
They read metadata through a database role of its own and act through the staff API under
`/api/v1/platform`. This runbook covers setting that up, making the first administrator, and what to
do when a staff member is locked out or leaves.

## Before an environment's first deploy

| What | Where | Notes |
|---|---|---|
| The staff role | `household_staff`, `HOUSEHOLD_STAFF_DATABASE_URL` | `bootstrap` creates it and sets its password from the connection string; `serve` reads what staff see through it. It holds `SELECT` on metadata columns and nothing else, and it bypasses nothing |
| The order | `bootstrap`, then `migrate`, then `serve` | Migration `01025` grants to `household_staff`, so the role has to exist first, as `household_meter` does for `01015` |

```bash
pnpm run db:setup
```

runs `bootstrap` and `migrate` locally. In an environment the three connection strings a deploy already
sets are joined by the staff role's; `bootstrap` refuses a development default on a cluster that is not
on this machine, so the password must be set.

## Make the first `platform_admin`

Nobody can make staff through the API until somebody is a `platform_admin`, so the first is made by the
operator, on the server, as the request role:

1. The person registers an ordinary account in the app and verifies its address.
2. They turn the second step on (Account, Security). A staff member whose second step is off is
   answered `403 staff_mfa_required` by every staff route.
3. On a host that holds `HOUSEHOLD_DATABASE_URL`:

   ```bash
   household-api staff grant karel@example.com platform_admin
   ```

   It refuses an address nobody has, and one that is not verified. It is recorded in the platform's
   log as the `operator`'s.
4. They sign in and call `GET /api/v1/platform/staff`: it lists them, with `mfa_enabled` true.

From then on staff are made and unmade through the API (`PUT /platform/staff/{user_id}`), each change
with its reason, in the log.

## A staff member leaves

```bash
household-api staff revoke someone@example.com
```

or, as a `platform_admin`, `PUT /platform/staff/{user_id}` with `"role": null`. They are staff no
longer from their next request. The last `platform_admin` cannot be revoked or made `support`: make
another first.

Erasing an account takes it out of the staff too. What it did stays in the log, under the address it
had.

## A staff member is locked out of their second step

They are an account like any other: another staff member unlocks or turns off their second step
(`POST /platform/users/{user_id}/actions`, `unlock` or `disable_mfa`). With the step off they are
admitted to nothing until they turn it on again.

If the only `platform_admin` has lost both the authenticator and the recovery codes, nobody is left to
do that through the API. Make a second account a `platform_admin` with `staff grant`, as above, and
have it turn the first one's step off.

## Reading the platform's log

`GET /platform/audit`, `platform_admin` only: newest first, filtered by `actor_id`, `household_id`,
`from` and `to`. Each entry says who, by the address they had, what, about which household or account,
and why. `meta.event_id` is the event the action wrote in the household's own activity log, where the
household reads it as done by *Household support*.

The log is append-only: the request role may insert and read, and no role updates or deletes. Entries
older than seven years are removed by the nightly expiry sweep through
`platform.purge_audit_log()`. To check the sweep ran, look for `platform audit entries` in the
`expiry.sweep` job's log.

## When a staff request fails

| Symptom | Cause |
|---|---|
| `404` on every `/platform` route | The caller is not staff: their account has no row in `platform.staff` |
| `403 staff_mfa_required` | The account's second step is off |
| `403 forbidden` | The route is `platform_admin`'s and the caller is `support` |
| `409 not_applicable` | The action does not apply as things stand: a subscribed household has no trial to extend, an invoice is not paid, a notification cannot go again, an address is verified already |
| `500` on every `/platform` read, `permission denied for table …` in the log | A migration added a column the staff API reads without granting it to `household_staff`. Architecture test 12 and the staff tests catch this before a merge; in an environment, check that `migrate` ran |
| `serve` does not start, `HOUSEHOLD_STAFF_DATABASE_URL is required` | The connection string is not set |

## Reference data an administrator edited

`migrate` logs `reference data loaded` for each dataset. `held` counts the rows an administrator
edited that the files in `reference-data/` differ from: the load left them as edited, and logs the
dataset at warning level (D-148). To settle one, either copy the edit into `reference-data/`, after
which the next load releases the row (`released`), or decide the files are right and edit the row back.
