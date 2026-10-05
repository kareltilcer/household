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
`html:has(dialog:modal)`, keeps the page from scrolling under it. The root keeps a scrollbar's
room whether or not one is drawn (`scrollbar-gutter`), so where a scrollbar takes room the page
behind a modal keeps its width: what Radix's lock did by measuring the scrollbar and padding the
page in the style it injects, the platform does with none. `Menu` is Radix's dropdown menu
opened non-modally, which takes no scroll lock; `Toast` is Radix's toast. Select is the platform's
own. Sheets and menus stand on `surface-overlay`, so `@household/tokens` declares the three pairs
they spend there and its test counts them: the strong border, the focus ring and `danger`.
A modal makes everything outside itself inert, so a menu's list, which Radix draws at the end of
the page, and the toasts, which stand at the app's root, are drawn inside the modal that is open
for as long as one is (`ui/topLayer.ts`), and a toast is announced from inside it: a menu opened
from a sheet can be chosen from, and an Undo raised over one can be pressed.
What the platform and Radix leave to the app, the components do themselves. A dialog's owner
names what takes the focus as it opens (`initialFocus`), where that is not its first control: a
field's `autoFocus` cannot, since React focuses such a field as it mounts, before the dialog is
open, and writes no attribute the platform could read. A dialog is asked to close by its own
`cancel` alone, which React hands up its tree from a dialog drawn inside it and the platform lets
rise from a file input. A browser lets a page refuse Escape only so many times in a row, and then
closes the dialog whatever the page says: its owner is told, as it is when Escape asks, and one
that keeps it open, a save under way or an editor that asks before it discards, has it shown
again. A dialog drawn inside another, a confirmation inside a side panel, opens after it: the
platform stacks modals in the order they open, and React runs a child's effect before its
parent's, so two that become open together would be opened inside out. A menu hands the focus
back to its trigger before the chosen item acts, so that a confirmation the item opens gives the
focus back there, and not to an item that is gone. And Radix holds every toast's dwell while one
is pointed at, letting go only while a toast is shown, so each run of toasts, from the first shown
while none is to the last one's leaving, is its provider afresh: a toast closed under the pointer
holds nothing of the next one. Radix also hands the focus of a toast that closes to the toasts'
region, and holds every dwell while the focus is there: closed by a key, the focus stays where
Radix put it, and closed by a pointer's press it is let go, so that the toasts beside it, and one
its own Undo raised, go once the pointer has left them. One Escape does one thing. Radix closes
the newest toast for the key wherever the focus is and tells the platform nothing of it, so the
dialog the toasts are drawn in would be asked to close by the same key, and an Escape meant for
a field of the page would take an Undo with it: pressed among the toasts, which a member reaches
by their key, Escape puts the toast away and is spent there, and the toast is one closed by a
key, whatever a pointer pressed on a toast before it, so the focus stays among them; pressed
anywhere else it is not the toasts', and the toast keeps its dwell and its Undo. Under a modal
the key is the modal's, and the toast is on the page again once the modal has gone.
Pressed in a menu it is the menu's. Radix hands the key to whatever it layered last, which is a
toast raised while the menu was open, and the menu would never hear of it: the toast leaves the
key alone, and the menu closes by it and spends it, so the dialog the menu is drawn in is not
asked as well. The toasts stand over the foot of the window, on the page and inside a modal
alike, so that a pointer on a toast is on it still when the modal goes. That is where a side
panel keeps its actions, so while a toast is shown inside a panel the panel is told how much
room the toasts take and keeps its own foot above them: under a toast, a press meant for Save
would land on the toast's Undo. A
toast is read out after the one word
*Notification*; the region's name, with the key that reaches it, is the viewport's. A banner that
is announced politely is drawn before its words, which are put into it two frames later, and so
is the offline bar: what is put into a polite region already in the document is said, and a
region that arrives with its words in it need not be. The region a hold says its word in is on
the page, empty, from the first.

