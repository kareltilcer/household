# 16 — Activity log (Historie změn)

## What it is

The household's own view of the audit spine ([03-platform-strands.md](../03-platform-strands.md)
§1): who changed what, when, from where, and what the value was before.

In `home` this was an admin-only debugging tool. In Household it is **a member-facing feature**, and
that change is deliberate: in a shared household, "who moved this / who deleted that / who changed
the amount" is a real question between people, and a product that records the answer and shows it is
a product people trust. It is also the surface on which the platform's transparency commitments —
staff actions, support actions, agent-free provenance — become visible rather than promised.

## Functional requirements

**FR-AL1 — Browse.** A paginated, filterable feed: by module, action, entity type, actor, level and
date range, with free-text search across rendered summaries. Keyset paginated; a malformed cursor is
`422`.

**FR-AL2 — Summaries render in the reader's language** from the stored key and arguments (**D-21**).
Two members of one household read the same event correctly in different languages.

**FR-AL3 — Entity timeline.** Every event touching one entity, oldest first, **including
cross-module events** — so a document's timeline shows it being uploaded, pinned, referenced by a
vehicle service record, and expiring.

**FR-AL4 — Field diffs.** For entities in the diff set — everything money-bearing, every tariff,
every permission and membership change, and the entities each module nominates — the event carries
the changed fields with old and new values.

**FR-AL5 — Redaction on read.** Events about private items are redacted for anyone but their owner:
a generic summary, no entity id, no diff. Full-text search has the **stricter second rule** — private
events are excluded from `q=` matching entirely for a non-owner, because a redacted hit still confirms
the search term occurs in a private title. Two rules, deliberately, because one rule leaks. Carried
from `home` D188.

**FR-AL6 — Grant filtering.** Events from a module the reader has `none` on are absent, exactly as
[02](../02-identity-and-access.md) FR-AC2 requires.

**FR-AL7 — Platform actions are visible to the household.** A support agent extending a trial, a
`platform_admin` acting on a legal request, an automated retention deletion — each writes an event
into the household's own log with `actor_type: service` and a clear summary. **A household can see
everything the platform did to it.** This is the transparency half of the no-content-access
guarantee, and it is what makes the guarantee checkable rather than merely stated. **D-75.** The
actor of what staff did is the service `support`, which a client renders as *Household support*:
never the staff member's name, and never the reason they gave, which are the platform's own log's
([02](../02-identity-and-access.md) FR-PS2, **D-145**).

**FR-AL8 — Provenance.** Every event records `meta.via`: `web`, `mobile`, `sync`, `import`,
`system`. "Did I do this on my phone or did the importer?" is answerable.

**FR-AL9 — Statistics.** Counts by module, action and actor over a window — the shape of the
household's activity, used by the module's own widget and by nothing else.

**FR-AL10 — Append-only.** Nothing in the log can be edited or deleted by anyone, including owners
and including `platform_admin`. It is retained for the life of the household, exported with it, and
deleted with it. A log a member can quietly edit is not a log.

## Data model

Owned by `platform/audit`, not by this module — the module is a reader. `audit_events` and
`audit_changes`, with a generated `tsvector` per event for search, partitioned monthly, and indexed
on `(household_id, occurred_at desc)`, `(household_id, entity_type, entity_id, occurred_at)` and
`(household_id, module, action)`.

## Sync

**Not synced.** The activity log is server-side and read online. It is unbounded, rarely read, and
never needed offline — replicating it would be the single largest thing in a local store for the
least benefit. A member offline sees the log's last-read page from the query cache and a clear
"needs connection" state beyond it. **D-76.**

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `activity.recent` — the last few household changes, plainly worded |
| Metric | `activity.events_today`, `activity.events_7d` |
| Search scope | `activity.event` — with FR-AL5's stricter rule applied |
| Storage | Declares the audit tables for the size picture |

## Permissions

| Operation | Level |
|---|---|
| Read the household feed | `view` on the activity module |
| Read one's own actions | Always available to every member, regardless of grant — a member can always see what they themselves did |
| Read another member's actions | `view` on activity |
| Entity timeline | `view` on activity **and** access to the entity itself |

**Default grant is `view` for adults and `none` for children.** A member being able to see the
household's history is normal; a household that wants it closed can close it.

## Non-goals

- No editing, no deletion, no pruning, no retention configuration by the household.
- No exporting to an external SIEM in 1.0.
- No alerting rules of its own — alerting is the notifications strand composing over the same
  action catalog.
