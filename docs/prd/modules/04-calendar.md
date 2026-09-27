# 04 — Calendar (Kalendář)

> **New.** `home` had no calendar — its `events` module was all-day-only with no times, no
> exceptions and no external sync. This is the most-expected feature in the category and the
> largest new build in 1.0 after the sync engine.

## What it is

A shared household calendar with real times and timezones, several named calendars, per-occurrence
editing, and **two-way synchronisation with the calendars the household already uses**.

The last part is the whole point. A family calendar that requires everyone to abandon Google
Calendar is a family calendar nobody uses. Household's job is to be *the place where the household's
calendars are visible together*, not to be a replacement for the one on your work phone.

## Setup

Light, and skippable. On first open:

1. **Create the household calendar** — done automatically, named after the household.
2. **Connect an external calendar** — offered, not required. If skipped, the module works as a
   standalone shared calendar and the offer reappears in settings.
3. **Choose a colour per member** — used for the "who" overlay.

## Functional requirements

### Calendars

**FR-CA1 — Several calendars per household.** Each has a name, a colour, an owner, and a **scope**:

| Scope | Visible to | Writable by | Use |
|---|---|---|---|
| `household` | Everyone with the grant | Per grant level | "Family" — the default |
| `personal` | Its owner only | Its owner | A member's own things, kept in Household but not shared |
| `member_shared` | An explicit member list | Those members | "Parents only" |
| `external` | Per its connection's scope | Read-only, or writable if the connection is two-way | A mirrored Google/Apple/CalDAV calendar |

**D-44: a personal calendar is a private root, not a hidden flag** — the same model
[02](../02-identity-and-access.md) §7 uses for Notes and Documents, and refusals are `404`.

### Events

**FR-CA2 — Event CRUD.** An event carries:

| Field | Notes |
|---|---|
| `title`, `description`, `location` | `location` is free text. **Never a coordinate, never geocoded** ([05](../05-privacy-and-compliance.md) §2) |
| `starts_at`, `ends_at` | `timestamptz` |
| `timezone` | **IANA name, stored on the event.** Not derived, not the household's |
| `all_day` | When true, `starts_at`/`ends_at` are interpreted as floating dates |
| `rrule`, `rdate[]`, `exdate[]` | RFC 5545 |
| `status` | `confirmed` · `tentative` · `cancelled` |
| `participants[]` | Household members, each with an RSVP state |
| `reminders[]` | Per-event lead times, feeding the reminder strand |
| `visibility` | `default` · `private` — a private event on a shared calendar shows as "Busy" with no title. It syncs as **two feed rows** ([03](../03-platform-strands.md) §2.2, **D-88**): the full event to its owner, a redacted busy block to everyone else. Under D-93 the busy block is a client table of its own that reaches the owner as well, who is shown the full event over it |
| `external_uid`, `external_etag`, `connection_id` | Present when the event mirrors an external one |

**D-45: an event stores its own IANA timezone.** A recurring 08:00 school run is 08:00 local
across a DST boundary; stored as UTC plus a rule it silently becomes 07:00 in winter. Storing the
zone with the event is the only correct answer, and it is also what makes an event created in
Prague still correct when the member reads it in Spain.

**FR-CA3 — Recurrence and exceptions.** Recurring events expand on read within a bounded window.
Editing an occurrence offers the standard three choices — **this occurrence**, **this and
following**, **all** — and each has a defined implementation:

| Choice | Implementation |
|---|---|
| This occurrence | An **override row** keyed by `(series_id, recurrence_id)` holding only the changed fields, plus an `EXDATE` on the master |
| This and following | The master's rule is truncated with an `UNTIL`, and a **new series** is created from the occurrence date carrying the change and a `continues_series_id` back-reference |
| All | The master is edited; overrides that no longer make sense are surfaced, never silently dropped |

This is where `home`'s "series-only edits" simplification stops being acceptable: a family calendar
without "just this Tuesday" is not a family calendar. **D-46.**

**FR-CA4 — Participants and RSVP.** Household members can be added to an event and respond
`accepted` · `declined` · `tentative` · `needs_action`. RSVP notifies the organiser in the `direct`
category. **External attendees are not invited** — Household does not send calendar invitations by
email in 1.0 (see Non-goals); an external attendee added on the other side is shown read-only.

