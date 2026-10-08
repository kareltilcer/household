# 0026 — The web shell learns its session from the answers it gets, a household's replica is one tab's and is opened as the session, the policy admits WebAssembly and one more origin, and the app holds one language at a time

- **Status:** Accepted
- **Date:** 2026-10-08
- **Plan item:** 25
- **Decides for:** [02-identity](../prd/02-identity-and-access.md) §2, §9; [06-clients](../prd/06-clients.md) §2, §4–§8; [07-nonfunctional](../prd/07-nonfunctional.md) §4; design [04-navigation](../design/04-navigation.md), [03-patterns](../design/03-patterns.md) §1, §2, §8; D-38, D-105, D-153, D-155 to D-166; PL-4; the consequences of [ADR 0009](0009-accounts-sessions-throttles-and-the-breach-corpus.md), [ADR 0010](0010-mobile-tokens-second-step-providers-and-client-versions.md), [ADR 0019](0019-the-sync-client-library.md) and [ADR 0025](0025-the-web-foundation-policy-harness-budget-and-build-id.md) for item 25

## Context

Item 25 puts the shell in `Root`'s place and builds the first screens a member meets: signing in,
their account, and what the sync engine asks of them. Items 8, 9, 18 and 24 each left the web
client a hand-over, and these questions came with them:

1. **How a static page knows who is signed in**, when its session is a cookie no script can read,
   and what each of the three answers that are about the session and not about a screen does:
   `401 unauthenticated`, `403 csrf_failed`, `400 update_required`.
2. **What a web build is numbered by.** `Household-Client` named every build `web/0.0.0`, so a
   deployment's web minimum could not tell one build from another (ADR 0025).
3. **How the replica reaches the API.** `@household/sync` sends `Authorization: Bearer` with a
   device's token on every request, and a request that carries a bearer is authenticated by it
   alone (ADR 0019).
4. **How one tab keeps a household's replica open**, where every tab opens the household's one
   database and each replica runs a connector of its own.
5. **What the policy must admit.** PowerSync's web SDK runs SQLite compiled to WebAssembly in
   workers, and connects to the sync service, another origin.
6. **Where Apple's answer lands.** Apple answers a web sign-in with a form its own page posts to
   the redirect URI, and the web client is static files (ADR 0010).
7. **Which providers a sign-in screen offers**, when no operation says which the server is
   configured for and a provider it is not answers `404`.
8. **How a browser is pushed to.** Web Push delivers to a service worker, and ADR 0025 refused
   one for learning of a newer build.
9. **How the first download stays in its budget.** Item 24's entry was 174 kB of 200 with 193
   messages in five languages; this item adds some hundreds.
10. **What the sidebar lists**, when the household's answer grants every module the contract
    names and no module has a web screen yet, and where a member's own order of it is kept, which
    the contract and the server keep nowhere.
11. **What the end-to-end suite runs against.** Its Done-when is register → verify → sign in →
    MFA, which needs the server, its mail and its limits.

## Decision

**The session is learned by asking, and only where a session can exist.** The server sets the
session's cookie and the readable cookie that carries its CSRF token together and takes them
away together, so a browser without the second holds no session and is not asked whose it is: a
visitor's page asks the server nothing it would refuse. Otherwise the app asks `GET /me`, kept in
the persisted cache so that a member with no connection is still a member, and asks again each
time the page is looked at again, however lately it read: that is when a session ended from
elsewhere is noticed, and an address proven in the tab its email's link opened. Asked with the
browser offline and nothing kept, the question waits for a connection, neither answered nor
failed: the page says the server could not be asked, with the way to ask again, and draws no
skeleton for it. Every problem a query or a mutation meets is told to one hub
(`api/problems.ts`), and so is one the replica's own requests meet; the session answers three
of them (D-156, D-158). A `401` on a member's session means it ended and has nothing to renew:
what the browser kept of their households, the persisted cache and every replica's database, is
removed, and the address they were at is held for the sign-in that follows. A `403 csrf_failed`
signs them in again and removes nothing. A `400 update_required` draws one screen in every
route's place, whose action reloads the page. Signing out ends the session at the server first,
and removes the same only once it has: unreached, the member is still signed in and is told so,
and a session the server ended already is signed out.

