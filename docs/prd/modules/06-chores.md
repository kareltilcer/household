# 06 — Chores (Domácí práce)

> **New.** The module that gives the `child` role something to be. Distinct from Tasks: a task is
> a thing that happens once and is then done; a chore is an obligation that recurs, belongs to
> somebody, and rotates.

## What it is

Recurring household work, assigned or rotated between members, with visible progress and — for
children — a points system that makes it worth doing.

**The design constraint:** a chore system fails when it becomes a nagging machine. Every design
choice here optimises for *the list staying credible* rather than for maximum coverage. A chore
nobody ever ticks is worse than no chore, because it teaches everyone to ignore the screen.

## Setup

Light. On first open, an owner picks:

1. **A starter set or none** — translated templates ("Kitchen", "Weekly reset", "Pets") that
   create three to six chores each, all editable and deletable.
2. **Whether points are on.** Off by default for adult-only households, offered when a child
   profile exists.
3. **Reset day** — which day a weekly cadence starts (defaults from the member locale).

## Functional requirements

### Chores

**FR-CO1 — Chore definition.** Name, optional description, an icon, an optional room/area, an
estimated duration, a `points` value (when points are on), and a **schedule**:

| Schedule kind | Meaning | Example |
|---|---|---|
| `fixed_interval` | Every N days/weeks/months from the **last completion** | "Water the plants, every 3 days" |
| `calendar` | On specified weekdays or dates | "Bins out, every Tuesday" |
| `monthly_nth` | Nth weekday of the month | "Deep clean, first Saturday" |
| `on_demand` | No schedule; appears only when someone claims it | "Wash the car" |

**D-49: `fixed_interval` anchors on the last completion, not on a fixed grid.** A chore done two
days late should next be due three days after *that*, not accumulate a debt of missed occurrences.
Grid-anchored recurrence is correct for a bin collection (which is why `calendar` exists) and wrong
for everything a household actually controls. Choosing the wrong one is the single most common way
a chore app becomes a guilt generator.

**FR-CO2 — Assignment modes.** Per chore:

| Mode | Behaviour |
|---|---|
| `unassigned` | Anyone may complete it |
| `fixed` | Always the same member |
| `rotating` | Cycles through an ordered member list on each completion |
| `weekly_rotation` | Cycles on the reset day regardless of completion, so a skipped week does not stick to one person |

Rotation state is stored explicitly (`current_assignee_id`, `rotation_index`) rather than derived
from completion history, so that adding, removing or reordering a member in the rotation is a
comprehensible edit rather than a recomputation of the past.

**FR-CO3 — Completion.** A member completes a chore occurrence: recorded with who, when, and the
points awarded. Uses the **press-and-hold** gesture (this one *is* expensive to undo — it moves the
rotation and awards points). Idempotent per `(chore_id, occurrence_key, user_id)`.

**FR-CO4 — Skip and snooze.** An occurrence may be **skipped** with an optional reason — it does not
advance points, does advance the rotation for `weekly_rotation`, and does not advance it for
`rotating`. It may also be **snoozed** by a member for a chosen number of days. Both exist because
the alternative is a permanently overdue item that trains everyone to ignore the list.

**FR-CO5 — Swap.** A member may ask another to take an occurrence; the other accepts or declines.
Notification in the `direct` category. This is what makes a rotation survive a real week.

**FR-CO6 — Verification, for children.** Optional per chore: `requires_verification`. A child marks
it done; it enters `awaiting_verification`; an owner confirms or returns it with a note. Points are
awarded on confirmation. **Off by default** — a household that wants trust-based chores should not
have to turn supervision off. **D-50.**

### Points

**FR-CO7 — Points are a ledger, not a counter.** Every award, deduction and adjustment is a row
with a reason and an actor. A child sees their balance, their history and where it came from. A
counter that can be silently edited is not something a child will believe in twice.

**FR-CO8 — Bonuses and penalties.** An owner may award ad-hoc points with a reason. Penalties are
possible but require a reason and are shown to the child in full — a silent deduction is worse than
none.

