# 0029 — The mobile app runs on the Expo SDK's React, which the workspace moved to, scales its own type and is held to accessibility rules of its own; a device's sign-in is a token pair, and what it keeps is named for its member and removed with their sign-in; the shell stands inside the navigator; and the app is proven on a device in CI alone

- **Status:** Accepted
- **Date:** 2026-10-10
- **Plan item:** 28
- **Decides for:** [06-clients](../prd/06-clients.md) §1 to §8; [02-identity](../prd/02-identity-and-access.md) FR-ID3, FR-ID4, FR-ID7; [03-platform-strands](../prd/03-platform-strands.md) §2, FR-NT1, §9; [05-privacy](../prd/05-privacy-and-compliance.md) FR-PR1; design [01-foundations](../design/01-foundations.md), [02-components](../design/02-components.md), [03-patterns](../design/03-patterns.md) §1, §2, §8, [04-navigation](../design/04-navigation.md) §1, §5, §8, §9, DD-11; D-23, D-25, D-36, D-38, D-98, D-99, D-104, D-105, D-154, D-155, D-178, D-183 to D-196; PL-3, PL-5, PL-13; plan Q6, Q18; the consequences of [ADR 0007](0007-shared-packages-client-catalogs-and-vectors.md), [ADR 0010](0010-mobile-tokens-second-step-providers-and-client-versions.md), [ADR 0019](0019-the-sync-client-library.md), [ADR 0024](0024-design-tokens-icons-and-the-illustration-kit.md), [ADR 0025](0025-the-web-foundation-policy-harness-budget-and-build-id.md), [ADR 0026](0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md) and [ADR 0028](0028-the-catalog-in-parts-the-payment-form-the-entitlement-in-the-shell-and-what-a-household-shows-of-its-data.md) for item 28

## Context

Item 28 builds the mobile app's foundation: the Expo app itself, the primitives and the twelve
states, the session, a household's replica and the sync UI, the shell, links, *please update*,
push, and whatever proves any of it. Items 6, 9, 18, 23, 24, 25 and 27 each left it a hand-over,
the plan left it Q6, and it was built on a machine that can launch neither platform: Windows on
ARM, with no Android SDK and no Xcode. These questions came with it:

1. **Which Expo SDK, and which React.** The workspace's catalog held React 19.3.0, which the web
   ran on and `@household/sync` and `@household/icons` were typechecked against. Expo's current
   stable SDK, 57, is built on React 19.2.3 and react-native 0.86.3, and an Expo app runs on the
   React its SDK was built against and no other.
2. **What Metro and Jest need** to take a pnpm workspace whose packages are TypeScript sources.
3. **What `pnpm audit` says once Metro is installed**, which item 18 left out of the install for
   `braces` (GHSA-vfj7-8cjw-p6xm).
4. **What Hermes has of `Intl`**, and how the i18n vectors, written against Node's ICU
   (ADR 0007), are held on it.
5. **Where the faces' static files come from**: iOS and Android register a TTF or an OTF, and
   the packages the web's faces come from hold `woff` and `woff2` (ADR 0024).
6. **How type scales to 200 %** where there is no cascade and no `rem`.
7. **How a dev-only harness stays out of a store's build** (D-154), where Metro has no mode of
   the app's own and folds away only what it can see.
8. **What stands where axe does**: nothing reads a React Native tree as axe reads a page.
9. **How a device signs in, renews, and learns that its sign-in ended** (ADR 0010), and what
   D-98's minute leaves it unable to close.
10. **Whose what a device keeps is**, where a shared tablet signs several profiles in at once
    (D-104) and D-161 refused the member in a name for a browser.
11. **Which `fetch` a request leaves by, and how a file of a hundred megabytes is sent**
    (ADR 0019: React Native's FormData takes a file by its URI, not bytes).
12. **How a replica is opened, held by more than one screen, and removed for good** on a file
    system that may refuse a deletion.
13. **How the shell stands on expo-router**: where the guard goes, how an address that names
    another household opens it, and what the tab bar is drawn from.
14. **How a dialog, a sheet, a menu and a toast stand over one another** on React Native's
    `Modal`.
15. **How hold-to-complete is completed by whoever cannot hold.**
16. **How any of it is proven**, when nothing where it was written can build or launch the app.

## Decision

Paths below are under `apps/mobile` unless they say otherwise. A sentence that says what iOS,
Android, VoiceOver or TalkBack does was read in the installed source of React Native 0.86.3,
Expo SDK 57 or Hermes and run on nothing, unless it says that CI saw it: it is marked *(read)*
where the difference matters, and the end of this record says which is which, by area.

**The app is built on Expo SDK 57, and the workspace runs on one React, the SDK's** (your
answer, 2026-10-10). The catalog (`pnpm-workspace.yaml`) holds `react` and `react-dom` 19.2.3
and `react-native` 0.86.3, the pins of `expo/bundledNativeModules.json`, with React's types at
its own minor, and the web moved down with them. `overrides` hold every request for the five, a
peer's included, to the catalog's version: without them pnpm gave an unmet peer its newest,
expo-router's web-only dependencies `react-dom` 19.3 beside `react` 19.2, and
`@household/sync`'s react-native a newer `@types/react` than `@household/icons`', which made two
`react-native` snapshots in the lockfile and would have put two copies in a bundle. The native
modules a shared package is typechecked against and the app links, op-sqlite, PowerSync's SDK
and react-native-svg, are catalog entries too. `packageExtensions` makes
`react-native-drawer-layout`'s two peers optional, as expo-router itself declares them: left
required, pnpm installed reanimated, gesture-handler and worklets at versions the SDK does not
pin, which autolinking would link into every build. The app has none of the three: a primitive
is `View`, `Pressable`, `Modal`, `Animated` and react-native-svg. Expo's own packages are
written with the SDK's ranges, as `expo install` writes them, and everything else is pinned
exactly; the lockfile is what pins the first. The app builds for Android 10 and for iOS 16.4,
which is the SDK's own floor: its build properties refuse a deployment target under it (D-185).

**Metro and Jest take the workspace with almost nothing configured.** There is no `metro.config`
and no Babel configuration: Expo's default finds the workspace root, follows pnpm's links and
resolves the packages' TypeScript sources and their `exports`, and Metro and jest-expo both fall
back to Expo's own Babel preset. That a bundle holds one copy of React, React Native, the SDK's
modules and the replica's was read off the source maps of both platforms' exports. Jest is 29,
which jest-expo 57 is built on, with React Native Testing Library 14 over `test-renderer`
1.2.0, the release for React 19.2, which moves with React's minor. Four things were needed
(`jest.config.js`). Jest transforms every module it loads, as Metro does, `.mjs` and `.cjs`
among them. op-sqlite, whose JavaScript installs its native bindings as it is imported, is a
stand-in that opens nothing (`src/test/op-sqlite.ts`): no database is opened under Jest, the
conformance suite holding the library on a real SQLite. AsyncStorage and NetInfo are their
libraries' own stand-ins. And the setup takes out of Node's `Intl` what Hermes does not have
before it loads the app's polyfills (`src/test/hermes.ts`, `src/test/setup.ts`), so that a test
formats through what a device formats through. Tests import `describe` and `expect` from
`@jest/globals`. TypeScript is three projects, the app, `build/` and `e2e/`, the last two on
Node's types, which the app's own is kept from. `app.config.ts` imports nothing of the
workspace's, Expo's loader compiling it alone, and `src/config.test.ts` holds it to the tokens'
list of fonts and to the package's version. expo-router is told that its routes are under `app/`
(`root`), since left to look it takes `src/app` first, which holds the table of routes and its
tests.

**The audit passes over two advisories that ship in no client, and one moderate advisory
ships.** `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` names `braces`
(GHSA-vfj7-8cjw-p6xm), under micromatch in Metro's file map and in Jest, and `node-forge`
(GHSA-86w9-cpqp-85rv), under Expo's CLI, which reads a developer's own signing certificates
with it. Neither has a patched release, and neither is in either platform's bundle, which was
looked for in their source maps; the reason for each is written beside its entry, where
`audit:ts` and CI's job both read it, and an entry leaves with the release that mends it. The
override that kept Metro out of the install (item 18) is gone. `decode-uri-component` 0.2.2
(GHSA-vcc3-ghjq-m6fr, moderate, under the audit's gate at `high`) is in both bundles:
expo-router's `query-string` parses a link's query with it, and the patched release is an ES
module that `query-string` 7 `require`s and calls, so an override would break routing.

**The app holds all five catalogs, and its own words are `device.*`** (D-195). It imports
`@household/i18n`'s own entry: a device downloads the app once and changes language with no
connection, so a language chosen is shown at once. A shared key is used where its English is
true of a phone. Where it says *this browser*, *tab*, *page* or *reload*, the app has a key of
its own under the first segment `device`, which is a row of `packages/i18n/src/parts.ts` beside
the server's own segments (`deviceSegments`) and in no part, so no download of the web's holds
one. The account's language is followed by one function of the provider (`followAccount`,
`src/i18n/I18nProvider.tsx`), and the followed and the chosen language are both kept on the
device, so the app starts in its member's language before the session is read.

**Plurals and numbers are FormatJS's on every device, and the rest of `Intl` is filled only
where Hermes lacks it** (`src/polyfills/intl.ts`). Read in Hermes's source at the tag React
Native 0.86.3 ships: it has `Collator`, `DateTimeFormat`, `NumberFormat`, with no
`formatToParts` on iOS, and `getCanonicalLocales`, and lacks `PluralRules`, `Locale`,
`ListFormat`, `DisplayNames`, `RelativeTimeFormat`, `Segmenter` and `supportedValuesOf`.
`PluralRules` and `NumberFormat` are forced, with the five languages' CLDR data, English first
as the fallback: one implementation, where a device's own would be its operating system's, one
ICU on Android and Foundation on iOS, each of its own age. `Locale`, `ListFormat`,
`DisplayNames` and `supportedValuesOf` are filled where they are missing; dates and collation
are the engine's own. `crypto.getRandomValues`, which every identifier is drawn from (D-23), is
expo-crypto's, installed where the engine has none (`src/polyfills/crypto.ts`), and the app's
entry imports the polyfills before expo-router's own entry (`index.ts`).
`src/i18n/vectors.test.ts` runs every case of `vectors/i18n.json` under the polyfills, over an
`Intl` cut down to Hermes's, and the dev screen at `/dev/engine` runs the same cases on the
device's own engine (`src/dev/engine/checks.ts`), which a flow reads in CI.