**The policy is one constant (`apps/web/build/csp.ts`), written into index.html as a `<meta>` by
the build and sent as a header by whoever serves it.** `default-src 'none'`, and `'self'` for
script, style, image, font, connection and manifest; `base-uri 'none'`; `form-action 'self'`. The
header adds `frame-ancestors 'none'`, which a `<meta>` cannot carry. The build inlines no asset
(`assetsInlineLimit: 0`), since a `data:` URL is a source the policy does not name. A directive
is widened in the pull request that needs it, for the origin it needs. React writes a `style` prop
through the CSSOM, which the policy does not govern, so a width or a custom property set from a
component is not inline style. The build writes the page's encoding first in its head, ahead of
the policy: a browser looks for it in a page's first 1024 bytes alone, and the policy grows with
every origin it is widened for (`build/check.ts` holds a build to it). And the app is its origin's
root: the page asks for `build.json` and for the API by their paths from the root, and the build
refuses any other base, under which the reload prompt would never show and nothing would say so.

**A classic script in the head sets the display modes before anything is painted.** The build
emits it as a file (`build/boot.ts`), generated from the app's own statement of the modes
(`src/display/modes.ts`): one key of `localStorage`, `household.display`, holding the theme, the
density, the text scale and the motion, each written as the attribute the tokens' stylesheet reads
only where it is not the default. A test runs the script against every combination, and against
what storage may hold that the app never wrote, and holds it to what the app itself sets. Light is
the default whatever the device prefers (06-clients §3); `system` is a choice.

**The harness is in a build of its own and on the development server, and in no other build.**
`vite build` writes `dist/www`, and `vite build --mode e2e` writes `dist/e2e`, the same production
build with the dev-only routes in. The routes are named only for that mode and for the development
server (`import.meta.env.MODE`, `import.meta.env.DEV`), constants of each build, so in `dist/www`,
and in a build of any other mode, the branch that imports them is dead and their files are not
written. The mode is named once, beside the routes (`src/app/paths.ts`), where the build's
configuration and its plugin read it. The router writes it out, since the bundler drops the
pages' branch only for a constant it reads in that very expression, and a test holds the two to
one word. A route marked dev-only there is served by no other build, whatever names a page for
it. The end-to-end suite runs against `dist/e2e` served by
`vite preview` with the policy as
a header, and every test fails on a `securitypolicyviolation` and on a console error. `dist/www`
is written without source maps, which would hand the app's sources to whoever asked a deployment
for them; `dist/e2e` has them. The build's own plugin refuses to write a build of any mode but
`e2e` that holds a module of `src/dev`, whatever imported it. `build/check.ts` reads `dist/www`
and fails a build that is over budget, that holds anything inline or of another origin, that
carries the harness's marker, that holds a source map, or whose `build.json` does not name the id
its page names.

**The twelve states are a table, and a frame applies it.** `src/ui/states.ts` is the port of
`components.js`'s treatments: each state replaces the body, wraps it, or marks a row of it, and
says whether the affordances that write are drawn. `StateFrame` applies one to any body, and
announces the sentence of a state it comes to while it is drawn, a load that failed, a write
refused, a row withdrawn: a failure at once, anything else politely. The state it was first drawn
in was there when the screen opened, and is read in its place. The
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
script loaded later. Item 24's build is 174 kB and 5 kB. The fonts are fetched by script and range
and are not counted.

**A build's id is a digest of every file it wrote**, by name and content, sixteen hex digits. The
plugin writes it into index.html's `<meta name="household-build">` and into `build.json` beside
it. A page asks for `build.json` past every cache when it is looked at again and every fifteen
minutes, and when Vite reports that it could not load one of its own files, which a newer build
causes and a dropped connection causes too. A different id shows a prompt; the page never reloads
by itself, and not knowing is never a newer build. A route that could not be loaded or drawn is
named in its own place, inside what every route is drawn in, so the watch and its prompt stand
over the very failure a newer build most often causes. The persisted query cache is kept under the
same id, so a newer build drops what an older one kept.

**Hold-to-complete is two controls.** The ring a pointer holds is hidden from assistive
technology. Beside it is a plain button, drawn nowhere and named for what it completes, which
completes on any activation: Enter, Space, a switch, a screen reader's double tap. The ring shows
the focus the button has. The fill is timed by the tokens' `hold-to-complete`, which reduced motion
does not shorten, and steps ten times under it. A release before the time is up says to keep
holding for as long as a toast stays, and the control is then idle again; a pointer let go in the
instant the time is up, before the control has been drawn again, has let go of a hold that is
over, and is no early release; and what completes is what its owner asks at the end of the hold,
not what it asked two seconds before. Completed, it
stays so for as long as it is drawn: a row to be completed again, after an undo or a write the
server refused, draws a control of its own for it, by a `key`.

