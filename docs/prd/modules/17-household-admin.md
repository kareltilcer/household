# 17 — Household settings (Nastavení domácnosti)

## What it is

Where an owner runs the household: members and their access, which modules are on, the household's
locale and units, notifications, storage, billing, export and deletion.

It replaces `home`'s Administrace, which was a notifications console. Notifications are still here;
everything else is new because a single-tenant app for two people needed none of it.

## Sections

### 1. Household profile

Name, avatar, **country**, **timezone**, **base currency**, **default locale**, **measurement
units**, **first day of week**, and the **household code**.

**The household code** ([02](../02-identity-and-access.md) FR-CH1) is shown here, to owners, with a
one-tap copy and a **regenerate** action. It is how a child profile on their own phone says which
household they are signing in to, because a child profile has no email address. It identifies a
household and authenticates nobody; regenerating it stops future sign-ins with the old code and
leaves existing sessions alone. Households with no child profile never need it, and the screen says
so rather than presenting it as a thing to guard.

**FR-HA1 — Changing the country changes reference data, not history.** Switching the country
profile updates which tariff presets, document types, statutory vehicle schedules and public
holidays are offered from that point on. It never retroactively reinterprets a recorded value.

**FR-HA2 — Changing the base currency is a deliberate, warned, one-way-ish operation.** Historic
amounts keep their own currency and their stored rate; totals are recomputed in the new base using
those stored rates. The screen shows what will change before it changes, and the operation is
audited. Silently redenominating a household's history would be the single worst bug the product
could ship. **D-77.**

### 2. Members

**FR-HA3 — The member list** shows each member's display name, role, join date, last activity, and a
compact grid of their module grants. One screen, because access questions are answered by comparison
("why can Petr see Finance and I can't").

**FR-HA4 — Invite** ([02](../02-identity-and-access.md) FR-HH2), setting the role and the full grant
matrix before the person exists, plus an optional starting dashboard layout
([01-dashboard.md](01-dashboard.md) FR-DB4).

**FR-HA5 — Change a member's role or grants.** Takes effect on their next request; lowering a grant
emits sync retractions immediately. The member is notified when their access changes — **an access
change a member discovers by finding something missing is a bug**, and telling them is one line.
**D-78.**

**FR-HA6 — Remove a member**, with a clear statement of what happens to their content
([05](../05-privacy-and-compliance.md) §5).

**FR-HA7 — Child profiles**: create, set the PIN, set and lock the dashboard, set grants, unlock
after failed PIN attempts, graduate to a full member.

### 3. Modules

**FR-HA8 — Enable and disable modules for the household.** A disabled module's routes `404`, its
widgets vanish, its sync entities stop and are retracted, and **its data is retained**. Re-enabling
restores everything. The confirmation says exactly that, because "will I lose my garden plan" is the
question and the answer is no.

**FR-HA9 — Per-module setup entry points.** The Finance, Utilities and Garden setup flows are
re-runnable from here.

### 4. Notifications

**FR-HA10 — Trigger rules and scheduled digests**, composed over the audit action catalog and the
metric catalog ([03-platform-strands.md](../03-platform-strands.md) §4). Owner-managed. The composer
offers keys from the live registry so they are picked, not typed.

**FR-HA11 — Templates are per-language.** A rule carries a template per supported language, with the
household's default filled in and others falling back to it. A recipient receives their own language.

**FR-HA12 — Delivery log**, filterable, showing what was sent, to whom, and whether it arrived. No
rendered bodies are retained beyond a short window.

**FR-HA13 — Test send** to the composing owner only, bypassing audience resolution.

### 5. Storage

**FR-HA14 — The storage picture**: total against the allowance, the trend, the split by module and by
member, the largest items, derived-variant overhead, and the projected charge for the current month
([04](../04-billing-and-entitlements.md) §4). Direct links into each module's clean-up view.

### 6. Billing

Visible to the payer, with state visible to all owners
([04](../04-billing-and-entitlements.md) §6). Plan, next charge, payment method, invoice history,
usage lines, cancel, and take-over-billing.

### 7. Data

