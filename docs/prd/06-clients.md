# 06 — Clients

Two client applications, one contract, one design system, one set of translation catalogs.

| | Mobile | Web |
|---|---|---|
| **Stack** | React Native via **Expo** (managed workflow, EAS Build/Update), TypeScript | React 19, Vite, TypeScript |
| **TypeScript** | `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. **No `any`, no non-null assertions** — both are lint errors, not warnings |
| **Platforms** | iOS 16+, Android 10+ | Evergreen Chrome, Safari, Firefox, Edge; last two majors |
| **Primary role** | Daily use, capture, notifications, everything offline | Setup, configuration, planning, long-form reading, admin, billing |
| **Offline** | Full local replica, queued writes | Reads from cache, queued writes; a browser is not the offline-first surface. A sign-in and a change to a member's own account are no household's writes, and are asked at once, never queued (**D-164**) |
| **Data layer** | SQLite as the replica, kept by the sync engine: PowerSync's React Native SDK on op-sqlite, in a dev build (D-93) | TanStack Query with a persisted cache |

**D-36: two codebases, not React Native Web.** The shared surface is the *contract, the tokens
and the strings* — not the components. RN Web produces desktop layouts that are worse than the
web ones for exactly the screens Household needs most: the Garden season planner, the Finance
allocation editor, the Utilities tariff composer, the household admin. The duplication is in
presentation, which is where the two platforms genuinely differ; nothing else is duplicated.

## 1. What is shared

| Shared artefact | Produced from | Consumed by |
|---|---|---|
| **`@household/api`** | Generated from `openapi.yaml` on every build | Both clients. A contract change that breaks a client breaks the build |
| **`@household/i18n`** | The translation catalogs, ICU MessageFormat, typed keys | Both clients and the server's render path |
| **`@household/tokens`** | The design tokens (see §3) | Both clients, as CSS custom properties and as a JS object |
| **`@household/sync`** | The sync client over PowerSync's SDKs (D-93): the replica, the connector that pushes the mutation queue, conflict surfacing | Both clients; the SDK differs (React Native on op-sqlite, web on wa-sqlite) |
| **`@household/domain`** | Pure functions with no I/O: money arithmetic, tariff evaluation for preview, allocation preview, recurrence expansion, unit conversion | Both clients — and **the same rules are implemented server-side and cross-checked by a shared test-vector file**, so a preview never disagrees with the saved result |

**D-37: shared test vectors, not shared implementations, for anything computed on both sides.**
The tariff engine and the allocation engine run on the server (authoritative) and on the client
(instant preview). A single JSON file of inputs and expected outputs is a fixture in both test
suites. When they disagree, CI says so, which is the only mechanism that keeps two
implementations honest over time.

## 2. Navigation and information architecture

Seventeen modules cannot be seventeen tabs.

**Mobile** — five destinations, fixed:

| Tab | Contents |
|---|---|
| **Home** | The dashboard: widgets contributed by modules, arranged by the member |
| **Today** | A cross-module agenda: calendar events, due reminders, chores, tasks marked *doing*, garden work — one chronological list of what today actually asks for |
| **Add** | A centre action opening a capture sheet: the six most likely creates for this household, learned from use |
| **Chat** | If enabled and granted |
| **More** | Every module the member has, as a searchable list, plus settings |

**Today is the product's spine.** It is what makes seventeen modules feel like one app rather
than a launcher. Each module contributes to it through the reminder strand and the metric
catalog; the screen owns no feature data, exactly as the dashboard does not.

**Web** — a persistent sidebar with the module list, a global search field, and the same
dashboard as the landing route.

**D-38: module order and visibility are per member.** A member who uses Garden and nothing else
should not scroll past Finance. Members pin, reorder and hide modules for themselves; a module
they have `none` on is not in the list at all. Until the server keeps a member's arrangement
(plan item 36), it is kept in the browser that made it, for each member and household (**D-155**).
The web lists a module the member holds only where its build has a screen for it: one it cannot
open yet is absent, as one the member does not hold is (**D-160**).

## 3. Design

**A fresh consumer-facing design system**, not an evolution of `home`'s. `home` was designed for
two known users who needed no onboarding, no empty states, no upgrade path and no marketing
coherence, and it is dark-default because that is what its two users wanted. A commercial product
needs all of those and a light default.

### Principles

1. **The default configuration is the simple one.** Every module opens in its least complex state.
   Depth is opt-in, reachable, and never a prerequisite.
2. **Capture in one screen, configure in another.** Adding a thing is never blocked on setting a
   thing up. A meter reading takes a number and a date; the tariff engine can wait.
3. **State is never ambiguous.** Synced, pending, failed and conflicted are visually distinct and
   named in words, on every row that can be in them.
4. **Empty states do the teaching.** Seventeen modules with an empty list and a plus button is a
   product nobody adopts. Each empty state explains the module in one sentence, shows one example,
   and offers one action.
5. **Nothing is destroyed without a plain sentence saying what will be lost**, and destructive
   confirmations name the object rather than saying "this item".

### Tokens

One token set, three layers of colour: **primitives** (the raw colour ramps) → **semantic**
(`surface`, `surface-raised`, `text-primary`, `text-muted`, `accent`, `danger`, `warning`,
`positive`, `border`, `focus`) → **component**. Application code spends colour only through
semantic and component tokens; a primitive used directly, or a raw colour, is a lint error. Beside
them are the **scales** (a type scale, an 8-point space scale, radii, elevation, motion durations),
whose steps application code spends by name (**D-152**).

**Themes**: light (default), dark, and system. Both themes are first-class and every screen is
reviewed in both. Per-module accent hues distinguish modules without ever being the only carrier
of meaning.

**Typography**: one variable sans for UI and one monospace for numeric columns. Latin Extended-A
is mandatory (Czech, Slovak and Polish diacritics are not optional) and Latin Extended-B is
required for phase-2 languages. Fonts are self-hosted; no third-party font CDN.

**Density**: mobile is comfortable; web offers comfortable and compact, because the Garden planner
and the Finance ledger are tables and tables want compact.

### Interaction inherited from `home`

The **2000 ms press-and-hold to complete** gesture crosses over — it is genuinely good at
preventing accidental completions in a pocket — with its two non-negotiables: a visible progress
indicator, and a **mandatory immediate keyboard and screen-reader path** that does not require the
hold. A gesture that is the only way to do something is an accessibility failure.

## 4. Accessibility

**WCAG 2.1 level AA is a release gate, not an aspiration.** The European Accessibility Act
applies to consumer services from June 2025, and this is a consumer service sold in the EU.

| Requirement | How it is held |
|---|---|
| Contrast ≥ 4.5:1 body, 3:1 large text and UI components | Token pairs are contrast-tested in CI; a failing pair fails the build |
| Every interactive element reachable and operable by keyboard | Automated axe pass on every route, both themes, in CI |
| Screen reader | VoiceOver and TalkBack manual passes per release on the primary flows; every icon-only control has a label |
| Dynamic type | Layouts survive 200 % text scaling without clipping or loss of function |
| Motion | `prefers-reduced-motion` respected; no essential information conveyed by motion alone |
| Colour | Never the sole carrier of meaning — status is always colour **and** icon **and** text |
| Targets | Minimum 44×44 pt |
| Forms | Every input labelled; errors associated programmatically and stated in words, never only in red |

## 5. Offline UX

The engine is in [03-platform-strands.md](03-platform-strands.md) §2. What the member sees:

| State | Presentation |
|---|---|
| **Online, synced** | Nothing. The absence of an indicator is the indicator |
| **Offline** | A persistent, unobtrusive bar: *"Offline — changes are saved and will sync"* |
| **Pending** | The row carries a subtle pending mark. It is fully editable; edits merge into the queued mutation until it is sent (**D-129**) |
| **Syncing** | A progress indication only when it takes longer than a moment |
| **Conflict** | The row is flagged and tappable, opening a plain comparison: *"You set the amount to 450. Petr set it to 500 at 18:40. Which is right?"* — with both values, both authors, both times, and no jargon |
| **Rejected** | Flagged with the actual reason in a sentence, and an action: retry, edit, or discard |
| **Re-snapshot needed** (under D-93, a re-download) | Handled silently unless it takes long enough to notice |

**D-39: conflicts are surfaced, never hidden and never auto-resolved silently where a human would
care.** For `lww_field` entities the merge is invisible because nothing was lost. For
`strict_version` entities — money, tariffs, allocations — the member is always asked. The dividing
line is whether a wrong answer costs anything.

## 6. Notifications on device

- Permission is requested **contextually** — the first time the member does something that implies
  wanting to be told — never on first launch.
- The system-level permission and the in-app category preferences are shown together, so
  "notifications are off" is diagnosable in one screen.
- Deep links from a notification resolve to the exact entity, and resolve correctly when the app
  was cold-started, when the member is in a different household, and when they no longer have
  access — the last of which shows a neutral message and never a leak.
- On the web a push is shown by a service worker that does nothing else: it serves no file and
  keeps no cache, and a press on a notification hands its address to a page that is open, or
  opens one ([ADR 0026](../adr/0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md)).

## 7. Release and update

| | |
|---|---|
| **Mobile** | EAS Build; **EAS Update** for JavaScript-only fixes, store submission for native changes. An update never changes the API version the client speaks |
| **Web** | Continuous deployment; the SPA checks its build id and prompts a reload when a new one is live. A build's id is a digest of its files, which its page carries and `build.json` beside it names; an open page asks for that file when it is looked at again and every fifteen minutes, and never reloads by itself ([ADR 0025](../adr/0025-the-web-foundation-policy-harness-budget-and-build-id.md)). A build names itself `web/<version>+<build id>`: the version is raised only by a change after which a deployment must refuse older builds, and a build the server refuses as too old draws the *please update* screen, whose action on the web is a reload (**D-158**) |
| **API compatibility** | The server supports the current and the previous minor for **at least 6 months**. Clients send a version header, `Household-Client: mobile/1.4.2` or `web/…`; a client below the minimum supported version for its type, set per deployment, gets a blocking, translated *"please update"* screen and nothing else. The server answers such a client's every request `400 update_required`, naming the oldest version it serves, before it checks anything else, so an old client is never refused for a request the contract has since changed. A request naming no client is held to no minimum ([ADR 0010](../adr/0010-mobile-tokens-second-step-providers-and-client-versions.md)) |
| **Feature flags** | Per household and per platform, so a module can ship dark and be enabled progressively. A flag is on or off for the platform, and a household's own setting of it comes first; the flag `module.<id>` is its module's, and a household for which it is off holds no level on the module, as for one it does not enable; household settings alone has no flag that gates it. A household's representation names the flags that are on for it, which a client shows what ships dark by (**D-146**) |
| **Beta** | TestFlight and Play internal testing, opt-in from settings |

## 8. Quality gates

Both clients, in CI, on every pull request:

- Type check with the strict configuration; zero errors, zero suppressions without a linked issue.
- Lint, including the custom rules: no literal user-facing strings, no primitive design tokens and
  no raw colours in application code, no `any`, no float money.
- Unit tests, including the shared domain test vectors.
- Component tests for every stateful component.
- **End-to-end tests on the critical paths**: register → create household → invite → accept;
  offline capture → reconnect → converge; subscribe → lapse → read-only → export. The web's suite
  runs against the server itself, which it starts on the development services, each test a
  network of its own to the server's limits ([ADR 0026](../adr/0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md)).
- Accessibility: axe on every route, both themes. On the web the routes are one list the router is
  built from, which the suite walks, and the twelve-state harness is among them: a dev-only page,
  in no build a deployment serves, whose words are fixtures (**D-154**).
- Pseudolocalisation pass, to catch layouts that only survive English.
- Bundle-size budget per platform, enforced. The web's is what a first visit downloads before the
  app can draw: 200 kB of script and 20 kB of stylesheet, compressed, and 150 kB for any one script
  loaded later (**D-153**). The web holds one language at a time, and the largest catalog is
  counted with the scripts (**D-159**).