**What a browser keeps is its member's, and for no longer than their session** (D-161). The
account it keeps is kept for a day and for one build, and the session's cookies lapse with the
session; a replica outlives both, and is one database for each household, opened by whoever is
signed in. So the removal does not wait on a page that knew the member. A `401` to `GET /me`
ends the session of a page that had read no account, which is not asked again; a browser with
no session that still notes a replica (`sync/databases.ts`) removes what it kept as it starts;
and a page that finds another member signed in under it, from another tab or where a failed
CSRF check left the first one's page as it was, removes what it kept and starts again by a
reload. A household the server answers `404` for opens nothing whatever the browser kept of
it, and the list it kept, which may be what led there, is read again. Where the app opens
passes over a household that list names as suspended, whose address answers `404` too
(D-115), for one that opens (D-162). And the screen that deletes an account reads nothing of a
suspended household, whose members answer `404` as the rest of it does: of one its member owns it
says what the list of households says, offers the box that deletes it with the account, and
leaves where they stand in it to the server (D-163).

**A build is `web/<version>+<build id>`** (D-158). The version is `apps/web/package.json`'s,
raised by the pull request after which a deployment must refuse older builds, and by no other;
the digest follows as SemVer's build metadata, which the server reads past. This item raises the
version to `0.1.0`.

**The replica is given a `fetch` that carries the session with the bearer left out**
(`sync/sessionFetch.ts`): it removes `Authorization`, names the client, sends the browser's own
cookies, and the CSRF token with an unsafe request, as the app's own client does. The credential
it is given sends nothing; its renewal, which a `401` asks for, asks whether the session still
stands, and where it does not tells the app, as any other request would, and tells the replica
its sign-in has ended, at which it discards itself (FR-ID7). Any other answer leaves the replica
to ask again.

**One tab holds a household's replica, by a Web Lock named for the household**
(`sync/ReplicaProvider.tsx`). The tab that takes the lock opens the replica and connects it;
another waits, says where the sync UI would be that another tab keeps this household, and takes
over when the first lets go. The replica is closed, and the lock with it, when the household
leaves the screen. Nothing of the sync library or its SDK is in a page until a replica is first
opened: every other file imports the library for its types alone, and what a screen needs of it
at run time is handed over with the open replica (`sync/open.ts`). With the replica comes
whether it is receiving the household's changes, which the bar above a household's screens says
where it is not (D-105): not, once an attempt of the replica's has failed, for as long as the
SDK keeps that failure, which is until an attempt succeeds; and nothing to say before then.

**The policy is widened by three sources and nothing else.** `script-src` gains
`'wasm-unsafe-eval'`, which lets a page compile WebAssembly and evaluates no string as script;
the SDK's workers are files of the page's own origin and need no source of their own.
`connect-src` gains the sync service's origin and its WebSocket twin, which a build is told by
`HOUSEHOLD_WEB_SYNC_ORIGIN`. `img-src` gains the object store's origin, told by
`HOUSEHOLD_WEB_FILES_ORIGIN`: a member's picture is a link the API pre-signs there (D-9), which
`'self'` alone refused, and the profile is the first screen to draw one. Unset, a service is
behind the page's own origin and nothing is added. Anything that is not one origin is refused as
the build starts.

**Apple's form is received by the API and sent on in a fragment.** The web client's redirect URI
for Apple is `POST /auth/oauth/apple/return`, which reads the form and answers `303` to the web
client's `sign-in/apple` with the code, the state and the name Apple gives once in the fragment,
which reaches no server. It signs nobody in and keeps nothing: the code is spent only with the
PKCE verifier, which never leaves the browser that began the sign-in. Apple's page posts the
form, so Apple's origin is admitted to that route and to no other (`session.Origins.Admitting`).
**`GET /auth/oauth` names the providers the server is configured for**, and a sign-in screen
draws those and no other.

