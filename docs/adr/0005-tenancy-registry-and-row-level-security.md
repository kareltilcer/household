# 0005 — A transaction per unit of work carries the tenant, and row-level security is one template

- **Status:** Accepted
- **Date:** 2026-09-27
- **Plan item:** 3
- **Decides for:** PRD 01 §2 (multi-tenancy), §4 (the module contract), §5 (enablement and
  grants), §10 tests 1, 2 and 3; PRD 02 §5 (FR-AC1, FR-AC2, FR-AC4); PRD 07 FR-NF4; D-1, D-2,
  D-4, D-6, D-16

## Context

PRD 01 §2.2 holds every household-scoped request to its household three times: the household is
in the path, a tenant middleware checks membership and sets `app.household_id`, `app.user_id`
and `ROLE household_app` with `SET LOCAL`, and row-level security, enabled and forced on every
tenant table, compares each row's `household_id` with the setting. It says the middleware
"opens the request's database transaction" with those settings. It does not say:

1. **When that transaction commits.** A transaction that spans the handler commits after the
   handler returns, and by then the handler has written its response: a client can receive `201`
   for a write whose commit then fails. The same transaction holds a pooled connection, idle in
   transaction, through every S3, Stripe or weather call the handler makes, and through the
   WebSocket upgrade of `…/stream` for the socket's whole life.
2. **What a policy reads when there is no tenant.** `current_setting('app.household_id')`
   raises an error in a session that never set it, and reads `''` (which `::uuid` refuses) in a
   pooled session whose previous transaction set it locally. The membership check itself runs
   before the household is known.
3. **How a module's id is kept honest** in `module_enablement` and `module_grants`, when the
   contract's `ModuleKeyValue` is the list.
4. **How the architecture tests find a tenant table, and what makes a policy the right one.** A
   table with row-level security enabled and a policy `USING (true)` passes "has RLS" and isolates
   nothing.
5. **How a test proves the platform's behaviour for a module** before any module exists.

## Decision

- **A transaction is a unit of work, not the request.** The tenant middleware resolves the
  caller in a transaction of its own: with only `app.user_id` set, it reads the caller's
  membership through the policy that lets a user read their own; with `app.household_id` then
  set, it reads the household's enablement and the caller's grants, and commits. It carries the
  result, a `tenant.Scope`, in the request context. A handler reaches the database only through
  `tenant.InTx(ctx, fn)`, which opens a transaction on the request role's pool, sets the role and
  both settings with `set_config(…, true)` (`SET LOCAL`, the values bound as parameters), runs
  `fn`, and commits before the handler answers. Modules never receive the pool, and a query that
  bypassed `InTx` would carry no tenant and read nothing.
- **The tenant context reads as `NULL` when unset.** `app_household_id()` and `app_user_id()`
  are `NULLIF(current_setting(…, true), '')::uuid`. A policy that compares a column with `NULL`
  is never true, so a query with no tenant reads nothing and writes nothing, rather than failing
  in a way that differs between a fresh and a pooled session.
- **One policy template.** `enable_tenant_isolation(regclass)`, created by the platform block and
  executable only by the migrate role, enables and forces row-level security and creates the
  `tenant_isolation` policy, `household_id = app_household_id()` for both `USING` and `WITH
  CHECK`. A tenant table's only permissive policy is that one; a narrower rule, such as a
  private item's owner, is a restrictive policy on top, which PostgreSQL ANDs with it where it
  would OR a second permissive one.
- **Two tables have policies of their own** (PRD 01 §2.4). Inside a household's context each
  reads as a tenant table does, that household's rows only. Outside any household's context,
  where the tenant middleware checks membership and a user lists their households,
  `memberships` is readable by the user it names and `households` by its members. The wider
  read is a `FOR SELECT` policy, and each table is written through a second policy held to its
  household's context: PostgreSQL checks a `DELETE` against a policy's `USING` alone, so one
  policy whose `USING` admitted the caller's rows everywhere would let a transaction in one
  household delete them in another. `users` and `modules` are global and hold no household's
  rows, and the request role deletes from neither: an account's row is replaced by a tombstone,
  never deleted (FR-PR4), and a user's memberships and grants cascade from it, so a delete in
  one household's context would reach every other household, past any policy.
- **A `modules` table lists the module ids**, seeded with `ModuleKeyValue`'s seventeen, and
  `module_enablement` and `module_grants` reference it. A test holds it equal to the contract's
  enum. A module with no enablement row is disabled, and a member with no grant row has
  `none`: both fail closed until item 10 writes the defaults.
- **The effective level** is the minimum of enablement and grant (PRD 01 §5). An owner has
  `manage` on every enabled module whatever the grant row says; a child is capped at
  `contribute` everywhere and at `view` on Finance (FR-AC4). The caps are applied when the level
  is resolved as well as where item 10 writes a grant.
