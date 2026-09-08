# 06 — Accessibility and internationalisation

Both are **release gates enforced in CI**, not review checklists. A design that fails either does
not ship, and finding out at implementation is the expensive way to find out.

## 1. Accessibility

> **WCAG 2.1 level AA is a release gate, not an aspiration.** The European Accessibility Act
> applies to consumer services from June 2025, and this is a consumer service sold in the EU.
> ([06-clients §4](../prd/06-clients.md))

| Requirement | How it is held | What it forbids at design time |
|---|---|---|
| **Contrast** ≥ 4.5:1 body, 3:1 large text and UI components | **Token pairs are contrast-tested in CI; a failing pair fails the build** | Muted text on a tinted surface that "looks fine"; a module accent used as a text colour without testing; placeholder text as a label |
| **Keyboard** — every interactive element reachable and operable | **Automated axe pass on every route, both themes, in CI** | A drag-only reorder; a hover-only affordance; a custom control with no key handling; a focus order that follows visual position instead of meaning |
| **Screen reader** | VoiceOver and TalkBack **manual passes per release** on the primary flows | An icon-only control with no label; a status conveyed only by a coloured dot; a live region that announces every sync tick |
| **Dynamic type** | Layouts survive **200 % text scaling** without clipping or loss of function | Fixed-height rows; two-column layouts that cannot become one; truncation that removes meaning; a tab bar with five labels that will not fit |
| **Motion** | `prefers-reduced-motion` respected; **no essential information conveyed by motion alone** | A progress indicator whose only signal is the animation; an entrance transition that carries meaning |
| **Colour** | **Never the sole carrier of meaning — status is colour *and* icon *and* text** | A red row; a green tick with no label; a chart whose series are distinguished only by hue |
| **Targets** | Minimum **44×44 pt** — note this is **SC 2.5.5, Level AAA** in WCAG 2.1, not AA; 2.1 has no AA target-size criterion, and the 24×24 AA minimum arrives only with WCAG 2.2's SC 2.5.8. The product adopts the stricter figure by choice ([06-clients §4](../prd/06-clients.md)), so it is a **product commitment above the AA baseline**, not the thing the European Accessibility Act argument rests on | A 32 px icon button in a compact table row; a swipe action with no tap equivalent |
| **Forms** | Every input labelled; **errors associated programmatically and stated in words, never only in red** | An error shown as a red border; a validation summary with no per-field association; a required marker that is only an asterisk colour |

### The three that will bite hardest

1. **The hold gesture.** 2000 ms press-and-hold **must** have a visible progress indicator and a
   **mandatory immediate keyboard and screen-reader path that does not require the hold**. *A
   gesture that is the only way to do something is an accessibility failure.* This is the single
   most-repeated accessibility constraint in the PRD and it applies everywhere the gesture does:
   Tasks, Chores, Reminders, Garden, and every widget that mirrors them.

2. **Status triple-encoding across thirteen states.** `synced` · `pending` · `syncing` ·
   `conflict` · `rejected` · `offline` · `overdue` · `blocked` · `estimated` · `private` ·
   `locked` · `stale` · `no_history`. Each needs a colour token, an icon, and a word — in every
   language. This is the same thirteen [01-foundations §8](01-foundations.md) draws in-house and
   [DD-10](08-decisions.md) budgets, and the count must stay in step: a state that is on one list
   and not the other ships with a colour and an icon but no guaranteed word, which is exactly what
   N2 forbids — and `private` and `locked` are the two where that failure is also a privacy one.

3. **200 % text on the dense screens.** The Chores weekly grid (members × days), the Finance
   ledger, the Utilities tariff breakdown and the Garden season plan are tables. Design the
   200 % behaviour explicitly — pivot, scroll, or collapse — rather than discovering it.

### Deliverable requirement

Every screen is delivered **in both themes** and **at 200 % text**. Every interactive component
spec names its focus, hover, pressed and disabled treatment, and its screen-reader label and
role.

## 2. Internationalisation

**English is the source language and the only language in the codebase**
([D-29](../prd/03-platform-strands.md)). There is no user-visible string in any client source
file, and an architecture test enforces it.

| Phase | Languages |
|---|---|
| **1.0** | English (source), **Czech, German, Slovak, Polish** |
| **1.x** | Dutch, Spanish, French, Italian, Portuguese, Hungarian, Romanian |
| **2.0** | The remaining EU official languages |

### What design must do about it

- **Write every string as an ICU message**, with plurals and gender declared. Czech, Slovak and
  Polish have three or more plural forms; **four-form Slavic plurals are the single most common
  bug in naively translated apps**. Never build a sentence by concatenation.
- **Never hand-roll a date, number or currency format.** ICU, member locale, always.
- **Design in German.** German is the length worst case among the launch languages and Polish is
  close behind. A layout tested only in English is a layout that breaks in German — the E2E suite
  runs a **pseudolocalisation pass** for exactly this reason, and design should not be the last
  to find out.
- **Latin Extended-A is mandatory** in the type stack. `Ď Ř Ě Ů Ł Ą Ę Ś Ź Ż Ö Ü ß` are not
  edge cases; they are four of five launch markets.
- **RTL is not required in 1.0** and no launch or phase-1.x language needs it. Do not spend
  effort there; do not actively make it impossible either.

### Localisation is more than language

| Dimension | Set per | Design consequence |
|---|---|---|
| **UI language** | **Member** | Two members of one household read **the same data** in different languages. The audit log renders from stored keys in the reader's language, so a shared screen is genuinely bilingual across two devices |
| **Timezone** | Household, **overridable per member** | "Today", quiet hours and digests all resolve against the member's **effective** timezone — the household's until that member overrides it. A member abroad who has *not* overridden it still sees the household's day, which is the default and the common case; one who has sees their own. Today's day boundary, the overdue group and `due_on` all follow this one rule ([01-foundations §9](01-foundations.md)) |
| **Base currency** | **Household** | But **formatting follows the member's locale**. These are two different settings and the UI must not conflate them |
| **Date, time, number, first day of week** | **Member locale** (the household locale sets the default the member overrides) | Calendar week start differs between members of one household |
| **Units** | Household | Metric default; imperial available for length, area, mass, temperature, volume |
| **Country profile** | Household | Drives **tariff presets, public holidays, vehicle-inspection naming (STK / TK / HU-TÜV / przegląd / MOT), document types and default VAT**. The vocabulary on the screen changes with the country, not only the translation |
| **Climate profile** | Household location | Drives Garden frost dates, hardiness zone and crop timing |

**Reference data is translated as data, not as strings** — the crop catalog, tariff presets,
document types and unit names carry per-language fields. So a screen may render a mix of
translated UI chrome and translated *content*, and the design must not assume the content is
short or that it matches the UI language's rhythm.

### The country-vocabulary rule

Utilities' tariff forms use **the words that appear on that household's actual bill in that
country** — *Grundpreis*, *plat za jistič*, *standing charge*. Vehicles' statutory dates use the
country's own name for the inspection. This is not translation; it is localisation, and it means
**one screen has five different label sets**. Design the layout to survive that.