**What a sign-in keeps between its screens is in the page's memory, and what a link carried
leaves the address.** A challenged sign-in's token (`auth/challenge.ts`) is held in a variable
and in no storage: a reload loses it and the member signs in again, which costs them a password
and keeps a token that stands for one out of what any script of the origin reads. A token an
email's link carried is read from the fragment and then taken out of the address by the router's
own replace (`auth/fragment.ts`), so that it is in no history entry and no copied address. The
screens say what the server does where the prototype says otherwise: twelve characters, a
password checked at the server against its own copy of the breach list, limits by address and
network, each link's own lifetime, and a deletion only its link cancels.

**A write of these screens, and of a member's own account, is asked at once** (D-164). Left to
itself the query client holds a write made with no connection in the page and sends it when one
returns (ADR 0025), which is what a household's queued write wants and no sign-in does. Asked at
once (`api/query.ts`, `askedNow`) it fails at once, and its screen says that the server could not
be reached and that nothing was changed. A provider's control stays busy once its start is
answered, the page being on its way to the provider's, and is put back where the browser shows
that page again as it kept it, for its Back button (`auth/provider.ts`).

**The service worker shows a Web Push and does nothing else.** The build writes it as one file
at the origin's root (`build/pushWorker.ts`), part of the build's id: it handles `push` and
`notificationclick`, has no `fetch` handler and keeps no cache, so it serves no file of any
build. A press on a notification hands its address to a page that is open, which goes there by
its own router, or opens one. Permission is asked by a member's press on the screen that shows
the permission and the preferences together, and never on load; a browser whose permission was
already given registers its subscription again for the member who is there, at a sign-in and
when the app starts with them signed in (`push/Push.tsx`), asking nothing; a sign-out removes it
first, while the session can still tell the server.

**The app holds one language at a time** (D-159). `@household/i18n/lazy` is the package's entry
with no catalog in it; the app fetches the catalog of the language it starts in before it draws
a word, and one chosen later when it is chosen. Where the first cannot be fetched the page is
loaded again when the connection is back, and where a later one cannot its control says to
reload: a browser may answer a second import of a file with the first one's failure.
`build/check.ts` counts the largest catalog with the scripts a first visit downloads. Every
screen is a file fetched when its address is opened. Split, the entry was 139 kB where it had
been 177 kB with a third of these words; with every screen of this item the first download is
180 kB of the 200, 19 of them the largest catalog.

**The sidebar is derived, and lists what this build can open** (D-160). `shell/navigation.ts` is
the port of the prototype's `navFor`: the modules the household's answer gives the member a level
above `none` on, of those the build has screens for (`modules/registry.ts`), in the member's own
order. The order, the pins and what the member put away are kept in the browser, for each member
and household (D-155). The dev page `/dev/shell` draws the list from a registry of its own.

**A page is titled for the screen it shows** (D-165). The document's title is the screen's one
heading and then the app's name, in the member's language (`app/title.ts`): *Sign in · Household*.
A screen says its name where it draws that heading, and the name goes with the screen, so
between two screens, and while one has no name yet, the page is called by the app's name alone,
as `index.html` calls it. Nothing above the screens sets a title: an effect of `Root`'s runs
after its screens' own, and would stand over theirs. axe holds only that a page has a title, so
the suite's walk of the routes holds each route's title to its heading.

**What a press came to is said to whoever cannot see it** (D-166). A form that is refused puts
the focus on the first field the refusal marked, whose sentence is then read with the field, on
the account's screens as on the screens before sign-in (`useRefusedField`, `auth/fields.tsx`). A
refusal that marks no field is a banner, announced where it is drawn: so is one of a control
that is put back and holds the focus already, a language, a timezone or a first day the server
would not take, and the one sentence about two fields together, quiet hours that are one time
twice; and so is the browser's own refusal of the question a press put, notifications it
blocks, where one it had given before the screen opened is read in its place. A limit on
sending a link again is a wait and no refusal, drawn as the countdown on its control
(`auth/Resend.tsx`): it is said once as it arrives, politely and in the control's own words, and
no second of the countdown after it. What a screen is drawn from that could not be read is
announced as it arrives, as a body's failure is (`Unread`, `app/guards.tsx`), and so is a part
of one with the way to ask again, the providers an account's screen could not read: nothing of
it is drawn while it is asked again, so a second failure is drawn, and said, anew. And the row a
confirmation was opened from, gone once the browser or device it names is signed out, leaves the
focus to the lists' own place, as the inbox's does; a picture's removal, which nothing else
says, leaves it on the control that chooses another. axe reads only that a field and its
sentence are tied, so each screen's own test holds where the focus is and what is announced.

