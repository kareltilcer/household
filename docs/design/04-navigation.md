# 04 — Navigation and information architecture

> **Seventeen modules cannot be seventeen tabs.**
> ([06-clients §2](../prd/06-clients.md))

## 1. Mobile — five destinations, fixed

| Tab | Contents |
|---|---|
| **Home** | The dashboard: widgets contributed by modules, arranged by the member |
| **Today** | A cross-module agenda — calendar events, due reminders, chores, tasks marked *doing*, garden work — one chronological list of what today actually asks for |
| **Add** | A centre action opening a capture sheet: the six most likely creates for this household, learned from use |
| **Chat** | If enabled and granted |
| **More** | Every module the member has, as a searchable list, plus settings |

This set is settled. Design owns what is inside each destination, not the set.

**Chat is conditional**, and this is the one tab that can be absent. A household with Chat
disabled, a member with `none` on it, and — potentially — every UK household if counsel's answer
on the Online Safety Act goes the other way ([D-89](../prd/modules/15-chat.md)) see **four** tabs.

**Settled ([DD-11](08-decisions.md)): four tabs is a first-class layout, designed in DS-0.** Not a
degraded five, not a gap closed at runtime. The tab bar is drawn twice and both drawings are
finished work.

This is not speculative work waiting on counsel: **the four-tab case already exists** through
module enablement and through a member with `none` on Chat, both of which are ordinary
configurations on day one. The UK question only decides how many households meet it. Designing it
now is also the only way to honour N6 here — a five-slot bar with a hole in it is exactly the
"hidden, not absent" failure that absence-not-disabling exists to prevent.

## 2. Today is the spine

> **Today is what makes seventeen modules feel like one app rather than a launcher.**

It is a **platform screen**, not a widget and not part of the dashboard layout. It is assembled
from the reminder strand and the metric catalog, it owns no feature data, and it is
**deliberately not customisable** — *a screen whose job is "what does today ask of me" stops
working when it can be rearranged into something else*
([FR-DB7](../prd/modules/01-dashboard.md)).

**Settled ([DD-7](08-decisions.md)): five groups, conditional alerts on top.** The PRD says "one
chronological list" and names the sources; overdue items, all-day items and undated *doing* tasks
are not chronologically comparable, so the groups below are the ordering, in this order:

| # | Group | Contains | Order within the group |
|---|---|---|---|
| 1 | **Conditional alerts** | Frost risk tonight; a blocked utility service; a document expiring inside its lead window | **Present only when the condition holds.** `garden.frost_risk_tonight` and `garden.plan_warnings` exist to be conditions, not decoration ([11-garden](../prd/modules/11-garden.md)) |
| 2 | **Overdue** | Anything past its date and not complete, from any module | Oldest first. **Shown once, prominently, and then it stops escalating** ([FR-CO12](../prd/modules/06-chores.md)) |
| 3 | **Timed today** | Calendar events with times | Chronological |
| 4 | **All day** | All-day events, due reminders, chores due, garden tasks, tasks with today's due date | Grouped by module, mine first |
| 5 | **In progress** | Tasks in a `kind=now` column | Unordered; it is a nudge, not a queue |

**A group with nothing in it is not rendered** — no empty heading, no "nothing overdue". A quiet
day is a short screen, and Today's own empty state ("nothing today") is a single teaching state,
not five.

Every row carries its **source module** as a chip and opens the source entity. Rows from a module
the member has `none` on are **absent**, not greyed.

The rejected alternatives were a strictly chronological flat list with undated items appended —
which sinks overdue items among today's and strips the conditional alerts of their urgency — and
a mine-first / household-second split, which breaks the single-timeline reading that makes Today
feel like an answer rather than a filter.

**Today must be complete offline**, because the reminder occurrence expansion runs on the client
from the synced rule ([03-reminders Sync](../prd/modules/03-reminders.md)).

## 3. The Add sheet

The six most likely creates for this household, **learned from use**
([06-clients §2](../prd/06-clients.md)).

**Settled ([DD-8](08-decisions.md)): a slow-moving window, and stable ordering.** The PRD leaves
the ranking rule open; **stability matters more than accuracy** here, because the value of the
sheet is muscle memory and a surface whose six entries move daily is one people stop trusting.

- **Rank on a slow window**, not on the last few days. The sheet should change when the
  household's habits change, not when this week was unusual.
- **Never reorder while the sheet is open**, and never reorder as a result of the create the
  member is about to make.