**The faces are Google Fonts' static files**, from `@expo-google-fonts/ibm-plex-sans` and
`-mono`, one file for each weight the type scale sets, embedded by expo-font's plugin: on iOS by
path, a file registering under the PostScript name it carries, and on Android as font resources
registered under the family and the weight `app.config.ts` gives. Their paths are data of
`@household/tokens`, and `packages/tokens/src/fonts.test.ts` holds each to PL-13 as the web's
files are held: its PostScript name is its family, Latin Extended-A whole with Romanian's
letters, and figures of one width.

**The app scales its own type, and holds it at 200 %** (D-186). `Text` (`src/ui/Text.tsx`) is
the one text primitive: a step of the type scale at its size times the reader's scale, which is
the device's font scale held to between one and two (`textScaleOf`, `src/display/modes.ts`),
with the system's own scaling off, since the two would multiply. ESLint fails an import of React
Native's `Text` anywhere else in the app. A target is 44 pt times the same scale (`useTarget`),
a glyph is drawn at it, and a field that is typed in turns the system's scaling off as `Text`
does. The display modes are the device's: the theme (light by default, dark, or the system's)
and motion, kept in AsyncStorage, with no density mode and no scale mode. A dev screen may hold
a theme or a scale over them without keeping it (`hold`), and a `ThemeScope` draws a subtree in
a named theme, which is how the harness draws each cell in both.

**A dev screen is in a bundle only where its route's own condition lets it in, and a check of
the export holds that** (D-154). Each file under `app/dev/` writes the condition out,
`__DEV__ || process.env.EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS === '1'`, and loads its screen behind
it with `lazy(() => import(…))`; where it is false the route draws *not available*. Metro folds
a condition only where it is written, so a constant imported from elsewhere would not do
(`src/dev/gate.ts` is for a question asked at run time alone). Every dev screen stands in
`DevScreen`, whose `testID` begins with one marker (`src/dev/marker.ts`), and `build/check.ts`
fails an export whose bundle holds the marker, searched for as bytes so that Hermes bytecode is
read as JavaScript is. `build/check.test.ts` holds every dev route to that exact line, and
everything outside `src/dev` to importing nothing from it. Metro's transform cache does not key
on an `EXPO_PUBLIC_*` variable, so the `export` script clears it every time. The dev screens'
words are fixtures in English, accented under the pseudo-locale (`useSample`), and in no catalog.
The harness at `/dev/harness` is eight data bodies through the twelve states, in both themes at
200 % text, the data table being the web's alone (D-190).

**Where axe stands on the web, ten rules stand over the tree a test draws**
(`src/test/a11y.ts`, `expectAccessible`). Each fails with the element it failed on. `named`:
whatever takes a press has a role and a name. `registered-name`: an icon-only control is called
what the register calls one (`@household/icons`' `controls`), in any of the five languages or
the pseudo-locale, a hold-to-complete passed over as named for the one thing it completes.
`target-size`: its style gives at least 44 pt, at the scale the test drew at, high and wide, its
hit slop counted, and a width its row gives it taken as wide enough. `never-disabled`: nothing
is disabled but a control the test names as out of its form. `picture`: an image or a drawing
is named, or hidden from a screen reader. `status`: whatever carries a `testID` that begins
`status:` holds a drawing and a word. `own-text`: every text has the system's scaling off, and
so is the app's `Text`. `field`: a field that is typed in has a name, its own or a drawn
label's, and the system's scaling off. `hold`: a hold-to-complete is within a screen reader's
reach, declares an `activate` action with a label, and answers an accessibility action, an
accessibility tap and a click. `truncated`: no text is held to a number of lines. What none of
them can hold is anything laid out, since Jest lays nothing out: a size as a device measures it,
a word clipped at 200 %; nor contrast, which the tokens' own test holds pair by pair; nor the
order a screen reader walks, nor whether an announcement was heard. Those are a flow's, which
reads the harness at 200 % in both themes, and a person's with VoiceOver and TalkBack (item
95). An announcement is a call and no tree, so a component's own test spies on
`src/ui/announce.ts`, the one file that calls React Native's `AccessibilityInfo`.

**What a press came to is said through that one file** (D-188). A screen's title is its one
header, which is what a screen reader names the screen by. A refused form's fields enter the
form in the order they are drawn, each saying whether the refusal marks it (`RefusedFields`,
`useRefusable`, `src/ui/refusal.ts`), and the first one marked is given the accessibility focus
(`useRefusedField`), the keyboard's left where it was. A banner's sentence is a string, since it
is what is announced, and whatever else stands under it is its `detail`, which is not. A banner
whose owner says `announce` says its title and its sentence as one announcement as it arrives
and whenever they change, a failure at once and anything else politely; a bar that stood when
its screen opened is read in its place and not said. A success that no control of its screen
says is a toast.