**The end-to-end suite starts the API itself, on the development services, and each test is a
network of its own.** The preview server proxies `/api` to it, so a page is same-origin with the
API as a deployment's is; `__Host-` cookies are set on `http://127.0.0.1`, which a browser takes
for a secure context. The server's limits count by a client's network, so the suite's API trusts
the preview server's `X-Forwarded-For`, and each test names an address of its own on its requests
to the API alone. A refusal the contract names, a `4xx` from `/api/v1`, is no fault of a page;
every other console error still fails its test.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Asking `GET /me` on every load, whoever is there | A visitor's every page would ask for what the server refuses, and a browser logs each refusal as an error. The CSRF cookie is set and cleared with the session's, so its absence is the answer |
| The replica kept when a session ends, for the member's return | A session ended from elsewhere is how a lost browser is dealt with (D-156) |
| What a session left removed only by a page that had read its account | The kept account lasts a day and one build, and the cookies lapse with the session: the lost browser D-156 is for is opened later than either, and the replica it left would be the next member's to open (D-161) |
| A replica and a cache named for the member as well as the household | Every member's copy would stay in a shared browser until they came back to sign out of it, which is the replica kept for a return. One database a household, removed with its session, has nothing to tell apart |
| The first member's page kept where another is found signed in, its reads asked again | What its screens hold in memory is the first one's, and a read that now fails keeps what it last had. A page that starts again holds nothing of them, and the open replica is closed by the page that goes |
| The app opened at the household last open, though the list names it suspended | Its address answers `404` (D-115), and the screen that says so leads back to where the app opens: a member with another household could not reach it. The app opens at one that opens, and at the suspended one, where item 27 draws its lockout, only for a member in no other (D-162) |
| A suspended household's members read by the screen that deletes an account, which waits on them, or the household said to be left as one the member does not own is | The read never comes (D-115): its owner was told their households could not be read and to check their connection, and could not ask for a deletion the server would have taken. Said to be left, its only owner would be refused for a box the screen never drew. The screen says it cannot read it, and offers the box (D-163) |
| The box of a suspended household drawn only once the server's refusal has named it as its member's alone | The refusal would be kept as a second word on where a member stands, beside what the page reads again after every refusal, and put away when it no longer holds. Its owner knows whether they own it alone, and a box ticked or left wrongly is answered by the server either way |
| A household's replica removed as the server answers `404` for it | What a browser keeps is bounded by its session (D-161), as a device that never reconnects keeps its copy (FR-SY8): nothing opens that replica again or draws from it, and it goes with the sign-out or the session's end. A second removal, by household, would be one more to keep in step with the first, for a copy its former member could read until the membership ended |
| The replicas left where another member is found signed in from another tab, and removed only after a failed CSRF check | A page cannot tell the two apart: either way the account under it is another's. Where the second member's own tab has opened a replica since, what goes with it is a copy read again when the household is next opened, and nothing queued: no module writes offline, and the first that does settles what a removal owes a replica that has queued something (Consequences) |
| A household drawn from what the browser kept while the server answers `404` for it | A kept read stands in for a server that cannot be asked, not for one that answered: a member taken out of a household would be drawn its shell for as long as the cache lasts (F-17) |
| Where the app opens waiting on the list of households being read again, every time | A round trip before every opening, and seconds of it on a connection that fails, to cover a list that named a household since left: that list is dropped by the `404` that found it out |
| A `fetch` that turns the library's bearer into a cookie on the server's side, or a web-session token minted for the replica | The first is the server reading a credential it was not sent. The second is a second credential for a browser that has one, with its own lifetime and revocation to keep in step |
| A replica's removal waited on, or taken back where its member signs in again before the tab that holds it has let go | The removal is asked for and not waited on, since a tab that never closes its replica would hold up the sign-in that follows, and a browser gives a page no way to take a removal back once it is asked. One that another tab blocks is carried out when that tab closes its replica, whoever is signed in by then: where that is the same member, signed in again in another tab before this one was looked at, what goes is a copy read again when the household is next opened, and nothing queued. What a removal owes a replica that has queued something is the first module written offline's to settle (Consequences) |
| The replica closed by the page that finds another member signed in, before it asks for the removal and loads itself again | The removal is carried out once the page's own connection has closed, which is as the page goes. Chromium keeps a removal whose page has gone (tried in review round 6), and the suite runs no other engine, so nothing here holds Firefox or Safari to it. Closing first is a second way to close a replica, beside the household leaving the screen, to keep in step with it, for a copy only another member of the same household would open on the same browser, which PowerSync holds to what is theirs at its first checkpoint and no screen reads yet. It is settled with what a removal owes a queue (Consequences) |
| The household's lock told apart as this tab's own, where a replica left a moment ago is still closing | A page cannot ask the browser whether a lock is its own: a household left and opened again within the moment its replica takes to close reads its own lock as another tab's, and says so until the lock is its own again, which is that moment. Telling them apart is a list of the locks this page holds, kept in step with the browser's, for a sentence that is gone before it is read |
| PowerSync's shared worker (`multiTab`) in place of the lock | It shares the connection, not the connector: two tabs would still each push the queue (ADR 0019) |
| A `BroadcastChannel` election of the tab that holds the replica | A lock the browser releases when a tab dies, with no heartbeat to time out |
| Whether a replica is receiving read off the SDK's `connecting` and `hasSynced`, as item 25 first had it | A replica opened again has synced before and has not tried yet, so every household opened a second time was said, and announced, not to be receiving until its connection was made. And `connecting` is true for the length of every attempt, so with the sync service gone the bar was taken away and said anew at each, every five seconds. The failure of the last attempt, which the SDK keeps until one succeeds, is neither |
| The sentence that a household is not receiving held back, after the browser was offline, until an attempt made with the connection back has failed; or the replica told to connect as the browser comes back | The failure the replica met with no connection is the SDK's last word until an attempt succeeds, and the SDK tries again on its own five seconds, not when the browser comes back: for those seconds the household is not receiving, and the bar says so where it said that the browser was offline. Holding it back is telling an attempt made before the connection returned from one made after, a clock kept beside the SDK's, as reading `connecting` was. A page that told the replica to connect would be a second caller of a connection the replica keeps trying by itself |
| `'unsafe-eval'`, or the SDK built without WebAssembly | The first is what PRD 07 §4 forbids. There is no SQLite for the browser that is not WebAssembly |
| The sync service's origin as a wildcard, or `connect-src *` | A policy is widened for one origin. A page that could connect anywhere could send what it reads anywhere |
| The sync origin read at run time from the API's answer | The policy is in the page before any script runs: a script cannot widen it |
| A picture fetched by the app and drawn from a `blob:`, or served through the API, to keep `img-src 'self'` | The first admits `blob:` to `img-src`, a wider source than one origin, and fetching needs the store in `connect-src` besides. The second puts every picture's bytes through the API, which D-9's pre-signed links exist to avoid |
| Apple's JS in popup mode | A third party's script under a policy whose rule is that every script is the page's own origin's, and the providers a build offers would become a build's setting |
| The whole policy relaxed for Apple's form, or the return route outside the origin check | The origin check is what stops another site's page posting as a member. One origin is admitted to one route that reads no session |
| The providers a build offers as a build-time setting | A deployment that configures a provider would rebuild its web client to show it, and the two would disagree in between |
| A service worker that also caches the app, for offline | PL-4 names none, and it would serve the files a newer build replaces (ADR 0025). The web reads from its persisted cache |
| Notification permission asked at sign-in | 06-clients §6: asked in context, never on first launch |
| The browser's subscription removed after the sign-out, or put back where the sign-out failed | It goes first so that a session that still stands tells the server, and after it there is none to tell with. Put back, it needs the server the sign-out could not reach. A member whose sign-out failed was leaving, and the app registers the browser again when it next starts with them signed in (`push/Push.tsx`) |
| What that removal was refused with told to the problem hub, as the renewal's is and as a request outside a query otherwise owes | The sign-out follows it at once and is told its own refusal. Told of the removal's first, a session the server had ended already would be drawn as one that expired under its member, the address they pressed *Sign out* at held for whoever signs in next, where the sign-out reads the same `401` as the sign-out done |
| A write of the screens before sign-in left to the query client's own rule, held in the page until a connection returns, as item 25 first had it | Pressed with the browser offline, a sign-in showed a busy control and no word, and was completed whenever the connection came back, with nobody at the screen and whatever screen it had been left for since; a reset's password was set, and every device signed out, minutes after its press. It is asked at once and fails at once, as the account's own writes are (D-164) |
| Asking at once made the query client's rule for every write | A household's write made with no connection is queued on the web (06-clients), and waits in the page until a replica keeps it (ADR 0025). Which of a module's writes wait is its screens' to say: a sign-in's and an account's are no household's |
| A provider's control busy only while its start is asked, and idle again once it is answered | The page is on its way to the provider's for as long as that page takes to answer, and a control idle meanwhile takes a second press, which begins a second flow. It stays busy, and a page the browser kept and shows again, back from the provider's, puts its start back |
| The file of recovery codes let go of in the press that hands it over, or by a timer after it | A browser may begin reading the file only once the press has returned, and how long after is its own affair. It is let go of with the screen that showed the codes |
| The answer to an earlier save of a language kept from the account, once a later one is chosen | Two languages chosen within one round trip show the first again for as long as the second's save takes, and end in the second, on the page and in the account. Keeping the first answer from the account is a second word on which answer counts, with the second's failure to put right beside it, where the server holds the first and the page was never told. A flicker that ends where it should is less than that |
| A catalog that failed to load imported again when the connection is back | Chromium keeps an import that failed and answers the next one of the same file with that failure, asking the network nothing: the page stayed blank until it was reloaded by hand. The page is loaded again, which asks for every file of its own anew, and a language chosen later says to reload |
| The catalogs fetched as data, which can be asked for again, and not imported | A second way to load and to name a build's files, and to count them in the budget, for a failure that loading the page again answers |
| English in the entry as a fallback for a catalog that fails to load | Counted on every visit of members who do not read it (D-159) |
| One title, the app's name, for every route, as item 25 first had it | A tab, a history entry and a screen reader's list of windows name a page by its title: with one for all, three tabs of the app read alike, and going from a profile to signing in changes nothing a title says. It is level A of the gate 06-clients §4 sets (WCAG 2.1, 2.4.2), and axe passes any title at all (D-165) |
| A table of titles beside `paths.ts`, or the title read off the page's `<h1>` by an observer | The first is a second name for each screen, kept in step with its heading by hand, with no word for a screen that changes what it says as it opens, a link's page or a provider's return. The second watches the document for what the screen that draws the heading already holds as a value. The screen says it, once, where it draws it |
| A refusal's sentence beside its field and tied to it, with nothing moved and nothing announced, as item 25 first had the account's screens | A sentence added beside a field the focus is not on is said to nobody who cannot see it: pressed with a wrong password, *Change password* told a screen reader's user nothing, where a save says so in a toast. It is level AA of the gate 06-clients §4 sets (WCAG 2.1, 4.1.3), and axe reads only that the two are tied. The focus moves to the field, as on the screens before sign-in (D-166) |
| Every field's sentence announced as an alert, in `ui/Field` | Said twice where the focus moves to the field, which reads the sentence with it, and as urgently as the server's own failure. A field's fault is read with the field, and a banner is for what is no field's |
| The switcher's line that a member's other households could not be read announced as a failure is | It answers no press and offers none: the household that is open is as it was, and the line is read in its place in the navigation, under the household's name and the member's role in it. An alert would say it to every member whose list could not be read, most of whom are in one household, and say it again each time the navigation's panel is opened at a phone's width and each time the list is asked for again |
| The wait kept out of a resend's own words while it counts down, for a screen reader that says a focused control's name as it changes | The countdown on the control is the design's (auth.js A-3), and the one place the wait is drawn. A screen reader that says a focused control's name as it changes would say each second of it; whether one does was not heard, the suite running no assistive technology, and it is for the release's passes with VoiceOver and TalkBack to hear (design 06-accessibility-and-i18n §1). Held still, the control's name would say nothing of the wait to whoever comes to it later, and the seconds drawn in a second place are one more to keep in step with the first. What a press came to is said besides, once: a limit's wait, in the control's words as its answer arrived |
| A `429` to a resend said as every other limit is, in a banner announced as an alert | A wait is no refusal (auth.js A-3): the address may ask again when its minute is over, and the control says when. An alert would say it as urgently as a failure, and draw a second sentence beside the control that counts the same wait down. It is said once, politely, by a region that draws nothing |
| What could not be read drawn anew at each press of *Try again* while the browser is offline | With no connection the query client holds the question and asks nothing, so the press comes to nothing new: the sentence that says the server could not be asked, and to check the connection, still holds, and the question is asked by itself when the connection is back, its answer drawn, and said, in the sentence's place. A count of presses to draw the alert again by is a second word on when it is drawn, for a press that changed nothing |
| The focus put by hand wherever the control that held it leaves with what it did: a second step turned off, a provider disconnected, a stage of the second step's setup that takes the last one's place, a deletion's form the server's refusal replaced | Each of these is said: by a toast, by the refusal's own banner, or by the screen that takes the place of the one before, whose title and heading name it. A list is different, which goes on under the focus and whose next row is what its member was reading (D-166), and so is a picture's removal, which nothing else says. A ref and an effect for each control that goes with what it did are one more thing apiece to keep in step with what the screen draws, and a control kept in its place to hold the focus would turn under it from disconnecting a provider to connecting one, where a second press begins a link |
| What pinning, putting away and showing a module came to said by the arrange screen in this item, the focus following the row to its new list, and the same of a merge's banner put away in the inbox | No member reaches either with anything in it: no module has a web screen until item 26 registers the first (D-160), and the inbox is empty until a module's entities are written offline. Each wants sentences of its own in five languages and a place for the focus, for screens held today by their tests and the dev pages alone. They are handed on with the screens (Consequences) |
| The stated switch held back where a household was reached by the browser's Back or Forward, from one the member chose in the switcher | A page is not told a history move from a link followed: the router's word for the first page a tab loads is the same, and the entry gone back to carries the state it was made with, which says nothing of the choice that left it. Telling them apart is a mark written into each household's history entry as it opens, a second navigation at every opening, for a sentence that is true of the tab, whose household did change with its address, that one press puts away and whose control leads back |
| What a browser kept removed without emptying the query cache under a screen that is drawn, or a visitor's screen drawn again once it is removed | Emptying the cache tells no screen (`queries.clear()`): a sign-in screen drawn before a kept account was read from storage and found without a session has its question of which providers the server signs in with cancelled, and draws none until it is drawn again, which the next key typed does. A browser comes to it only by its cookies being cleared alone, since their thirty idle days outlast the day the cache is kept, and only where the screen's file arrives before the cache is read. Resetting the queries in place asks each again at once, the account's among them, of a session that has just ended, which a sign-out would then read as a session that expired; a second way to empty the cache is one more to keep in step with the first |
| Every granted module listed, with a screen that says it is not built | A link to nothing (D-160) |
| The arrangement in a synced entity now | A server item's work inside this one (D-155) |
| The suite against a stand-in API, or with requests answered by the test | The Done-when is the flow through the server: its mail, its throttles, its cookies. A stand-in would be a second server kept in step by hand |
| One network for the whole suite, with the server's limits raised for it | A configuration no deployment runs, to pass tests of the one that does |

