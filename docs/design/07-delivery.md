# 07 — Delivery

## 1. The order

Design runs one phase ahead of engineering, against the same
[roadmap](../prd/08-roadmap.md).

| Design set | Delivers into | Contents |
|---|---|---|
| **DS-0 · Foundations & platform** | Phase 0 | The token system v1 with tested contrast pairs · the five-family accent map · the licensed icon base plus the 17 module and 13 status icons · the primitive and layout components · **the sync-state vocabulary** (offline, pending, syncing, conflict, rejected) · **the conflict inbox**, the **conflict resolver** and the **rejected-mutation resolver** · the **four- and five-tab** bar · auth (sign in, register, verify, MFA, password reset, sessions and devices, **the account-takeover notice**, child sign-in and PIN lockout), household creation, **invitation compose and accept** · the grant matrix · **account settings** (profile, language, MFA, sessions, notification categories, quiet hours, first day of week) · **the household switcher** · **the Phase 0 half of household settings** — profile, members and grants, modules, **storage**, billing, data ([05-screens §C](05-screens.md)) · **sync health** · entitlement banners including the three trial stages, plus the **`suspended` full-screen lockout** · the neutral "not available" screen and the **withdrawn/retracted** treatment · **the notification permission + categories screen**, designed as one · **privacy centre, diagnostic bundle, export and account deletion** · **"please update"** · leave household |
| **DS-1 · Shopping** | Phase 1 | Shopping end to end, at production quality, on both clients — including the two-trolley offline behaviour and the teaching empty state that becomes the template for sixteen more. **The illustration construction language is settled here** |
| **DS-2 · Daily core** | Phase 2 | Dashboard and the widget shell (2/4/6 grid) · **Today** · the Add sheet · **global search — the one result row shape** ([05-screens §F](05-screens.md)) · Reminders · Tasks · Notes · Documents · Chores · Activity log · the rest of household settings — **the notification composer and the per-module setup re-entry points**, the whole of what Phase 2 adds there · **the in-app help content model**, so later modules author help as they are designed rather than retrofitting it |
| **DS-3 · Differentiators** | Phase 3 | Utilities, Finance, Garden — each with its setup flow and its one hard screen (**tariff composer**, **flow view**, **plan check + tier model**) · **the print stylesheet and Garden's two print layouts**, as their own line, not absorbed ([DD-14](08-decisions.md)) |
| **DS-4 · Breadth** | Phase 4 | Calendar · the asset engine's shared screens then Property, Vehicles, Pets — including **Property's printable insurance inventory**, the third print target, which lands here rather than in DS-3 because it prints tables that do not exist until this set ([DD-14](08-decisions.md)) · Chat |
| **DS-5 · GA polish** | Phase 5 | **The marketing site and store listings** · help content completed in five languages · the pseudolocalisation and 200 % sweep · the accessibility audit remediation |

**DS-0 is the risky one and it has no demo**, exactly as Phase 0 does. Resist the pull toward
drawing a beautiful Garden screen early: the sync-state vocabulary and the grant matrix are what
every later screen inherits, and they are cheapest to get right before there are seventeen
modules using them.

### Four things that must start earlier than they feel like they should

1. **Empty-state copy and illustration.** Seventeen of them, each teaching a module in one
   sentence with one example. This is content work with a long lead and it cannot be batched at
   the end.
2. **The four illustrated answers in Finance setup** ([FR-FI: setup step 1](../prd/modules/09-finance.md))
   — *"How does your household handle money?"* is the module's most important screen and the
   illustration is load-bearing, not decorative. It is also the house style decision that
   propagates to every empty state, so it is settled in DS-1 at the latest.
3. **The in-app help content model** ([DD-13](08-decisions.md)). Help that is authored alongside
   each module costs almost nothing; help retrofitted across seventeen modules in Phase 5, in five
   languages, is a project. The model belongs in DS-2 and every module after it writes its own.
4. **The 17 module and 13 status icons** ([DD-10](08-decisions.md)). The status set is
   load-bearing under N2 — every sync and honesty state depends on it — so it cannot wait for the
   modules that use it.

### The illustration system

**Settled ([DD-5](08-decisions.md)): one systematic construction language, not bespoke artwork
per module.** A limited palette drawn from the five family accents, one drawing language, and
composition from a shared kit of parts. Seventeen bespoke empty states plus four Finance
illustrations would carry more charm and would not survive contact with coherence, translation or
the schedule; illustration built as a system scales to seventeen and to whatever 1.x adds.

Empty states are where the PRD puts the teaching burden, so a purely typographic treatment was
also rejected — it is the cheapest option and the weakest tool for the job it has.

## 2. What a deliverable is

