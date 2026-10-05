# 0025 — The web app is a static build under a strict policy, a dev-only harness is its gate, its budget is counted on what a first visit downloads, and a build is named by a digest of its files

- **Status:** Accepted
- **Date:** 2026-10-05
- **Plan item:** 24
- **Decides for:** [06-clients](../prd/06-clients.md) §3, §4, §7, §8; [07-nonfunctional](../prd/07-nonfunctional.md) §4; design [02-components](../design/02-components.md) §0, §1, §3, §4.1, §4.2; [06-accessibility-and-i18n](../design/06-accessibility-and-i18n.md); D-29, D-36, D-153, D-154; PL-3, PL-4, PL-9

## Context

Plan item 24 builds `apps/web`: the app PL-4 names, its primitives, the twelve-state harness, and
the gates 06-clients §8 lists. The stack and the inventory were settled. These were not:

1. **What the strict policy rules out of PL-4's stack.** PRD 07 §4: *the web app sets a strict CSP
   with no `unsafe-inline`*. PL-4 names Radix primitives for behaviour. Radix's dialog, and every
   primitive it opens modally, locks the page's scroll through `react-remove-scroll`, which
   injects a `<style>` element whose text depends on the scrollbar's width; its select and its
   scroll area write a `<style>` of their own. Under `style-src 'self'` each is refused.
2. **Where the policy lives.** Nothing serves the web app yet, and the PRD says the app sets it.
3. **How a member's theme is on the page before the first paint**, when the policy admits no
   inline script and the app's own script is a module, which runs after the page is parsed.
4. **What the harness is built into.** It is a dev-only route, the end-to-end suite must run
   against it under the policy, and the policy cannot hold on Vite's development server, whose hot
   reloading injects styles.
5. **What the harness's words are.** No user-visible string is a literal (D-29), every one is in
   five catalogs (PL-9), and the dev-only pages draw more than two hundred sentences and labels of
   sample content.
6. **How the pseudo-locale pass tells a string that escaped the catalogs** on a page that also
   shows dates, money and units `Intl` wrote, which are in no catalog either.
7. **What the bundle budget counts.** 06-clients §8 says *enforced* and gives no number.
8. **What a build's id is**, and how a page learns of a newer one (06-clients §7).
9. **How a 2000 ms hold has an immediate path** for assistive technology on a touch screen, where
   a screen reader's activation reaches the page as a tap.
10. **Where component tests run**, and what they cannot hold.

## Decision

**A modal is the platform's `<dialog>`; Radix is kept where it injects nothing.** `Dialog` and
`Sheet` (the side panel) call `showModal()`: the browser makes the page behind inert, keeps the
focus in, closes on Escape and gives the focus back, and one rule of the app's own stylesheet,
`html:has(dialog:modal)`, keeps the page from scrolling under it. `Menu` is Radix's dropdown menu
opened non-modally, which takes no scroll lock; `Toast` is Radix's toast. Select is the platform's
own. Sheets and menus stand on `surface-overlay`, so `@household/tokens` declares the three pairs
they spend there and its test counts them: the strong border, the focus ring and `danger`.

**The policy is one constant (`apps/web/build/csp.ts`), written into index.html as a `<meta>` by
the build and sent as a header by whoever serves it.** `default-src 'none'`, and `'self'` for
script, style, image, font, connection and manifest; `base-uri 'none'`; `form-action 'self'`. The
header adds `frame-ancestors 'none'`, which a `<meta>` cannot carry. The build inlines no asset
(`assetsInlineLimit: 0`), since a `data:` URL is a source the policy does not name. A directive
is widened in the pull request that needs it, for the origin it needs. React writes a `style` prop
through the CSSOM, which the policy does not govern, so a width or a custom property set from a
component is not inline style.

**A classic script in the head sets the display modes before anything is painted.** The build
emits it as a file (`build/boot.ts`), generated from the app's own statement of the modes
(`src/display/modes.ts`): one key of `localStorage`, `household.display`, holding the theme, the
density, the text scale and the motion, each written as the attribute the tokens' stylesheet reads
only where it is not the default. A test runs the script against every combination, and against
what storage may hold that the app never wrote, and holds it to what the app itself sets. Light is
the default whatever the device prefers (06-clients §3); `system` is a choice.

**The harness is in every build but a deployment's.** `vite build` writes `dist/www`, and
`vite build --mode e2e` writes `dist/e2e`, the same production build with the dev-only routes in.
The routes are named behind `import.meta.env.MODE`, a constant of each build, so in `dist/www` the
branch that imports them is dead and their files are not written. The end-to-end suite runs
against `dist/e2e` served by `vite preview` with the policy as a header, and every test fails on a
`securitypolicyviolation` and on a console error. `build/check.ts` reads `dist/www` and fails a
build that is over budget, that holds anything inline or of another origin, that carries the
harness's marker, or whose `build.json` does not name the id its page names.

**The twelve states are a table, and a frame applies it.** `src/ui/states.ts` is the port of
`components.js`'s treatments: each state replaces the body, wraps it, or marks a row of it, and
says whether the affordances that write are drawn. `StateFrame` applies one to any body. The
harness is nine bodies through that frame, each state drawn in a light and a dark scope side by
side (ADR 0024 made a theme a scope for this page), with the root held at 200 % text for as long as
the page is open. `/dev/primitives` draws the components that carry no household data.