## Consequences

- A screen's requests go through TanStack Query, their answers through `unwrap`: that is how
  the session hears of the three answers. A request made outside it tells the hub itself, as
  the renewal of a browser's push does (`push/worker.ts`); the one that does not is the removal
  a sign-out follows, whose own refusal is told (above).
- A screen that reads the account again names its key whole (`meKey`, `exact`). Where an
  account is signed in and what it is notified of are filed under that key, and a refetch by the
  key's beginning would ask for those too, of a page that kept them from an earlier visit and has
  no screen to ask with: each would be left as failed.
- A screen that draws the page's `<h1>` says the same words to `usePageTitle` (`app/title.ts`),
  where it draws them; `Screen` and `SettingsPage` do for the screens they frame. The walk of the
  routes fails a route whose title does not name its heading (D-165).
- A form gives its `<form>` the ref `useRefusedField` answers (`auth/fields.tsx`), with what it
  was last refused with, a new value for each refusal: the screens before sign-in through
  `Form`. A refusal that is no field's, and one of a control that saves as it is changed, is a
  `Banner` with `announce`, as is a part of a screen that could not be read and offers to be
  asked again, where it is not a `StateFrame`'s; and a screen that removes the row a dialog was
  opened from says where the focus goes (D-166).
- A write of a screen before sign-in or of a member's own account spreads `askedNow`
  (`api/query.ts`), and a test holds every one of them to it. A module's screens say for
  themselves which of their writes wait for a connection.