**FR-CA5 — The "who" view.** A day or week view can be overlaid by member, so "is anyone free
Thursday evening" is a glance. It shows availability from events the viewer may see; a private
event contributes a busy block with no detail.

**This works offline**, because the busy block is a real synced row rather than a server-side
filter. The redacted row carries exactly:

| Carried | Withheld |
|---|---|
| `starts_at`, `ends_at`, `timezone`, `all_day` | `title`, `description`, `location` |
| `calendar_id` and the organiser's id | `participants[]` and their RSVP states |
| **`rrule`, `rdate[]`, `exdate[]`** | Everything on any per-occurrence override except its times |

**The recurrence rule travels, and it has to.** A private event that recurs weekly must produce a
weekly busy block; a projection that dropped the rule would show every other member a single block
on one Tuesday and then claim the organiser was free for the rest of the term, which fails the one
job a busy block has (**D-88**). The cost is that other members learn the *cadence* of something
private — that this member is busy at 09:00 every Thursday — and not what it is. That is the right
side of the trade: a calendar exists to say when people are unavailable, and a wrong answer to that
question is worse than a vague one.

**Per-occurrence overrides project too.** An override that moves or cancels one occurrence emits its
own redacted row carrying the changed times, or the `EXDATE`, and nothing else — otherwise the busy
block drifts out of step with the event the moment the member reschedules just this Tuesday.

The projection that produces all of this is declared with the sync entity and has its own test,
because "what is safe to reveal" is the one thing here that must not be re-derived in two places.

**FR-CA6 — Views.** Month, week, day, and an agenda list. The agenda is the mobile default and the
month is the web default, because that is where each is actually readable.

**FR-CA7 — Reminders.** An event may carry lead times, which register with the reminder strand as
kind `calendar.event`. Per-member overrides apply (FR-RE6).

### External synchronisation

**FR-CA8 — Connections.** A member connects an external calendar account. The connection belongs
to **the member who made it**, not the household — it uses their credentials and their consent, and
it is removed when they leave.

**This is the one place in the product where household content can leave the EEA**, and it is
governed by [05-privacy-and-compliance.md](../05-privacy-and-compliance.md) §10 (**D-86**): off by
default, per member, per remote calendar, busy-only offered first, named at the moment of
connecting, and never available to a child profile. Google and Apple are recipients under the
member's instruction, not Household sub-processors.

| Provider | Protocol | Direction |
|---|---|---|
| **Google Calendar** | Google Calendar API, OAuth 2.0, incremental sync tokens + push channels | Two-way |
| **Apple iCloud Calendar** | CalDAV with an app-specific password | Two-way |
| **Generic CalDAV** | RFC 4791, discovery, `sync-collection` | Two-way |
| **ICS subscription** | Fetch a public `.ics` URL on a schedule | **Read-only** |
| **ICS export** | A per-calendar secret token URL Household serves | Read-only, outbound |

**FR-CA9 — Per-calendar direction and scope.** For each remote calendar the member picks:

- **Off** — do not sync it.
- **Import** — mirror it into Household read-only. Household never writes back.
- **Two-way** — changes flow both directions.

And separately: **import details** or **import as busy only**, which mirrors the times without the
titles. A member syncing a work calendar into the family view almost always wants the second, and
it is the option that makes them willing to connect at all. **D-47.**

**FR-CA10 — Sync mechanics.**

- Incremental where the provider supports it (Google sync tokens, CalDAV `sync-collection`), full
  reconciliation otherwise, and a scheduled full reconciliation weekly regardless — incremental
  protocols drift.
- Push where available (Google watch channels), polling at a configurable interval (default 15 min)
  otherwise.
- Mapping is by **`external_uid` plus `connection_id`**, never by title or time.
- `etag` / sequence numbers carried and used for optimistic concurrency against the remote.
- Deletions propagate as cancellations in both directions, never as silent disappearances.

**FR-CA11 — External conflicts.** When both sides changed since the last sync, **the external
system wins for events it owns and Household wins for events Household owns**, and the losing
version is preserved and surfaced to the member as a resolvable item. Ownership is determined by
where the event was created, recorded at creation and never inferred. **D-48: never merge calendar
events field-by-field.** A meeting that took its time from one system and its date from another is
a meeting nobody attends.