**FR-CO9 — Rewards.** An owner defines rewards with a point cost ("an hour of screen time",
"choose Friday dinner"). A child requests a redemption; an owner approves; the ledger is debited.
**Household-defined, non-monetary by default.** Household does not process pocket money in 1.0 —
see Non-goals.

**FR-CO10 — Streaks and progress, not leaderboards.** A member sees their own completion streak and
the household's weekly progress bar. **There is deliberately no ranking of members against each
other.** A leaderboard between siblings, or between partners, produces exactly one outcome and it is
not more clean dishes. **D-51.**

### The board

**FR-CO11 — Views.** *Today* (what is due now, mine first), *This week* (the grid: members across,
days down), and *All chores* (the definitions). The weekly grid is the screen that makes a rotation
legible and it is the module's primary web view.

**FR-CO12 — Overdue handling.** An overdue chore is shown once, prominently, and then **stops
escalating**. It is never re-notified daily. After `CHORE_STALE_DAYS` (default 14) an untouched
overdue chore is flagged to an owner as *possibly not a real chore* with a one-tap way to delete or
reschedule it. Pruning the list is a feature.

## Data model

`chores`, `chore_assignments` (rotation membership, ordered), `chore_occurrences` (materialised
only when a chore is due or acted upon — not for all time), `chore_completions`, `chore_swaps`,
`chore_point_entries` (the ledger), `chore_rewards`, `chore_redemptions`.

`chore_occurrences` carries `(chore_id, occurrence_key)` unique, where `occurrence_key` is the due
date for scheduled kinds and a generated key for `on_demand`.

## Sync

| Entity | Policy | Notes |
|---|---|---|
| `chores.chore` | `strict_version` | Definition changes are structural |
| `chores.occurrence` | `lww_field` | |
| `chores.completion` | `state_set` | Keyed by (occurrence, user) — double-completion is idempotent |
| `chores.point_entry` | `additive` | A ledger is append-only or it is not a ledger |
| `chores.swap`, `chores.redemption` | `strict_version` | Two-party state machines; a merge would produce an impossible state |

**Rotation advancement is server-authoritative.** A client shows the predicted next assignee
optimistically; the server's value is canonical. Two offline completions of the same rotating chore
resolve to one advancement, because completion is `state_set` on the occurrence, and the rotation
advances from the occurrence, not from the mutation. **D-52.**

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `chores.mine_today` — my chores due today and overdue, with hold-to-complete |
| Widget | `chores.week` — the household's weekly grid, compact |
| Metric | `chores.due_today`, `chores.overdue`, `chores.mine_open`, `chores.points_balance` (per recipient), `chores.awaiting_verification` |
| List | Mirrors of each |
| Reminder kind | `chores.due` — personal completion |
| Search scope | `chores.chore` — name, description |
| Storage | Tables only |

## Permissions

| Operation | Level |
|---|---|
| See the board, own chores, own points | `view` |
| Complete, skip, snooze, request a swap, request a redemption | `contribute` |
| Create, edit, delete a chore; edit rotations; define rewards | `manage` |
| Award or deduct points; verify a completion; approve a redemption | `manage` (and in practice `owner`) |

**A `child` is capped at `contribute`**, as in every module. That is exactly the right level here:
they do chores, claim points and request rewards; they do not define what a chore is worth.

## Non-goals

- **No money.** Points are not currency and Household does not move funds. Converting points to
  pocket money is the deferred Allowance feature; the ledger is already shaped for it
  ([00-overview.md](../00-overview.md) §5).
- **No leaderboards, no inter-member comparison, no public shaming.** (**D-51**)
- **No location or presence detection** to infer whether a chore was done.
- **No photo proof requirement** in 1.0 — verification is a person confirming, not a surveillance
  step. A member may voluntarily attach a photo, which is a **document reference** (**D-40**) like
  every other file outside Documents, Notes and Chat — this module owns no object-storage prefix.
- No chore marketplace, no cross-household anything.