**A device signs in with a token pair kept under its member** (`src/session`). The vault is
SecureStore (`vault.ts`, the one file that imports it), every item
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`: `household.device`, the installation's own id;
`household.signins`, who is signed in here and which of them is in use; and
`household.signin.<member>`, a pair with the moment its access token lapses by the device's own
clock. The layout is several sign-ins' from the first, one a member, since a shared tablet holds
several (D-104), which item 29 builds on. The API's client (`src/api/client.ts`,
`src/api/transport.ts`) names the app on every request, `Household-Client: mobile/<version>`
with the package's own version, says `credentials: 'omit'`, and signs with the access token. A
token is renewed when a request needs one within a minute of its lapse, and once more where a
request is refused `401 unauthenticated`, which is read from a copy of the answer, the request
then sent again from a copy of itself. It is never renewed on a timer, so a device that is not
being used rotates nothing. One renewal runs at a time, and every request that needs one
meanwhile is served by it. The renewal itself leaves by a client that signs nothing
(`renewal.ts`). The new pair is held in memory before it is written, and a keystore that
refuses the write is passed over: the token it replaces is used up either way.

**Only a renewal the server answers `401 refresh_token_invalid` ends a sign-in** (D-187). The
store removes the pair and tells the session, which removes everything else the device kept of
that member (`forget`, `src/session/forget.ts`): what the query client kept of what they read,
the note of their push registration, and every replica of theirs with its waiting files and
the changes it had not sent. A renewal that got no answer ends nothing, and leaves the request
it was made for with no answer either, which `@household/api` resends; one answered with
another problem ends nothing, and the request's own `401` stands. A `401` to a request ends
nothing. Signing out removes the device's push registration at the server first, then ends the
sign-in there, and removes what the device kept only once the server has heard or says that it
no longer knows the sign-in: unreached, the member stays signed in with everything kept. A
different member signing in removes the first one's before anything of theirs is kept, and
nothing is started again. The sign-in screen then says, in one banner of the `info` tone, that
the device was signed out and that what it kept was removed with any change it had not sent. It
names no cause, the answer naming none (Q18), and is announced only where it arrives under a
screen that is already drawn. A `400 update_required`, from any request, the renewal's, the
replica's and an upload's among them, draws *please update* in every screen's place and nothing
beside it, no route, no link and no registration (D-193). Its one action opens the app's page
in the store, where the build was told of one for the platform it runs on
(`src/update/store.ts`); a build told none draws no control.

**Push is registered for a device that allows it already, and asked for by a press alone**
(D-194; `src/push`). A device whose system permission is granted is registered again for its
member at each sign-in and at each start, Expo's token told to the server with the
installation's id, and the registration is removed at the server before a sign-out. The token
that was registered is remembered under its member, and so is their own choice to turn
notifications off here, which outlives their sign-in. The system's question is put by
`usePush().ask`, in a press, and by nothing else; no screen of this item draws one, F-20 being
item 29's. A build that was told no EAS project cannot ask Expo for a token: its state is
`unsupported`, and nothing is asked of anybody.

**D-98's window is the server's, and a device cannot close it.** A renewal presents the refresh
token the device holds, and the server uses it up as it answers with the next pair. A device
that was killed between the answer and the write, or whose keystore refused the write, or, the
commoner case on a phone, that never received the answer at all, still holds the used token.
Presented again within a minute, with the next one unused, it is the retry it is, and is
answered with a new pair. Presented after the minute it is a reuse: the server revokes the
family and emails the takeover notice, and the device, answered `401 refresh_token_invalid`,
removes what it kept, its unsent changes among it. So a phone that goes into a lift as its
token is renewed and comes out two minutes later is signed out, and its member is sent an email
that reads as an incident. The client narrows the window as far as it can: one renewal at a
time; the pair held in memory before it is written; a renewal only when a request needs one; a
lost answer resent at once with the same token; and a renewal with no answer changing nothing,
so that the next presents the same token. It cannot make the minute longer.

**What a device keeps is named for its member and its household** (D-187): a replica's file,
`household.<member>.<household>.db`, and the directory its waiting files are in; the reads the
query client keeps, `household.queries.<member>`; the pair; and the note of a push token. A
shared tablet holds several profiles signed in at once, each seeing other rows, and a device
removes a member's own whenever their sign-in ends, so D-161's objection to the member in a
name, a copy that stays until its member returns, does not hold here. The query client is one
member's at a time: its keys are the web's, without the member in them, what it kept is
restored under the member whose sign-in is in use, and an account it holds is taken for the one
signed in only where its id is theirs. Its keep is the app's own, over `dehydrate` and
`hydrate` (`src/api/keep.ts`), a day long and for one version of the app. What outlives a
sign-in is the device's and no member's content: the display modes, the language, a member's
arrangement of their modules (D-155), which household they were last in, and their own choice
to turn notifications off on this device.

**The global `fetch` on a device is Expo's already, and the client hands it the `Request`
whole.** Read in Expo SDK 57's runtime: it installs `expo/fetch` in React Native's place, and
`Request`, `Response` and `Headers` stay React Native's own, which are whatwg-fetch's.
`expo/fetch` reads such a `Request`, its body included; both it and React Native's send the
device's cookies unless they are told not to; and its answer is no `instanceof Response`,
which nothing of the app asks. So the transport passes the platform's `fetch` the `Request`
itself, with `credentials: 'omit'`, and runs on whichever a build installed.
`src/api/transport.test.ts` runs the client over both implementations' own JavaScript, with
only the native half of each stood in for.

**A file is sent from where it is, by `File.upload`, and its part is named for its row's id.**
`@household/sync` gains one thing for it: an attachment's `transport` may be `{ byUri }`, a
transport handed the stored file's place, its type and its name where the other is handed its
bytes, and for which the queue reads no file. The app's (`uploadByUri`, `src/sync/files.ts`)
sends with expo-file-system's `File.upload`, as a multipart form whose `file` field it is, in
the foreground session, and not through the `fetch` the replica's other requests leave by:
read in the installed sources, `expo/fetch` builds every body in memory and refuses a part
given by its URI, and React Native's own networking, which takes one, holds the whole form in
memory on iOS, where `File.upload` hands the system a file on both platforms. So this one
request names the app, and tells the problem hub of `update_required`, itself. The upload names
the form's part by the path it sends, which is the row's id: the row carries the file's own
name, and has reached the server before its bytes (D-25). No route takes a file yet, and the
way in, `Replica.attach`, still takes bytes.

**A replica is opened for a member, of a household that is theirs, and once on a device
however many hold it** (`src/sync/open.ts`, the one file of the app that imports the sync
library's values, which a test of the sources holds). The provider
(`src/sync/ReplicaProvider.tsx`) opens nothing on an address's word: only for whoever is signed
in, of a household that the server, or what the device kept of its answer, says is theirs. It
opens through `@household/sync/native` with a `fetch` that names the app and tells the hub of
`update_required` (`namedFetch`), with the session's credential, which throws the library's
`Revoked` once the sign-in has ended, and with the file storage and the transport above.
Holders are counted by the file's name: the household on screen, one underneath it in the
stack, a dev screen over both. The replica is connected once, as it is opened, closed when the
last holder lets go, and one that is being closed is waited out before its file is opened
again. Its phases are opening, open and unavailable, the last with a way to ask again, a device
having no page to reload and no other tab to wait for. The file is imported with the
household's layout, and so loaded as the app starts, which is when it says what the session is
to forget.

**A replica's removal is noted step by step, and what failed is taken up at the next start**
(`src/sync/databases.ts`). A replica is noted in AsyncStorage before it is opened. When a
member's sign-in ends theirs are marked as leaving, which is all the session waits for. Each is
then emptied through the library, wiped and closed, one that is not open being opened for
nobody, with a credential that throws and no server to ask, and noted as emptied; then its
database's file is deleted by op-sqlite itself, after a checkpoint that truncates its log, its
files' directory is deleted, and its note dropped. Whatever failed is tried again as the file
is loaded, before any replica is opened. A replica that is still leaving is removed before it
is opened again; one that was emptied and whose file could not be deleted is its member's to
open, being empty; one that could not be emptied is not opened. A sign-in that ends while its
replica is on its way opens nothing. `onRevoked` is not handed to the replica: the refusal
that makes the credential throw has ended the sign-in already.

**"Receiving" is read as the web reads it** (D-105, ADR 0026): true while PowerSync's status is
connected, false once an attempt has failed, for as long as the SDK keeps that failure, and
nothing before that; never off `connecting` nor `hasSynced`. Whether the device is online is
its own word, believed in one direction: NetInfo's `isConnected`, with *unknown* taken for
connected and `isInternetReachable` not read; TanStack's online manager is told the same, and
its focus is the app coming to the front. Above a household's screens stands one bar
(`src/sync/HouseholdBars.tsx`): offline, or, with the device online and the replica not
receiving, that sentence in the same place (D-191). Over a household that takes no writes it
promises nothing of a change, and at the addresses whose changes are asked at once (D-170) it
says that a change needs a connection. The app never tells the replica to connect again.

**The guard, the replica's provider and the frame stand inside the household's navigator, in
its `layout`** (`src/shell/HouseholdLayout.tsx`). A household's screens are a tab navigator
(`expo-router/js-tabs`) with the app's own bar as its `tabBar`, the navigator's history as its
way back, and no header. Running the real router under Jest (`src/shell/layout.test.tsx`)
showed what no mocked test would have: a layout that draws no navigator loses the rest of the
address, so a guard around the navigator held a visitor's link to a household's screen as a
link to the household's Home. Inside the navigator's `layout` the navigator is always mounted
and holds the route, and what it draws is still the guard's to decide.

**A household is a route of a stack of its own** (`app/households/_layout.tsx`,
`src/shell/HouseholdsLayout.tsx`). With the household a part of one route's name, the router
found no difference between two households' addresses until it reached their screens, and an
address that named another household opened its screen inside the first one's frame: the
first's name over the second's address. As the route `[household]` of a stack, such an address
puts a new layout on top, whichever way the router is asked for it, and going back returns to
the one underneath, which stays mounted with its replica open. One layout is one household's
for as long as it is drawn, and nothing under it is keyed by the household.

**The bar is derived, never authored** (`src/shell/tabs.ts`; D-183, D-184). One function gives
a member's slots from the household's own answer and from the screens this build has
(`src/modules/registry.ts`): Home, Today and More always; Chat where the member holds it and
the registry has it; Add where its sheet would offer something, a capture surface of this
build's for a module the member may create in, in a household that takes writes. The order is
kept and the slots share the bar again, at five, four or three. The registry is empty in this
build, so no bar of it draws Add or Chat, and a test fails as soon as a module registers a
capture surface while the slot still opens nothing. The bar opens a place by its address and
reads which is open from the navigator's own state; a route that draws *not available* is
under no place, and no slot says it is open. A slot is a `tab`, and the row that holds them
`tabbar` on iOS and `tablist` elsewhere *(read: on iOS `tabbar` is the one of the three that
maps to a trait)*. On a phone a slot is a share of the bar, at least 44 pt high at the reader's
scale, its label wrapping and never cut; from 744 pt of room counted in the reader's text each
slot is a row, a glyph beside its word, and the slots stand together in the middle (D-192).
The bar in front tells the toasts how high it stands, and no other does.

**Every screen of a household stands in `HouseholdScreen`** (`src/shell/HouseholdScreen.tsx`):
the app bar, which says the household's name first and the screen's one header after it, with
the way back where the screen says it was reached from another. The name is a label that takes
`onSwitch`, by which item 29 makes it the switcher's control. The frame
(`src/shell/HouseholdFrame.tsx`) reads the household, and the member's arrangement of its
modules from AsyncStorage, before anything of the shell is drawn, and draws a wait, *could not
be read*, *not available*, or the bars and the screens under them, with a place under the
offline bar's for item 29's one entitlement banner. More lists the modules the member holds
that this build has screens for, in their own order (`src/shell/navigation.ts`, the web's
derivation ported whole), and after them arranging, the way to what needs their attention
while something does, with its count, which the More tab's name carries too (D-191), and
signing out. Two panes are drawn from the same 744 pt (`src/shell/Panes.tsx`), and one where
the left cannot fill a second.

**Arrange's handle is an adjustable, and no button.** Nothing is dragged and no tap moves a
row, so the handle takes no press: it is named *Reorder {name}* and has the two actions
`increment` and `decrement`, labelled *Move up* and *Move down*, and only the moves that exist.
A row is moved from its menu too. A move is announced, and a row that leaves its list for
another takes the accessibility focus with it.

**An address that arrives is the web's own, and one function says what it comes to**
(`src/links/resolve.ts`, D-196). A route is a line of `src/app/paths.ts` and a file under
`app/` that re-exports its screen, which `src/app/routes.test.ts` holds to each other both
ways; the addresses are the web's, since the server writes one into a push's `data.url`, and
one the app has no screen for is the neutral *not available*, inside the household's frame
where it names a household. A pressed notification's address is opened by the app's own router.
A link the system hands over is left to expo-router, and the app does what the router does not
know to: it holds the address for a visitor, in memory and in AsyncStorage, since signing in
may leave the app, and notes that a link changed the household, which is said in a banner with
the way back. That a link switched the household is positive evidence, an address that named
another household than the one on screen, and never inferred from a household having changed.

**Overlays are React Native's `Modal`** (`src/ui/Dialog.tsx`, the one file that draws one;
`Sheet`, `Menu` and `Select` stand on it). The owner decides every close: the system's back, a
screen reader's escape, the ground and a sheet's close control ask. The accessibility focus is
put on the title once the platform says the modal is shown, and given back to what opened it
once it has gone, which iOS's `Modal` does by itself *(read)* and the app asks for once more
where an `opener` is named. Three things follow from how iOS presents *(read in
`RCTModalHostViewComponentView.mm`: a modal is presented by the nearest view controller, with
no queue, and one asked for while another of the same controller's is still leaving is never
drawn)*. A dialog over a sheet is drawn inside the sheet's children, so that the sheet's own
controller presents it. A menu's chosen item acts once its sheet has gone and not as it is
pressed, what it opens being often a confirmation: CI's flow opens one so on the iOS
simulator. And a resolver keeps what it last showed while it leaves, the refused change's
sheet staying until its confirmation has gone. Toasts are drawn by the innermost open modal,
in a row at its foot, and by the root where none is open, since under a modal an Undo could
not be pressed: the hosts are a stack by depth, and a toast's dwell is the provider's and not
the drawn toast's, so it runs on through a modal that opens or closes around it. **While a
screen reader is on, no toast's dwell runs** (D-188): a toast stays until its Undo or its
dismiss is pressed, React Native saying whether a screen reader is on and not where its focus
is.

**Hold-to-complete is two elements, and three activations complete it at once**
(`src/ui/HoldToComplete.tsx`). The ring is what a finger lands on: a plain view that answers
touches through the responder system, hidden from a screen reader, which runs the 2000 ms hold
by a timer and gives it up when the finger leaves. The button around it is what everything
else meets: accessible, named for what it completes, and never reached by a finger, the ring
covering it whole. It completes at once on the `activate` accessibility action, which is
TalkBack's double tap and which carries the control's own name as its label, since iOS lists a
bare action by its identifier; on `onAccessibilityTap`, which is VoiceOver's double tap, and
without which iOS taps the screen at the element's centre, where the ring would take it for a
hold let go at once; and on a press with no touch before it, which is a keyboard's Enter *(all
three read)*. Neither path looks at how long anything lasted (ADR 0025). The fill is an
animation of the ring's stroke, in ten steps under reduced motion, and it only shows the hold:
the timer ends it.

**The controls are drawn here, and each is controlled.** A field's help and its error are its
accessibility hint and are drawn as texts beside it, there being no described-by on a device,
and nothing says *invalid* but the error's own sentence, its glyph and the edge's colour. A
select is a button that holds its value and opens a sheet of radio rows; a stepper parses what
was typed itself, with a comma or a full stop before a fraction, and its two moves are actions
of its field; a checkbox, a radio and a switch are drawn, one row a control. A control that
cannot act is absent, an option that cannot be chosen is not offered, and a busy control says
`busy`, drops the press and stays where it is.

**CI proves the app on a device of each platform, since nothing where it is written can** (your
answer, 2026-10-10; `.github/workflows/ci.yml`). Four jobs. `mobile-changes` reads the diff
with `git` and sets the other three off where it names the app, any package, the lockfile, the
workspace's settings, the root manifest or the workflow; otherwise they are skipped, which a
required check takes for passed. `mobile` makes the production export of both platforms and
runs `check`. `mobile-android` writes the Android project, builds it, starts the development
services and the API from its sources, makes a member through the typed client
(`e2e/stack.ts`), boots an emulator at API 29, the oldest Android the app supports, runs the
flows, asks the server which devices the account lists, and holds the build's permissions to
their reasons. `mobile-ios` makes a simulator on a named image and Xcode, installs the pods,
builds, runs the flows that ask nothing of a server, a macOS runner having no Docker, and
reads the built `Info.plist`. The app's unit tests are Jest's, in the job that runs every
package's.

**The build the flows walk is the development variant as a release build, with the dev screens
in it** (`EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS=1`), for the emulator's architecture alone and the
simulator's. It is made in jobs apart from the export, Metro's cache not knowing the variable.
The development variant may speak plain `http` on Android, which the template allows a debug
build alone. The flows (`e2e/flows`) select by `testID` and never by a word, and
`e2e/flows.test.ts` holds each to the app's own names, since nothing where they are written
runs them: its `appId`, a link's scheme and address, and each piece of each `id`. Three tags
keep a flow out of a run: `awaiting`, `stack` and `android`. Maestro is fetched as its
release's own archive and held to its digest (`e2e/install-maestro.sh`), and one script runs
the flows for CI and for a developer (`e2e/run.ts`).

**The dev screens are reached by presses, on both platforms.** On the first run iOS put a
dialog of its own over the app when a flow sent a link, *Open in "Household Dev"?*, which
carries no `testID` and stayed over every flow after it. So the sign-in screen has a control
that leads to the dev sign-in form in a build that holds the dev screens, every dev screen
leads to their index, and the flows walk that; a link is sent by one flow, on Android alone.

**A build asks its device for what `build/asked.ts` names, each with its reason, and for
nothing else** (FR-PR1). The list a build ends with is in no file: the manifests of the
template and of every library are merged as it is made, and the first build asked for
thirty-one permissions. `unusedPermissions` in `app.config.ts` removes twenty-two of them from
every variant, the development one too, so that the build the flows run is one that goes
without them; a development build alone keeps the one React Native draws its errors by. The
Android job reads the list off the APK it built (`aapt2 dump permissions`) and `build/apk.ts`
fails a permission with no reason and a reason for a permission the build does not ask for;
`build/permissions.test.ts` holds each variant's configuration to the same two lists through
Expo's own introspection. On iOS the configuration writes no usage sentence of its own, and
the dev launcher's plugin, which writes one for the local network, adds the build phase that
takes it out of every build but a debug one: the iOS job reads the release app it built and
fails if it is there.

**The budget is each platform's bytecode, what it measured and a fifth** (D-189,
`build/budget.ts`): the `.hbc` files of a production export, in their own bytes, against one
measured number a platform from which the limit is derived. `check` fails an export over
either, and one that holds no bytecode for a platform. Measured on 2026-10-10 with the whole
of this item in it: 6 220 747 bytes for Android and 6 006 246 for iOS, of which PowerSync's
SDK, the sync library and the sync UI are some 870 kB a platform.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| The SDK 58 beta, on react-native 0.88's release candidate, which keeps React 19.3.0 | Your answer (2026-10-10): the current stable SDK. A beta on a release candidate would be under the item every later mobile item stands on |
| A second catalog, or pins of the app's own, so that the web stays on React 19.3 | Two Reacts in one workspace: `@household/sync` and `@household/icons` are typechecked once and bundled into both apps, and a package given the wrong one puts a second React in a bundle. One React, which moves when the app moves to an SDK (your answer) |
| React's types left at 19.3 | The web would typecheck against a React it does not run on |
| `react-dom` named in `apps/mobile` and `@types/react` in `packages/sync`, in place of the overrides; `autoInstallPeers: false` | The first worked, but they are manifest lines a native app and a library have no use for, and the next package that forgets one brings the second copy back silently. The second changes the policy of the whole workspace: every package that relies on a peer pnpm installs would have to name it |
| reanimated and gesture-handler installed at the SDK's pins; `peerDependencyRules.ignoreMissing` | Nothing needs either: both bundles export and every test passes without them, and expo-router does not require gesture-handler. The second is workspace-wide where the fault is one package's declaration |
| The native modules' versions matched by hand in two manifests | A drift is two copies of a native module's JavaScript in one bundle, or a library typechecked against a version the app does not link |
| Expo's own packages pinned exactly, at each range's floor | `expo` depends on them by range, which pnpm resolves to the newest patch: an exact pin beside a newer patch under `expo` is two versions of one native module |
| React Native Testing Library's newest release, two days old, behind an exclusion from the workspace's minimum release age | The release before it does the same, and no exclusion was added for anything |
| The lockfile deleted and resolved anew after a change of settings | Every range in the workspace would move. It was resolved again from the committed one each time, since an incremental install keeps a peer it installed earlier after the rule that asked for it is gone |
| An override that holds `react-is` to React's version | expo-router's range brings 19.3.0 into the bundle beside React 19.2.3. It only tells element types apart, and an override would have to be scoped past the older majors `pretty-format` and `prop-types` ask for |
| A `metro.config` whose `resolveRequest` pins React and React Native to the app's copy | Unnecessary once the lockfile holds one of each, and it would hide a second copy where the overrides prevent one |
| A Babel configuration file | Under `"type": "module"` a `babel.config.js` is an ES module, which Babel loads only asynchronously where Metro's transformer is synchronous; a `.cjs` wants CommonJS globals in the root ESLint configuration. With none, Metro and jest-expo both use Expo's preset |
| Jest 30; `test-renderer` 1.3.0; React Native Testing Library 13 | jest-expo 57 is built on Jest 29. `test-renderer` 1.3.0 stands on a reconciler that peers React 19.3. Version 13 renders through `react-test-renderer`, which React 19 deprecates |
| `@types/jest` and ambient globals | Every source file would see `describe`, and the repository's Vitest tests import theirs too |
| jest-expo's list of the packages Jest transforms | Under pnpm's layout it is read at each package's own folder, so every dependency published as ES modules alone would have to be on it, and the next one added fails with a syntax error until somebody knows to add it. Transforming everything costs seconds |
| The real op-sqlite under Jest, behind a fake of its native proxy | The real module would load and fail later, obscurely. The stand-in's `open` throws: no test opens a database |
| The polyfills loaded over Node's whole `Intl` under Jest | The ones that fill only what is missing would install nothing, and a test would pass through Node's ICU, which no device has |
| `@types/node` in the app's project; `expo/types` whole; Expo's base tsconfig; the `react-native` condition | `Buffer` and `fs` would typecheck in code that runs on Hermes; `expo/types` adds react-native-web's props to React Native's components; the base has the DOM's library and no strict family; and the condition would typecheck other packages' sources under this workspace's flags. `build/` and `e2e/` are projects of their own, on Node's types |
| `app.config.ts` importing `@household/tokens` for the fonts | Expo's loader compiles the configuration alone, and its `require` of a workspace package would be Node's own, of a TypeScript source: that works on Node 24, by type stripping, and not on whatever Node a builder has. A test holds the two lists to each other |
| expo-router left to find its routes; the routes under `src/app` | It takes `src/app` before `app` where both exist, and would make a route of the table of routes, the root layout and every test beside them: seen, an export failed on a test's import |
| Typed routes (`experiments.typedRoutes`) | `expo start` then writes a declaration file that pulls `expo/types` whole into the project, and rewrites the tsconfig's `include` through a parser that drops its comments |
| A turbo task of its own for the export | The web's build has none either: whoever exports generates first, as CI does |
| An override to a patched `braces` or `node-forge`; Metro left out of the install, as item 18 left it; `--ignore` flags in the audit's script | Neither has a patched release; the app is bundled by Metro; and a flag in a script has nowhere to write its reason, where the workspace's file is read by the script and by CI alike |
| `decode-uri-component` overridden to its patched release | It is an ES module with one default export, and `query-string` 7 `require`s it and calls what it is given, which under Metro is the module's namespace and no function: a link's query would stop parsing |
| `device` among the server's segments; a `device` part | It is not the server's, and three tests say what those segments are. A part would give the web a loader for words it never draws |
| The account's language rule in the session's provider, as the web has it; the account's language shown and not kept | The session would derive again a rule that is i18n's. The next start would draw in the device's language until the session was read |
| `DateTimeFormat` polyfilled too, so that dates match Node's; `getCanonicalLocales` polyfilled; plurals and numbers polyfilled only where missing | The first is megabytes of time-zone data for what Hermes has; Hermes has the second; and with the third a device would format a number with its own ICU on Android and with Foundation on iOS, and the vectors would hold neither |
| `react-native-get-random-values` | A further native module for what expo-crypto, which is the SDK's own, does in an installer of six lines with a test |
| `@ibm/plex-sans` and `@ibm/plex-mono`, which the web's faces come from; `@ibm/plex` whole; the files committed; the `woff2` converted as the workspace generates | The first two hold `woff` and `woff2` alone, and run a telemetry script as they install. The monolith has the TTFs in 186 MB and ten thousand files, with the same script. ADR 0024 rejected committing them. And a decoder and a build step for what a package already holds |
| A second list of the faces' files in their test; the test in the app | The test and the app would each know where a family's file is. Jest in the app would need Node's types in the app's project |
| expo-font's plain list of paths on Android; the fonts loaded at run time (`useFonts`) | Android then knows a file by its file's name, which is not the family the tokens name. Loaded at run time, text is drawn in the system's face until they arrive, at every launch |
| Scaling left to the operating system (`allowFontScaling`) | Nothing could hold the text at 200 % or draw a harness cell at a scale the device is not set to, and a line's height and a target's size would not follow |
| A density mode; a `ThemeScope` that paints a ground of its own | Comfortable is the phone's only density (01-foundations). A cell would be painted twice: what stands in a scope paints its own |
| `Text` with a free `style`; glyphs at a fixed size | A colour or a size given there is outside the tokens and the scale: it takes layout alone. A 16 pt mark beside 32 pt text |
| `Button` taking any node as its children; a `disabled` prop on it | Its name could be empty, and the literal-string lint could not see it. A control that cannot act is absent; one that takes no press while another's write is on its way says so and stays |
| expo-router's default error screen | English, and it shows a stack. The app's own stands on providers of its own, in the device's language |
| The dev screens' gate as one imported constant; `require()` behind the condition | Metro folds a condition only where it stands: with the expression written out in each route, a production export holds none of the dev screens' strings. `require` needs a suppression with an issue, and its result is untyped |
| Metro's cache trusted between exports; a `--no-bytecode` export for the check | The cache does not key on the variable: an export made with it reused cached transforms and held no dev screen, and the reverse would put them in a store's build. The second would check another artefact than the one shipped |
| The session's providers and the toasts' written into the root layout, and the replica's provider and the bars into the household's | Each is a file of its own that the layout composes, so a layout is edited for none of them |
| A rule against a fixed height around text; a rule for contrast; a rule that a banner was announced | An avatar and a hold's ring are fixed boxes that grow with the scale, which a rule could not tell from a row. The tokens' own test holds contrast. An announcement is a call and no tree: each component's test spies on it |
| A status mark, a hold and a flow's target found by their words | Five languages. A fixed `testID` on a shipped component is how a rule and a flow find it |
| A drawing known to the rules by one platform's host name; react-native-svg stood in for by one name under Jest; a rule for each platform | react-native-svg draws another view on Android, so a status mark drawn as Android was read as one with no glyph. Under a stand-in the rules would hold a tree no device draws. And it is one fact with two names |
| A banner whose children are any node, as the web's; its words read back out of its children; Android's live region with an announcement on iOS | Nothing to say aloud. A walk of React elements that breaks at the first component. Two mechanisms for one rule, Android saying an arriving banner twice wherever both fired *(read: `accessibilityLiveRegion` is Android's alone)* |
| A banner's title and its sentence as two announcements; a full stop between them | An urgent one would cut its own title off. A title that ends in a question mark would read *?.* |
| The web's two frames before a region's words (`useDrawnFirst`); a `key` by state on the frame's banners | Both are there so that a region is in the document before its words. An announcement needs no region, and a banner announces again whenever what it says changes |
| The offline bar always said; said only where its owner asks | Opening the harness would say the sentence sixteen times, and opening the app offline would say a bar that is read in its place. With the default off, the bar above a household would have to remember to turn it on, and its whole point is to be said when the connection goes. It is said by default, and its owner says where it stood already |
| A refused form's first field found by asking the tree; by measuring where each field is; by its owner passing the order | There is no document to ask. Measuring is asynchronous, and Jest lays nothing out. The third is a second list of a form's fields. Known limit: a field drawn later than its neighbours enters after them |
| A refusal focusing the field for the keyboard too | The keyboard would rise over the error a sighted member is reading |
| A status's word as a hidden text beside its glyph | React Native has no visually hidden text, only clipped or transparent text, which a screen reader may or may not read. The mark is one accessible element, named by its word |
| Every text of a row a stop of its own; the whole row one accessible element | A row of four swipes. The second would put its trailing action and its conflict control out of a screen reader's reach on iOS *(read)*. A row's words are one element, and its mark and its action each their own |
| The `Request` unpacked into an address and its options; `expo/fetch` imported by name; React Native's `fetch` forced (`EXPO_PUBLIC_USE_RN_FETCH`) | A body would be read as text, which refuses the form an upload sends. The second pins what the runtime already chose, and under Jest its native half is a stand-in. The third is a build-wide switch for no gain |
| A renewal on any `401` | A sign-in that failed, `invalid_credentials`, would rotate the refresh token of whoever is signed in, for nothing |
| A renewal with no answer handing its request's `401` back; a renewal answered with another problem thrown | A member offline would be told that something went wrong at our end. `@household/api` takes a throw for a lost answer and resends, and each resend would ask for the renewal a `429` has just refused |
| A request failed where its token could not be renewed before it lapsed | The token held is sent as it is, and the server says whether it still stands: an answered problem thrown from the transport would be taken for a lost answer |
| The access token's lapse read out of the token | The server's clock against the device's. It is counted from when the pair arrived |
| A renewal failed where its pair could not be written | The old refresh token is used up either way, and the request has a good token: held in memory, the sign-in works until the app is closed |
| One vault entry holding everything; the keychain's default class; `AFTER_FIRST_UNLOCK`; the vault behind Face ID | SecureStore's values are small, and item 29's profiles add and remove one entry without rewriting the others. The default class travels in a backup: a pair restored on to another phone is one sign-in held by two devices, and the first renewal of either ends the other as a reuse, with the email. Nothing reads the vault while the device is locked, so the stricter class costs nothing today. And the app asks for no Face ID (FR-PR1): a prompt would stand in front of every renewal |
| The token store told who listens for an ended sign-in as it is made; what is forgotten with a member held in a React context | The store is made before the provider that listens. The sync library's file says what it removes outside any component, as it is loaded |
| The household a member was last in removed at a sign-out | It is an id and no content, and the twin of the web's key, which a sign-out leaves |
| Why a sign-in ended kept as one of several causes; the notice kept across a restart | The answer names none (Q18). After the app was closed and opened it is a notice nobody asked for; the web's is in memory too |
| The API's clients made as the providers mount | Where a build was told no API, making one throws: it is made when first asked for, and a misconfigured build fails inside the route's own boundary |
| Nothing drawn until the vault is read | The router's stack must be mounted to be told where to go, and the splash is held already for the display's own reads. The session is *unknown* until then |
| The member in every query key | Every screen's key would carry it, and the web's keys would stop being the app's. The cache is one member's at a time, and emptied when its member is forgotten |
| TanStack's own persister | Its throttle writes a cache back after it was removed, and its restore rejects where storage refuses: the web's own reasons (ADR 0025) |
| The query client emptied in the providers' own cleanup | React runs a removed tree's cleanups parent first: the readers let go after the emptying, and each set a day's timer on a read the cache no longer held. It is emptied by a component that stands after everything that reads |
| The device believed on `isInternetReachable`; *unknown* taken for offline | Where the platform cannot say, NetInfo asks a host of Google's. Every read at a cold start would wait for NetInfo's first answer, and a bar would be drawn for a state nobody reported. A network with nothing behind it is a request's own failure to say |
| The offline bar hearing the device by a listener of its own, beside the query client's; a lint that keeps NetInfo to one file; the device asked once more as that file loads | Two stores of one fact, and the query client's is the one that holds a read back, so it is the one the bar must not disagree with: the bar reads what the query client was told. The lint's one rule of restricted imports is spent on `Text` for the same files, where a second block would replace it, so a test of the sources names the file. NetInfo hands a new listener the state it has *(read)* |
| The ended sign-in's notice in the `warning` or the `danger` tone; always announced; never announced | Calm is a design decision of that notice (A-11). A screen that opens with it reads it in its place, and would say it twice; a renewal refused while a visitor sits on the screen would otherwise change it silently |
| A member in no household told the web's sentence, or left with no control | The shared body speaks of *the rest of this page*, and every other way out of the account is inside a household until item 29: the index offers signing out |
| A member in none but suspended households told that they are in none | They are opened at the first of them (D-162), where item 29's lockout stands |
| Navigation driven from a route's guard alone; a `+native-intent` file that rewrites what the system hands over | A pressed notification for a visitor who signed out themselves would not be held, the guard holding nothing for them, and nothing would know that a link changed the household. The second is a file under `app/` that is no route, and runs outside React, with no session |
| *Switched* inferred from any change of household its member did not make, as the web infers it; the hook reading for itself whether its household is in front | On a device the index opening a household after a sign-out and a sign-in would read as a switch. The frame hands the second over: a stack keeps the household a link was opened over mounted underneath |
| The held address in memory alone; held during render, as the web holds it | Signing in may leave the app, for a password manager or a provider's screen, and the system may close it meanwhile. The router has one address for every screen, and as the guarded screen gives way it reads the sign-in's own, which would take the place of what was held |
| expo-notifications called from each file that needs it | One file imports it (`src/push/device.ts`), and every call that can fail on a build with no notifications answers nothing there: Jest's stand-in for its native half throws |
| Expo asked for the token again in order to remove it; *turned off here* kept for the device; the project as a default parameter | A sign-out on a poor connection may not reach Expo's service: the token that was registered is remembered. A shared tablet's profiles each keep their own (D-104). `undefined` passed on purpose would be replaced by the build's |
| A second Android channel for urgent pushes; a notification left unshown while the app is open | The server names no channel, and from Android 8 a notification's own priority is ignored *(read)*. The server has applied its member's mutes and quiet hours already |
| The device's twins of the web's `push.*` words written now | No screen of this item draws them: F-20 is item 29's, which designs the screen they belong to |
| The store's page derived from the app's identifier | Android's could be; iOS's needs the App Store's own number for the app. One rule for both is a setting |
| Nothing said where the store cannot be opened | A press that came to nothing, said to nobody |
| The dev sign-in form checking its fields before it sends; idle again once it has signed in; a `409` that asks for a second step read as an unreadable problem; a refusal's banner left to leave by itself between two presses | It is a dev form, and the server's `422` is what marks a field. A second press would sign in a second time, which ends the sign-in the first made (FR-ID3). It would read as *something went wrong at our end*. Two refusals can arrive in one draw, the banner then never leaves, and the second is said to nobody: it is keyed by the count of presses |
| The way to the dev sign-in behind the imported gate; under a catalog key; as a literal | The export's check fails any import of `src/dev` from outside it, and Metro folds a condition only where it is written. A key for a control no store's build holds. The lint fails a literal: its words are its address |
| No change to the sync library: a storage whose `readFile` answers nothing, and a transport that works the file's place out of the upload's address; a fifth argument to the transport; the file's bytes made lazy; a second option beside `transport` | The type would say bytes and lie to its next reader. The bytes would still be read. The web's and Node's builds would be handed something else. A union on the one option cannot be given both or neither |
| The handed `fetch` with a form; `XMLHttpRequest` with a part given by its URI; the upload in the background session | `expo/fetch` refuses such a part, and reads a file whole and copies it whole again. React Native's networking holds the whole form in memory on iOS *(both read)*. A transfer in the background may end after the JavaScript that awaits it is gone: the queue never hears, and the file is sent whole again at the next run |
| Each waiting file stored under its own name; copied under it before each try | The library asks the storage for a place by the row's id alone, and naming it otherwise changes the web's and Node's builds. A hundred megabytes written twice on iOS, the copy and then the form |
| A way in that takes a file by its place | A second change to the library with nothing to exercise it: no capture surface exists. Item 30's |
| A replica's file named for the household alone, as the web's; a folder in the database's name | D-187. The SDK is handed a name and op-sqlite a directory apart: the library passes no location, and adding one is a change nobody asked for |
| One holder and a second that waits, as the web's lock; the second taking it from the first | A dev screen drawn over a household that is still mounted under it would wait for ever. The household underneath would hold a closed replica when its member went back |
| The replica connected by each provider; the sync library's file fetched when a replica is first opened, as the web's | A second holder's `connect()` reconnects a replica that is connected. There is no first download to keep small, and the file must be loaded as the app starts, to say what a sign-in's end removes |
| A replica opened for whatever id the address holds | A link to any UUID would make a file, and a replica asking every few seconds for credentials it is refused |
| A household's own answer read in three places, the frame's, the replica's and the bar's; every screen reading it for itself, with no context from the frame; the member's id in what is read | One reading, asked only for a member and of an id that can be a household's, under one key and so in one request. Every screen would have four states to draw, which the frame draws once and hands down already read. The provider has the session at hand |
| The web's *Reload* where a replica cannot be opened | A device has no page to reload: without a way to ask again its member would have to leave the household and come back |
| *Receiving* read off `connecting` or `hasSynced` | ADR 0026: every retry is connecting, and a replica opened again has synced before and has not tried yet |
| The file deleted, and that called the wipe; the removal waited for by the sign-out; not even its note waited for; every noted replica removed whose member is not the one signed in | A file that could not be deleted would keep its member's rows until some later start, and the deletion is the uncertain half. A sign-out's screen would be held by SQLite. An app killed after the sign-out and before the note would never remove anything. The session hands out one member, and item 29 signs several in |
| The database's file deleted through expo-file-system; deleted with no checkpoint first | Its default place is op-sqlite's own, which on Android is outside the directories expo-file-system may touch *(read)*. A log left by a run that ended badly, found later beside a new file of the same name, is read into it |
| A replica opened though what an ended sign-in left of it could not be emptied; one whose sign-in ended as it was opening let open and then closed | What an ended sign-in left would be drawn as the new one's. A file made for nobody, with a note that says it is kept |
| A note left of a replica whose sign-in ended before the note was asked for | It is two ids and no content, and is cleared at that member's next sign-in; but it says that a replica is kept which never was, on a device whose rule is that what it keeps of a member goes with their sign-in. The opening asks whether its sign-in has gone before it notes itself, as well as after |
| `onRevoked` handed to the replica | A second path to an end the session has reached already |
| The sentence for the settings' addresses left out of the bar until item 29 has screens there | The addresses are real, and a push names them: the bar over *not available* there would promise that changes are saved |
| The inbox saying nothing after *Try again*; the focus moved to its list | The control that was pressed leaves with its sentence. Where one state takes another's place no element outlives both: what trying again came to is announced |
| The focus moved by an effect on the inbox's entries; whenever an entry leaves | On iOS the sheet goes after the row and on Android before it *(read)*: an effect steals the focus from under a leaving sheet, or misses the row. A row the replica sent by itself would take the focus from wherever its member was. It is moved once the sheet says that it has gone |
| The focus left to the platform once the inbox's last row is answered; a wrapper round the list as its place, as the web's; the empty sentence announced | The web puts it on the list's own place (D-166), and a device's is the lead while rows are drawn and the empty sentence once none is. An accessible view round the list closes its rows to a screen reader on iOS *(read)*. And a focus that is nowhere is still nowhere after an announcement |
| A resolver unmounted as its answer goes, as the web's; the confirmation and its sheet closed at once | A modal unmounted says nothing of having gone, and iOS refuses what is presented meanwhile *(read)*. A controller told to dismiss while the modal it presented is leaving may stay: unverified either way, so the order that cannot fail was taken |
| A conflict's two versions side by side | A sheet on a phone at 200 % has room for one label and its value: they stand one under the other |
| The dev screen's live replica read from the household underneath it; the replica's report brought forward in the build the flows walk | Another screen's provider is not this one's context. A second behaviour that only a test's build has: the dev screen has a control that has the replica report now |
| The guard around the household's navigator | A layout that draws no navigator loses the rest of the address: a visitor's link to a screen of a household was held as a link to its Home |
| The household as a parameter of one route of the root's stack; a `key` by household under the layout | The router compares routes by their names, and a parameter only where it is a route's whole name *(read, and seen under Jest)*: another household's screen was drawn in the first one's frame. With a stack of households one layout is one household's: a key could be made to matter by no test, and was taken away |
| A stack with the bar drawn under it; expo-router's headless tabs; a `(tabs)` group under a stack | A tab's own screen would be replaced at every press and lose its place. A second router to learn for what the standard navigator's `tabBar` does. A route's file is written from its address (`fileOf`), and a group is in no address |
| A place opened by the navigator's name for its route; the open place read from the app's address | A household's address always carries the household, and a jump by name carries none. The address is the whole app's: a household underneath another would read the one on top |
| More drawn as open over *not available* | The address opened nothing, and a slot that says otherwise is a small lie about where its member is |
| Add left out of the derivation until its sheet exists; a placeholder sheet | Two rules for one slot. The sheet is item 38's, and a test holds the slot shut until something is behind it |
| The prototype's three lines for More; `nav.more` as a shared key | Not among the vendored glyphs. The web has no More, and a shared key is in its first download |
| `tablist` on both platforms; a label built as *Home, tab, 1 of 3* | On iOS neither `tab` nor `tablist` maps to a trait *(read)*: a slot would be read by its name and *selected*, with nothing that says it is a tab. The second is English |
| The open slot's word in the accent | The accent on that surface is no declared text pair. The open slot is its `selected` state, a rule above it and its word's weight |
| A target's least width on each slot; five shares stretched over a tablet; a bar down the side | Five slots of 88 pt do not fit a phone at 200 %: a share of the bar holds the 44 pt floor. F-11 says not to stretch. The design keeps the tab bar on a tablet |
| The bar reading the window itself; every bar telling the toasts its height | The dev screen draws a phone's bar and a tablet's on one device. Two households' bars are mounted at once after a link, and the one underneath was left with toasts over it once the one on top had gone |
| The safe area overridden under the frame, so that a plain screen pads nothing; one app bar drawn by the layout from a table of titles | A dialog reads the same context from inside a `Modal`, which is a window of its own and needs the real insets. A screen's title is the screen's (D-188) |
| A household's screen drawn in a plain `Screen`, as the inbox first was; a lint that fails one | Under the frame a plain screen pads the top a second time and has no app bar. A route's screen is found through its route's file, which a lint does not follow: a test of the routes reads the sources. What the frame draws in a screen's place, a wait, *could not be read* and *not available*, is a plain screen rightly, the frame padding nothing until the household is read |
| The household's name under the title; the title in the navigator's options | The order a screen reader meets them in is the household, then the title. Nothing draws a navigator's title |
| Back drawn wherever the router can go back | After Home and then Today, Today could go back. It is drawn where the screen says it was reached from another |
| The panes' room measured by layout | Jest lays nothing out, and the shell's panes are the window's. The rule is the room and not the device: a large phone on its side is drawn as a tablet is |
| The arrangement in a store outside React, as the web's; read by each screen | Storage answers later on a device, so every reader would have a *not read yet* to draw, and More would be drawn in the product's order for a moment and then in its member's. The frame reads it before the shell is drawn |
| The handle as a button; custom-named actions on a button | A button a tap does nothing to, whose registered name says *use arrow keys*. `increment` and `decrement` are an adjustable's own actions on both platforms |
| A move said by a live region; the focus following a hidden row to its *Show* control | A device has no live region on both platforms. The row's name is where a reader starts |
| Arrange's sections laid out by a `wide` prop; in the prototype's tablet order | The row's own wrap does it in any room, a pane's too. One reading order in both layouts |
| The way to the inbox always listed; a row of More as a list row with a link at its end; its name left to its text | D-191. A 44 pt word at the end of a row that is itself the obvious target. A count beside the words could be read after the sentence |
| *Not available* leading on by a push; the way back from a switched household by `router.back()`, or by a replace | Back would return to the address that opened nothing. `back` is right only while nothing was opened since the link, and a replace would take the link's target away |
| The dev screen's two text sizes by the toolbar alone; a scope of scale in the display's provider | The page is to show both at once. No member's screen wants one |
| The focus put on a dialog's first control, as the web's; at the commit | A screen reader reads on from where its focus is put: from the title it reads the description and then the choices. Before the platform says that the modal is shown there is nothing on the screen to focus |
| The ground named and within a screen reader's reach | An unnamed button the size of the screen is what it would land on first. It has the close control, the choices and its own escape |
| A side panel; a grabber on a sheet; a swipe that closes one | 02-components: mobile prefers sheets, and a tablet's is a sheet of a bounded width. A grabber that cannot be dragged says that it can. No gesture is the only way to do a thing |
| The modal sliding in; an entrance of the app's own; portrait as a modal's only orientation | A slide moves the veil with the sheet. The second is another thing to keep in step with the platform's own presentation. The third is `Modal`'s default, which would hold one upright on a tablet on its side |
| A colour token for the veil | ADR 0025: none is invented for it. It is the theme's darkest surface at an opacity |
| A menu's sheet given a title of its own; its trigger wrapped in a view; an empty menu's sheet | A second name for one control. An element between the row and its control, and focusing a wrapper is not focusing the control. A control that cannot act is absent, its trigger too |
| A toast's dwell held only while a screen reader's focus is on it; Android's recommended timeout; held while a keyboard's focus is on its control | React Native has no event for where the accessibility focus is. The second is Android's alone. The third is a second flag, and a toast removed from under the focus never says that it lost it |
| The dwell as a timer of the drawn toast; the hosts ordered by when they entered; a portal | A toast is drawn anew when a modal opens or closes around it, and its dwell would begin again. React runs a child's effect before its parent's, so of two modals that open at once the outer would be taken for the top. React Native has no portal across a native modal |
| The toasts' provider measuring the bar; drawing its children in a fragment; reading the safe area itself | It is above the router, and the bar inside it. Their region is placed over the foot of a view the provider owns. The safe area is read where a toast is drawn, under whatever provides it there |
| The platform's pickers for a select, and `combobox` as its role; the platform's switch | A wheel and a dialog, in neither the app's type nor the reader's scale; iOS has no trait for the role *(read)*. One size whatever the text is, and a second target inside its row |
| A select with nothing chosen taking its first option; a radio option that is disabled; a stepper's buttons disabled at its bound | D-172. Absence: an option that cannot be chosen is not offered, and a control that cannot act is not drawn |
| One keyboard for the stepper; its two actions on a wrapper; with no label | The digits' keyboard has no minus. An accessible wrapper hides the field and the two buttons inside it on iOS, and an action with no label is listed under its English identifier *(both read)* |
| The password's *Show* as a toggle button with `selected` | iOS gives it the button's trait alone *(read)*, and what *selected* means of *Show* is not said. It is a switch |
| The prototype's 20 pt box for a checkbox; a link in a row underlined | The base set's smallest reviewed glyph is 20, which fills such a box to its edge. `Text` takes no decoration: a chevron after the word is the more-than-colour |
| The ring as a `Pressable`; a plain view with `onClick` as the button | Its press-out comes up to 130 ms late, a finger slid off and back begins a hold nobody began, and on a release it calls press-out and then press in one turn, so one control could not tell its own touch from a keyboard's. `onClick` is not in React Native's public types for a view |
| Where the finger is, read from each move's own coordinates; the native responder blocked | Their meaning off the target differs by platform, and the second is Android's alone. A scroll that begins under the finger still ends the hold on both, which then says *Keep holding* |
| The hold ended by the animation's callback; the native driver; a ring of two rotating halves | Under Jest the animation finishes at once, and on a device a busy thread would stretch the hold. The native driver does not drive a drawing's stroke. Four views and a mask for one small ring |
| The hold's words as the button's accessibility value; its failure said at once; a word of its own for the `activate` action | iOS would say the changed value of the focused element and the announcement both *(read)*. An urgent one would cut *Completing* off. The control's own name does |
| A completed hold saying nothing of itself; a completion that throws swallowed | A reader who comes back to it would hear a button that does nothing: it says `disabled`, and `busy` while completing, and stays. An owner's bug would be said as a refused write |
| A list's rule as each row's bottom border; a row held to a number of lines; a money value held to one | A row does not know that it is last. Truncation removes meaning, and a rule fails it; an amount is kept together by the non-breaking spaces of its locale's own format |
| A flow chart laid out by the window; a side that fills its column when stacked | The window is not the pane. In a column of no fixed height it is given none, and the two lists overlap |
| An estimated column dashed on three sides, as the web's | React Native draws a dashed border as one path round the whole box, in one width and one colour *(read)*: it is dashed on all four |
| A badge in a status colour; as a bare dot; with a name of its own | Reserved (01-foundations). 02-components forbids it. What is counted is its owner's to say |
| The harness drawing one body until asked; as a virtual list; its cells always side by side; the web's fixture sentences | A flow would not find a cell of another body without knowing of the chooser, and it can be narrowed to one. Jest would draw ten cells of 192. 170 pt a cell at 200 %. The web's are the prototype's, which name what was withdrawn and say *past due*: the phone's say what the product does |
| The band behind Android's navigation buttons mended without a native module: the platform's contrast turned off by a plugin of the app's; `Appearance.setColorScheme` | With no scrim the buttons' ink follows the device's night mode, light on a light ground where the app is light on a dark device, which is worse than a band that does not match. The second changes what the `system` choice reads, and not the bar that was seen *(both read)*. `expo-navigation-bar` would set it, one native module more, which is left to decide |
| The jobs filtered by the workflow's own `paths`; a third-party action that filters; the API's list of a pull request's files | It filters the whole workflow, and a check that never reports stays pending where it is required. An action for one `git diff`. A token and a page limit for the same answer |
| The server's sources and the compose file among what sets the device jobs off; the contract | Two device jobs on nearly every pull request. A server change that breaks a flow is found by the next change to the app, and the typed client's breakage is the typecheck's |
| The budget as steps of the Android job; Metro's cache cleared by hand between the two; the export after the flows | Metro's cache does not know of the variable: the build made second would be made of the first's transforms. A path of Metro's own that the workflow would have to know. The budget would go unchecked when a flow fails |
| The budget counted compressed, as the web's; a limit written beside what was measured; the plain JavaScript counted too | Nothing downloads the bytecode apart from the binary, whose compression is the store's. Two numbers to keep in step, where the rule is one. An export without bytecode is another artefact than the one a build embeds |
| A debug build under the flows; a fourth variant for them; every Android ABI; both simulator architectures | It loads its JavaScript from Metro: the job would run a bundler and prove another artefact. An identifier, a scheme and a profile for something no member installs. Three ABIs compile the native code again for devices the job does not have, and a precompiled framework without the second slice would fail the link for nothing |
| The unused permissions removed from staging and production alone | Then no build that runs on a device goes without them, and whether SecureStore and NetInfo are well without theirs would first be learned in a staging build |
| A plugin of the app's that deletes the dev launcher's two keys | Expo's own build phase does, and a second mechanism would have to be ordered against the first. The iOS job reads the built app, since reading the plugin does not show that the phase runs |
| The permissions asserted on the configuration alone; the prebuild's own code called in the test; the list in the test alone; held right after the build; the reasons in `app.config.ts` | It would hold what the configuration says and not what a manifest ends with. Not resolvable from the app under pnpm without naming it a dependency. The merged list exists only in a build. A list that moved would skip the stack's steps and hide whether the app still runs. Node cannot import that file |
| The sixteen launcher-badge permissions kept in case | FR-PR1 is about what a module uses now. The runbook says what bringing a badge back takes |
| Maestro by its documented installer; a composite action for it | It runs whatever that address serves on the day, in a workflow where every action is pinned by commit. A new place for six lines |
| `actions/setup-java`; the emulator's snapshot cached; the pods, Xcode's output and Gradle's build outputs cached; `restore-keys` | An action to install what the image holds. A cache for a boot of a minute. What a build made, restored under another commit, is not safe to trust. A cache that only grows. All of Gradle's own folder was 1.6 GB: its downloads alone are kept |
| An emulator with Google's APIs; at API 32, which Maestro's own CI uses | The app needs no Play services to start. The floor is 29, and the oldest Android is where the engine screen says most |
| `macos-latest`; an existing simulator picked from the image's list | It moves, and the Xcode and the runtime are one image's. More to get wrong than three names |
| Xcode's raw output; `-quiet` | Tens of thousands of lines in the job's log. A hang would show nothing. The whole output is in the artifact where the build failed |
| The flows run by a line of the workflow; by a shell script | The emulator's action runs each line as a command of its own and stops at the first failure. Nothing here lints Bash, where TypeScript is typechecked with the app |
| Flows kept out of a run by their folder | A flow moves between runs by losing a tag, a diff of one line |
| The flows trusted; read with a YAML parser; their names generated from the components, or collected by drawing each dev page | A wrong name is otherwise found by a runner a quarter of an hour in. A dependency for files regular enough for patterns. A component is no module the flows' project can import, and a sheet's names exist only once it is open. What the test does not catch is a name spelt right that its screen does not draw |
| The theme asserted by a screenshot; the member made by hand-written requests | Nothing asserted: it is read off the toolbar's control, whose words name the mode. The typecheck is the one thing here that can hold the script to the contract |
| The stack started after the flows; the flows run only where the stack came up | A failure of the plumbing would hide whether the app launches at all |
| Artifacts kept of a failed run alone | A screenshot is the one place the faces and the two themes are seen |
| The iOS dialog answered by its words; the link's flow dropped; the sign-in's control leading straight to the dev index, or a control on the toolbar | It carries no `testID`, so a flow would select by the system's English, and Maestro's own issue 2610 reports that tap failing on hosted runners. A link would then be proven on no device: it is sent on Android. The first is another screen's control, and the toolbar is the display's modes |
| The flows relying on the order they run in | Maestro promises none: each flow starts as an installation that kept nothing |

## Consequences

- The three pins, `react`, `react-dom` and `react-native`, move together when the app moves to
  an SDK, and the web moves with them; `test-renderer` moves with React's minor. A native
  module is added with the SDK's own range (`expo install --check` says when one is off), and
  `pnpm-workspace.yaml` is read afterwards for an exclusion pnpm may have appended.
- An export made with `EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS` and the next one made without it are
  each made with Metro's cache cleared, which the `export` script does; `check` is what catches
  one that was not. Before an export or `expo start` outside turbo, `pnpm exec turbo run gen`.
- A region's own conventions are not on a device: `de-AT`, `de-CH` and `en-GB` count and group
  as their language does, where the web formats them with the browser's whole CLDR. What a date
  prints on a device is its operating system's.
- The keychain's class is right while nothing reads the vault with the device locked. The day
  something does, a silent push that syncs or a background task, it becomes
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, and an item's class is changed by writing it again.
- A device whose renewal's answer was lost for longer than D-98's minute is signed out, loses
  what it had not sent, and its member is emailed the takeover notice. How long a lost answer
  may be retried for is between the theft the minute bounds and the promise that nothing queued
  is lost (PRD 03 §2): **item 53** looks at it beside Q18.
- A household that another was opened over stays mounted underneath, its replica open, until
  its member goes back; each *Back to …* of the switched banner stacks one more. **Item 29**'s
  switcher replaces, and does not navigate.
- With a screen reader on, a toast stays until it is put away, and several can stand at once
  for a reader who dismisses none. Whether a newer toast releases the older ones is a product
  decision for the first module that raises many.
- With nothing waiting the inbox has no row, and is reached by its address alone until
  **item 29**'s sync health lists it. A replica reports itself a quarter of an hour after it
  first syncs and not as it opens, so a household's clients name a phone only then (D-178):
  item 29's sync health reports as it opens, as the web's does (D-181). The dev screen's
  control that reports now is for the flow.
- **Item 29** takes the seams this leaves: the sign-in screen's place (`src/session/SignIn.tsx`)
  and `signedIn`, which a sign-in the server answered is handed to; several profiles' sign-ins
  in the token store, of which one is in use; the household's name in the app bar as the
  switcher's control (`onSwitch`); the place under the offline bar for the one entitlement
  banner, and the lockout where the frame draws *not available* for a household the member's
  list still names; `usePush()` for F-20, with the device's own words for it; sync health over
  the replica the provider holds; and the takeover notice where the ended sign-in is said.
- **Item 30** makes the first EAS project and build: nothing of `eas.json` has run, nor the
  script that generates on the builder (`eas-build-post-install`), and until a project exists
  no build can ask for a push token. It gives the app a link host and its association files,
  the scheme alone opening it today, and the store's pages. Its first upload route must not
  take the part's file name for the file's, which is the row's id on a device; the way in still
  takes bytes, so a camera's file would be read whole once; and it takes `awaiting` off the
  flow of the replica and adds the one that reads the household's clients.
- **Item 33**, the first module with screens on a device, adds its line to
  `src/modules/registry.ts`, its routes to `src/app/paths.ts` and `app/`, and the place they
  stand under to `src/shell/tabs.ts`. The bar draws Add as soon as a registered module has a
  `capture` surface its member may create in, and a test fails until something is behind the
  slot: **item 38** builds the sheet.
- **Item 36** gives the arrangement a store, which takes the place of AsyncStorage's
  (`src/shell/arrangement.ts`), as it does of the browser's (D-155).
- **Item 93** generates the permissions' justification table from the two lists,
  `build/asked.ts` and `unusedPermissions`. `RECEIVE_BOOT_COMPLETED` is asked for with the
  other notification permissions and serves notifications scheduled on the device, of which the
  app has none: a stricter reading of FR-PR1 removes it.
- **Item 95**'s VoiceOver and TalkBack checklist is where everything this record marks *(read)*
  is first heard: start at the hold, a modal's focus, the tab bar and the arrange handle.
- Android has one notification channel, of default importance, named in the app's language.
  A channel of its own for urgent pushes is a product decision with a server half, the push
  naming no channel today.
- `expo-localization`'s `supportedLocales`, by which the operating system offers the app's
  language in its own settings, is not set: the UI language is the member's (PRD 03 §9), and
  whether the system's setting may choose it is undecided.
- The upload's cookies cannot be turned off, `File.upload` having no such option. The API sets
  no cookie for a device's sign-in, so there is none to send.
- An ignore for `braces` now exists, so ADR 0024's reason for linting the stylesheets with a
  check of the workspace's own, and not stylelint, no longer holds by itself. Nothing was
  changed for it here.
- The web's harness still draws the prototype's sentences where the phone's were rewritten,
  *past due* and a withdrawn module's name among them: the web's to mend.
- **What would make this worth revisiting**: Expo shipping a `Request` of its own, which the
  transport's test of React Native's classes is where it shows; an SDK whose React the web
  cannot run on; React Native saying where the accessibility focus is, which the toast's dwell
  would then follow; `expo/fetch` taking a file by its place; a patched `braces`, `node-forge`
  or a `query-string` that takes the patched `decode-uri-component`; a hosted runner on which
  a flow can answer the system's own dialog.
- **Run on a device, in CI's runs of 2026-10-10.** On the Android emulator: the app opens at
  sign-in with nothing kept; the engine screen's checks hold on Hermes, the vectors' 87 format
  cases and 8 match cases under the polyfills, the five families registered, the random source
  and the client's name, and a screenshot shows the faces drawn; the theme changes at a press;
  a link in the app's scheme opens its screen; the dev form signs in against the real server
  over plain `http` and the household's Home is drawn, and drawn again after a restart, the
  pair read back from the keystore by a build without the biometric permissions; and the built
  APK asks for nine permissions, each with its reason. On the iOS simulator: the app opens at
  sign-in; the engine screen's checks hold; the theme changes; a sheet opens and closes, and a
  menu's item opens a confirmation once its sheet has gone; and the release build's
  `Info.plist` holds neither of the dev launcher's keys. The flows that read the harness's
  cells and the hold had found their targets on neither platform when this was written, nor
  the primitives' flow on Android, and the step that asks the server for the account's devices
  runs only after every flow has passed: what those read is held by Jest until a run shows it.
- **Not run on a device: the session and the API on iOS.** A macOS runner has no Docker, so no
  flow signs in on iOS: the keychain, the bearer, the renewal, the household's frame and the
  replica have run there on nothing. On neither platform has a renewal at a token's real lapse
  run, nor the end of a sign-in and the removal that follows, nor a restore from a backup;
  that the native half of `expo/fetch` honours `credentials: 'omit'` is read.
- **Not run on a device: the replica.** Its flow is written ahead of its screens' names and is
  taken by no run yet: that op-sqlite, PowerSync's extension and the SDK link, that a replica
  opens, receives and reports with the app's name, and that the offline bar arrives and leaves
  are believed from the conformance suite, which holds the library on Node's SQLite, and from
  Jest. That op-sqlite's own deletion removes PowerSync's file, and that expo-router loads
  every route's file as the app starts, so that the forgetter is registered before a sign-in
  can end, are read.
- **Not run at all: an upload, a push, and EAS.** No route takes a file, so `File.upload` has
  met no server. No EAS project exists, so no permission was asked for, no token registered,
  no notification shown or pressed, and no build made from `eas.json`.
- **Not run on a device: links beyond one.** A link on iOS, which asks first; a link the
  system hands over that names another household, which under Jest is asked of the router as a
  pressed notification asks it; a cold start by a pressed notification; and an address held
  while the app was left to sign in.
- **Not run on a device: most of the shell and the overlays.** Three navigators deep, the
  frame's inset meeting the bar's, the bar's measured height reaching the toasts, a tab's
  screen keeping its place, two panes and the tablet's bar on a tablet; a dialog inside a
  sheet, a toast inside an open sheet, the keyboard under a sheet on Android, and whether
  Android gives the focus back to what opened a modal by itself.
- **Heard by nobody: everything a screen reader does.** No run has VoiceOver or TalkBack on.
  The hold's three activations, the tab bar's traits, the adjustable handle and its two
  actions, a field's label read once on each platform, the focus on a modal's title and back,
  a refusal's focus, every announcement, and a toast that stays while a reader is on are held
  by Jest to what the app declares, and by reading React Native to what a platform makes of
  it.
- **Seen by nobody: what only glass shows.** That nothing is clipped at 200 % on a narrow
  phone, the ring's fill and its steps, the dashed column, a shadow and an outline as the
  tokens say, and Android's weight of a face whose one file is another weight. One thing CI's
  screenshots did show: with the app dark on a device that is light, the band behind Android's
  three navigation buttons stays white. The platform draws it, light or dark by the device's own
  night mode and not by the app's theme *(read)*, and nothing the app links sets it.
