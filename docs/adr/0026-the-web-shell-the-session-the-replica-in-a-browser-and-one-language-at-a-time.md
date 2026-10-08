# 0026 — The web shell learns its session from the answers it gets, a household's replica is one tab's and is opened as the session, the policy admits WebAssembly and one more origin, and the app holds one language at a time

- **Status:** Accepted
- **Date:** 2026-10-08
- **Plan item:** 25
- **Decides for:** [02-identity](../prd/02-identity-and-access.md) §2, §9; [06-clients](../prd/06-clients.md) §2, §5–§8; [07-nonfunctional](../prd/07-nonfunctional.md) §4; design [04-navigation](../design/04-navigation.md), [03-patterns](../design/03-patterns.md) §1, §2, §8; D-38, D-105, D-153, D-155 to D-160; PL-4; the consequences of [ADR 0009](0009-accounts-sessions-throttles-and-the-breach-corpus.md), [ADR 0010](0010-mobile-tokens-second-step-providers-and-client-versions.md), [ADR 0019](0019-the-sync-client-library.md) and [ADR 0025](0025-the-web-foundation-policy-harness-budget-and-build-id.md) for item 25

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
the persisted cache so that a member with no connection is still a member. Every problem a query
or a mutation meets is told to one hub (`api/problems.ts`), and so is one the replica's own
requests meet; the session answers three of them (D-156, D-158). A `401` on a member's session
means it ended and has nothing to renew: what the browser kept of their households, the
persisted cache and every replica's database, is removed, and the address they were at is held
for the sign-in that follows. A `403 csrf_failed` signs them in again and removes nothing. A `400
update_required` draws one screen in every route's place, whose action reloads the page. Signing
out ends the session at the server first, and removes the same only once it has: unreached, the
member is still signed in and is told so.

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
at run time is handed over with the open replica (`sync/open.ts`).

**The policy is widened by two sources and nothing else.** `script-src` gains
`'wasm-unsafe-eval'`, which lets a page compile WebAssembly and evaluates no string as script;
the SDK's workers are files of the page's own origin and need no source of their own.
`connect-src` gains the sync service's origin and its WebSocket twin, which a build is told by
`HOUSEHOLD_WEB_SYNC_ORIGIN`: unset, the service is behind the page's own origin and nothing is
added. Anything that is not one origin is refused as the build starts.

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

**The service worker shows a Web Push and does nothing else.** The build writes it as one file
at the origin's root (`build/pushWorker.ts`), part of the build's id: it handles `push` and
`notificationclick`, has no `fetch` handler and keeps no cache, so it serves no file of any
build. A press on a notification hands its address to a page that is open, which goes there by
its own router, or opens one. Permission is asked by a member's press on the screen that shows
the permission and the preferences together, and never on load; a browser whose permission was
already given registers its subscription again after a sign-in, asking nothing.

**The app holds one language at a time** (D-159). `@household/i18n/lazy` is the package's entry
with no catalog in it; the app fetches the catalog of the language it starts in before it draws
a word, and one chosen later when it is chosen. `build/check.ts` counts the largest catalog with
the scripts a first visit downloads. Every screen is a file fetched when its address is opened.
The entry is 139 kB, where it was 177 kB with a third of these words.