**FR-HA15 — Export the household** — the full ZIP of [05](../05-privacy-and-compliance.md) §3,
owner-only, generated async, available for 7 days, and available **in every entitlement state
including `read_only` and `canceled`**.

**FR-HA16 — Delete the household** — owner-only, name confirmation, all members notified, 30-day
reversible window, then irreversible.

**FR-HA17 — Transfer ownership** and promote or demote owners.

**FR-HA20 — Restrict the household** — any owner, immediately reversible by any owner, putting the
household into the `restricted` entitlement state ([04](../04-billing-and-entitlements.md) FR-BI7).
The confirmation states plainly what stops (every write, every upload, offline queues) and what does
not (reading, downloading, exporting, and the subscription, which keeps running). This is GDPR
Article 18 made self-service ([05](../05-privacy-and-compliance.md) §3) and it is deliberately next
to export and deletion rather than next to billing, because it is not a billing action.

### 8. Advanced

**FR-HA18 — API version and client compatibility** — which clients are connected and their versions,
useful when a member reports something the others do not see.

**FR-HA19 — Sync health** — per device: last sync, cursor position, pending mutation count,
conflicts awaiting resolution, **replica-digest state** (when the device last verified itself
through `POST …/sync/digest`, and which entity types disagreed — [D-85](../09-decisions.md)), and a
**force re-snapshot** action. When offline-first goes wrong, this is the screen that tells a member
why, and its absence is why sync bugs become support tickets. **D-79.** Under D-93 the cursor
position is the replica's last checkpoint, the replica-digest state is its bucket-checksum state
(with the digest's, if the plan keeps that endpoint), and the re-snapshot is a re-download of the
replica.

**It ships in Phase 0, not with this module** ([10-sync-risk.md](../10-sync-risk.md) §6). Because
platform staff cannot read household content ([D-3](../09-decisions.md)), nobody can inspect a
member's mutation queue to diagnose a divergence — so this screen is the only view anyone gets of
a sync failure, and it has to exist as soon as the engine does.

## Data model

`households` (carrying the `household_code`, unique, regenerable), `household_settings`,
`memberships`, `module_grants`, `module_enablement`, `invitations`, `notification_rules`,
`notification_schedules`, `notification_deliveries`, `export_jobs`, `deletion_requests`. Billing
tables live in the billing schema.

Audience membership rows — chat conversation members and `member_shared` calendar members — carry
`floor_seq` beside their own module's membership fields, because the sync pull predicate evaluates
it ([03](../03-platform-strands.md) §2.3, **D-90**). They are the owning module's rows, not this
module's; they are named here only so the list of things that gate access is in one place. Under
**D-93** the replicated path reads no `floor_seq`, and none is stored: what gates it is the readers
the owning module keeps on each row of the audience, derived from these membership rows
([15-chat](15-chat.md) Sync).

## Sync

| Entity | Policy | Notes |
|---|---|---|
| `admin.household_settings` | `strict_version` | |
| `admin.membership`, `admin.module_grant` | **not synced as editable** | Grants are pushed to clients as **derived capability state**, not as an editable entity. A client must never believe it can change its own permissions offline |
| `admin.notification_rule`, `admin.notification_schedule` | `strict_version` | |

**D-80: permissions are never client-authoritative, offline or otherwise.** The client caches its
resolved grants so the offline UI can hide what it should hide, and the server re-resolves them on
every request regardless. A cached grant is a rendering hint, never an authorization.

## Catalog contributions

None — this module is a consumer of every catalog and a contributor to none.

## Permissions

`owner` for everything, with these exceptions:

| Operation | Level |
|---|---|
| View the member list **and every member's grants** | Any member — the comparison is the point of the screen (FR-HA3), and a household is not an org chart. It also means "can Petr see this?" is answerable without asking an owner |
| View household profile settings | Any member |
| View the storage picture | `view` on the admin module |
| Billing | The payer; other owners see state only |
| Personal notification categories and quiet hours | Any member — these are personal preferences |

## Non-goals

- No custom roles, no role builder, no permission templates beyond the four levels.
- No audit-retention configuration, no log export to third parties.
- No household-to-household anything: no merging, no linking, no shared modules between households.
- No IP allowlists, no SSO, no SCIM, no device management. These are business features.