**A dev-only page's words are fixtures** (D-154): English, in `src/dev`, in no catalog. Under the
pseudo-locale they pass through the same `pseudolocalize` a catalog's message does. Everything a
shipped component says itself, a status word, *Undo*, *Show more*, is in the five catalogs.

**The pseudo-locale pass looks for plain letters.** `en-XA` replaces every ASCII letter, so a
pseudo-localised page holds no run of them: a run of four or more is a word nobody translated. The
month names `Intl` writes in English are the one exemption, computed by the test from `Intl`
itself; a unit or a currency code is shorter than a word. The pass also holds every opening bracket
to its closing one, nothing that holds text to be clipped, and no page to scroll sideways. One
test plants a literal and expects the pass to find it.

**The budget is what a first visit downloads before the app can draw** (D-153): the scripts
index.html names and preloads, 200 kB, and its stylesheets, 20 kB, gzip, and 150 kB for any one
script loaded later. Item 24's build is 173 kB and 5 kB. The fonts are fetched by script and range
and are not counted.

**A build's id is a digest of every file it wrote**, by name and content, sixteen hex digits. The
plugin writes it into index.html's `<meta name="household-build">` and into `build.json` beside
it. A page asks for `build.json` past every cache when it is looked at again and every fifteen
minutes, and when Vite reports that one of its own files is gone. A different id shows a prompt;
the page never reloads by itself, and not knowing is never a newer build. The persisted query
cache is kept under the same id, so a newer build drops what an older one kept.

**Hold-to-complete is two controls.** The ring a pointer holds is hidden from assistive
technology. Beside it is a plain button, drawn nowhere and named for what it completes, which
completes on any activation: Enter, Space, a switch, a screen reader's double tap. The ring shows
the focus the button has. The fill is timed by the tokens' `hold-to-complete`, which reduced motion
does not shorten, and steps ten times under it.

**Component tests run in jsdom, and a browser holds the rest.** jsdom lays nothing out and has no
modal dialog, so what the platform does, a dialog's focus, a menu under the keyboard, a 44 pt
target, a contained overflow, is Playwright's, measured on live rectangles. The text scale is the
root's computed font size against 16 px, so the browser's own setting counts as `data-scale` does;
the empty state's illustration is not drawn from 200 %.

**The API client is `@household/api`'s, same-origin.** It names itself in `Household-Client`, sends
the readable CSRF cookie's value with each unsafe request, and throws a problem document as an
`ApiProblemError` typed by its code. TanStack Query asks again only for what may yet succeed; its
cache is persisted to IndexedDB as one structured clone, written at most once a second, for a day.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Radix Dialog with a nonce for its injected style | A nonce is minted per response by a server. The app is static files, and a nonce in a file is a constant any injected markup can read |
| `'unsafe-inline'` for `style-src`, or a hash for the injected style | The first is what PRD 07 §4 forbids. The style's text holds the scrollbar's width, so it has no one hash |
| The policy as a header alone | Nothing serves the app yet, and the PRD has the app set it. A page that carries its policy is under it wherever it is opened |
| The display modes set by an inline script with its hash in the policy | The hash would be a second copy of the script, kept in step by hand. A file is fetched once and cached, from the page's own origin |
| No script in the head: the app sets the modes when it starts | A member who chose dark on a light device would see a light page on every load until the module had run |
| The harness in Storybook, or on the development server | A second build with its own markup and its own policy proves nothing of the app's. The development server cannot be put under the policy at all |
| The harness's words in the five catalogs | More than two hundred sentences and labels, four translations each, on the review ledger for native review before GA, for pages no member is served (D-154) |
| A list of what the pseudo-locale pass may see unbracketed | Every date, amount and unit a screen formats would be added to it. The absence of plain letters needs no list |
| A budget on the whole build, or measured in a browser per route | The first grows with every module whether or not a first visit loads it. The second needs a profile of a network to mean anything, and a file's compressed size does not |
| `size-limit` or a bundler's analyser as the gate | A dependency for sixty lines that read index.html and gzip what it names |
| The build id from the commit, or from the clock | A deploy that changed nothing would prompt every open page to reload |
| A service worker to learn of a new build | PL-4 names none, and a worker caches the very files a new build replaces |
| One control for the hold, completing on a click with no pointer before it | A screen reader on a touch screen sends a tap, which is a short press. Telling the two apart is a guess per browser |
| Vitest's browser mode for component tests | Chromium in the job that typechecks every package, to hold what the end-to-end job already holds on the built app |

## Consequences

- A route is a line of `src/app/paths.ts`: the router is built from it, and axe in both themes and
  the pseudo-locale pass walk it. A test fails a router with a route the list has not.
- A screen spends the twelve states through `StateFrame`, and its own sentences through its texts.
- Item 25 takes `Root`'s place with the shell, reads the language and the display modes from the
  member's account where it has them, clears the persisted cache when a member signs out, and
  widens the policy for the sync service. Item 27 widens it for the payment processor's frame.
- A test's markup is held to the literal-string lint as the app's is, so a test names its words in
  a constant and passes them as values.
- The bundle holds all five catalogs, the texts of emails among them, since `@household/i18n`
  imports them together. Splitting them by language is the first thing to do when the budget is
  near.
- A modal's page behind it is inert by the platform's own rule, so the Tab key reaches the
  browser's own controls after the dialog's last: the focus is then on no element of the page.
- `build.json` and index.html are the two files a deployment must not cache; every other file's
  name holds its content's hash.
