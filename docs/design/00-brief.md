# 00 — Brief

## 1. What is being designed

| | Mobile | Web |
|---|---|---|
| **Stack** | React Native / Expo, iOS 16.4+ ([D-185](../prd/09-decisions.md)), Android 10+ | React 19 + Vite, evergreen browsers |
| **Primary role** | Daily use, capture, notifications, **everything offline** | Setup, configuration, planning, long-form reading, admin, billing |
| **Offline** | Full local replica, queued writes | Reads from cache, queued writes — **a browser is not the offline-first surface** ([06-clients](../prd/06-clients.md)). What this means per screen is [03-patterns §1](03-patterns.md) |
| **Default view** | Agenda / list | Table / calendar / editor |
| **Density** | Comfortable only | Comfortable **and** compact |

**Two codebases, not React Native Web** ([D-36](../prd/06-clients.md)). The shared surface is
*the contract, the tokens and the strings* — **not the components**. Design accordingly: one
token set and one vocabulary, two native-feeling presentations. A phone layout stretched to
1440 px is a failure, and so is a desktop table crammed onto a phone.

Shared as real build artefacts: `@household/tokens` (design tokens, emitted as CSS custom
properties **and** a JS object) and `@household/i18n` (ICU catalogs, typed keys). **The token
package is a design deliverable**, not a developer translation of one.

## 2. The product, in one line

> Everything your household has to keep track of, in one app that works on the tram, in the shop,
> and at the bottom of the garden.

A subscription app in which a family, a couple or a shared flat keeps the running state of their
home. €4.99/household/month billed annually, 30-day trial, no card. Seventeen modules. Five
launch markets — Czechia, Slovakia, Germany, Poland, the United Kingdom — localised, not merely
translated. ([00-overview](../prd/00-overview.md))

**The wedge is depth in the boring, expensive, recurring parts of running a home**: a real
utility tariff engine, a curated agronomic knowledge base, and a Finance module that does both
pooled budgets and Splitwise-style splitting. Those three modules are where the product is
defensible and where the hardest screens are.

## 3. Who it is for

Five personas, condensed to what each one changes about the design.

| Persona | Design consequence |
|---|---|
| **Jana, 38 — owner/organiser.** Runs the logistics, invites everyone, pays | Needs the admin, invitation and grant surfaces to be comprehensible without a manual. She is the only one who will ever see the setup wizards |
| **Petr, 41 — partner.** Uses two modules, ignores fifteen | **Per-member module order and visibility is not a nicety** ([D-38](../prd/06-clients.md)). His home screen must not have Finance on it. He must never see a setup screen |
| **Adam, 14 — child profile on his own phone** | Signs in with household code + profile + PIN, no email. His dashboard may be **locked** by an owner. Chores and points are his product |
| **Klára, 26 — flatmate, expenses only** | Has `none` on fourteen modules. Her app is three screens and must not feel like a crippled version of somebody else's |
| **Miloš, 62 — gardener, on a tablet** | Tablet layouts are not optional. Larger text is likely. Garden must be reachable in one tap from a cold start |

**Anti-persona: the small business.** Nothing is designed for approval chains, cost centres,
org charts or more than about ten members.

## 4. The five principles

From [06-clients §3](../prd/06-clients.md). Each is stated with what it forbids, because a
principle that forbids nothing is decoration.

1. **The default configuration is the simple one.** Every module opens in its least complex
   state; depth is opt-in and reachable.
   *Forbids:* a first-run screen that asks a question before it shows anything; a settings-shaped
   empty state.

2. **Capture in one screen, configure in another.** Adding a thing is never blocked on setting a
   thing up. A meter reading takes a number and a date; the tariff engine can wait.
   *Forbids:* a required field that exists only for a downstream calculation; a "finish setup to
   continue" wall.

3. **State is never ambiguous.** Synced, pending, failed and conflicted are visually distinct and
   **named in words**, on every row that can be in them.
   *Forbids:* a spinner as the only sync affordance; a colour-only pending mark; silent retry.

4. **Empty states do the teaching.** Each one explains the module in one sentence, shows one
   example, and offers one action.
   *Forbids:* an empty list with a plus button. Seventeen of those is a product nobody adopts.

5. **Nothing is destroyed without a plain sentence saying what will be lost**, and destructive
   confirmations **name the object** rather than saying "this item".
   *Forbids:* "Are you sure?"; a red button with no consequence stated; type-to-confirm as a
   substitute for saying what happens.

## 5. Voice

- **English is the source language**, and no user-visible string exists in client source
  ([D-29](../prd/03-platform-strands.md)). Every string you write is a translation key with an
  ICU message. Write for a translator: no puns, no idiom, no string concatenation, no gender
  assumptions, plurals declared.
- **Plain, specific, unhurried.** *"You set the amount to 450. Petr set it to 500 at 18:40. Which
  is right?"* — that is the register. Not *"Sync conflict detected"*.