**The sidebar is derived, and lists what this build can open** (D-160). `shell/navigation.ts` is
the port of the prototype's `navFor`: the modules the household's answer gives the member a level
above `none` on, of those the build has screens for (`modules/registry.ts`), in the member's own
order. The order, the pins and what the member put away are kept in the browser, for each member
and household (D-155). The dev page `/dev/shell` draws the list from a registry of its own.

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
| A `fetch` that turns the library's bearer into a cookie on the server's side, or a web-session token minted for the replica | The first is the server reading a credential it was not sent. The second is a second credential for a browser that has one, with its own lifetime and revocation to keep in step |
| PowerSync's shared worker (`multiTab`) in place of the lock | It shares the connection, not the connector: two tabs would still each push the queue (ADR 0019) |
| A `BroadcastChannel` election of the tab that holds the replica | A lock the browser releases when a tab dies, with no heartbeat to time out |
| `'unsafe-eval'`, or the SDK built without WebAssembly | The first is what PRD 07 §4 forbids. There is no SQLite for the browser that is not WebAssembly |
| The sync service's origin as a wildcard, or `connect-src *` | A policy is widened for one origin. A page that could connect anywhere could send what it reads anywhere |
| The sync origin read at run time from the API's answer | The policy is in the page before any script runs: a script cannot widen it |
| Apple's JS in popup mode | A third party's script under a policy whose rule is that every script is the page's own origin's, and the providers a build offers would become a build's setting |
| The whole policy relaxed for Apple's form, or the return route outside the origin check | The origin check is what stops another site's page posting as a member. One origin is admitted to one route that reads no session |
| The providers a build offers as a build-time setting | A deployment that configures a provider would rebuild its web client to show it, and the two would disagree in between |
| A service worker that also caches the app, for offline | PL-4 names none, and it would serve the files a newer build replaces (ADR 0025). The web reads from its persisted cache |
| Notification permission asked at sign-in | 06-clients §6: asked in context, never on first launch |
| English in the entry as a fallback for a catalog that fails to load | Counted on every visit of members who do not read it (D-159) |
| Every granted module listed, with a screen that says it is not built | A link to nothing (D-160) |
| The arrangement in a synced entity now | A server item's work inside this one (D-155) |
| The suite against a stand-in API, or with requests answered by the test | The Done-when is the flow through the server: its mail, its throttles, its cookies. A stand-in would be a second server kept in step by hand |
| One network for the whole suite, with the server's limits raised for it | A configuration no deployment runs, to pass tests of the one that does |

## Consequences

- A screen's requests go through TanStack Query, their answers through `unwrap`: that is how
  the session hears of the three answers. A request made outside it tells the hub itself.
- A module's screen shows a row's state through `sync/` and never imports the library's code:
  what it needs at run time is added to `Opened` (`sync/open.ts`).
- **Item 26** registers household settings in `modules/registry.ts`, the first module the
  sidebar lists, builds the member screen that item 11's owner controls stand on, and gives a
  member in no household the way to make one, which the account's empty state leaves out.
- **Item 27** widens the policy for the payment processor's frame, draws the entitlement banner
  in `shell/HouseholdBars.tsx` and the suspended lockout where a household answers `404` while the
  list names it.
- **Item 36** gives a member's arrangement a store, and **item 37** puts the search field in
  `shell/SearchSlot.tsx` and the dashboard in Home's place.
- **Items 28 and 29** show A-11 on the device whose sign-in ended (D-157).
- **Items 30 and 88** serve the app: `index.html`, `build.json` and `push-worker.js` are the
  three files a deployment must not cache; the build is given `HOUSEHOLD_WEB_SYNC_ORIGIN`; the
  API and the web client are one origin; and Apple's return route and Google's
  `sign-in/google` are registered with the providers and in `HOUSEHOLD_OAUTH_REDIRECT_URIS`
  ([runbook](../runbooks/sign-in-keys-and-providers.md)).
- Until a module's entities are written offline, the inbox is empty on real data: the resolvers
  are held by their tests and by `/dev/sync`. Signing out removes a replica with whatever it had
  queued, and today it can have queued nothing: the first module written offline adds, to the
  sign-out, the count of changes not yet sent and the question that names them.
- The arrange screen moves a row by its handle's arrow keys and by its menu. Dragging a row is
  not built: PL-4's dnd-kit comes with the first board.
- **What would make this worth revisiting**: a browser that stops taking `http://127.0.0.1` for a
  secure context, which the suite's cookies stand on; a PowerSync release whose workers are not
  the page's own origin's; or a provider that posts its answer from more than one origin.
