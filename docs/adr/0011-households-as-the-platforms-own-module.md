# 0011 — The household surface is admin, a module the platform serves itself, whose every write goes through the spine

- **Status:** Accepted
- **Date:** 2026-09-29
- **Plan item:** 10
- **Decides for:** [02-identity-and-access](../prd/02-identity-and-access.md) §3–5 (FR-HH1–FR-HH6,
  FR-AC1–FR-AC4); [modules/17-household-admin](../prd/modules/17-household-admin.md) (FR-HA1, FR-HA3–FR-HA8,
  FR-HA17, Data model, Sync); [01-architecture](../prd/01-architecture.md) §2.4, §3; D-16, D-17, D-80, D-103;
  [ADR 0005](0005-tenancy-registry-and-row-level-security.md) and [ADR 0006](0006-sync-ready-schema-and-the-mutation-spine.md)'s
  notes on item 10

## Context

Plan item 10 builds what makes a household: creating one, its settings, its members' roles and grants,
the invitations that bring them in, leaving and removal, and the modules it enables. Five things about
it are not settled by the PRD or by the items before it:

1. **Whose writes these are.** CLAUDE.md and PRD 01 §3 make every mutation write its row, an audit
   event and a sync change in one transaction, through `mutation.Apply`, which refuses an action no
   registered module declares and a change of an entity no module declares. The only other write path is
   `tenant.AccountTx`, for a user's global tables. A household's members, grants, modules and
   invitations are tenant tables, and PRD modules/17 names them the data of `admin`, the seventeenth
   module, which has no package: the contract puts its routes at the household's root
   (`…/members`, `…/invitations`, `…/modules`), not at `…/admin`, and its reads are not held to a grant
   the way a module's are (every member reads the member list, PRD modules/17 Permissions).
2. **What a membership's sync change is.** PRD modules/17 lists `admin.household_settings` as a
   `strict_version` entity and says memberships and grants are "not synced as editable" but pushed as
   derived capability state. An entity needs a table keyed on an `id` with the base columns
   (architecture test 5); `memberships` and `module_enablement` were keyed on their pairs.
3. **How a non-member writes a household.** Creating one writes rows in a household whose creator is
   not yet a member; accepting and declining an invitation are done by someone who is not one either.
   The tenant middleware answers a non-member `404`, and `mutation.Apply` needs a tenant scope.
4. **How an invitation is found** before any household's context: by the token its link carries,
   unauthenticated, and by the address it was sent to, for the invitee's own list.
5. **Where a household's settings live.** The list of a user's households shows their names, read
   before any household's context (PRD 01 §2.4), where only `households` and `memberships` answer.

## Decision

**`admin` is a module the platform serves itself.** `module.PlatformModule` declares a module's audit
actions and sync entities without a package, routes or migrations of its own, and
`Registry.WithPlatform` adds it beside the modules: the spine records its mutations, architecture test 5
checks its entities' tables, and the summary check its actions' keys, while `Registry.All`, the modules
mounted under `/<name>`, leaves it out. `app.NewRouter` adds `household.Admin()` to the registry it
carries, so every router has it. `internal/platform/household` serves its routes: a signed-in user's
households, creating one and their own invitations beside the account's routes, with the account's
`Idempotency-Key`; the household's routes behind the tenant middleware, with the member's key; and
leaving behind the account's key, taken before the tenant middleware looks for the membership leaving
ended, so that a repeat is answered as the first request was and not as a stranger's.

**Four entities, each `strict_version` and never written offline** (D-80): `admin.household_settings`
on `households`; `admin.membership` on `memberships`, whose row carries the member's grants, so that a
grant's change is its membership's and moves its version, the `ETag` of `PATCH …/members/{user_id}`;
`admin.module_enablement` on `module_enablement`; and `admin.invitation` on `invitations`. Memberships
and enablements gain an `id` primary key and the base columns, keeping their pairs as unique keys, which
the grants and the Idempotency-Keys still reference. Each is read by every member granted `admin`, as
the grant axis holds every entity; plan item 13 generates their streams (see Consequences).