For a **token**: a value in `@household/tokens`, in both themes, with its declared contrast
pairs. Not a hex code in a comment.

For a **component**: the anatomy, every state from [02-components §0](02-components.md), the
tokens it consumes, its keyboard behaviour, its screen-reader role and label, its
reduced-motion behaviour, and its responsive/density variants. Redlines are unnecessary where
tokens carry the values — name the token instead of the pixel.

For a **screen**: the layout at three widths (phone, tablet, desktop where it exists), in both
themes, at 100 % and 200 % text, in **English and German**, with every state that screen can be
in — including the offline, pending, permission-absent and entitlement-read-only ones.

For **copy**: an ICU message with a key, in English, with plural and gender forms declared and a
note to translators where context is not obvious from the string.

## 3. Definition of done, per screen

A screen is finished when all of these are true. This list is the review checklist, and it covers
**all twelve states** in [02-components §0](02-components.md) — an undocumented state is an
untested state.

- [ ] **Both themes**, with no colour defined only inside the dark block.
- [ ] **200 % text** without clipping or loss of function.
- [ ] **English and German**, and the layout survives the longer one.
- [ ] Every **status is colour *and* icon *and* text**.
- [ ] Every interactive element is **keyboard-reachable** with a visible focus ring on both
      surfaces, and every icon-only control has a label.
- [ ] All hit targets **≥ 44×44 pt**, in compact density too.
- [ ] **Declared contrast pairs only** — no ad-hoc colour combinations.
- [ ] **Only semantic tokens** referenced.
- [ ] The **empty state teaches**: one sentence, one example, one action.
- [ ] The **loading** state is drawn — a **skeleton shape-matched to the content**, not a spinner,
      wherever the shape is known. A cold web cache is a loading state
      ([03-patterns §1](03-patterns.md)).
- [ ] The **error** state is drawn: **named in words, with an action**. Never a bare failure.
- [ ] The **offline, pending, syncing, conflicted and rejected** states are drawn for every row
      that can be in them.
- [ ] The **permission-absent** behaviour is *absence*, not disabling — and nothing on the screen
      hints that a module the member lacks exists.
- [ ] The **withdrawn** behaviour is drawn for any row that can be retracted while it is on
      screen: what the member sees, and the sentence that says access changed
      ([03-patterns §2](03-patterns.md)).
- [ ] The **entitlement read-only** state is drawn: content visible, writes gone, banner explains.
- [ ] Every **destructive action names the object and what will be lost**.
- [ ] No number is shown that the product has not earned; "not enough information" states name
      what is missing.
- [ ] **No literal user-facing string** — every one is a key.
- [ ] Where the hold gesture appears, the **keyboard and screen-reader path** is specified.
- [ ] `prefers-reduced-motion` behaviour is specified for any motion.

## 4. Handoff mechanics

- **The token package is the source of truth**, and it is versioned with the clients. A design
  change that does not land in `@household/tokens` has not shipped.
- **Strings land in `@household/i18n`** as typed keys; a missing key is a compile error, so copy
  is a build dependency and not a late addition.
- **Component specs live beside the components**, and every stateful component has a component
  test — the states you document are the states that get tested.
- **CI will tell you first.** Contrast pairs, axe on every route in both themes, the
  pseudolocalisation pass and the bundle-size budget all run on every pull request. Design that
  anticipates them is faster than design that reacts to them.

## 5. What would change this plan

Stated so that changing it is a decision rather than a drift, mirroring
[08-roadmap](../prd/08-roadmap.md):

- **If beta research says Calendar is the acquisition driver**, Calendar moves into DS-2 and Chat
  moves after DS-5.
- **If the crop catalog cannot be sourced**, Garden ships at `pots` and `beds` tiers only — the
  tier model makes that a supported outcome, and the `plot` screens come out of DS-3.
- **If counsel's answer on the UK Online Safety Act goes the other way**, Chat ships disabled in
  UK households and the **four-tab mobile layout** becomes a first-class deliverable rather than
  a fallback.
- **If gate G-C fails** and the sync engine is replaced with an off-the-shelf one, the sync-state
  vocabulary may need to express different guarantees. Design DS-0's sync vocabulary so it
  describes *what the member experiences*, not *what this particular engine does*.
- **If store rules make the web-only purchase flow unworkable**, [04-billing §7](../prd/04-billing-and-entitlements.md)'s
  reader fallback becomes the primary posture and **the marketing site carries more weight** — it
  stops being acquisition support and becomes the purchase surface. That grows DS-5, the one set
  [DD-12](08-decisions.md) already budgets as its own body of work, so it is the contingency with
  the largest effect on a design deliverable's size.