- **A cold-start set** for a household with no history, drawn from which modules are enabled and
  which the member has `contribute` on. A brand-new household's Add sheet is never empty and
  never arbitrary.

The rejected alternatives were recency-weighting, which is more accurate in a busy week and
prevents muscle memory ever forming, and a member-pinned set, which is perfectly predictable but
puts a configuration screen between someone and their first quick capture — a screen most people
would never open.

Every entry in the sheet lands on that module's **capture** surface
([03-patterns §7](03-patterns.md)), never on a configure surface.

## 4. Web — sidebar and search

A persistent sidebar with the module list, a **global search field**, and the same dashboard as
the landing route.

- **The sidebar is the module list**, filtered and ordered per member (§5). It is not a nav tree
  with seventeen expandable sections.
- **Global search** is one endpoint across every module the caller may see, returning a uniform
  hit shape ([FR-SE1](../prd/03-platform-strands.md)). Design one result row, not seventeen.
  Privacy and grants apply **before ranking**, so the result count is itself not a leak.
- The web app is where **setup, configuration, planning, long-form reading, admin and billing**
  happen. It should feel like a workspace, and it may assume a keyboard.

## 5. Per-member module order and visibility

**D-38** — settled, and load-bearing for the Petr persona:

- Members **pin, reorder and hide** modules for themselves.
- A module a member has `none` on **is not in the list at all**.
- This is a **personal preference**, requiring only `view`, and it is per household — the same
  user in two households may order them differently.

Design needs an arrange affordance in both clients that is discoverable without being in the way,
and a clear distinction between *hidden by me* (recoverable, in a "hidden" section of the arrange
screen) and *absent* (not shown anywhere, no trace).

## 6. Household switching

A user may hold several memberships, **with different roles in each**, and may be in a paid
household and a trial one at once ([02-identity §1](../prd/02-identity-and-access.md)).

Requirements the switcher must satisfy:

- **The active household is unambiguous on every screen** where a household-scoped action is
  possible. There is no "current household" on the session — the household is in the URL
  ([D-4](../prd/09-decisions.md)) — so the UI is the only place ambiguity can be introduced.
- Switching household changes: the module list, the grants, the entitlement banner, the timezone,
  the base currency and the dashboard layout. All at once.
- A **notification deep link may target a different household than the active one**, and must
  resolve correctly ([06-clients §6](../prd/06-clients.md)).

## 7. Within-module navigation

Three shapes recur; use them rather than inventing a fourth.

| Shape | Modules | Notes |
|---|---|---|
| **List → detail** | Reminders, Shopping, Chores, Vehicles, Pets, Property, Finance, Utilities, Chat | Mobile pushes; web uses a two-pane or a side panel |
| **Tree → detail** | Notes, Documents | Slug paths; a **root switcher** for shared vs private ([§10](03-patterns.md)) |
| **Board / grid / calendar** | Tasks, Chores (weekly grid), Calendar, Garden (beds and season) | Mobile gets a list-first alternative for each; the grid is the web's primary view |

### Slug paths and permalinks

Notes and Documents address by **slug path** in the client route, resolved to a stable id by the
API. **Renaming or moving changes the URL and the old one 404s — there are no redirects**
([FR-NO5](../prd/modules/07-notes.md)). A document's *content* URL is id-based and permanent,
because the id never changes and the bytes never change
([FR-DO4](../prd/modules/08-documents.md)).

Design consequence: a shared link to a note that was renamed lands on a **404 that explains
itself**, not on a generic error. There is no public sharing and no share token anywhere in the
product, so every such link is household-internal and the message can say so.

## 8. Deep links

Every deep link must resolve correctly in four situations
([06-clients §6](../prd/06-clients.md)):

1. **Warm** — the app is open in the right household.
2. **Cold start** — the app was killed; the link must survive the auth and household resolution.
3. **Wrong household** — the target is in another household the member belongs to; switch, then
   resolve.
4. **No access** — the member no longer has the grant, or the entity is gone. **A neutral message,
   never a leak**, and never a `403`-flavoured "you don't have permission to see X" that confirms
   X exists.

## 9. Version and update surfaces

- **Web** checks its build id and **prompts a reload** when a new one is live.
- **Mobile** below the minimum supported API version gets a **blocking, translated "please
  update" screen and nothing else** ([06-clients §7](../prd/06-clients.md)). This is a designed
  screen, in five languages, and it is the last thing some members will ever see of the app if it
  is bad.
- The server supports the current and previous minor for at least six months, so this screen is
  rare — which is exactly why it will be forgotten if it is not on the inventory.