**Component tests run in jsdom, and a browser holds the rest.** jsdom lays nothing out and has no
modal dialog, so what the platform does, a dialog's focus, a menu under the keyboard, a 44 pt
target, a contained overflow, is Playwright's, measured on live rectangles. The text scale is the
root's computed font size against 16 px, so the browser's own setting counts as `data-scale` does;
the empty state's illustration is not drawn from 200 %.

**The API client is `@household/api`'s, same-origin.** It names itself in `Household-Client`, sends
the readable CSRF cookie's value with each unsafe request, and throws a problem document as an
`ApiProblemError` typed by its code. TanStack Query asks again only for a problem the server
stated that may yet clear, its own failure or a first attempt still running: a request that got no
answer is the transport's to resend, and is resent there alone. Its cache is persisted to
IndexedDB as one structured clone, written at most once a second, for a day. A query keeps its
answer out of what is stored by saying so (`meta: { persist: false }`): a search as it is typed, a
link to a file that is good for minutes. What is stored is what was read, and no write: TanStack
by itself stores a mutation that waits for a connection, with all it was to send, a password
typed at sign-in among it, for a page that could not send it once loaded again. Such a write
waits in the page, and is sent from there when the connection is back.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Radix Dialog with a nonce for its injected style | A nonce is minted per response by a server. The app is static files, and a nonce in a file is a constant any injected markup can read |
| `'unsafe-inline'` for `style-src`, or a hash for the injected style | The first is what PRD 07 §4 forbids. The style's text holds the scrollbar's width, so it has no one hash |
| A dialog's content mounted once the dialog is open, so that a field's `autoFocus` is honoured | The platform's own first focus, the safe choice of a confirmation, would fall on the empty dialog and have to be rebuilt by hand. An owner that wants another control names it |
| A dialog the platform closed left closed, with its owner told and no more | An owner that keeps it open would hold a panel that is open by its state and drawn nowhere, what was typed still in it, and no way to open it again; one that answers by asking a question would ask it inside a panel nobody sees, over a page it makes inert |
| The toasts' dwell timed by the app, or Radix told by a made-up event that the pointer has left | The first is what Radix's toast is used for. The second steers a library by its internals, where a provider mounted afresh holds nothing by construction |
| Escape under a modal left to Radix and the platform both, or given to the toast first | The first closes the panel and takes the Undo with it. The second leaves the panel open after the key that should have closed it, and loses the Undo all the same: a toast is no layer a member opened |
| The toasts drawn at a side panel's own foot, in its flow, where they would cover nothing | A toast would move as the panel closed, out from under a pointer that holds its dwell, and Radix would hold every dwell after it. Their place is one, and the panel makes room |
| A menu's Escape left to Radix's layers alone | A toast raised while a menu is open is the last layer: the key would close the panel the menu is drawn in, with what was typed there, or put away a toast the member did not mean |
| Escape left to put the newest toast away on a page with nothing else open, as Radix has it | Whatever a screen gives the key to, a rename taken back or a search cleared, would put an Undo away with it, and the toasts would have to be told of each. The key is theirs only among them, where their own key takes a member |
| A confirmation that makes room for the toasts, as a side panel does | A panel's foot is the window's, always under the toasts. A confirmation is centred and reaches them only at 200 % text in a phone's width, or in a window no taller than a phone held sideways. Room taken by the panel's property would move every confirmation by half a toast whenever one came or went, Keep and Delete under a press; a transform would make the dialog what its fixed toasts are placed against; and one that gives way only where it reaches them is the dialog rebuilt as a ground with its card inside. The toast is plainly over the buttons, goes with its dwell, and has its own control to put it away |
| A scrollbar's room kept only while a modal is open, or measured and padded by script | The first gives a page too short to scroll the room as the modal opens, and moves it the other way. The second is Radix's lock again, written by hand |
| The mode of the dev pages given to the router as a constant the build defines | It would be told to Vite, to Vitest's own configuration and to TypeScript, three places kept in step by nothing. The literal is held to `devPagesMode` by one test, which fails before a build would, and the plugin refuses a build that kept the pages |
| The focus Radix puts on the toasts' region left there after a pointer's press | The toasts beside the one closed, and one its own Undo raised, would stay until the member pressed somewhere else. The region gives up a focus of its own, which is no event made up for Radix: the browser tells it the focus has left |
| The table's column of sync marks timed by the table | A second clock to keep in step with each mark's own. A rule of the stylesheet draws the column while a mark is drawn in it, and has nothing to keep in step |
| The policy as a header alone | Nothing serves the app yet, and the PRD has the app set it. A page that carries its policy is under it wherever it is opened |
| The display modes set by an inline script with its hash in the policy | The hash would be a second copy of the script, kept in step by hand. A file is fetched once and cached, from the page's own origin |
| No script in the head: the app sets the modes when it starts | A member who chose dark on a light device would see a light page on every load until the module had run |
| The harness in Storybook, or on the development server | A second build with its own markup and its own policy proves nothing of the app's. The development server cannot be put under the policy at all |
| The harness's words in the five catalogs | More than two hundred sentences and labels, four translations each, on the review ledger for native review before GA, for pages no member is served (D-154) |
| A list of what the pseudo-locale pass may see unbracketed | Every date, amount and unit a screen formats would be added to it. The absence of plain letters needs no list |
| A budget on the whole build, or measured in a browser per route | The first grows with every module whether or not a first visit loads it. The second needs a profile of a network to mean anything, and a file's compressed size does not |
| `size-limit` or a bundler's analyser as the gate | A dependency for sixty lines that read index.html and gzip what it names |
| The build id from the commit, or from the clock | A deploy that changed nothing would prompt every open page to reload |
| The reload prompt drawn outside the router, where no failed route can take it down | The shell item 25 puts in `Root`'s place would still go with any screen that failed. A boundary under `Root` keeps both |
| `build.json` asked for under Vite's `base` | The router and the API's paths are from the root too. A base the app cannot be served under is refused, not half supported |
| Hold-to-complete told by a prop what is complete | A control with two sources of what is so, designed before the first screen that has a completion to undo. Its owner's `key` gives a fresh one, and that screen says whether it is enough |
| A service worker to learn of a new build | PL-4 names none, and a worker caches the very files a new build replaces |
| A file the page cannot load taken for a newer build | A page with no connection cannot load one either, and would be told to reload into nothing |
| Source maps in the build a deployment serves | Whoever serves `dist/www` serves every file in it. Maps for crash reports are uploaded to where the reports go, which is item 89's |
| TanStack's async-storage persister for the cache | Its throttled write cannot be dropped, so a cache removed at sign-out would be written back by the write that was waiting, and its restore rejects in a browser that refuses storage |
| A write that waits for a connection kept in the stored cache, to be sent by the next page | It is stored with what it was to send, in the clear, and the page that loads it has no function to send it with: it fails there without a word. A write that must outlive its page is the replica's (item 25) |
| A time limit on reading the stored cache | No browser the PRD names leaves an open of IndexedDB unanswered: the hang on record is WebKit's of 2021, in Safari 14.1, and the store is opened with no version, which no other tab can block. A refusal rejects, and is answered with nothing. A clock would drop a good cache on a slow disk |
| The stored cache written as the page is hidden | What the throttle can lose is a second's reads, each fetched again on the next visit, from a cache that is a convenience (06-clients: a browser is not the offline-first surface), and TanStack's own persister throttles the same way. A write begun as a tab closes is one the browser need not finish, so a listener would hold only for a tab put aside within that second and then discarded |
| A formatter that shows what it cannot format as it was given, or an instant in another zone | What it refuses is what the contract rules out, a day no calendar has, a decimal with an exponent, an instant that is no RFC 3339, and the server's own tests hold every response to the contract. A zone this browser does not know has no right answer: another zone's time would be shown as the household's. The boundary under `Root` names a screen that cannot be drawn, and a screen whose rows are worth saving one by one draws a boundary of its own, as the dashboard's widgets must (02-components §4.8) |
| A label's weight spent as a type step's weight token | The scale's weights are each a step's, and a button's label, a banner's title or a member's initials is none of those steps: it is body set at 500 or 600, as the prototype sets it. Named by a title's token it would change with a title it has nothing to do with. A weight of its own in the scale is design's to add (01-foundations §1) |
| One control for the hold, completing on a click with no pointer before it | A screen reader on a touch screen sends a tap, which is a short press. Telling the two apart is a guess per browser |
| Vitest's browser mode for component tests | Chromium in the job that typechecks every package, to hold what the end-to-end job already holds on the built app |