- **Never blame the member.** *"Offline — changes are saved and will sync"*, not *"No connection"*.
- **Name the thing.** *"this is the service invoice on your Škoda"*, not *"1 reference"*.
- **Never claim a number the product has not earned.** Utilities shows *"not enough information
  to forecast"* and names exactly what is missing, rather than a zero
  ([FR-UT12](../prd/modules/10-utilities.md)).

## 6. Non-negotiables

These are release gates or product commitments. They are not design preferences and they are not
open for a redesign to trade away.

| # | Constraint | Source |
|---|---|---|
| N1 | **WCAG 2.1 AA**, enforced in CI: token contrast pairs, axe on every route in both themes, 44×44 pt targets, 200 % dynamic type, `prefers-reduced-motion`, forms labelled and errors in words | [06-clients §4](../prd/06-clients.md) |
| N2 | **Colour is never the sole carrier of meaning.** Status is always colour **and** icon **and** text | ibid |
| N3 | **Light and dark are both first-class**, light is the default, and every screen is reviewed in both | [06-clients §3](../prd/06-clients.md) |
| N4 | **Only semantic tokens appear in application code.** A colour primitive used directly, or a raw colour, is a lint error; the scales are spent by name ([D-152](../prd/09-decisions.md)) | ibid |
| N5 | **The 2000 ms press-and-hold gesture** keeps its visible progress indicator **and** its mandatory immediate keyboard and screen-reader path | ibid |
| N6 | **`none` means absent, not hidden.** A module a member lacks is missing from all nine surfaces FR-AC2 names — including the sync feed, where entities already on the device are **retracted** — plus navigation. The full list is [03-patterns §2](03-patterns.md) | [FR-AC2](../prd/02-identity-and-access.md) |
| N7 | **Every offline-capable row shows its state**, and `strict_version` conflicts are **always asked**, never auto-merged | [D-39](../prd/06-clients.md) |
| N8 | **Latin Extended-A is mandatory** in every face; fonts are self-hosted, no third-party CDN | [06-clients §3](../prd/06-clients.md) |
| N9 | **Money is integer minor units plus an ISO 4217 code.** Never a float, never a pre-rendered currency string in the data | [PRD conventions](../prd/README.md) |
| N10 | **No advertising, no third-party trackers, no ad SDKs, no dark patterns around cancellation.** No **billing** state ever blocks export — `suspended` is not a billing state and is the one exception, which is design's call and is recorded as [DD-15](08-decisions.md) ([03-patterns §3](03-patterns.md)) | [00-overview §5](../prd/00-overview.md), [D-32](../prd/04-billing-and-entitlements.md) |
| N11 | **No AI features in 1.0.** No assistant surface, no generated content, no "smart" affordance that implies one | [00-overview §5](../prd/00-overview.md) |
| N12 | **No location permission is ever requested.** Garden asks for a *place*; the map pin snaps to two decimal places (~1.1 km) in front of the member | [05-privacy §2](../prd/05-privacy-and-compliance.md) |

## 7. What design owns, and what it does not

**Design owns**

- The token system, all three layers, and the contrast-tested pairs that back it.
- The component inventory and every state in it.
- The information architecture *within* a module, and every screen layout.
- All user-visible copy, as ICU message keys.
- The empty, loading, error, offline, pending, conflicted, rejected and permission-absent states
  of everything.
- Motion, iconography, illustration, and the print stylesheets Garden and Property require.
- **In-app contextual help** ([DD-13](08-decisions.md)) — a content model, the surfaces that carry
  it, and its copy in five languages.
- **The marketing site and the app-store presence** ([DD-12](08-decisions.md)), in DS-5.

**The PRD has already settled — do not relitigate**

- The five mobile destinations and the web sidebar ([06-clients §2](../prd/06-clients.md)).
- Four grant levels; three roles; `404` not `403`; absence, not disabling.
- Dashboard is an ordered list with three sizes — **no free-form grid**
  ([01-dashboard](../prd/modules/01-dashboard.md) non-goals).
- Today is **not customisable**.
- Shopping check-off is **a single tap**, not a hold ([FR-SH4](../prd/modules/05-shopping.md)).
- Eight entitlement states, and what each one permits.
- Which merge policy each entity has, and therefore which changes ask and which merge silently.

**Explicitly out of scope for 1.0**

Cross-household social features · business/team features · bank connections · AI · smart home ·
self-host · white-label · a public API.

The **marketing site and store listings are in scope** and sit in DS-5
([DD-12](08-decisions.md)). They consume the same token package, which is the point — but a
marketing site is a different discipline from product UI and is budgeted as its own body of work,
not as an afterthought to the last phase.

## 8. The one sentence to keep in view

**Seventeen modules must feel like one app rather than a launcher**, and the two things that do
that work are *Today* — one chronological answer to "what does today ask of me" — and a design
system disciplined enough that a member who lives in Garden recognises Utilities the first time
they open it.