- A module's screen shows a row's state through `sync/` and never imports the library's code:
  what it needs at run time is added to `Opened` (`sync/open.ts`).
- **Item 26** registers household settings in `modules/registry.ts`, the first module the
  sidebar lists, builds the member screen that item 11's owner controls stand on, and gives a
  member in no household the way to make one, which the account's empty state leaves out. With
  the first module the arrange screen has something to arrange: a row moved by its handle says
  where it has come to, and item 26 has one that is pinned, put away or shown again say so too,
  and take the focus with it to the list it went to (D-166).
- **Item 27** widens the policy for the payment processor's frame, draws the entitlement banner
  in `shell/HouseholdBars.tsx` and the suspended lockout where a household answers `404` while the
  list names it: the app opens there only for a member in no household that opens (D-162).
- **Item 36** gives a member's arrangement a store, and **item 37** puts the search field in
  `shell/SearchSlot.tsx` and the dashboard in Home's place.
- **Items 28 and 29** show A-11 on the device whose sign-in ended (D-157).
- **Items 30 and 88** serve the app: `index.html`, `build.json` and `push-worker.js` are the
  three files a deployment must not cache; the build is given `HOUSEHOLD_WEB_SYNC_ORIGIN` and
  `HOUSEHOLD_WEB_FILES_ORIGIN`, the second the origin of `HOUSEHOLD_OBJECT_STORE_PUBLIC_URL`; the
  API and the web client are one origin; and Apple's return route and Google's
  `sign-in/google` are registered with the providers and in `HOUSEHOLD_OAUTH_REDIRECT_URIS`
  ([runbook](../runbooks/sign-in-keys-and-providers.md)).