- **Every module is mounted at `/households/{household_id}/<name>`**, behind the tenant
  middleware and `grant.Gate`, which answers `404` to a caller below `view`. A handler asks
  `grant.Require(ctx, module, level)`, which answers `404` for a module that is absent to the
  caller and `403` only when they can see it (D-16). A household-scoped request with no caller is
  `401`; a caller who is not a member gets the `404` that a household that does not exist gets.
  The caller comes from `auth.User(ctx)`, which items 8 and 9 fill in.
- **The registry** takes the modules `internal/modules.All()` lists, refuses a nil module, a
  name that is not a module id, a name used twice and migrations that are not one block of the
  module's own, and gives each module's block its number from its files' names.
- **The architecture tests.** Test 1 parses imports: a module, its test files and the packages
  in its testdata included, imports no other module and not the module list, and the platform
  imports neither. Test 2 reads PostgreSQL's catalog after every block has run: every table not
  exempted by name, with a reason, has `household_id uuid NOT NULL`, row-level security enabled
  and forced, and the template as its only permissive policy; a table exempted for a policy of
  its own has only `FOR SELECT` policies wider than its household; a materialized view, which no
  policy can hold, is refused; a foreign key from a table holding households' rows acts on a
  delete or an update of a global table's row only where the request role cannot make one,
  since a referential action runs past row-level security; an exemption that names no table is
  refused. Test 3 type-asserts every registered module to `ExportSource` and `EraseSource`. The
  isolation test (FR-NF4) loads a fixture of two households with a row in every tenant table
  and, as `household_app` in household B, with household B's owner as the caller, who is a
  member of household A as well, reads each of household A's rows by primary key and finds
  none, then reads each as household A and finds it, so that finding nothing proves something;
  a tenant table with no fixture row fails it.
- **A test module proves the rest.** `internal/app/testdata/probe` is a module with a table, a
  block (99), a contract of its own, a list handler with no `WHERE` and a create handler that
  writes the household its body names. `testsupport.Main(m, blocks…)` migrates a package's clone
  with extra blocks after cloning it, so the probe's table exists only in the one package that
  serves it, and a module's tests will pass their own block the same way.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| One transaction per request, as PRD 01 §2.2 first read | Commits after the response is written, so a reported success can be a failed write; holds a connection idle in transaction through slow calls and a WebSocket's life. Committing at the handler's first write instead needs a response writer that intercepts `WriteHeader`, `Flush` and `Hijack` and a rule for which statuses commit, with an escape for the handler that must commit a failed attempt it refuses |
| `current_setting('app.household_id')::uuid` in the policies, as PRD 01 §2.2's example writes it | Errors when the setting is unset and when a pooled session left it `''`, and the membership check runs before the household is set |
| A `CHECK` constraint listing the module ids | A test module could not have an enablement row; a new module would drop and re-add the constraint instead of inserting a row |
| Architecture test 2 by parsing migrations | Misses a policy created by a function, a `DO` block or a later `ALTER`; the catalog is what PostgreSQL enforces |
| Test 2 checking only that RLS is enabled and forced | A policy `USING (true)`, or a second permissive policy, passes it and isolates nothing |
| One policy on `memberships` and `households`, keyed on the user as well as the household in every context | Its `USING` reaches the caller's rows in their other households: inside household A's context a `DELETE` that forgets its `WHERE household_id` removes the caller's membership in household B, or household B itself and every row that cascades from it, and a role lookup that forgets it can find their role in household B |
| Rows fabricated per table from the catalog for the isolation test | Check constraints, foreign keys and enums defeat a generic fabricator; a fixture row per table is explicit, and missing one fails loudly |
| The module blocks in the template database | `testsupport` would import every module, and a module's own tests import `testsupport`: an import cycle for every in-package module test |
| `ExportSource` and `EraseSource` in the `Module` interface | Enforced by the compiler, but PRD 01 §4 lists them as catalogs and names architecture test 3 as the check; either holds, and this keeps the PRD's shape |

## Consequences

- A handler that writes the response before its transaction commits cannot do so by accident:
  `InTx` returns once the commit has. A handler that needs a consistent snapshot across
  several statements puts them in one `InTx`.
- The membership check and the handler's work are two transactions, so a member removed between
  them has one request in flight complete; the next is refused (D-15's "next request").
- Every migration that creates a tenant table calls `enable_tenant_isolation`, and the PR that
  adds one adds its rows to `internal/arch/testdata/isolation/fixture.sql`.
- Reading a user's memberships across households, as listing their households does, takes a
  transaction with only the caller set, as the middleware's resolution runs; inside a
  household's context those rows read as a tenant table's. Item 10's `invitations`, the third
  table PRD 01 §2.4 gives a policy of its own, takes the same shape, and test 2 holds it to it.
- Item 4's mutation spine builds on `InTx`; item 10 writes enablement rows and grant defaults;
  item 18 fills in the entitlement hook (`tenant.Config.Entitlement`).
- Revisit the two-transaction resolution if its round trips show in latency at real load
  (item 90): the membership and grant reads can move into the first `InTx` of a request.
