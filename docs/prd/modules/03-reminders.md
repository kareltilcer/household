# 03 — Reminders (Připomínky)

> Renamed from `home`'s **Okno do budoucnosti**.

## What it is

Two things that are easy to confuse and must not be:

1. **The Reminders module** — a member-facing screen and a place to keep *standalone* recurring
   household obligations that belong to no other module: "descale the kettle", "Grandma's
   birthday", "change the smoke-alarm battery".
2. **The reminder strand** — a platform capability that owns lead times, snoozing, completion and
   delivery for **every** date-bearing thing in the product. Specified in
   [03-platform-strands.md](../03-platform-strands.md) §6.

**D-27 restated:** the mechanism is a strand and the module is its interface. In `home`, Okno do
budoucnosti owned its own events *and* its own reminder logic, and it was the only module that had
any. Household has **ten** modules producing due dates — Tasks, Calendar, Chores, Documents,
Finance, Utilities, Garden, Property, Vehicles and Pets — registering **twenty-one** reminder kinds
between them, and implementing lead times ten times is how ten subtly different behaviours ship.

## Functional requirements

### The module's own reminders

**FR-RE1 — Reminder CRUD.** Title, optional note, `due_on` (a date, not an instant), optional
recurrence, an optional linked entity, and a `completion_scope` of `household` or `personal`.
Soft delete; series-only edits, as in `home` — editing a recurring reminder edits the series, not
one occurrence.

**FR-RE2 — Recurrence.** An RRULE subset: daily, weekly (with weekdays), monthly (by day-of-month
or by nth-weekday), yearly, each with an interval and an optional end (a date or a count).
Occurrences are **expanded on read**, never materialised as rows, and the expansion is capped.
Short months clamp: a monthly reminder on the 31st fires on the 28th, 29th or 30th. Carried from
`home` D19.

**FR-RE3 — Occurrence completion is idempotent** and recorded per `(reminder_id, occurrence_on)`
— the only per-occurrence row that exists. Completing an already-complete occurrence is `200`, not
`409`, because a hold gesture on a bad connection fires twice. Undo is its inverse.

**FR-RE4 — Anniversaries.** A reminder may be flagged as an anniversary with a `since_year`, in
which case the UI shows the count ("Grandma's 80th") and the reminder does not "complete" — it
passes. This is a small thing that a household calendar is used for constantly.

### The strand's surface, in this module

**FR-RE5 — The unified list.** The module's main screen is **not** only its own reminders. It is
every reminder the member is subscribed to, from every module, in one chronological list:

```
This week
  Tue 9   Car — technical inspection due in 30 days        Vehicles
  Wed 10  Descale the kettle                               Reminders
  Fri 12  Boiler service                                   Property
Next week
  Mon 15  Passport expires in 6 months  ·  Jana            Documents
```

Each row names its source module and opens the source entity. Rows from a module the member has
`none` on are absent, not greyed.

**FR-RE6 — Subscriptions.** A member subscribes per **reminder kind**, with their own lead time and
their own delivery preference (in-app only, or push). Two members can want different notice for the
same boiler service, and both are right.

**The lead-time set is the strand's** ([03-platform-strands.md](../03-platform-strands.md) FR-RM2) —
`0d`, `1d`, `3d`, `1w`, `2w`, `1m`, `3m`, or a custom number of days. This module presents it; it
does not define it, because a second list is a second list to fall out of step.

Defaults are set per kind by the module that registers it — a passport expiry defaults to six
months, a bin collection to one day — because a sensible default is the difference between a
feature used and a feature configured once and abandoned.

**FR-RE7 — Snooze.** Any occurrence can be snoozed by a member for a chosen interval. Snoozing is
**personal** even when completion is shared: you can stop being told about the boiler service
without marking it done for everybody. **D-43.**

**FR-RE8 — Completion scope is declared by the kind, not chosen by the member.** A shared
obligation ("the boiler was serviced") completes for everyone; a personal one ("renew *my*
passport") completes for one. The module registering the kind decides, because it is a property of
the obligation and not a preference.

**FR-RE9 — Overdue.** An occurrence whose date has passed and which is not complete is overdue,
sorted first, and stays visible for `OVERDUE_WINDOW_DAYS` (default 60) before ageing out of the
list — it remains in the source module either way. Nothing is ever silently dropped.

## Data model

**`reminders`** — the module's own: `title`, `note`, `due_on`, `rrule`, `rrule_until`,
`rrule_count`, `completion_scope`, `is_anniversary`, `since_year`, `linked_entity_type`,
`linked_entity_id`, plus house columns.

**`reminder_completions`** — `(household_id, source, source_id, occurrence_on, user_id NULL)`
unique. `user_id` is null for household-scope completions and set for personal ones. The **only**
per-occurrence row.

**`reminder_subscriptions`** — `(household_id, user_id, kind_key)` unique; `lead_days`,
`channel enum(in_app, push, both, off)`.

**`reminder_snoozes`** — `(household_id, user_id, source, source_id, occurrence_on)` unique;
`until_on`.

The three tables after the first are **owned by the strand, not by this module**, and live in the
platform's migration block. Any module's reminder kind writes into them through the strand's API.

## Sync

| Entity | Policy |
|---|---|
| `reminders.reminder` | `lww_field` |
| `reminders.completion` | `state_set` — a completion is a toggle keyed by (source, occurrence, user) |
| `reminders.subscription` | `lww_row`, personal |
| `reminders.snooze` | `state_set`, personal |

Occurrence expansion happens **on the client too**, from the synced rule, so the offline list is
complete rather than a cached window. The expansion function is in `@household/domain` with shared
test vectors ([06-clients.md](../06-clients.md) §1).

## Catalog contributions

| Kind | Key | Notes |
|---|---|---|
| Widget | `reminders.due` | Everything due or overdue within the member's lead windows, across all modules, overdue first, with press-and-hold complete |
| Widget | `reminders.this_month` | Read-only look-ahead to month end |
| Metric | `reminders.due_today`, `reminders.due_today_open`, `reminders.overdue_open`, `reminders.due_7d` | Per recipient — subscriptions differ |
| List | Mirrors of each | |
| Search scope | `reminders.reminder` | Title and note |

## Permissions

Standard gate, with the personal-preference exemption: subscriptions, snoozes and personal
completions require only `view`.

## Non-goals

- **No times of day on the module's own reminders.** A reminder is a day. Anything that needs a
  time is a Calendar event, and Calendar exists now — this is the boundary between the two modules
  and it is worth keeping sharp.
- No location-based reminders (no geofencing — the product does not read device location,
  [05](../05-privacy-and-compliance.md) §2).
- No per-occurrence exceptions to a series. Editing a series edits the series; a one-off is a new
  reminder. Carried from `home`.
- No natural-language input in 1.0 — it is an AI feature, and there are none.