## Consequences

- A route is a line of `src/app/paths.ts`: the router is built from it, and axe in both themes and
  the pseudo-locale pass walk it. A test fails a router with a route the list has not.
- What a component draws over a page, a dialog, a side panel, a menu, a toast, a banner that
  arrives, is on no route as it opens: `e2e/overlays.spec.ts` opens each from the page of
  primitives and holds it to the same two gates. A new one is opened there.
- A screen is a child of the boundary `inRoot` puts under `Root` (`src/app/routes.tsx`): one that
  fails to load or to draw is named in its place, and the shell around it stays.
- A screen spends the twelve states through `StateFrame`, and its own sentences through its texts:
  the two that stand in a body's place, an error's and a withdrawn row's, are required of it, so a
  failed load is never a blank screen.
- Item 25 takes `Root`'s place with the shell, reads the language and the display modes from the
  member's account where it has them, clears the persisted cache when a member signs out, and
  widens the policy for the sync service. Item 27 widens it for the payment processor's frame.
- Hold-to-complete knows what it did, and not what became of it. The first screen with a
  completion to undo, Tasks' or Chores', says whether a fresh control by `key` is enough, or the
  control takes its owner's word for what is complete.
- A button that is busy or has nothing to do hands on no handler of a press: neither the click nor
  what comes before it, the pointer going down and the key, which is what a menu opens on.