**`tenant.Assume` makes the scope of a household for a caller who is not in it**, without the
membership check, once the request has proved its right: creating the household, or holding its
invitation. Its scope resolves no module levels, so `grant.Require` refuses every module in it.
Architecture test 4 fails a module that names it, as it does `InWriteTx` and `AccountTx`.

**An invitation has a policy of its own**, the shape ADR 0005 gave `households` and `memberships`:
inside a household's context, that household's rows; outside any, `FOR SELECT` only, the invitation
whose token's SHA-256 the transaction presents in `app.invitation_token`, and every email invitation to
the caller's verified address. It is written only in its household's context. The token is kept as its
hash, a link invitation's response is never kept by its `Idempotency-Key`, and a signed-in addressee may
name an invitation by its id, which is how their list names it.

**A household's settings are its own row's**, on the tenant root, which its members read before any
household's context: name, country, timezone, base currency, locale, units, first day of the week, the
household code, and the payer, a deferred key to the payer's membership, so that the database refuses to
lose the payer too. `households` gains `household_id`, generated as its own id, the column every entity
names its household by.

**The rules that hold across members are checked under a lock on the household's row**, `FOR NO KEY
UPDATE`, which does not hold up another mutation's audit event: the last owner and the payer (FR-HH4),
so that two owners leaving at once cannot each find the other still an owner.

**The household surface enables and grants the contract's seventeen modules**, from the household's
creation, whether or not a module's package is built yet: `household.Modules`, which a test holds to
`ModuleKeyValue`.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A module package, `internal/modules/admin` | Its routes would be mounted under `/admin` behind the grant's gate, which the contract and PRD modules/17's permissions contradict; creating a household and accepting an invitation need a scope no module may make; and its tables are the platform block's since item 3 |
| An audit event without a sync change for the platform's own tables | Breaks the rule every mutation keeps (PRD 01 §3), and leaves item 13 no entity to generate the member list's and the grants' streams from, which the offline client needs to hide what it should hide (D-80) |
| Grants as an entity of their own, `admin.module_grant`, as PRD modules/17 first listed | A grant's change would not move its membership's version, so `If-Match` on a member would not see it; seventeen rows a member change the same way a membership does |
| The settings in a `household_settings` table, as PRD modules/17's data model first listed | A tenant table is not read before a household's context, so the list of a user's households would read each one's name in a transaction of its own; the tenant root already has the policy that list needs |
| A `SECURITY DEFINER` function to find an invitation by its token | A second way past row-level security beside the policies test 2 checks, and one test 2 cannot read |
| Leaving with the member's Idempotency-Key | The key is deleted with the membership in the transaction that commits the leaving, so the response cannot be stored, and a repeat is answered `404` |
| The modules table as the list of modules | In a test database it holds a test's module, which the contract's `ModuleKeyValue` does not name, and a response naming it breaks the contract |

## Consequences

- A later platform surface of a module that has no package (the billing of plan item 19, the exports
  and deletion of item 20) records its mutations the same way, as actions and entities of `admin`.
- Plan item 13 generates streams from these four entities. Every member's app needs the settings, the
  member list and the enablement offline, a child's among them, whose default on `admin` is `none`
  (FR-AC4): the stream of each reaches every member of the household, whatever their `admin` grant; the
  invitations reach the members granted `admin`, as their `GET` does.
- Plan item 67 turns on offline writes for every `strict_version` entity merged before it; admin's stay
  off (D-80).
- Items 14, 17, 18 and 20 fill in `household.Hooks`: the retraction a lowered grant, a disabled module or
  a member's removal or leaving needs (`Lost`), the notice of an access change (`Changed`, D-78), and the
  trial (`Created`). Until item 17's notification transport exists, the inviter of a declined invitation
  is told by email.
- A membership's version moves with its grants, so an owner editing one member's grants while another
  owner edits their role meets a `409`, which the grants editor resolves as any `strict_version` conflict.
- Revisit the lock on the household's row if an owner's changes to members ever queue visibly behind one
  another (item 90).
