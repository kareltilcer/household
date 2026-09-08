# 02 — Tasks (Úkoly)

## What it is

A Trello-style board: boards → columns → cards, with drag ordering, labels, checklists, notes
and links. Carried from `home` v1 almost unchanged — it is the module that needed the least
work to become commercial, because a kanban board makes no assumptions about the household.

**What changed:** assignment to a member, an optional due date, per-card comments, and the
removal of `home`'s seeded Czech board in favour of a chosen template.

## Setup

None. On first open the member picks one of four **starter templates** or an empty board:

| Template | Columns |
|---|---|
| Simple | To do · Doing · Done |
| Household (default) | Backlog · This week · Doing · Done |
| Project | Ideas · Planned · Doing · Blocked · Done |
| Empty | — |

Templates are reference data, translated, and carry no data — they are a shape, not content.

## Functional requirements

**FR-TA1 — Boards.** CRUD. A board has a name, an optional description, an icon, an archive flag
and a lexorank position. Deleting a board with cards requires `?cascade=true`, else `409` with
the count.

**FR-TA2 — Columns.** CRUD within a board, lexorank ordered. A column carries a free-form `kind`
of `normal` · `now` · `done`, which is what lets the *Doing* widget and the completion semantics
work without hardcoding column names. Collapse is client-side and personal.

**FR-TA3 — Cards.** CRUD. Title, body (Markdown), labels, checklist, links, `assignee_id`,
`due_on`, priority, lexorank position. Soft delete.

**FR-TA4 — Move.** `POST …/cards/{id}/move` with `{ column_id, position }`. Moving into a
`kind=done` column stamps `done_at` and clears it on move out. Cross-board moves are supported
(they were not in `home`), because a commercial user with several boards will try immediately.

**FR-TA5 — Assignment.** A card may be assigned to one member of the household. Assignment
notifies the assignee in the `direct` category. A card assigned to a member with `none` on Tasks
is refused with `422` naming the reason — the assignment would be invisible to them. Naming it is
safe because module grants are readable by every member
([17-household-admin.md](17-household-admin.md) Permissions), so the refusal discloses nothing the
assigner could not read on the member list. The picker excludes those members in the first place;
the `422` is for the offline and stale-cache cases.

**FR-TA6 — Due dates.** Optional `due_on`. A card with a due date contributes to the reminder
strand (FR-RM1) as kind `tasks.card_due` with **personal** completion, so each member's reminder
is theirs.

**FR-TA7 — Checklists.** Ordered items with a done flag. Progress is shown on the card face.

**FR-TA8 — Labels.** Per board, named, coloured. A label's colour is never the only carrier of
meaning — the name is always shown.

**FR-TA9 — Comments.** Threaded per card, plain text with mentions. A mention notifies in the
`direct` category. This is the "communication in context" that keeps chatter out of Chat.

**FR-TA10 — Board tree read model.** `GET …/boards/{id}/tree` returns the board with columns,
cards, labels and checklist progress in one query set — the screen's whole payload, no N+1.

## Data model

`task_boards`, `task_columns`, `task_cards`, `task_card_links`, `task_checklist_items`,
`task_labels`, `task_card_labels`, `task_comments`. All carry `household_id`, `version`,
soft delete and the house audit columns. Ordering is lexorank throughout.

Notable constraints: a card's `column_id` and the column's `board_id` must agree (enforced by a
composite foreign key, not by application code); `done_at` is null exactly when the card's column
kind is not `done`.

## Sync

| Entity | Policy | Why |
|---|---|---|
| `tasks.board`, `tasks.column`, `tasks.label` | `strict_version` | Structural. Two people restructuring a board concurrently should be told |
| `tasks.card` | `lww_field` | Two members editing title and assignee both succeed |
| `tasks.card_position` | `lww_field` | A lexorank position is an ordinary field, and two members reordering a column touch *different rows*, so they do not meet at all. The one real collision — the same card dragged twice — is honest last-write-wins, and a conflict dialog for a drag would be absurd |
| `tasks.checklist_item` | `lww_field` | |
| `tasks.comment` | `additive` | Comments are never edited into conflict |

**Position merge, specifically.** Lexorank was chosen in `home` because it makes an insert a local
operation. Offline it earns its place twice over: two members reordering the same column offline
produce interleaved ranks that both apply without a conflict, and the result is a defensible order
even if it is not the order either of them pictured. Where two ranks collide exactly, the server
rebalances the column and emits the new ranks as a normal change.

## Catalog contributions

| Kind | Key | Notes |
|---|---|---|
| Widget | `tasks.doing` | Every card in a `kind=now` column across non-archived boards, grouped by board, with press-and-hold complete |
| Widget | `tasks.assigned_to_me` | Open cards assigned to the caller, due-soonest first |
| Metric | `tasks.doing_count`, `tasks.open_total`, `tasks.done_today`, `tasks.overdue`, `tasks.assigned_to_me` | Last is per-recipient |
| List | Mirrors of the countable metrics | |
| Reminder kind | `tasks.card_due` | Personal completion |
| Search scope | `tasks.card` | Title, body, comments |
| Storage | Tables only; no blobs |

## Permissions

Standard gate. `manage` is required for board and column CRUD and for label management; cards,
checklists and comments are `contribute`.

## Non-goals

- No swimlanes, no dependencies, no Gantt, no time tracking, no story points, no automation
  rules. This is a household board, not a project tool, and every one of those is the beginning
  of becoming one.
- No per-card permissions. A card is visible to everyone with the Tasks grant.
- No card attachments — a card links to a Document instead (**D-40**, document references),
  which keeps files in one place and one meter.