- A stepper in a form is settled by Enter as it is by being left, so the form sends the number
  the field shows. A number typed over a bound is held to it, and not refused with an error. Its
  step is how far a button moves it, and no grid the platform holds a typed number to: any whole
  number within the bounds is a value of it.
- A list is one by its role as well as by its element: every list is drawn without markers, and
  WebKit takes such a list for layout and tells assistive technology of none.
- The root keeps a scrollbar's room at the window's edge on every page, where a scrollbar takes
  room at all. A side panel is docked to the page's edge, beside that room.
- A test's markup is held to the literal-string lint as the app's is, so a test names its words in
  a constant and passes them as values.
- A row whose owner knows when its write began to sync says so (`syncingSince`, a mark's `since`):
  the moment a sync is given before it is shown is counted from then, and without it from when the
  row was drawn, which a row drawn again in the middle of a long sync waits out a second time.
- A sync mark is a control only for a conflict and a rejection, which have something to open,
  whatever a list or a table hands it: the rule is the mark's own.
- An icon-only control a primitive draws itself is in the register beside the design's twenty
  (`@household/icons`' `controls`): what puts a banner or a toast away, and a stepper's two
  buttons.
- A time series stands on its axis: a point at or under zero has no column, and is said in its
  words, as a segment that is none of a composition has no part of its bar. A series that goes
  under zero, Finance's burn-down when a budget is overspent, is its own screen's to draw.
- A calendar day is shown as it is written or not at all: a day no calendar has, the
  thirty-first of February, is refused as a malformed one is, and a year is read as written.
- A table scrolls in its own box at any width, a marked row's too: the box is what a word drawn
  nowhere inside it is placed against.
- `Household-Client` names the web app by its package's version, `0.0.0` until a release raises
  it, so the server's web minimum cannot yet tell one build from another: set above the version
  the newest build names, it refuses every web client. How a release numbers a build is not
  settled here, and until it is `HOUSEHOLD_MIN_WEB_VERSION` stays unset
  ([runbook](../runbooks/sign-in-keys-and-providers.md)).
- The bundle holds all five catalogs, the texts of emails among them, since `@household/i18n`
  imports them together. Splitting them by language is the first thing to do when the budget is
  near.
- A modal's page behind it is inert by the platform's own rule, so the Tab key reaches the
  browser's own controls after the dialog's last: the focus is then on no element of the page.
- `build.json` and index.html are the two files a deployment must not cache; every other file's
  name holds its content's hash.