**FR-CA12 — Connection health.** A connection that fails authentication, or fails repeatedly, is
marked degraded, the member is notified once (not per failure), and the calendar renders from its
last good state with a visible staleness badge. Tokens are refreshed proactively before expiry.

**FR-CA13 — Disconnecting.** Removing a connection asks what to do with the mirrored events:
**keep them as ordinary Household events**, or **remove them**. Defaulting to either without asking
is wrong in half the cases.

## Data model

`calendars`, `calendar_events` (the series master), `calendar_event_overrides` (per-occurrence),
`calendar_participants`, `calendar_event_reminders`, `calendar_connections`,
`calendar_connection_calendars` (the per-remote-calendar direction and scope), `calendar_sync_state`
(tokens, cursors, last-success, failure counts).

Notable constraints: `(household_id, calendar_id, external_uid)` unique where `external_uid` is not
null; `(series_id, recurrence_id)` unique on overrides; `ends_at >= starts_at`; an event's
`timezone` must be a valid IANA identifier, validated against the bundled tzdata.

**Credentials** for connections are stored encrypted with a key from the managed secret store, never
in the same table as the sync state, and are excluded from every export and every log.

## Sync (offline)

| Entity | Policy | Notes |
|---|---|---|
| `calendar.calendar` | `strict_version` | Structural. A `member_shared` calendar sets `audience_id` on every feed row it and its events produce, and the membership axis resolves it exactly as it resolves a conversation ([02](../02-identity-and-access.md) §7). Its audience has no floor — joining grants the whole calendar — so its membership row stores `floor_seq = 0`. Under D-93 the audience reaches the replica through the readers kept on each row ([15-chat](15-chat.md) Sync): here every member of the calendar reads every row, a join or a departure rewrites the readers of all of them, and no `floor_seq` is stored |
| `calendar.event` | `strict_version` | **Deliberately strict.** Two people moving the same appointment must be told, not merged. An event with `visibility: private` also declares a **redacted projection** (**D-88**) — the busy block every other member replicates |
| `calendar.override` | `strict_version` | Same |
| `calendar.participant` | `state_set` | An RSVP is a per-(event, user) toggle and cannot meaningfully conflict |
| `calendar.connection` | not synced | Server-only; holds credentials |

Offline creates and edits are queued normally. **External propagation happens server-side after the
mutation lands** — a client never talks to Google directly, so an event created offline in a tunnel
reaches the household immediately on reconnect and the external calendar shortly after, in that
order, which is the right order.

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `calendar.today` — today and tomorrow, with the member colour bar |
| Widget | `calendar.week_ahead` — the next seven days, agenda form |
| Metric | `calendar.events_today`, `calendar.events_7d`, `calendar.unanswered_invitations` (per recipient) |
| List | Mirrors of each |
| Reminder kind | `calendar.event`, shared or personal per the event's participant set |
| Search scope | `calendar.event` — title, description, location |
| Storage | Tables only |

## Permissions

Standard gate, plus:

| Operation | Level |
|---|---|
| Create or delete a calendar | `manage` |
| Create, edit, delete events on a `household` calendar | `contribute` |
| Anything on a `personal` calendar | Its owner only, at any level |
| Connect or disconnect an external account | `contribute`, and only for the member's own connection |
| Change a `member_shared` calendar's member list | `manage`, or the calendar's owner |

A `child` may be given `contribute`, which lets them add to the family calendar. Children cannot
create external connections — that is an OAuth consent to a third party, which a managed profile
cannot give.

## Non-goals

- **No email invitations to non-members.** Sending iMIP/iTIP invitations makes Household a mail
  sender with deliverability, spoofing and abuse obligations, for a feature the household's existing
  calendar already does. External attendees round-trip read-only.
- **No meeting scheduling, no availability polls, no booking links.** That is a work product.
- **No natural-language event entry** in 1.0 (no AI).
- **No Exchange/Office 365 connector** in 1.0 — CalDAV covers Apple and most others, Google covers
  the majority; EWS/Graph is a phase-2 item if demand appears.
- **No geocoding, no maps, no travel-time estimates.** Location is text.
