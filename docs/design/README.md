# Household — Design handoff

**Derived from [`docs/prd`](../prd/README.md) v1.0 · 2026-09-08 · for Claude Design**

This directory is the brief for designing Household's two client applications and the design
system they share. It exists because the PRD is six thousand lines of product and engineering
specification in which the design requirements are correct, complete and scattered.

## How to use it

- **The PRD is authoritative.** Where this handoff and the PRD disagree, the PRD wins and this
  document is wrong. Every constraint here carries a link to the requirement it comes from.
- **Where the PRD left something open, this handoff decides it**, and the decision is recorded as
  **DD-n** in [08-decisions.md](08-decisions.md) with the alternative that was rejected and why.
  A `**Settled (DD-n)**` marker in the text means exactly that: it is not in the PRD, and it is
  not up for rediscussion in a design review. One question remains genuinely open (**OQ-1**,
  Chat in the UK) and it blocks nothing.
- **Read 00 and 03 before drawing anything.** The brief and the cross-cutting patterns are what
  make seventeen modules one product; the screen inventory is only useful after them.

## Contents

| # | File | What it settles |
|---|---|---|
| 00 | [Brief](00-brief.md) | What is being designed, for whom, the principles, and the non-negotiables |
| 01 | [Foundations](01-foundations.md) | Tokens, colour, type, space, motion, icons, density, numbers and dates |
| 02 | [Components](02-components.md) | The component inventory and the states each one must have |
| 03 | [Patterns](03-patterns.md) | Sync state, absence, entitlement, empty states, setup, destructive actions, the hold gesture |
| 04 | [Navigation](04-navigation.md) | Information architecture on both platforms, Today, deep links |
| 05 | [Screens](05-screens.md) | The full screen inventory, per module, with priority and design risk |
| 06 | [Accessibility & i18n](06-accessibility-and-i18n.md) | The release gates, and what they forbid at design time |
| 07 | [Delivery](07-delivery.md) | What to produce in what order, and when a screen is done |
| 08 | [Design decisions](08-decisions.md) | DD-1 to DD-15, each with its rejected alternative; plus the one question still open |

## The shortest possible summary

Seventeen modules, two clients, five languages, five markets, one subscription. Every read works
offline and every write survives being offline, so **every row that can be pending, conflicted or
rejected has to say so**. A module a member was not granted is **absent**, not disabled. Every
module opens in its simplest state and depth is opt-in. WCAG 2.1 AA is a release gate. Light is
the default theme and dark is not an afterthought.