- Until a module's entities are written offline, the inbox is empty on real data: the resolvers
  are held by their tests and by `/dev/sync`. Signing out removes a replica with whatever it had
  queued, and today it can have queued nothing: the first module written offline adds, to the
  sign-out, the count of changes not yet sent and the question that names them, and to the
  inbox what putting a merge's banner away came to, said, with the focus left to the list's own
  place as an answered row leaves it (D-166).
- A replica's removal is asked for and not waited on (`sync/databases.ts`): the browser carries
  it out once every connection to the database has closed, which for one another tab holds is
  when that tab lets go, and for one the asking page holds itself and then loads itself again is
  after the page has gone. The second is tried in Chromium alone, the one engine the suite runs.
  The first module written offline settles what a removal owes a replica that has queued
  something, and with it whether a page closes its replica before it asks.
- The arrange screen moves a row by its handle's arrow keys and by its menu. Dragging a row is
  not built: PL-4's dnd-kit comes with the first board.
- The first download is 180 kB of its 200 kB (D-153), 19 of them a language's whole catalog,
  which every module's words are added to. The item whose words would take it past the budget
  splits a language's catalog as the screens are split, the app's own words in the first
  download and a module's fetched with its screens; item 26 is the first to add a module's.
- **What would make this worth revisiting**: a browser that stops taking `http://127.0.0.1` for a
  secure context, which the suite's cookies stand on; a PowerSync release whose workers are not
  the page's own origin's; or a provider that posts its answer from more than one origin.
