# 0029 — The mobile app runs on the Expo SDK's React, which the workspace moved to, scales its own type and is held to accessibility rules of its own; a device's sign-in is a token pair, and what it keeps is named for its member and removed with their sign-in; the shell stands inside the navigator; and the app is proven on a device in CI alone

- **Status:** Accepted
- **Date:** 2026-10-10
- **Plan item:** 28
- **Decides for:** [06-clients](../prd/06-clients.md) §1 to §8; [02-identity](../prd/02-identity-and-access.md) FR-ID3, FR-ID4, FR-ID7; [03-platform-strands](../prd/03-platform-strands.md) §2, FR-NT1, §9; [05-privacy](../prd/05-privacy-and-compliance.md) FR-PR1; design [01-foundations](../design/01-foundations.md), [02-components](../design/02-components.md), [03-patterns](../design/03-patterns.md) §1, §2, §8, [04-navigation](../design/04-navigation.md) §1, §5, §8, §9, DD-11; D-23, D-25, D-36, D-38, D-98, D-99, D-104, D-105, D-154, D-155, D-178, D-183 to D-197; PL-3, PL-5, PL-13; plan Q6, Q18; the consequences of [ADR 0007](0007-shared-packages-client-catalogs-and-vectors.md), [ADR 0010](0010-mobile-tokens-second-step-providers-and-client-versions.md), [ADR 0019](0019-the-sync-client-library.md), [ADR 0024](0024-design-tokens-icons-and-the-illustration-kit.md), [ADR 0025](0025-the-web-foundation-policy-harness-budget-and-build-id.md), [ADR 0026](0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md) and [ADR 0028](0028-the-catalog-in-parts-the-payment-form-the-entitlement-in-the-shell-and-what-a-household-shows-of-its-data.md) for item 28

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
is `View`, `Pressable`, `Modal`, `Animated` and react-native-svg. Expo's own packages, and the
two others the SDK pins by a range (`react-native-safe-area-context`, `react-native-screens`),
are written with the SDK's ranges, as `expo install` writes them, and everything else is pinned
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
one. One shared sentence is made true of a phone, and has no twin: a kept version's banner
tells its member to copy what they still need (`sync.kept.hint`), so the value of a key–value
pair can be selected (`src/ui/KeyValue.tsx`). *Read*: on iOS a long press on a selectable text
offers Copy, of the whole of it, and on Android the text is told that it is selectable. Not
known, and heard by nobody: what a screen reader makes of it, how Copy is reached with
VoiceOver on, and whether TalkBack then stops on a value apart from its label. The account's
language is followed by one function of the provider (`followAccount`,
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
and motion, kept in AsyncStorage, with no density mode and no scale mode. Where motion is
reduced, by its member's choice or the device's, one screen takes another's place at once in
both of the router's stacks (`src/app/Root.tsx`, `src/shell/HouseholdsLayout.tsx`), as a modal
does: an instant change, and never a slower one. A dev screen may hold
a theme or a scale over them without keeping it (`hold`), and a `ThemeScope` draws a subtree in
a named theme, which is how the harness draws each cell in both.

**A dev screen is in a bundle only where its route's own condition lets it in, and a check of
the export holds that** (D-154). Each file under `app/dev/` writes the condition out,
`__DEV__ || process.env.EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS === '1'`, and loads its screen behind
it with `lazy(() => import(…))`; where it is false the route draws *not available*. The two
controls that lead to the dev screens write it out too, in their markup
(`src/session/SignIn.tsx`, `src/shell/More.tsx`). Metro folds a condition only where it is
written, so a constant imported from elsewhere would not do: `src/dev/gate.ts` is the one place
the condition is written to be read, and nothing imports it. Every dev screen stands in
`DevScreen`, whose `testID` begins with one marker (`src/dev/marker.ts`), and `build/check.ts`
fails an export whose bundle holds the marker, searched for as bytes so that Hermes bytecode is
read as JavaScript is. It fails one that holds a stand-in the same way: what stands in for the
server, the replica or a member in a test is written outside `src/dev`, since a test may import
nothing from there and a dev screen draws over two of them, and each that holds words, five
files, is named in `build/bundles.ts` (`standIns`) with words it alone holds. The two providers
a test alone draws in (`src/session/fixture.tsx`, `src/shell/fixture.tsx`) hold none and are
listed nowhere, the first importing two that are. `build/check.test.ts` reads the condition out
of `gate.ts` and holds every dev route and the two controls to exactly it, and the variable to
being named nowhere else; holds everything outside `src/dev`, the app's entry among it, to
importing nothing from it, by name, behind a call or bare, and the gate to being imported by
nothing at all; and holds each stand-in's words to its own file and to no other source, and
every file outside `src/dev` and `src/test` that is named `*.fixtures.ts`, `standIn.ts` or
`testing.ts` to being on that list. Metro's transform cache does not key on an `EXPO_PUBLIC_*`
variable, so the `export` script clears it every time. The dev screens' words are fixtures in
English, accented under the pseudo-locale (`useSample`), and in no catalog.
The harness at `/dev/harness` is eight data bodies through the twelve states, in both themes at
200 % text, the data table being the web's alone (D-190).

**Where axe stands on the web, fourteen rules stand over the tree a test draws**
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
accessibility tap and a click. `truncated`: no text is held to a number of lines. `reach`:
nothing that takes a press, and no field that is typed in, stands inside what is one thing to a
screen reader, an `accessible` view or another control, where on iOS it would be no element of
its own *(read: `RCTViewComponentView.mm`)*. `wrap`: in a row that wraps, a child that both
grows and shrinks, which is how one says how much room it is to have before its neighbours go
under it, is not the row's only child that flexes: Yoga counts such a child as nothing wide
and breaks no line for it *(read)*, which is how a list row's title came to a letter's width
at 200 % (Consequences). `room`: nothing says its room by a `flexBasis`, which a device
computes once, at the element's first layout, and keeps whatever its style says later *(read,
and seen in CI's tenth run)*: it is said by a `width`, which is read at every layout
(Consequences). What the rule cannot see is a `flex` given to an element that was first laid
out without one, a drawn tree having no history: such an element is drawn anew, by its key,
when its layout changes (Consequences). `state`: a switch, a checkbox and a radio say whether they are
`checked`, and a tab whether it is `selected`. What none of them can hold is anything laid out,
since Jest lays nothing out: a size as a device measures it, a word clipped at 200 %, where a
line broke, `wrap` and `room` reading what a row declares, and `wrap` alone having passed the
row that broke no line on a device; nor contrast, which the tokens' own test holds
pair by pair; nor the order a screen reader walks, nor whether an announcement was heard.
Those are a flow's, which reads the harness at 200 % in both themes, and a person's with
VoiceOver and TalkBack (item 95). An announcement is a call and no tree, so a component's own test spies on
`src/ui/announce.ts`, the one file that calls React Native's `AccessibilityInfo`.

**What a press came to is said through that one file** (D-188). A screen's title is a header,
the first on its screen, which a screen reader lists and moves to *(read)*; a section within a
screen is headed too (`src/shell/Arrange.tsx`, `src/shell/More.tsx`), a device's header having
no level. A refused form's fields enter the form in the order they are drawn, each saying
whether the refusal marks it (`RefusedFields`, `useRefusable`, `src/ui/refusal.ts`), and the
first one marked is given the accessibility focus (`useRefusedField`), the keyboard's left
where it was. A banner's sentence is a string, since it is what is announced, and whatever
else stands under it is its `detail`, which is not. A banner
whose owner says `announce` says its title and its sentence as one announcement as it arrives
and whenever they change, a failure at once and anything else politely; a bar that stood when
its screen opened is read in its place and not said. A banner is said by a screen that is in
front alone (`useInFront`, `src/ui/Screen.tsx`, which `HouseholdScreen` tells from the
navigator): a tab's screen and a household that another was opened over stay mounted, and what
arrives on one out of sight is told to nobody and taken as having stood there when its member
comes back, as the bar above a household's screens is. *At once* is iOS's: on Android React
Native hands an announcement no place in a queue, so a failure is said there as any other is
*(read: `AccessibilityInfo.js`, where `queue` is iOS only)*. What stands in a screen's place
where a read failed (`Unread`, `src/session/guards.tsx`), *please update*
(`src/update/UpdateRequired.tsx`) and what stands where a route failed to draw (`RouteError`,
`src/app/Root.tsx`) open no screen of their own, so each is said as it arrives, its title and
its sentence joined by a line break, as a banner's are: once for each time it arrives, and not
again where only the language changes under it (`useSaidOnArrival`, `src/ui/Screen.tsx`); and
what could not be read is said only where the screen it stands in the place of is the one in
front, which the guard and the household's frame tell it from the navigator. A success that no control of its
screen says is a toast; and a failure that *please update* answers is said by that screen
alone, a sign-out refused so raising no toast over it. What *Try again* came to in the inbox
is said by the inbox in front alone.

**A device signs in with a token pair kept under its member** (`src/session`). The vault is
SecureStore (`vault.ts`, the one file that imports it), every item
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`: `household.device`, the installation's own id;
`household.signins`, who is signed in here and which of them is in use; and
`household.signin.<member>`, a pair with the moment its access token lapses by the device's own
clock. The layout is several sign-ins' from the first, one a member, since a shared tablet holds
several (D-104), which item 29 builds on. The vault answers nothing where nothing is kept, and
rejects where the device will not say what it holds, a keychain shut while the device is
locked *(read in expo-secure-store's sources and run on nothing: Android answers nothing for a
key permanently invalidated and for a value it cannot decrypt after a reinstall; iOS answers
nothing for an item not found and throws any other status)*. On that silence nothing is
removed, and nothing is written either: who is signed in *could not be read*, said in the
device's own words with the way to ask again, which reads the vault again
(`src/session/SessionProvider.tsx`, `Unreachable` in `src/session/guards.tsx`), and until the
vault has said, no sign-in is taken and no installation is named anew (`tokens.ts`: `keep`,
`remove` and `device` reject). A sign-in kept over a list that was never read would be the
only one listed, and what the device kept of every other member, their unsent changes among
it, would be removed as nobody's at the next start. And who is signed in is written before
their pair, in the pair's own turn and written again with it where the keystore would not
take either: a pair left with nobody named is a sign-in the device holds and cannot list.
The API's client
(`src/api/client.ts`, `src/api/transport.ts`) names the app on every request,
`Household-Client: mobile/<version>` with the package's own version, says
`credentials: 'omit'`, and signs with the access token. A token is renewed when a request needs
one within a minute of its lapse, and once more where a request is refused
`401 unauthenticated`, which is read from a copy of the answer, the request then sent again
from a copy of itself. A request is answered by its own sign-in alone: one refused on a token
that was another member's, the one in use until a moment ago, is given no token of the one now
in use, and its own refusal stands. And one that is sent again for want of an answer leaves
as it was signed: the resend stands under the signing (`createMobileClient`,
`src/api/client.ts`), where signed anew at each sending a request that hung while its member
signed out and another signed in left the second time as the other's, with the key it left
with. A token is never renewed on a timer, so a
device that is not being used rotates nothing. One renewal runs at a time, and every request
that needs one meanwhile is served by it. The renewal itself leaves by a client that signs
nothing (`renewal.ts`). The new pair is held in memory before it is written, its writes going
one after another, and one the keystore would not take is written again as a token is next
asked for: the token it replaces is used up either way.

**Only a renewal the server answers `401 refresh_token_invalid` ends a sign-in** (D-187). The
store removes the pair and tells the session, which removes everything else the device kept of
that member (`forget`, `src/session/forget.ts`): what the query client kept of what they read,
the note of their push registration, every replica of theirs with its waiting files and the
changes it had not sent, and the toasts on screen. A renewal that got no answer ends nothing,
and leaves the request it was made for with no answer either, which nothing sends round to
ask for the renewal once more; one answered with
another problem ends nothing, and the request's own `401` stands. A `401` to a request ends
nothing. Signing out removes the device's push registration at the server first, then ends the
sign-in there, and removes what the device kept only once the server has heard or says that it
no longer knows the sign-in. That it no longer knows it is a `401` whose renewal the server
refused, the pair gone with it; a `401` that left the pair where it was, a lapsed token whose
renewal failed for another reason, is the server never having heard, and the sign-out fails as
one that was not reached does. Unreached, the member stays signed in with everything kept, the
device's note of its push registration among it where the server was not told to remove that
either: the note says what the server holds. Where the registration's removal was heard and
the sign-out after it was not, the note has gone with it, and the device is registered again
at its next start, or when a connection next returns. A different
member signing in ends the first one's sign-in at the server, under the first one's token and
whatever that comes to: left alive there it would never lapse (D-99), a sign-in no device
holds, for which the server goes on sending its member's notifications to the device another
now uses. The first one's pair and everything else of theirs
is then removed before anything of the second is kept, and nothing is started again. After a
sign-in that ended from elsewhere the sign-in screen says, in one banner of the `info` tone,
that the device was signed out and that what it kept was removed with any change it had not
sent. It names no cause, the answer naming none (Q18), and is announced only where it arrives
under a screen that is already drawn. A `400 update_required`, from any request, the renewal's,
the replica's and an upload's among them, draws *please update* in every screen's place and
nothing beside it, no route, no link and no registration (D-193). Its one action opens the
app's page in the store, where the build was told of one for the platform it runs on
(`src/update/store.ts`); a build told none draws no control.

**Push is registered for a device that allows it already, and asked for by a press alone**
(D-194; `src/push`). A device whose system permission is granted is registered again for its
member at each sign-in, at each start and whenever a connection returns, a phone being
started with none as a matter of course, Expo's token told to the server with the
installation's id, and the registration is removed at the server before a sign-out. The token
that was registered is remembered under its member, and so is their own choice to turn
notifications off here, which outlives their sign-in; the first is said to the session as
kept of its member, so that a note written back by a registration answered after their
sign-in ended is removed at the next start. Nothing is registered over a choice the device
would not read back, a registration removing the note of it; nor for a member who left while
Expo was asked, the request being signed for whoever is signed in as it leaves. Nor are
notifications turned off where the device would not say whether it holds a registration:
taken for none, the server was asked nothing and the choice kept, the device reading as
turned off while the server went on sending to it. And a
notification's press is taken from the system as it is handed on, which otherwise gives the
last one again to whoever listens next in the same run (`src/push/device.ts`) *(read)*. The
system's question is put by
`usePush().ask`, in a press, and by nothing else; no screen of this item draws one, F-20 being
item 29's. A build that was told no EAS project cannot ask Expo for a token: its state is
`unsupported`, and nothing is asked of anybody.

**D-98's window is the server's, and a device cannot close it.** A renewal presents the refresh
token the device holds, and the server uses it up as it answers with the next pair. A device
that was killed between the answer and the write, or closed while its keystore still would not
take the pair, or, the commoner case on a phone, that never received the answer at all, still
holds the used token.
Presented again within a minute, with the next one unused, it is the retry it is, and is
answered with a new pair. Presented after the minute it is a reuse: the server revokes the
family and emails the takeover notice, and the device, answered `401 refresh_token_invalid`,
removes what it kept, its unsent changes among it. So a phone that goes into a lift as its
token is renewed and comes out two minutes later is signed out, and its member is sent an email
that reads as an incident. The client narrows the window as far as it can: one renewal at a
time; the pair held in memory before it is written, and written again until the keystore takes
it; a renewal only when a request needs one; a lost answer resent with the same token as soon
as the platform gives the request up, the app setting no deadline of its own on it; and a
renewal with no answer changing nothing, so that the next presents the same token. It cannot
make the minute longer.

**What a device keeps is named for its member and its household** (D-187): a replica's file,
`household.<member>.<household>.db`, and the directory its waiting files are in; the reads the
query client keeps, `household.queries.<member>`; the pair; and the note of a push token. A
shared tablet holds several profiles signed in at once, each seeing other rows, and a device
removes a member's own whenever their sign-in ends, so D-161's objection to the member in a
name, a copy that stays until its member returns, does not hold here. **And what it keeps of
anybody it holds no sign-in of is removed as the app starts** (`forgetOthers`,
`src/session/forget.ts`; D-161's *whether or not a page knew them when it ended*). Whoever
keeps something named for its member says whom it keeps something of, the kept reads and a
push registration's note by their keys and the replicas by their notes, and the session
removes what is kept of every member the vault names no sign-in of, before anything is read
back and before a sign-in is taken; a keeper that cannot say, its own notes unread, is passed
over until the next start. That is what a run closed between a pair's removal and the rest
left behind, what a keystore that lost a pair left, and what a restore from a backup brought,
which carries what
was kept and never the pair. Where the vault would not say what it holds, nothing is removed.
**And the device's own HTTP cache holds nothing of what the API answers** *(read on both
platforms; what each cache stores is recalled of OkHttp and of `URLCache`, whose sources are
not in the repository; run on no device)*. The client that `expo/fetch` asks through keeps a
cache on disk by itself: on Android React Native's OkHttp client, ten megabytes under the
app's cache directory (`OkHttpClientProvider.kt`, which `ExpoFetchModule.kt` builds its client
from), and on iOS the default session's shared `URLCache` (`ExpoFetchModule.swift`). Each
keeps the `200` of a `GET` that does not forbid it, one asked with a token among them, and
nothing of the app's can empty either. So the account's, the households', a household's and
its members' last answers stayed on the device after their member signed out, beside
everything the app removes, which the fifth review round found by reading what the app links.
`expo/fetch` hands neither platform a request's cache mode, so the answer says it: **the API
answers everything `Cache-Control: no-store`**, unless a handler says otherwise of its own
answer (`NoStore`, `server/internal/platform/httpx/httpx.go`), for a browser as for a device,
and a test holds a device's answers to it (`server/internal/app/device_test.go`). The contract
says so (`docs/api/openapi.yaml`, *Clients*), and D-197.
The query client is one member's at a time: its keys are the web's, without the member in them,
what it kept is restored under the member whose sign-in is in use, and an account it holds is
taken for the one signed in only where its id is theirs. Its keep is the app's own, over
`dehydrate` and `hydrate` (`src/api/keep.ts`), for as long as its member's sign-in and for one
shape, not for one build: what was kept is read back however old it is and whichever build
wrote it, the account, the households and a household's own answer being what the shell and
the replica open on with no connection (PRD 03 §2.1), and what was kept under another number
(`keptShape`) is dropped. The number is raised only by the pull request after which the app
can no longer draw what an earlier one kept, and never by a release, in the manner of the
web's version (D-158): a read is the contract's own answer, which a later build of the same
major reads as it reads an older server's. What is kept is the last answer a read was given,
whatever became of asking again: one asked again of a server that could not be reached, or
that failed or refused for now, stays kept, as the answer it last was, and only the API's own
*not found* takes it off the device, the server's word standing over what was kept. That word
stands from then on: a read the API answered so holds nothing any more, in memory as on the
device, and nor does what is filed under its key, so a re-read that then fails some other way
puts nothing back (`createQueryClient`, `src/api/query.ts`). Left in memory, as TanStack leaves
what an error stood over, a household its member had been taken out of was drawn as theirs
again, its replica opened and its answer written back to the device, at the first re-read that
got no answer. And the
query client lets go of no read for its age while its member is signed in, drawn or not,
since what is written is what it holds (`isKept`, `src/api/query.ts`). A store that would not
be read back as the app started is not written over for the rest of that run: with no
connection the cache holds nothing a second later, and that nothing was written over
everything the device kept. What outlives a
sign-in is
the device's and no member's content: the display modes, the language, a member's arrangement
of their modules (D-155), which household they were last in, their own choice to turn
notifications off on this device, the installation's own id, and the address of the screen a
sign-in ended under, which is held for whoever signs in next.

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
memory on iOS, where `File.upload` hands the system a file on both platforms, on iOS a copy
it first writes, framed as the form, under the app's caches (Consequences). So this one
request names the app, and tells the problem hub of `update_required`, itself; and the queue
takes that answer for no refusal of the file, which waits with its row for the app its member
updates to, as one refused by no problem of the API's does
(`packages/sync/src/attachments.ts`). The upload names
the form's part by the path it sends, which is the row's id: the row carries the file's own
name, and has reached the server before its bytes (D-25). A waiting file is found by its name,
in the directory its replica has now, which the transport and the storage are both handed, and
never at the place the queue was told when the file was added: the queue keeps that place
whole, and iOS gives an app's container another path when the app is updated or restored *(not
run; read in what guards against it, PowerSync's own queue, which looks at each start for a
file whose stored place is broken and finds it again by its name)*. No route takes a file yet,
and the way in, `Replica.attach`, still takes bytes.

**A replica is opened for a member, of a household that is theirs, and once on a device
however many hold it** (`src/sync/open.ts`, the one file of the app that imports the sync
library's values, which a test of the sources holds). The provider
(`src/sync/ReplicaProvider.tsx`) opens nothing on an address's word: only for whoever is signed
in, of a household that the server, or what the device kept of its answer, says is theirs. It
opens through `@household/sync/native` with a `fetch` that names the app and tells the hub of
`update_required` (`namedFetch`), with the file storage and the transport above, and with a
credential that is its member's own. The session's signs with whichever sign-in is in use on
the device, and another member may sign in before this replica has been emptied: so the
replica's asks the session only while its own member's sign-in stands, looked at before the
session is asked and again once it has answered, and throws the library's `Revoked` from then
on.
Holders are counted by the file's name: the household on screen, one underneath it in the
stack, a dev screen over both. The replica is connected once, as it is opened, closed when the
last holder lets go, and one that is being closed is waited out before its file is opened
again. Its phases are opening, open and unavailable, the last with a way to ask again, a device
having no page to reload and no other tab to wait for. The file is imported with the
household's layout, and so loaded as the app starts, which is when it says what the session is
to forget.

**A replica's removal is noted as far as it came, and what failed is taken up at the next
start** (`src/sync/databases.ts`). A replica is noted in AsyncStorage before it is opened, and
one whose note the device would not write is not opened: nothing would mark it when its
member's sign-in ended, and nothing would ever remove it. One that is noted already is opened
with nothing written. And the notes are read, or the step that needed them is not taken: a
device that will not hand its notes over is never read as one that noted nothing, which the
next write would have made true of every other replica it holds, each then a file that
nothing marks and nothing removes. So a replica whose notes could not be read is not opened,
a removal writes nothing back over a reading that failed, and whoever asks whose replicas are
kept is told that it could not be said, and passed over until the next start. When a member's
sign-in ends theirs are marked as leaving, which is all the session waits for; where even
that could not be noted, the next start's sweep marks them, the pair being gone. Each is then
emptied by one path. One that is open is closed, under whoever
still holds it, and never wiped through: its last holder may have closed it first, as a
sign-out's screen does on its way out, and a closed database refuses the wipe, and the library
may have begun to discard it itself, after which its wipe answers at once whatever became of
the first. It is then opened for nobody, with a credential that throws and no server to ask,
wiped and closed. Then its database's file is deleted by op-sqlite itself, after a checkpoint
that truncates its log, and asked for once more, op-sqlite's deletion saying nothing of what
it came to *(read: `OPBridge.cpp`; the second look is held by Jest's stand-in alone)*: one
that still opens has not gone, and the removal has failed. Its files' directory is deleted
whatever became of the database's deletion. The note is written once, after both: dropped,
or, where the deletion failed, saying how far the removal came. What could not be emptied has
its file deleted all the same. Whatever failed is tried again as the file is loaded, before
any replica is
opened. A replica that is still leaving is removed before it is opened again; one that was
emptied and whose file could not be deleted is its member's to open, being empty; one that
could be neither emptied nor deleted is not opened. A sign-in that ends while its replica is on
its way opens nothing. `onRevoked` is not handed to the replica: the refusal that makes the
credential throw has ended the sign-in already.

**"Receiving" is read as the web reads it** (D-105, ADR 0026): true while PowerSync's status is
connected, false once an attempt has failed, for as long as the SDK keeps that failure, and
nothing before that; never off `connecting` nor `hasSynced`. Whether the device is online is
its own word, believed in one direction: NetInfo's `isConnected`, with *unknown* taken for
connected and `isInternetReachable` not read. Nor is it worked out. Left as it comes, the
library asks a host of Google's whether the internet can be reached wherever the platform does
not say, which is on iOS, whose native half says only whether there is a connection: as soon
as anything listens, and from then on each minute while it is answered and every five seconds
while it is not, by the global `fetch`, whether or not its answer is read. So its check is
turned off before the app listens (`reachabilityShouldRun`, `watchConnection`): a request a
minute, at the least, from every iPhone the app is open on, to a host that is
none of the app's, which the product's own rules leave no room for (PRD 05 §1 and §2, D-5:
no third party in the apps, and nothing outside the EU in the product's own requests), is not
what leaving its answer unread was for *(read in NetInfo 12.0.1, its JavaScript and
`ios/RNCNetInfo.mm`; run under Jest over the library's own JavaScript, its native half stood in
for as an iPhone's answers, `src/api/netinfo.test.ts`; and on no device, where nothing reads
what an app asks of the network)*. One file hears it (`src/api/query.ts`, the one
file that imports NetInfo, which a test of the sources holds): it tells TanStack's online
manager, whose focus is the app coming to the front, and a screen reads the manager
(`useOnline`), so the bar cannot say that there is no connection over a read that was sent.
Above a household's screens stands one bar
(`src/sync/HouseholdBars.tsx`): offline, or, with the device online and the replica not
receiving, that sentence in the same place (D-191). Over a household that takes no writes it
promises nothing of a change, and at the addresses whose changes are asked at once (D-170) it
says that a change needs a connection. A bar that arrives, and a sentence that takes another's
place, is said, and by the household in front alone: one that another was opened over stays
mounted with its own bar, the connection goes for both at once, and what stands above it when
its member comes back is taken as having stood there. What is told apart is which sentence it
is and not its words, so the same one in another language is no change: the app's language
follows the account's whenever that is learned, on every screen that is drawn. The bar and a
banner, which are handed words and no key, tell that by the language they were last drawn
in; and a hold-to-complete says its phase as it changes, never its word as that does, and
from a screen in front alone. The app never tells
the replica to connect again.

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
under no place, and no slot says it is open. A slot that opens a place is a `tab`, Add a
`button`, and the row that holds them `tabbar` on iOS and `tablist` elsewhere *(read: on iOS
`tabbar` is the one of the three that maps to a trait)*. On a phone a slot is a share of the
bar, at least 44 pt high at the reader's scale, its label wrapping and never cut; from 744 pt
of room counted in the reader's text each slot is a row, a glyph beside its word, and the slots
stand together in the middle (D-192). The bar in front tells the toasts how high it stands, and
no other does.

**Every screen of a household stands in `HouseholdScreen`** (`src/shell/HouseholdScreen.tsx`):
the app bar, which says the household's name first and the screen's title, a header, after it,
with the way back where the screen says it was reached from another. `src/app/routes.test.ts` reads
the sources and fails a household's route whose screen is drawn in a plain `Screen`, which
under the frame would keep clear of the top a second time and carry no bar. The name is a label
that takes `onSwitch`, by which item 29 makes it the switcher's control. The frame
(`src/shell/HouseholdFrame.tsx`) reads the household, and the member's arrangement of its
modules from AsyncStorage, before anything of the shell is drawn, and draws a wait, *could not
be read*, *not available*, or the bars and the screens under them, with a place under the
offline bar's for item 29's one entitlement banner. It remembers the household as the one its
member was last in while it is the one in front, and so again when they go back to one that
another was opened over, which mounts nothing. **A household's own answer is read in one
place** (`useHousehold`, `src/household/data.ts`), only for a member and of an id that can be a
household's. The frame and the replica's provider read it in the same commit, by one key and so
in one request, and whatever else needs it is handed it, as the bar above the screens is: a
reader that mounts after the answer finds it stale at once and asks again, which is how a
household that was opened came to be asked for twice. That the address opens nothing is the
API's own `404`, a problem with its code (`isAbsent`): a `404` from whatever stands before the
API has said nothing of the household, and is a read that failed. And only an answer ends it:
a re-read that fails after it is no word of the server's, and what is drawn stays *not
available*. The member's list of
households is read with no signal, so that a re-read which began is finished though its reader
has left: where the app opens goes by the list the device kept and leaves for a household at
once, and a re-read given up there never landed, so a household the kept list named and the
server no longer did was where the app opened for good, *not available* leading back to
itself. More lists the modules the member holds
that this build has screens for, in their own order (`src/shell/navigation.ts`, the web's
derivation ported whole), and after them arranging, the way to what needs their attention
while something does, with its count, which the More tab's name carries too (D-191), and
signing out. Two panes are drawn from the same 744 pt (`src/shell/Panes.tsx`), and one where
the left cannot fill a second.

**Arrange's handle is an adjustable, and no button.** Nothing is dragged and no tap moves a
row, so the handle takes no press: it is named *Reorder {name}* and has the two actions
`increment` and `decrement`, labelled *Move up* and *Move down*, and only the moves that exist.
A row is moved from its menu too. A move is announced, and a row that leaves its list for
another takes the accessibility focus with it: that move is said once the focus is where it
goes and not at the press, a screen reader reading what its focus lands on *(the order is the
app's; which of the two is heard is heard by nobody yet)*.

**An address that arrives is the web's own, and one function says what it comes to**
(`src/links/resolve.ts`, D-196). A route is a line of `src/app/paths.ts` and a file under
`app/` that re-exports its screen, which `src/app/routes.test.ts` holds to each other both
ways; the addresses are the web's, since the server writes one into a push's `data.url`, and
one the app has no screen for is the neutral *not available*, inside the household's frame
where it names a household. A pressed notification's address is opened by the app's own router.
A link the system hands over is left to expo-router, and the app does what the router does not
know to: it holds the address for a visitor where it leads into a household, in memory and in
AsyncStorage, since signing in may leave the app, and notes that a link changed the household,
which is said in a banner with the way back. An address that leads into no household is a
screen a visitor may open, and is opened as it is: the sign-in's own, held, sent a member who
had just signed in from the sign-in screen to itself, without end. And a guard holds an
address only while its own screen is the one in front (`Signed`, `src/session/guards.tsx`):
the router's word for where the app is belongs to every screen alike, and a household that
stays mounted underneath another screen would hold that screen's address for its own, and
lead whoever signed in next to it. That a link switched the
household is positive evidence, an address that named
another household than the one on screen, and never inferred from a household having changed.

**Overlays are React Native's `Modal`** (`src/ui/Dialog.tsx`, the one file that draws one;
`Sheet`, `Menu` and `Select` stand on it). The owner decides every close: the system's back, a
screen reader's escape, the ground and a sheet's close control ask. What keeps a screen reader
from what is behind an open one is the platform's own presentation, a window of its own on
Android and a view controller over the whole screen on iOS, and not `accessibilityViewIsModal`,
which is iOS's alone and is said as well *(read; what it adds is heard by nobody)*. The
accessibility focus is put on the title once the platform says the modal is shown, or on what
its owner named instead, and on the title after all where that is not drawn yet; and it is
given back to what opened it once the modal has gone. iOS's host gives it back by itself and
Android's restores none *(read: `RCTModalHostViewComponentView.mm`, `ReactModalHostView.kt`)*,
so the app gives it back wherever an `opener` is named: the inbox names the mark of the row
that was opened, and a refused change's confirmation its *Discard*. Three things follow from
how iOS presents *(read in `RCTModalHostViewComponentView.mm`: a modal is presented by the
nearest view controller, with no queue, and one asked for while another of the same
controller's is still leaving is never drawn)*. A dialog over a sheet is drawn inside the
sheet's children, so that the sheet's own controller presents it. A menu's chosen item acts once its sheet has gone and not as it is
pressed, what it opens being often a confirmation: CI's flow opens one so on the iOS
simulator. A select tells its owner of the choice once its sheet has gone too, for that reason
and so that whatever the choice moves the focus to is not taken back by the sheet as it goes.
And a resolver keeps what it last showed while it leaves, the refused change's sheet staying
until its confirmation has gone; what a decision came to, where it failed, is drawn above the
versions it was about, under which it would be below the fold at 200 %. Toasts are drawn by
the innermost open modal, in a row at its foot, and by the root where none is open, since
under a modal an Undo could not be pressed: the hosts are a stack by depth, and a toast's
dwell is the provider's and not the drawn toast's, so it runs on through a modal that opens or closes around it. A toast with
Undo wraps: its sentence says how much room it is to have, and its controls go under it where
a phone at 200 % has not the room for both. What is drawn over the whole window keeps clear of
the device's sides as of its foot, by the device's own insets, as every screen and bar does: a
modal's ground reaches every edge, and a sheet, a dialog and the toasts' row stand inside them
(`src/ui/Dialog.tsx`, `src/ui/Toast.tsx`). A phone on its side has the housing of its camera at
one side and, on Android with three buttons, their band at the other; on a phone 852 pt
long a sheet's edge was inside such a side from some 150 % of the text and a toast's a little
sooner, each as wide as the screen from 180 % and 160 %, and each stood under what is there by
all but its own padding *(read: the insets are the device's word for what it keeps, and the
arithmetic is the tokens'; seen on no device)*. The toasts on screen go with their member when a
sign-in ends (`onForget`): one names a row of theirs, and its Undo writes to their replica.
**While a
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
of its field. At each key it gives its owner what leaving the field would settle to, the
nearest whole number held to its bounds, while the field goes on showing what was typed: on a
device the press that sends a form takes no focus from the field, and iOS's number pad has no
key that ends the typing *(read)*, so a number typed past a bound stood in the field while the
form sent the one before it. Its owner hears each key's number, those on the way to a longer
one among them, as it already heard one within the bounds on its way. Leaving the field gives
nothing again: given again there, as it first was, what was typed was put back over a number
its owner had changed meanwhile by another control of its form, whose press takes no focus
from the field either. So each key gives its number where that is another than the one its
owner shows, or than the one the typing last came to: an owner that takes a number later than
it is given still shows the one before, and a number typed back to that one would be told to
nobody by what its owner shows alone; and a button's step is counted from the number the
typing last came to, for the same owner. Its count is never
narrower than a target, so that three targets and two gaps
are what it needs, 280 pt at 200 %, which a dialog leaves on a phone 360 pt wide; where there
is less its row wraps and cuts nothing; and where its owner gives it no bounds it is held to
the whole numbers a number holds exactly, twenty-two digits typed having been handed on as
`1e21`. A select's and a menu's opening press put the keyboard away, their sheet taking the
screen from whatever field was being typed in *(read: React Native's modal names the keyboard
nowhere on either platform; what a device then does is seen on none)*. A checkbox, a radio
and a switch are drawn, one row a control. A control that
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
flows, asks the server which devices the account lists and which clients the household does,
and holds the build's permissions to their reasons. `mobile-ios` makes a simulator on a named image and Xcode, installs the pods,
builds, runs the flows that ask nothing of a server, a macOS runner having no Docker, and
reads the built `Info.plist`. The app's unit tests are Jest's, in the job that runs every
package's.

**The build the flows walk is the development variant as a release build, with the dev screens
in it** (`EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS=1`), for the emulator's architecture alone and the
simulator's. It is made in jobs apart from the export, Metro's cache not knowing the variable.
The development variant may speak plain `http` on Android, which the template allows a debug
build alone. The flows (`e2e/flows`) select by `testID` and never by a word, and
`e2e/flows.test.ts` holds each to the app's own names, since nothing where they are written
runs them: its `appId`, a link's scheme and address, and each piece of each `id`. The flows are
twenty-two. Seventeen carry no tag, ask nothing of a server and run on both platforms: the
launch, the engine, the theme, the harness, the primitives, the hold, the shell and the
resolvers, and nine that each read one thing only a device shows, a flow of its own so that
it fails for that alone: a list row at twice the text (`row`), a sync mark that arrives after
its row (`mark`), a drag that begins on a stepper's count (`stepper`), a stepper in a sheet at
twice the text (`sheet`), a select's choices opened with a field's keyboard up (`keyboard`), a
toast with Undo at twice the text (`toast`), a tab bar whose room changes under it
(`turned`), a sheet, a dialog and a toast with the device turned on its side (`sides`,
written after the fifth review round and run on no device yet), and what the app's own
formatters write on a device's `Intl` (`formats`). That
last holds each sample to who writes it (`src/dev/engine/checks.ts`): a number, an amount and
a size, which FormatJS writes on every device, to the very string Node writes, and a date,
which the device's own ICU writes, to its fields in their order, with the spaces, a comma, a
full stop and English's joining word between them folded; what a device wrote another way and
was let is drawn under it. Two more are no flows of the suite (`e2e/flows/kept`): the Android job
runs them before it (`e2e/run.ts`, `--kept`), with the API stopped between the two, to hold
that a device signed in and brought back with the server away, and then started again, still
opens on what it kept of its reads. Five run in the Android job alone. A link (`link`) is
tagged `android`: iOS asks before it opens one that came from outside the app, in a dialog no
`testID` finds. A sign-in that outlasts a restart (`stack`) and signing out (`sign-out`) are
tagged `stack`: they need the API, the sync service and a member, which only that job has, a
macOS runner having no Docker. The replica (`replica`) and an address held for a visitor and
reached once they have signed in (`held`) are tagged both: the one takes the device's
connection away, which Maestro does on Android alone, and the other is sent as a link.
Three tags keep a flow out of a run: `stack`, `android`, and `awaiting`, for a flow written
ahead of its screens, which excuses it its names and which no flow carries now. Maestro is
fetched as its release's own archive and held to its digest (`e2e/install-maestro.sh`), and one
script runs the flows for CI and for a developer (`e2e/run.ts`). It runs once more, in a
session of their own, the flows that failed for no reason of theirs, Maestro's driver on the
device being gone: on iOS a crash of the app in one flow takes the driver with it some minutes
later, and every flow after that (seen in the fifth and sixth runs). A flow that failed for
itself is not run again, and fails the job.

**The dev screens are reached by presses, on both platforms.** On the first run iOS put a
dialog of its own over the app when a flow sent a link, *Open in "Household Dev"?*, which
carries no `testID` and stayed over every flow after it. So the sign-in screen has a control
that leads to the dev sign-in form in a build that holds the dev screens, More has one that
leads a member to their index, the sync screen's live replica needing a member, every dev
screen leads to that index, and the flows walk that: the replica's comes to the sync screen from
More, with the household's own screens, and the replica they opened, still beneath it. The dev
form leads its member on to the address that was held for them, as the sign-in screen said it
would, and to where the app opens where none was. A link is sent on Android alone, by the one
flow that proves one.

**A flow finds a thing by its own `testID`, never as inside another, and on a screen narrowed
to one part.** The fourth run's flows looked for a cell's content as a child of the cell and
found none on either platform: under Fabric a view that is there only to be named is mounted,
and its children are mounted in the nearest ancestor that draws something or is a control
*(read in React Native's source, and seen in the hierarchies Maestro saved)*, so a cell and
what stands in it are neighbours in the tree a flow reads. A thing is found by its own name;
where a state is to be read, by a name only that state draws, or by `selected`. And a dev
screen that is long, the page of primitives, the shell's and sync's, has a control at its head
for each of its parts (`src/dev/Only.tsx`; the harness has its own, by body), which a flow
presses before it looks for anything: a page is hundreds of nodes that a driver reads at every
step, and on Android a swipe that began on a stepper's count scrolled the page no further
(Consequences). What a screen draws later is waited for where it stands: a scroll swipes for
as long as its element is not found, one that has not come yet as one that is further down
*(read in Maestro's source)*. And the tap that brings a toast does not wait for the screen to
settle through the toast's five seconds.

**A build asks its device for what `build/asked.ts` names, each with its reason, and for
nothing else** (FR-PR1). The list a build ends with is in no file: the manifests of the
template and of every library are merged as it is made, and the first build asked for
thirty-one permissions. `unusedPermissions` in `app.config.ts` removes twenty-three of them
from every variant, the development one too, so that the build the flows run is one that goes
without them; a development build alone keeps the one React Native draws its errors by. So a
development build asks for eight, and one a member installs for seven, the app's own guard over
its receivers among them. `VIBRATE` is of the seven as the template's own: no library the app
links asks for it, and it is kept until a device has shown a notification felt without it
(item 30). The Android job reads the list off the APK it built (`aapt2 dump permissions`), the
permissions a manifest asks for from Android 6 on (`uses-permission-sdk-23`) among them, and
`build/apk.ts` fails a permission with no reason and a reason for a permission the build does
not ask for; `build/permissions.test.ts` holds each variant's configuration to the same two
lists through Expo's own introspection. On iOS the configuration writes no usage sentence of
its own, and the dev launcher's plugin, which writes one for the local network, adds the build
phase that takes it out of every build but a debug one: the iOS job reads the release app it
built and fails if it is there. The dev client's plugin also gives a build a scheme of its own
making, `exp+household`, by which a developer's machine opens a development build; the three
variants share the slug, so only a development build is given it (`addGeneratedScheme`,
`app.config.ts`), which the same test holds for each variant on both platforms.

**The budget is each platform's bytecode, what it measured and a fifth** (D-189,
`build/budget.ts`): the `.hbc` files of a production export, in their own bytes, against one
measured number a platform from which the limit is derived. `check` fails an export over
either, and one that holds no bytecode for a platform. Measured on 2026-10-10 with the whole
of this item in it: 6 221 873 bytes for Android and 6 004 499 for iOS, so budgets of 7 466 247
and 7 205 398, of which PowerSync's SDK, the sync library and the sync UI are some 870 kB a
platform.

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
| A device's date held to Node's exact string, as the engine page's `formats` line first held it | An ICU's punctuation and spaces are the platform's and change with its version: the simulator of iOS 26 wrote *Mar 3, 2026 at 6:41 PM*, with a narrow no-break space, where Node writes a comma and a plain one. The fields are what a member reads, and the line holds a date to those, in their order; what FormatJS writes, a number, an amount and a size, is held to the string still |
| `react-native-get-random-values` | A further native module for what expo-crypto, which is the SDK's own, does in an installer of six lines with a test |
| `@ibm/plex-sans` and `@ibm/plex-mono`, which the web's faces come from; `@ibm/plex` whole; the files committed; the `woff2` converted as the workspace generates | The first two hold `woff` and `woff2` alone, and run a telemetry script as they install. The monolith has the TTFs in 186 MB and ten thousand files, with the same script. ADR 0024 rejected committing them. And a decoder and a build step for what a package already holds |
| A second list of the faces' files in their test; the test in the app | The test and the app would each know where a family's file is. Jest in the app would need Node's types in the app's project |
| expo-font's plain list of paths on Android; the fonts loaded at run time (`useFonts`) | Android then knows a file by its file's name *(read)*, which is not the family the tokens name. Loaded at run time, text is drawn in the system's face until they arrive, at every launch |
| Scaling left to the operating system (`allowFontScaling`) | Nothing could hold the text at 200 % or draw a harness cell at a scale the device is not set to, and a line's height and a target's size would not follow |
| A density mode; a `ThemeScope` that paints a ground of its own | Comfortable is the phone's only density (01-foundations). A cell would be painted twice: what stands in a scope paints its own |
| `Text` with a free `style`; glyphs at a fixed size | A colour or a size given there is outside the tokens and the scale: it takes layout alone. A 16 pt mark beside 32 pt text |
| `Button` taking any node as its children; a `disabled` prop on it | Its name could be empty, and the literal-string lint could not see it. A control that cannot act is absent; one that takes no press while another's write is on its way says so and stays |
| expo-router's default error screen | English, and it shows a stack. The app's own stands on providers of its own, in the device's language |
| The dev screens' gate as one imported constant; `require()` behind the condition | Metro folds a condition only where it stands: with the expression written out in each route, a production export holds none of the dev screens' strings. `require` needs a suppression with an issue, and its result is untyped |
| Metro's cache trusted between exports; a `--no-bytecode` export for the check | The cache does not key on the variable: an export made with it reused cached transforms and held no dev screen, and the reverse would put them in a store's build. The second would check another artefact than the one shipped |
| The session's providers and the toasts' written into the root layout, and the replica's provider and the bars into the household's | Each is a file of its own that the layout composes, so a layout is edited for none of them |
| That a store's build holds no stand-in read off the sources' imports, as the dev routes are read; one marker that every stand-in imports | A reading follows only the imports somebody thought to read: the export is what is asked. A shared marker is a line in each file that does nothing but be found. Each file is named by words it alone holds, which a test holds to that file and to no other source: the first try named one by a sentence a dev screen's own fixtures also held, and the check named the wrong file |
| The dev screens reached by a member through a link alone; the dev sign-in form leading on to their index | No flow of both platforms can send a link, and the sync dev screen's live replica needs a member: More has a control, behind the gate's condition written out. The stack's flow waits after that form for the household's Home |
| A focus ring's state kept, and its outline written, by each control that draws one, fourteen places now; one pure function of the theme, the state left in each; a read that could not be made decided in each of four places | The state and its two handlers are the larger half of what was repeated: one hook draws the ring (`useFocusRing`, `src/ui/focus.ts`), in the focus token's colour, and in the toast's own ink on the one ground that token has no declared pair with. And one function says that a read which holds nothing failed, or waits for a connection (`couldNotBeRead`, `src/api/query.ts`) |
| A rule against a fixed height around text; a rule for contrast; a rule that a banner was announced; a rule for where a row's line breaks | An avatar and a hold's ring are fixed boxes that grow with the scale, which a rule could not tell from a row. The tokens' own test holds contrast. An announcement is a call and no tree: each component's test spies on it. Jest lays nothing out: what a row that wraps declares is a rule (`wrap`), and where its line then breaks is a flow's to see |
| A status mark, a hold and a flow's target found by their words | Five languages. A fixed `testID` on a shipped component is how a rule and a flow find it |
| A drawing known to the rules by one platform's host name; react-native-svg stood in for by one name under Jest; a rule for each platform | react-native-svg draws another view on Android, so a status mark drawn as Android was read as one with no glyph. Under a stand-in the rules would hold a tree no device draws. And it is one fact with two names |
| A banner whose children are any node, as the web's; its words read back out of its children; Android's live region with an announcement on iOS | Nothing to say aloud. A walk of React elements that breaks at the first component. Two mechanisms for one rule, Android saying an arriving banner twice wherever both fired *(read: `accessibilityLiveRegion` is Android's alone)* |
| A banner's title and its sentence as two announcements; a full stop between them | An urgent one would cut its own title off. A title that ends in a question mark would read *?.* |
| The web's two frames before a region's words (`useDrawnFirst`); a `key` by state on the frame's banners | Both are there so that a region is in the document before its words. An announcement needs no region, and a banner announces again whenever what it says changes |
| The offline bar always said; said only where its owner asks | Opening the harness would say the sentence sixteen times, and opening the app offline would say a bar that is read in its place. With the default off, the bar above a household would have to remember to turn it on, and its whole point is to be said when the connection goes. It is said by default, and its owner says where it stood already |
| A refused form's first field found by asking the tree; by measuring where each field is; by its owner passing the order | There is no document to ask. Measuring is asynchronous, and Jest lays nothing out. The third is a second list of a form's fields. Known limit: a field drawn later than its neighbours enters after them |
| A refusal focusing the field for the keyboard too | The keyboard would rise over the error a sighted member is reading |
| The keyboard left for the platform to put away as the screen holding its field is replaced; `Button` putting it away whenever it turns busy; the router's stacks putting it away at each change of address | On Android whether it goes is a race *(seen in CI's tenth run: after the dev form's sign-in it stood over the household's tab bar for as long as the flow waited, where three other sign-ins of the same run left none; read: React Native blurs a focused field in the commit that deletes its view, and Android hides the keyboard only for a view still attached to its window)*. A control that is busy is not always its screen's last: one that saves and stays would take the keyboard from a member who is still typing beside it. And at a change of address the field has gone already: `Keyboard.dismiss()` blurs the field that has the focus, and there is none left to ask. The press that leads away knows that it does, and puts the keyboard away itself, while its field is still mounted: the dev form's does, and item 29's forms do (Consequences) |
| `Screen` making room for the keyboard under a field of its own now: `automaticallyAdjustKeyboardInsets` on its scroll view, which is iOS's alone, with a root padded by the keyboard's height or `softwareKeyboardLayoutMode: 'pan'` for Android; a `KeyboardAvoidingView` in `Screen`, as a modal and the toasts stand in one | No screen of this build holds a field, the dev pages apart. The mend is another on each platform, Android's a choice for the whole build, and neither can be run where this was written. A `KeyboardAvoidingView` counts from its place in its parent and not on the screen *(read: `_relativeKeyboardHeight`, `Libraries/Components/Keyboard/KeyboardAvoidingView.js`)*, so in a screen under the frame's bars it would leave their height under the keyboard: a modal's and the toasts' stand at the top of their window, where the two are one. Item 29's first form makes the room, where a device's screenshot can show it (Consequences) |
| A status's word as a hidden text beside its glyph | React Native has no visually hidden text, only clipped or transparent text, which a screen reader may or may not read. The mark is one accessible element, named by its word |
| Every text of a row a stop of its own; the whole row one accessible element | A row of four swipes. The second would put its trailing action and its conflict control out of a screen reader's reach on iOS *(read)*. A row's words are one element, and its mark and its action each their own |
| One constant for the pair of props that hides an element from a screen reader on both platforms | Every place that hides one writes the pair, and none writes half of it; a wrapper is an element more in each |
| One hook for *said once, and not again where only the language changed*, told by a sentence's key and its arguments, in place of the four places that decide what is said again (`stood` in `Banner`, `drawnIn` in `OfflineBar`, `told` in the hold, `useSaidOnArrival`) | They are four answers to four questions. A banner says whatever its sentence becomes, and keeps the language it was last said in, as the offline bar keeps the one it arrived in (`stood`, `drawnIn`): two lines in each. The hold keeps the phase it last told, and what stands in a screen's place says what it arrived as, once, by an effect that runs once: neither keeps a language at all. So one hook would hold two of them. And a banner is handed its sentence as words, which is what it announces: a key beside them would be a second prop on every banner, there for this alone. What it would mend is a banner whose sentence changes in the very draw its language does, which is taken for the same one and not said, where the language changes as the account's is learned or changed |
| The `Request` unpacked into an address and its options; `expo/fetch` imported by name; React Native's `fetch` forced (`EXPO_PUBLIC_USE_RN_FETCH`) | A body would be read as text, which refuses the form an upload sends. The second pins what the runtime already chose, and under Jest its native half is a stand-in. The third is a build-wide switch for no gain |
| The device's HTTP cache kept empty by the app: its requests saying `Cache-Control: no-store` themselves; the device's client built without a cache, by `OkHttpClientProvider.setOkHttpClientFactory` on Android and the session configuration `expo/fetch` takes from its host on iOS; the cache emptied as a sign-in ends. Or the API's header for a device's requests alone | OkHttp heeds such a request *(recalled)*, and whether iOS's cache does is not known here: half a mend, on the platform no flow signs in on. A client with no cache is native code in the application's own class on each platform, of which this app writes none: two config plugins that write Kotlin and Swift, to turn off what one header of the answer turns off. Nothing in JavaScript reaches either cache to empty it. And a browser's cache keeps the same answers no better: the rule is the API's, for every client, held by the server's tests, and the web's own suites, the end-to-end one among them, pass with it where this was written |
| A renewal on any `401` | A sign-in that failed, `invalid_credentials`, would rotate the refresh token of whoever is signed in, for nothing. A second step whose challenge is gone is answered `unauthenticated` all the same, which the answer cannot tell from a refused token: a screen that signs somebody in beside a sign-in in use asks through a client that signs nothing, as the renewal does (item 29) |
| A renewal with no answer handing its request's `401` back; a renewal answered with another problem thrown | A member offline would be told that something went wrong at our end. And a problem thrown from the transport is taken by its caller for an answer that never came: a renewal the server had answered, with a `429`, would be said as a server out of reach |
| A request failed where its token could not be renewed before it lapsed | The token held is sent as it is, and the server says whether it still stands: an answered problem thrown from the transport would be taken for a lost answer |
| The access token's lapse read out of the token | The server's clock against the device's. It is counted from when the pair arrived |
| A renewal failed where its pair could not be written | The old refresh token is used up either way, and the request has a good token: held in memory, the sign-in works for as long as the app runs, and the pair is written again as a token is next asked for, which a keychain that was shut while the device was locked then takes |
| A deadline of the app's own on the renewal | A timer for a hung attempt alone: a phone with no connection for longer than D-98's minute is signed out with or without it |
| One vault entry holding everything; the keychain's default class; `AFTER_FIRST_UNLOCK`; the vault behind Face ID | SecureStore's values are small, and item 29's profiles add and remove one entry without rewriting the others. The default class travels in a backup: a pair restored on to another phone is one sign-in held by two devices, and the first renewal of either ends the other as a reuse, with the email. Nothing reads the vault while the device is locked, so the stricter class costs nothing today. And the app asks for no Face ID (FR-PR1): a prompt would stand in front of every renewal |
| The token store told who listens for an ended sign-in as it is made; what is forgotten with a member held in a React context | The store is made before the provider that listens. The sync library's file says what it removes outside any component, as it is loaded |
| The household a member was last in removed at a sign-out | It is an id and no content, and the twin of the web's key, which a sign-out leaves |
| Why a sign-in ended kept as one of several causes; the notice kept across a restart | The answer names none (Q18). After the app was closed and opened it is a notice nobody asked for; the web's is in memory too |
| The API's clients made as the providers mount | Where a build was told no API, making one throws: it is made when first asked for, and a misconfigured build fails inside the route's own boundary |
| Nothing drawn until the vault is read | The router's stack must be mounted to be told where to go, and the splash is held already for the display's own reads. The session is *unknown* until then |
| A vault that would not say taken for nobody's sign-in for the whole run, as it first was; the vault asked again by itself, when the app comes to the front | A member was shown the sign-in screen while signed in, with no word why, until the app was closed; a sign-in taken there was written over a list of sign-ins that was never read, and the installation given a second id. What could not be read is said so, and asked again by its member's press, as every other read of the app's is: an observer of the app's coming to the front would be a second way to do what *Try again* does |
| The member in every query key | Every screen's key would carry it, and the web's keys would stop being the app's. The cache is one member's at a time, and emptied when its member is forgotten |
| TanStack's own persister | Its throttle writes a cache back after it was removed, and its restore rejects where storage refuses: the web's own reasons (ADR 0025) |
| The kept reads tied to the build that wrote them, as the web's are (D-161), and dropped by the next | What the tie was for is drift: a build may keep a read otherwise than the one before it, a key's meaning or an answer's shape, and what is restored is drawn before any answer can correct it, with a connection as without. But it drops every read at every update, and the first start after one would need a connection: a member whose phone updated the app overnight would open it with none to *could not be read* and no replica, on the client whose promise is that reads work offline (PRD 03 §2.1). A number answers the drift where it arises: `keptShape` is raised by the pull request that changes what is kept, and a read is the contract's own answer, which a later build of the same major reads as it reads an older server's |
| A read kept only while its last asking succeeded, which is TanStack's own rule for what it stores, and the web's; a read that nothing draws let go from memory after a day, as the web's is | An app opened once while the server was away, or on a network with nothing behind it, wrote everything it kept out of the device a second after its re-reads failed, and the next start with no connection opened on *could not be read*, with no replica: an outage met twice shut the app that is to work with none (PRD 03 §2.1). And what is written is what the cache holds: another household's own answer, read by nothing while its member is in the first, went from the device after a day of the app's life. The web's rules are a browser's, which is no offline surface |
| The query client emptied in the providers' own cleanup | React runs a removed tree's cleanups parent first: the readers let go after the emptying, and each left held again a read the cache had just put away. It is emptied by a component that stands after everything that reads |
| The device believed on `isInternetReachable`; *unknown* taken for offline | Where the platform cannot say, NetInfo asks a host of Google's. Every read at a cold start would wait for NetInfo's first answer, and a bar would be drawn for a state nobody reported. A network with nothing behind it is a request's own failure to say |
| NetInfo's own check of whether the internet can be reached left running with its answer unread, as it first was; the check pointed at a host of the app's own | The check is the library's and not its reader's: on iOS, whose native half does not say, it asked Google's host as soon as the app listened, and each minute after while it was answered and every five seconds while it was not, for a listener that read `isConnected` alone, which the row above took for not asked *(read, and run under Jest over the library's JavaScript)*. Pointed at the API it would be the app asking its own server once a minute for what a request that fails says already, and for an answer nothing reads |
| The kept reads written only for a change an answer made, told by the kind of each change of a read (TanStack's `action`), and not for every change of one | A read that only begins to be asked for again, as the account is each time the app is looked at, schedules a write of what the device already holds: one write a second at the most, of some kilobytes while the reads are the account's and its households'. Telling the kinds apart ties what is kept to names TanStack keeps as its own, and a kind left out is a read that is not written |
| The offline bar hearing the device by a listener of its own, beside the query client's; a lint that keeps NetInfo to one file; the device asked once more as that file loads | Two stores of one fact, and the query client's is the one that holds a read back, so it is the one the bar must not disagree with: the bar reads what the query client was told. The lint's one rule of restricted imports is spent on `Text` for the same files, where a second block would replace it, so a test of the sources names the file. NetInfo hands a new listener the state it has *(read)* |
| The ended sign-in's notice in the `warning` or the `danger` tone; always announced; never announced | Calm is a design decision of that notice (A-11). A screen that opens with it reads it in its place, and would say it twice; a renewal refused while a visitor sits on the screen would otherwise change it silently |
| A member in no household told the web's sentence, or left with no control | The shared body speaks of *the rest of this page*, and every other way out of the account is inside a household until item 29: the index offers signing out |
| A member in none but suspended households told that they are in none | They are opened at the first of them (D-162), where item 29's lockout stands |
| Navigation driven from a route's guard alone; a `+native-intent` file that rewrites what the system hands over | A pressed notification for a visitor who signed out themselves would not be held, the guard holding nothing for them, and nothing would know that a link changed the household. The second is a file under `app/` that is no route, and runs outside React, with no session |
| *Switched* inferred from any change of household its member did not make, as the web infers it; the hook reading for itself whether its household is in front | On a device the index opening a household after a sign-out and a sign-in would read as a switch. The frame hands the second over: a stack keeps the household a link was opened over mounted underneath |
| The held address in memory alone; held during render, as the web holds it | Signing in may leave the app, for a password manager or a provider's screen, and the system may close it meanwhile. The router has one address for every screen, and as the guarded screen gives way it reads the sign-in's own, which would take the place of what was held |
| The guard holding a visitor's address with its query | The router's own word for where the app is has none, and the address that launches the app is heard by nothing else. No route reads a query and the server writes none into a link: the first route that takes one holds it, and keeps the guard from writing its own word, which has none, over what a link's arrival held with one a moment before |
| expo-notifications called from each file that needs it | One file imports it (`src/push/device.ts`), and every call that can fail on a build with no notifications answers nothing there: Jest's stand-in for its native half throws |
| Expo asked for the token again in order to remove it, at a sign-out or where notifications are turned off on a device that holds no note of one; *turned off here* kept for the device; the project as a default parameter | A sign-out on a poor connection may not reach Expo's service: the token that was registered is remembered. And the note is there wherever the server holds a registration this device made, going only with a removal the server heard or with the sign-in, so turning off with no note is left to a device that would not write one, which Expo's answer does not mend. A shared tablet's profiles each keep their own (D-104). `undefined` passed on purpose would be replaced by the build's |
| The device's registration left for the sign-out to end, with no removal before it | The web's order (ADR 0026), kept so that both clients sign out by one rule. What it costs is said (D-187): a device whose registration was removed and whose sign-out then failed stays signed in and unregistered until its next start, or until a connection next returns |
| The note of a push registration removed at a sign-out whether or not the server was told to remove the registration, as it first was | Where neither the removal nor the sign-out after it reached the server, the server still held a registration the device had no note of. A member who then turned notifications off was told that they were off and the server was asked nothing, there being no token to name; and the renewal, which passes over a device turned off, never mended it, so notifications went on arriving for as long as the sign-in lived. The note goes with a removal the server heard, or with the sign-in itself (`onForget`), and until then it says what the server holds |
| A second Android channel for urgent pushes; a notification left unshown while the app is open | The server names no channel, and from Android 8 a notification's own priority is ignored *(read)*. The server has applied its member's mutes and quiet hours already |
| The device's twins of the web's `push.*` words written now; `device.display.note` taken out of the catalogs until a screen draws it | No screen of this item draws them: F-20 is item 29's, which designs the screen they belong to. The one sentence of the device's own that is in the catalogs ahead of its screen says what this item built, that the display's modes are kept on this device alone, and the plan hands it to item 29's Appearance screen by name: taken out, it is five translations drafted again for the same words |
| The display's modes and a member's arrangement of their modules not written while what the device kept of them could not be read, as nothing is written over a vault or over the replicas' notes that could not be | Each is one value of its own, read once before anything is drawn, and where the read failed what is drawn is the default: its member sees that, and what a change of theirs then writes is what the screen shows. Nothing they cannot see is written over. The vault's list and the replicas' notes hold other members' things, which one member's write would have taken with it; and the kept reads, which are several reads under one name, are not written over either (`src/api/keep.ts`) |
| The web's query client telling its observers in a microtask (`notifyManager.setScheduler`), in place of the hold that each control of the web's that saves as it is changed keeps for the frame of its press (`pressed` in `account/Notifications.tsx`, `chosen` in `privacy/Consents.tsx`, the two selects of `account/Account.tsx`) | The cause is shared, TanStack telling a screen by a timer that a browser runs after the frame that answers the press, and one line would answer it for every screen. But it changes when every screen of the web app hears of every read and every write, under a pull request that builds another client, with nothing but the web's own suites to say what else it moves: it is the web's to weigh in a change of its own, where the three holds can be taken out against a test of each |
| `device.` twins for `nav.home` and `ui.not_available.home` in German and Polish, which say *Zur Startseite* and *Strona główna* | That is what a phone app's home is called in both, and D-195 judges a key by its English |
| A `device.` twin of `sync.kept.hint` that does not say *copy* | The shared sentence is true once the value it speaks of can be selected, which a key–value pair's now can |
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
| The bar above a household's screens reading the household for itself; a `staleTime` on the household's query; the bar reading the frame's context | The frame draws the bar only once the household is read, and a reader that mounts after an answer finds it stale at once and asks again: a household that was opened was asked for twice. A `staleTime` would hide that request and every one that should be made, the app looked at again among them. The sync dev screen draws the bar under no frame: it is handed what was read |
| The web's *Reload* where a replica cannot be opened | A device has no page to reload: without a way to ask again its member would have to leave the household and come back |
| *Receiving* read off `connecting` or `hasSynced` | ADR 0026: every retry is connecting, and a replica opened again has synced before and has not tried yet |
| The file deleted, and that called the wipe; the removal waited for by the sign-out; not even its note waited for; every noted replica removed whose member is not the one signed in | A file that could not be deleted would keep its member's rows until some later start, and the deletion is the uncertain half. A sign-out's screen would be held by SQLite. An app killed after the sign-out and before the note would never remove anything. The session hands out one member, and item 29 signs several in: what the app removes as it starts goes by every sign-in the vault holds, and not by the one in use |
| The session's first reading of the device not waiting on a removal left over from the run before | Whose replicas the device keeps is asked in the removals' own turn (`keptReplicas`, `src/sync/databases.ts`), so a start that follows a sign-out the app was closed in the middle of shows its wait for as long as that wipe and deletion take. The member whose replica is still leaving is one the vault holds no sign-in of, whom that start marks and removes in the same turn anyway, and no replica is opened while one is being removed: what would be gained is the sign-in screen a moment sooner, at the one start after an interrupted removal, for another order of the same steps. A wipe that never answered would hold that start for good, as it would hold every opening of the household it is of, which waits in the same turn: a wipe that fails is passed over and its file deleted all the same, and whether one can go unanswered is not known, no removal having run on a device |
| The database's file deleted through expo-file-system; deleted with no checkpoint first | Its default place is op-sqlite's own, which on Android is outside the directories expo-file-system may touch *(read)*. A log left by a run that ended badly, found later beside a new file of the same name, is read into it |
| A replica opened though what an ended sign-in left of it could be neither emptied nor deleted; one whose sign-in ended as it was opening let open and then closed; one that could not be emptied left for the wipe alone | What an ended sign-in left would be drawn as the new one's. A file made for nobody, with a note that says it is kept. A wipe that fails may fail at every start, on a device with no room left or over a file that is damaged: its rows would stay for good, and the household be shut to its member, so its file is deleted all the same |
| A household's replica removed as its address answers `404` | A suspended household answers `404` too (D-115), and what a device had not sent of it must be there still when the suspension is lifted: the frame cannot tell gone from suspended. The member's list can, which item 29's lockout reads (Consequences) |
| A note left of a replica whose sign-in ended before the note was asked for | It is two ids and no content, and is cleared at that member's next sign-in; but it says that a replica is kept which never was, on a device whose rule is that what it keeps of a member goes with their sign-in. The opening asks whether its sign-in has gone before it notes itself, as well as after |
| `onRevoked` handed to the replica | A second path to an end the session has reached already |
| One watcher of what waits, in the replica's provider, for the tab bar, More and the inbox to share | Each of the three watches for itself, at one read of the few rows that wait for each change of them, and only while it is drawn. One watcher would need a context of its own, so that whoever reads the replica's status is not drawn again for an inbox that changed, and a fixture that runs the watch for every test and dev screen that hands over a stand-in: some forty lines, and a shape other than the web's own provider, for a saving nobody could measure |
| The sentence for the settings' addresses left out of the bar until item 29 has screens there | The addresses are real, and a push names them: the bar over *not available* there would promise that changes are saved |
| The inbox saying nothing after *Try again*; the focus moved to its list | The control that was pressed leaves with its sentence. Where one state takes another's place no element outlives both: what trying again came to is announced |
| *Try again* outside the inbox announcing what it came to, by each owner of a wait; a debt of focus paid by the next screen's title | The inbox has a sentence for what came, and the three that stand in a read's place, of who is signed in, of the list of households and of a household, have none but the screen itself, as the screen that stands where a route failed to draw has none but the route. A flag that the next title pays would be paid by whichever screen mounted next, one nobody asked again for among them. With no connection the press changes nothing and says nothing, as the web's (ADR 0026) |
| The focus moved by an effect on the inbox's entries alone; whenever an entry leaves; as soon as the sheet has gone | On iOS the sheet goes after the row and on Android before it *(read)*: an effect on the entries alone steals the focus from under a leaving sheet, or misses the row. A row the replica sent by itself would take the focus from wherever its member was. And the sheet may have gone before the list has heard of the answer, the focus then put on the lead of a list about to leave with its last row. It is moved once the sheet has said that it has gone and the list no longer draws the answered row |
| The focus left to the platform once the inbox's last row is answered; a wrapper round the list as its place, as the web's; the empty sentence announced | The web puts it on the list's own place (D-166), and a device's is the lead while rows are drawn and the empty sentence once none is. An accessible view round the list closes its rows to a screen reader on iOS *(read)*. And a focus that is nowhere is still nowhere after an announcement |
| A resolver unmounted as its answer goes, as the web's; the confirmation and its sheet closed at once | A modal unmounted says nothing of having gone, and iOS refuses what is presented meanwhile *(read)*. A controller told to dismiss while the modal it presented is leaving may stay: unverified either way, so the order that cannot fail was taken |
| *Put it away*, *Keep mine* and a refused change's *Try again* saying where the focus goes once they leave with their own press, and so a toast's own dismiss and the switched banner's; *Put it away* saying that it was put away | The web's twins are the same, and React Native cannot say where a reader was. An answer that writes says what it came to in a toast; a kept version put away writes nothing its member made, its banner leaving is the web's whole answer too, and no catalog has words for more |
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
| *Not available* leading on by a push; the way back from a switched household by `router.back()`, by a replace, or by `router.dismissTo` | Back would return to the address that opened nothing: after a push always, and after the replace only inside a household, once, where the replace is a jump between the household's tabs and the tabs keep the address in their own history *(seen under Jest, `src/shell/layout.test.tsx`)*, a way round which is larger than a second press of back. `back` is right only while nothing was opened since the link, and a replace would take the link's target away. `dismissTo` finds no screen to go back to: the stack's two households are routes of one name with no id of their own, so the pop takes the one on top for its target and hands it the other's address in place *(read: React Navigation's `StackRouter.js`, to which expo-router's stack leaves the action)*. The household kept underneath is not returned to, the one on top changes household under a frame that is mounted, and the link's target is gone, which is the replace |
| The dev screen's two text sizes by the toolbar alone; a scope of scale in the display's provider | The page is to show both at once. No member's screen wants one |
| The focus put on a dialog's first control, as the web's; at the commit | A screen reader reads on from where its focus is put: from the title it reads the description and then the choices. Before the platform says that the modal is shown there is nothing on the screen to focus |
| The ground named and within a screen reader's reach | An unnamed button the size of the screen is what it would land on first. It has the close control, the choices and its own escape |
| A side panel; a grabber on a sheet; a swipe that closes one | 02-components: mobile prefers sheets, and a tablet's is a sheet of a bounded width. A grabber that cannot be dragged says that it can. No gesture is the only way to do a thing |
| The modal sliding in; an entrance of the app's own; portrait as a modal's only orientation | A slide moves the veil with the sheet. The second is another thing to keep in step with the platform's own presentation. The third is `Modal`'s default, which would hold one upright on a tablet on its side *(read)* |
| A colour token for the veil | ADR 0025: none is invented for it. It is the theme's darkest surface at an opacity |
| A menu's sheet given a title of its own; its trigger wrapped in a view; an empty menu's sheet | A second name for one control. An element between the row and its control, and focusing a wrapper is not focusing the control. A control that cannot act is absent, its trigger too |
| A toast's dwell held only while a screen reader's focus is on it; Android's recommended timeout; held while a keyboard's focus is on its control | React Native has no event for where the accessibility focus is. The second is Android's alone. The third is a second flag, and a toast removed from under the focus never says that it lost it |
| The dwell as a timer of the drawn toast; the hosts ordered by when they entered; a portal | A toast is drawn anew when a modal opens or closes around it, and its dwell would begin again. React runs a child's effect before its parent's, so of two modals that open at once the outer would be taken for the top. React Native has no portal across a native modal |
| The toasts' provider measuring the bar; drawing its children in a fragment; reading the safe area itself | It is above the router, and the bar inside it. Their region is placed over the foot of a view the provider owns. The safe area is read where a toast is drawn, under whatever provides it there |
| The platform's pickers for a select, and `combobox` as its role; the platform's switch | A wheel and a dialog, in neither the app's type nor the reader's scale; iOS has no trait for the role *(read)*. One size whatever the text is, and a second target inside its row |
| A select with nothing chosen taking its first option; a radio option that is disabled; a stepper's buttons disabled at its bound | D-172. Absence: an option that cannot be chosen is not offered, and a control that cannot act is not drawn |
| One keyboard for the stepper; its two actions on a wrapper; with no label | The digits' keyboard has no minus. An accessible wrapper hides the field and the two buttons inside it on iOS, and an action with no label is listed under its English identifier *(both read)* |
| A stepper showing its owner's number over what is typed, whenever that number becomes another than the one what is typed gives; an emptied field giving back the number it held before the typing began | An owner whose number follows what it was given late, a row read back from the replica, would have what its member is typing replaced by the number of a key before, and is told from an owner that changed the number itself only by remembering every number the typing gave. What was typed is the field's to show until it is left, and leaving it gives nothing again, so an owner's own change stands. And the numbers on the way are heard on the way down as on the way up: "12" emptied a key at a time leaves its owner at 1, as the web's does of a number within its bounds, where emptied at once it leaves 12 |
| The password's *Show* as a toggle button with `selected` | iOS gives it the button's trait alone *(read)*, and what *selected* means of *Show* is not said. It is a switch |
| The prototype's 20 pt box for a checkbox; a link in a row underlined | The base set's smallest reviewed glyph is 20, which fills such a box to its edge. `Text` takes no decoration: a chevron after the word is the more-than-colour |
| The ring as a `Pressable`; a plain view with `onClick` as the button | Its press-out comes up to 130 ms late, a finger slid off and back begins a hold nobody began, and on a release it calls press-out and then press in one turn, so one control could not tell its own touch from a keyboard's *(read)*. `onClick` is not in React Native's public types for a view |
| Where the finger is, read from each move's own coordinates; the native responder blocked | Their meaning off the target differs by platform, and the second is Android's alone. A scroll that begins under the finger still ends the hold on both *(read)*, which then says *Keep holding* |
| The hold ended by the animation's callback; the native driver; a ring of two rotating halves | Under Jest the animation finishes at once, and on a device a busy thread would stretch the hold. The native driver does not drive a drawing's stroke. Four views and a mask for one small ring |
| The hold's words as the button's accessibility value; its failure said at once; a word of its own for the `activate` action | iOS would say the changed value of the focused element and the announcement both *(read)*. An urgent one would cut *Completing* off. The control's own name does |
| A completed hold saying nothing of itself; a completion that throws swallowed | A reader who comes back to it would hear a button that does nothing: it says `disabled`, and `busy` while completing, and stays. An owner's bug would be said as a refused write |
| A list's rule as each row's bottom border; a row held to a number of lines; a money value held to one | A row does not know that it is last. Truncation removes meaning, and a rule fails it; the non-breaking spaces of its locale's own format keep an amount together, for as long as it fits its line |
| An amount wider than its line given a smaller step or a breaking space | No screen draws such a figure yet: the first that does decides |
| Arrange's rows, a dismissable banner and a sheet's header given the list row's tail, so that their words do not stand between two targets at 200 % | Nothing is lost or cut at 360 pt: the words break inside a word, which is the price of a target that grows with the text (D-186) |
| A flow chart laid out by the window; a side that fills its column when stacked | The window is not the pane. In a column of no fixed height it is given none, and the two lists overlap |
| An estimated column dashed on three sides, as the web's | React Native draws a dashed border as one path round the whole box, in one width and one colour *(read)*: it is dashed on all four |
| A badge in a status colour; as a bare dot; with a name of its own | Reserved (01-foundations). 02-components forbids it. What is counted is its owner's to say |
| The harness drawing one body until asked; as a virtual list; its cells always side by side; the web's fixture sentences | A flow would not find a cell of another body without knowing of the chooser, and it can be narrowed to one. Jest would draw ten cells of 192. 170 pt a cell at 200 %. The web's are the prototype's, which name what was withdrawn and say *past due*: the phone's say what the product does |
| The band behind Android's navigation buttons mended without a native module: the platform's contrast turned off by a plugin of the app's; `Appearance.setColorScheme` | With no scrim the buttons' ink follows the device's night mode, light on a light ground where the app is light on a dark device, which is worse than a band that does not match. The second changes what the `system` choice reads, and not the bar that was seen *(both read)*. `expo-navigation-bar` would set it, one native module more, which item 29 decides beside its Appearance screen (Consequences) |
| The jobs filtered by the workflow's own `paths`; a third-party action that filters; the API's list of a pull request's files | It filters the whole workflow, and a check that never reports stays pending where it is required. An action for one `git diff`. A token and a page limit for the same answer |
| The server's sources and the compose file among what sets the device jobs off; the contract | Two device jobs on nearly every pull request. A server change that breaks a flow is found by the next change to the app, and the typed client's breakage is the typecheck's |
| The budget as steps of the Android job; Metro's cache cleared by hand between the two; the export after the flows | Metro's cache does not know of the variable: the build made second would be made of the first's transforms. A path of Metro's own that the workflow would have to know. The budget would go unchecked when a flow fails |
| The budget counted compressed, as the web's; a limit written beside what was measured; the plain JavaScript counted too | Nothing downloads the bytecode apart from the binary, whose compression is the store's. Two numbers to keep in step, where the rule is one. An export without bytecode is another artefact than the one a build embeds |
| A debug build under the flows; a fourth variant for them; every Android ABI; both simulator architectures | It loads its JavaScript from Metro: the job would run a bundler and prove another artefact. An identifier, a scheme and a profile for something no member installs. Three ABIs compile the native code again for devices the job does not have, and a precompiled framework without the second slice would fail the link for nothing |
| The unused permissions removed from staging and production alone | Then no build that runs on a device goes without them, and whether SecureStore and NetInfo are well without theirs would first be learned in a staging build |
| A plugin of the app's that deletes the dev launcher's two keys | Expo's own build phase does, and a second mechanism would have to be ordered against the first. The iOS job reads the built app, since reading the plugin does not show that the phase runs |
| The permissions asserted on the configuration alone; the prebuild's own code called in the test; the list in the test alone; held right after the build; the reasons in `app.config.ts` | It would hold what the configuration says and not what a manifest ends with. Not resolvable from the app under pnpm without naming it a dependency. The merged list exists only in a build. A list that moved would skip the stack's steps and hide whether the app still runs. Node cannot import that file |
| The sixteen launcher-badge permissions kept in case | FR-PR1 is about what a module uses now. The runbook says what bringing a badge back takes |
| `RECEIVE_BOOT_COMPLETED` kept with the other notification permissions, as it first was | expo-notifications asks to be started with the device so as to schedule again what an app had it hold, and the app holds nothing to show later: a notification is a push, sent when it is due. Its receiver stays in the merged manifest, and without the permission Android does not send it the device's start *(read)* |
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
| A flow finding one thing as inside another (`childOf`); a state read off where a thing stands | A view that is there only to be named has its children mounted beside it *(read, and seen in the fourth run's hierarchies)*: the flows scrolled whole pages for a child no cell has. A state is read off a name only that state draws, a row's own *Show* for *the row is in the hidden list*, or off `selected` |
| A flow scrolling a whole dev screen to what it reads | A page of every control in both themes is hundreds of nodes, read at every step, and on Android the scroll stopped where a swipe began on a stepper's count. The long dev screens are narrowed to one part, as the harness is to one body, and narrowing the sync screen neither closes nor opens its live replica |
| Signing out at the end of the stack's flow; the replica's flow taking the connection away before the replica has reported | The job asks the server for that sign-in's device after the flows: signing out is a flow of its own, and each flow being a new installation to the server, the stack's sign-in stays whatever order they run in. The step that asks for the household's clients would wait on the emulator's way back to its connection, which the flow gives back whatever became of it |
| A state waited for by a scroll until it is visible; Maestro left to let the screen settle after a tap that brings a toast | A scroll swipes for as long as its element is not found, one not drawn yet as one further down *(read)*. A toast stays five seconds, and on a slow emulator settling takes seconds of them: the tap says how long to wait |

## Consequences

- The three pins, `react`, `react-dom` and `react-native`, move together when the app moves to
  an SDK, and the web moves with them; `test-renderer` moves with React's minor. A native
  module is added with the SDK's own range (`expo install --check` says when one is off), and
  `pnpm-workspace.yaml` is read afterwards for an exclusion pnpm may have appended.
- An export made with `EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS` and the next one made without it are
  each made with Metro's cache cleared, which the `export` script does; `check` is what catches
  one that was not. That is true of an export and of nothing a build embeds. A build bundles
  through `expo export:embed`, to which React Native's build scripts pass `--reset-cache`, and
  which drops it where `CI` is set in its environment *(read in both, run on nothing but CI's
  fresh runners)*: there, on a machine that has bundled before, Metro's cache is cleared by
  hand first, or the dev screens' variable is read from the bundle before it
  ([runbook](../runbooks/mobile-builds.md)). Before an export or `expo start` outside turbo,
  `pnpm exec turbo run gen`.
- What the app kept of what it read is one shape's and no build's: **a pull request that
  changes what a kept read is, a key's meaning or what is stored of an answer, raises
  `keptShape`** (`src/api/keep.ts`), and nothing else does. The first start after such a
  change, and after no other update, reads from the server: with no connection that start
  draws *could not be read*, and the replica stays shut, a household being read as its
  member's before it is opened, until one start has had a connection.
- **Every read through the query client is kept, and held for as long as its member's sign-in,
  unless it says otherwise.** A later item's read that nobody reads again, or that is keyed by
  what a member types or by a page, says `persist: false` and names a `gcTime` of its own
  (`QueryNotes`, `src/api/query.ts`): left to the defaults it stays in memory, and in the one
  entry the device keeps for its member, until they sign out, on a device whose sign-in never
  lapses (D-99). That entry is one row of AsyncStorage's. On Android its database is held to
  six megabytes in all unless a build says otherwise *(read: `ReactDatabaseSupplier.java` and
  `android/config.gradle`, 2.2.0)*, and a row is read back through a cursor whose window is
  some two megabytes *(recalled of Android, whose source is not in the repository; run on
  nothing)*: a row past that would be written and not read back, and a store that would not be
  read back is neither restored nor written over for the rest of that run, so at every run
  until its member signs out. This build's reads are the account, the list of households and a
  household's own answer, some kilobytes. And a read the API answered *not found* holds
  nothing from then on, so a body drawn by `readState` (`src/household/data.ts`) draws it as
  *could not be read*, with the way to ask again, where F-17 has *not available*: the first
  screen that reads something of a household which can be *not found* for its reader alone
  asks the read's own problem (`isAbsent`), as the household's reader does.
- A region's own conventions are not on a device: `de-AT`, `de-CH` and `en-GB` count and group
  as their language does, where the web formats them with the browser's whole CLDR. What a date
  prints on a device is its operating system's, the word, the punctuation and the spaces
  between its fields among it, so the engine page holds a date to its fields alone (`formats`).
- The keychain's class is right while nothing reads the vault with the device locked. The day
  something does, a silent push that syncs or a background task, it becomes
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, and an item's class is changed by writing it again.
- A device whose renewal's answer was lost for longer than D-98's minute is signed out, loses
  what it had not sent, and its member is emailed the takeover notice. How long a lost answer
  may be retried for is between the theft the minute bounds and the promise that nothing queued
  is lost (PRD 03 §2): **item 53** looks at it beside Q18.
- A household that another was opened over stays mounted underneath, its replica open, until
  its member goes back; each *Back to …* of the switched banner stacks one more. **Item 29**'s
  switcher replaces, and does not navigate. Two frames of one household, which links alone can
  stack, each read their member's arrangement once, and a change made under one is written
  over by the next change under the other: nothing can be arranged in this build, and
  **item 36**'s store is one for both.
- **What stands above a household's screens does not scroll** (`src/shell/HouseholdFrame.tsx`):
  the connection's bar and the switched banner, and under them the place for item 29's one
  entitlement banner. By arithmetic on the tokens, seen on no glass: on a phone 360 pt wide at
  200 % the switched banner alone, its sentence and its two controls, is some 500 pt high.
  **Item 29**, which puts a third thing there, looks first at the dev shell page at 200 % with
  that banner drawn, and gives the place a ceiling and a scroll if a screenshot shows what the
  arithmetic says.
- With a screen reader on, a toast stays until it is put away, and several can stand at once
  for a reader who dismisses none. Whether a newer toast releases the older ones is a product
  decision for the first module that raises many. And what an Undo came to is its owner's to
  say: the primitive's `undo` answers nothing, so a failure of it is heard by nobody, and no
  toast of this build carries one. The first module's does (**item 30**), and its toast must
  not outlive the household it was raised in either, an Undo pressed after its member left it
  writing to a replica that is closed.
- With nothing waiting the inbox has no row, and is reached by its address alone until
  **item 29**'s sync health lists it. Nor does a press lead to arranging while no module has
  screens: in a build of this item nothing can wait and nothing is there to arrange, until the
  first module's (**item 30**). A replica reports itself a quarter of an hour after it
  first syncs and not as it opens, so a household's clients name a phone only then (D-178):
  item 29's sync health reports as it opens, as the web's does (D-181). The dev screen's
  control that reports now is for the flow.
- A new reader of a household's own answer reads it in the commit the frame does, or is handed
  it: one that mounts later asks the server again, and a test of the bar holds the household
  to being asked for once (`src/sync/bars.test.tsx`). The member's list of households is asked
  again as a household opens, by the notice of a switch, which names a household by a fresh
  list: left. And a read of that list which has begun is finished though its reader has gone,
  where the app opens being such a reader: it leaves for a household at once, by the list the
  device kept.
- **A household that answers `404` keeps its replica's file until its member's sign-in ends**,
  as the web's does (ADR 0026). On a device a sign-in never lapses (D-99), and PRD 03 §2.6 asks
  that what a member lost access to be removed from what they hold. A suspended household
  answers `404` too (D-115), and what a device had not sent of it must be there still when the
  suspension is lifted, so the two are told apart by the member's list and not by the frame:
  **item 29**'s lockout reads that list, and removes the replica of a household it no longer
  names.
- **The address held for whoever signs in next outlives a sign-in that was ended from
  elsewhere**: it is where they are led, and today an id and a screen's name, with no word of
  its member's. The first route whose address carries such a word, a note's slug, holds the
  household's own address there instead.
- **Backups are not decided here** *(read, and restored on nothing)*. A replica's file is in
  op-sqlite's own directory (`NSLibraryDirectory` on iOS, `getDatabasePath` on Android) and its
  waiting files under the app's documents, and both are in a device's backup; the pair is
  readable on the device that made it alone. On Android what AsyncStorage holds travels too
  (Expo writes `android:allowBackup` as true where the configuration says nothing), so a
  restored device finds notes of a member it holds no sign-in of, and removes what they name
  at its first start. On iOS AsyncStorage is excluded from a backup by default (RNCAsyncStorage),
  so a restored replica's file arrives with no note and nothing finds it: its member signing
  in again opens it as theirs, a copy of the old phone's with that phone's replica id.
  `android.allowBackup` and an exclusion on iOS are **item 30**'s to decide, with the first
  build.
- **A modal is not its screen's** *(read on both platforms, run on neither)*. Android dismisses
  one when its host is detached and shows it again at a resume; iOS leaves it over the screen
  that a link or a pressed notification opens. No sheet is reachable in a member's build yet:
  the first module's rows make one so (**item 30**), and the flow line for then, on Android
  after `link`, is to open a sheet, send the link, assert that its `:surface` is not visible,
  go back, press its opener and assert that it is.
- **The tab bar at five slots does not fit its words on a 360 pt phone in German, Czech and
  Slovak at 100 %** (*Unterhaltungen*, *Hinzufügen*): arithmetic on the tokens, seen on no
  device. No member's bar of this build has five. **Items 38 and 87** give the slot a word of
  the device's own if a screenshot of the dev shell page in German shows it.
- **On Android the band behind the three navigation buttons is the device's, not the app's.**
  With the app dark on a device that is light, CI's screenshot shows it white. The platform
  draws it, light or dark by a flag of the window that React Native sets once, as the activity
  is made, from the device's own night mode, and the app's theme is its member's choice, read
  after that *(read in React Native's source)*. Nothing the app links sets the flag again;
  `expo-navigation-bar` would, a native module more. It is not mended here: **item 29**
  decides it beside its Appearance screen, where a member first chooses a theme that is not
  the device's. A device that navigates by gestures draws no band, and the buttons are legible
  on it either way.
- **Mended as read, and proven on no device: on Android a drag that began on a stepper's count
  did not scroll the page.** Seen as where a flow's scroll stopped, in two flows of the fourth
  run, the count under the middle of the screen, where iOS scrolled the same page to its end.
  Read in React Native's source: its Android field shuts its parents out of a touch as the
  finger comes down, and lets them back in at the first move only if it can scroll no way
  itself (`ReactEditText.kt`), and `textAlign: 'center'` is the field's horizontal gravity
  (`ReactTextInputManager.kt`). Recalled of Android's own `TextView`, whose source is not in
  the repository, and run on nothing: a field of one line answers that it can scroll sideways
  unless that gravity is the start's. So the count is no longer centred on Android, and is
  still on iOS (`src/ui/Stepper.tsx`). The flow line that would show it: a swipe that begins
  on the count, and an assertion of what is below the fold.
- **Mended twice as read, the first mend seen not to hold and the second seen to: at 200 % on
  a phone a list row's title was left a few letters' width.** Seen in the
  fifth run's `harness-conflicted.png`: a glyph a line, cut at the right. The cause was not
  what stood beside the title but that no line broke. Read first in Yoga
  (`computeFlexBasisForChildren`, `CalculateLayout.cpp`; `calculateFlexLine`, `FlexLine.cpp`):
  where a row's only flexible child both grows and shrinks, its basis is taken for nothing and
  the row's lines are broken by that, so the words got what the avatar, the mark and the
  action left. So a row became two parts, the avatar with the words and the mark with the
  action, of which the second may shrink too, so that the words' basis counts and the second
  part goes under the first; and a row takes an `under` part for what stands across it, the
  inbox's kept version (`src/ui/ListRow.tsx`). **The tenth run (38131404522) showed that row
  unbroken on both platforms**: the first part was 160 pt and what the line had left over
  (179 of 304 on the simulator, 190 of 313 on the emulator), which is its basis at a scale of
  one, though its style said 320 by then. Read after that: a basis that a `flexBasis` gives is
  computed once in an element's life, while it has none (`CalculateLayout.cpp`, the branch
  guarded by `computedFlexBasis.isUndefined()`), and only Yoga's own setters clear it
  (`Node::markDirtyAndPropagate`), which React Native's renderer does not go through for a
  style that changed (`YogaLayoutableShadowNode::updateYogaProps`). The harness holds its
  scale after its first layout, so its rows kept the basis of the scale they were first laid
  out at; and so would a member's row whose device's text size changed under it, and one
  first drawn alone, which the shortcut gives a basis of nothing, when its mark arrived. That
  a part whose basis is right at its first layout does break its line was seen in that run
  too: a toast with Undo, raised with the text at 200 % already, drew its two controls under
  its sentence on the emulator (`toast-undo-200.png`). A
  basis that a `width` gives is computed at every layout (the branch after it, unguarded), so
  **the room a part is to have is said by `width`, never by `flexBasis`**, with `flexGrow` and
  `flexShrink` as before: in the row, its `under` part, the composition chart's legend, the
  flow chart's node, a toast with Undo and arranging's sections. A rule over the drawn tree
  fails a `flexBasis` (`src/test/a11y.ts`), and fails the row as it stood. That a device then
  breaks the line is the `row` flow's to show, in the harness at 200 %: *Open* at the row's
  own edge, under the avatar, and not to its right. On the simulator that ran (304 pt inside
  the row): the avatar and the words alone on the first line, the words 220 pt wide, and
  *Open* on a line of its own beginning where the avatar does. **The thirteenth run
  (38148919981, on `8b0936e`) showed it on both platforms**: the `row` flow passed on the
  simulator and on the emulator, *Open* not to the right of the avatar and below it. A row
  whose mark arrives after it was drawn has a flow of its own since (`mark`, on the page of
  primitives, where a press gives a drawn row a mark that waits), which the fifteenth run
  (38155421110) passed on both platforms.
- **Read after that, and run on no device: a `flex` given to an element that was first laid out
  without one keeps the basis of its earlier layout.** It is the same guard: `flex: 1` is a
  basis of nothing (`Node::processFlexBasis`), which is written only while the element has
  none, and an element laid out without a `flex` has the one its measuring gave it
  (`CalculateLayout.cpp`). A slot of the tab bar is as wide as its words on a tablet and a
  share of the bar on a phone (`src/shell/TabBar.tsx`), by the window's width counted in the
  reader's text: a bar that went from the first to the second while it was mounted, an iPad
  given another app beside it or a text size raised on a tablet, would have kept each slot at
  its tablet's width, which does not shrink, and three of them are wider than a third of an
  iPad's screen. And a flow chart's two sides stand under one another until the chart has
  measured its room, and beside one another from then on where there is room
  (`src/ui/charts/Charts.tsx`): each would have kept, as its width, the height it had in the
  column. Both are now drawn anew, by a key, when that changes. A rule cannot hold it, a drawn
  tree having no history: **an element whose style gains a `flex` under a condition is keyed
  by the condition, and so is a container whose direction is conditional over children that
  have a `flex`**, though their own style never changes. The fourth review round read the
  second half: the branch that is computed once is taken only where the container has a size
  along its direction (`useResolvedFlexBasis`, `CalculateLayout.cpp`), so in a column of no
  height of its own, a page that scrolls, a child with `flex: 1` is measured, its height
  written as its basis at every layout, and once that column is a row the guarded branch
  finds a basis there and keeps it. That is the flow chart's case, which its container's key
  covers; no other container of the app turns *(read, and run on no device)*. The two panes
  are one tree in both layouts, each pane the same element alone or beside the other, the
  list's room a `width` and the other's a `flex` it has from its first layout, in a row
  (`src/shell/Panes.tsx`): as two trees, a turn of the room, a phone on its side being wide
  enough for two, took the list and what was opened down and built them again, and what they
  held, where a list was scrolled to and what was half typed, went with them, which
  `src/shell/Panes.test.tsx` now holds. That a device then lays the turned panes out, the
  list's `width` going from the whole room to its share on an element that is mounted, is
  read (the branch a `width` takes is computed at every layout) and run on no device: the dev
  shell page has no pane whose room a press turns. The dev shell page draws one bar of five slots whose room a press turns
  from a tablet's to 320 pt, the bar mounted all the while (`shell:turned`), so that a flow on
  CI's phones can read it: after the press, Home and More within the room, where unmended
  each slot would be 144 pt and the two ends past the screen's edges. A flow of its own reads
  it now, on both platforms (`turned`, `e2e/flows/turned.yaml`): it presses the control and
  asks for each end of the bar whole on the screen, by a scroll that swipes nothing where it
  has it, an assertion passing an element any part of whose frame is on the screen. **The
  sixteenth run (38170218040, on `9448e7a`) passed it on both platforms**: the mended bar
  within its room, which is what a device has shown, the bar unmended having been drawn on
  none. No flow can reach
  the flow chart, which no phone held upright gives 28 rem.
- **Item 29** takes the seams this leaves: the sign-in screen's place (`src/session/SignIn.tsx`)
  and `signedIn`, which a sign-in the server answered is handed to; several profiles' sign-ins
  in the token store, of which one is in use; the household's name in the app bar as the
  switcher's control (`onSwitch`); the place under the offline bar for the one entitlement
  banner, and the lockout where the frame draws *not available* for a household the member's
  list still names; `usePush()` for F-20, with the device's own words for it; sync health over
  the replica the provider holds; and the takeover notice where the ended sign-in is said.
  And it takes what this leaves open. The lockout carries the way to sign out: a member in none
  but suspended households is opened at one, *not available* leads back to it, and nothing on
  that path signs out until then. A request is signed once, by whichever sign-in is in use
  when it is asked: it leaves again as it left, and one refused on another member's token is
  given none of the one now in use. What is not closed is that the session hands out one
  member and the store one renewal at a time: several profiles need a client or a token store
  for each, or a profile whose pair has lapsed is served by another's renewal. Its sign-in
  screens ask through a client that
  signs nothing, a second step whose challenge is gone being answered as a refused token is. A
  link the system hands over while a visitor is on the sign-in screen leaves two of them on
  the stack. And *Try again* outside the inbox says nothing of what it came to (Alternatives
  rejected). `usePush()`'s two writes, the asking and the turning off, are each asked at once
  and settle in the order the server answers them, which need not be the presses': F-20's
  screen holds each of its two controls while the other's write is on its way (`asking`,
  `turningOff`), as the web's controls that share a state do. **A form of its screens puts the keyboard away at the press that sends it**
  (`Keyboard.dismiss()`), while its field is still mounted, as the dev form does: on Android
  a keyboard whose field leaves with its screen stays or goes by a race, and in CI's tenth run
  it stood over the household's tab bar after a sign-in, the bar out of a member's reach and
  out of the tree a flow reads, until something put it away. **And `Screen` makes no room for
  the keyboard under a field of its own** *(read, and seen on no device)*. On iOS a scroll view
  is inset for the keyboard only where it asks to be (`automaticallyAdjustKeyboardInsets`, off
  unless set: `_keyboardWillChangeFrame`, `RCTScrollViewComponentView.mm`), and on Android the
  app is drawn edge to edge, where the keyboard resizes nothing and stands over what is drawn
  *(read: `Window.enableEdgeToEdge`, `WindowUtil.kt`; recalled of Android, and seen of the tab
  bar in that run)*. So a field in the part of a screen the keyboard covers is typed in unseen,
  and its page scrolls no further than its own end, which is under the keyboard too; a modal's
  fields are clear of it, a modal standing in a `KeyboardAvoidingView`. No screen of this build
  holds a field. Item 29's first form makes the room (Alternatives rejected says what was
  weighed), and what shows it is a flow's line: with the text at 200 %, press the last field
  of its longest form, and a screenshot taken with the keyboard up shows that field above it,
  on both platforms.
- **Item 30** makes the first EAS project and build: nothing of `eas.json` has run, nor the
  script that generates on the builder (`eas-build-post-install`), and until a project exists
  no build can ask for a push token. It gives the app a link host and its association files,
  the scheme alone opening it today, and the store's pages. Its first upload route must not
  take the part's file name for the file's, which is the row's id on a device, and an upload
  it refuses `update_required` keeps its file; the way in still takes bytes, so a camera's file
  would be read whole once. Two things of an upload are read and left to it. A file sent from
  its place that its transport cannot read ends every run of the queue at itself:
  `File.upload` rejects for it as for a request that got no answer, the same exception on
  both platforms, so the queue, which passes over a file it reads itself and cannot, cannot
  tell this one from a network that is down; the first route decides whether the transport
  tells the two apart, or a file is given up after some tries. And on iOS `File.upload` first
  writes a whole copy of the file, framed as the form, under the app's caches: it needs that
  much free room, makes the copy again at every try, and a copy left by an app killed in the
  middle is removed by nothing, the removal of a member's files included, so a member's file
  can outlive their sign-in there. Its first push on Android is where the notification's channel
  shows (below). It decides the backups (above), and whether `VIBRATE`, the template's own,
  stays asked: it is left asked until a device shows whether a notification is still felt
  without it. Its critical paths on a device stand on this item's flows. On Android a member's
  replica opening and receiving, and the offline bar arriving and leaving, are run, and so is
  the step that asks whether a household's clients name `mobile/<version>`, which they did in
  the eighth run; no replica has opened on iOS (below). Its module is the first whose rows the
  inbox can hold and More can arrange.
- **Item 33**, the first module with screens on a device, adds its line to
  `src/modules/registry.ts`, its routes to `src/app/paths.ts` and `app/`, and the place they
  stand under to `src/shell/tabs.ts`. The bar draws Add as soon as a registered module has a
  `capture` surface its member may create in, and a test fails until something is behind the
  slot: **item 38** builds the sheet.
- **Item 36** gives the arrangement a store, which takes the place of AsyncStorage's
  (`src/shell/arrangement.ts`), as it does of the browser's (D-155).
- **Item 93** generates the permissions' justification table from the two lists,
  `build/asked.ts` and `unusedPermissions`. An item that has a device hold a notification to
  show later takes `RECEIVE_BOOT_COMPLETED` out of the second and gives it its reason in the
  first, as one that draws a count on the icon does the launchers' sixteen.
- **Item 95**'s VoiceOver and TalkBack checklist is where everything this record marks *(read)*
  is first heard: start at the hold, a modal's focus, the tab bar and the arrange handle. Then
  a screen's title as a header; a failure's announcement on Android, where React Native hands
  it no *at once* and it is said as any other is; an announcement and a focus move that the app
  makes together, a module moved to another list, a resolver's toast and the focus given back
  as its sheet leaves, of which the order is the app's and which is heard is unheard; and
  whether the focus the app gives back on Android to an opener that is named lands there,
  Android's modal restoring none by itself *(read)*.
- Android has one notification channel of the app's making, of default importance, named in
  the app's language *(read, and the push itself unrun)*. A pushed notification that names no
  channel is shown by expo-notifications in its own fallback channel, named *Miscellaneous* in
  English, unless Expo's push service names one for it, which nothing here can read. **Item
  30**'s first push on Android is where it shows, and the mend is one field: `channelId` in the
  server's message to Expo, or the plugin's `defaultChannel`. A channel of its own for urgent
  pushes is a product decision with a server half, the push naming no channel today.
- **Once a build can ask Expo for a token, expo-notifications goes on telling Expo's service
  of the device's push token by itself** *(read: `getExpoPushTokenAsync.ts`,
  `DevicePushTokenAutoRegistration.fx.ts` and `utils/updateDevicePushTokenAsync.ts`, 57.0.22;
  run on nothing, no build being able to ask yet)*. Asking for a token turns that on for the
  installation, and nothing of the app's turns it off: at each start from then on, as the
  library is loaded, and whenever the system gives the device another token, it sends Expo
  the device's token where that is another than the last one sent or a week has passed,
  whoever is signed in, or nobody, and whether or not notifications were turned off here. It
  tells Expo nothing of a member, Expo's service is what the contract's `expo` transport sends
  a push through (FR-NT1), and the server sends to no token it was told to forget; but it is a
  request the app did not ask for, of the kind
  this record turned off in NetInfo. Read off an export's bytecode, by a search of its strings
  for addresses, which one put together from pieces would escape, the hosts it names that
  are not the app's, the addresses of documentation apart, are three: Google's, which NetInfo
  no longer asks; Expo's push service; and Expo's asset host, which `expo-asset` falls back to
  inside Expo Go alone. `setAutoServerRegistrationEnabledAsync(false)` ends it: whether a
  sign-out, or a turning-off here, calls it is **item 30**'s to decide with the first project,
  where it can first run. The library names the device to Expo by an id of its own making,
  kept in the app's files that no backup takes on Android and in the keychain on iOS, beside
  the last token it sent *(read: `serverregistration/InstallationId.java`,
  `ServerRegistrationModule.swift`)*: no sign-out removes either, and neither says anything of
  a member.
- **expo-notifications links Firebase Messaging on Android, which asks nobody while the build
  holds no `google-services.json`** *(read: `firebase-messaging` in the library's
  `android/build.gradle`, and `PushTokenModule.kt`, which catches the app Firebase then lacks;
  Firebase's own code is in no file of the repository, and no build was made)*. A push on
  Android needs that file. With it, by Firebase's documented default and read in no source,
  Firebase registers the installation with Google as the app first starts, before any member
  was asked anything and whether or not one ever turns notifications on: a request to a third
  party that nobody caused, of the kind turned off in NetInfo. **Item 30**, which adds the
  file, turns that off with it (`firebase_messaging_auto_init_enabled` false in the manifest,
  a token being asked for at a member's press all the same), or says why not.
- **What the fifth review round read of everything else the app links** *(read in
  `node_modules`, each library's JavaScript and its native half where it is there; the
  bytecode's addresses once more; nothing run on a device)*: nothing else asks a host by
  itself in a build of this configuration, and no `expo-updates` is linked. `expo-dev-client`
  compiles to stubs in an Android release and into no iOS configuration but Debug;
  `expo-application` reads the device's ids only where it is asked, and nothing asks;
  `expo-constants` makes no installation id. What the libraries keep by themselves holds
  nothing of a member: flags of which permissions were asked for, a background colour
  (`expo-system-ui`), an empty directory op-sqlite has Android make in the app's external
  files. And the sync SDK's own requests are not the app's: the stream and what goes with it
  leave by the SDK's own `expo/fetch` (`@powersync/react-native`, `lib/sync/stream/fetch.js`),
  to the one endpoint the API's credentials name, with the device's cookies allowed, a
  request the app does not make having no `credentials: 'omit'`, with a header of the SDK's
  that names its version, React Native's and the operating system's, and with the replica's
  own id. The sync service sets no cookie. The stream is a `POST`, which neither cache above
  keeps; after an upload the SDK also asks the service for a write checkpoint by a `GET` that
  carries the replica's id (`getLegacyWriteCheckpoint`, `@powersync/shared-internals`), whose
  answer, a number, is the service's own to forbid the keeping of, the API's header being no
  part of it *(what the service answers it with is not read)*. Handing the SDK the app's own
  transport is a change to `@household/sync` that nothing here needed. A built APK's manifest holds more than its permissions, which are
  all `build/asked.ts` reads: the `<queries>`, services, receivers and providers its libraries
  merge, Firebase's among them, and on iOS the notifications' plugin writes `aps-environment`
  as `development` in every variant: **item 30**'s first build reads both, and **item 93**'s
  table.
- **A member's picture is kept by whatever cache its reader has, past their sign-out, on a
  device as in a browser** *(read: `objectstore.go`, `FrescoModule.kt`, `RCTImageLoader.mm`;
  no member's screen of the app draws a picture yet)*. The object store answers every object
  `private, max-age=31536000, immutable`, its bytes never changing (ADR 0015), and a picture
  is asked of it by the link the API hands out, so the API's `no-store` is no part of that
  answer. `Portrait` (`src/ui/Chip.tsx`) draws one with React Native's `Image`, whose loader
  keeps it on disk, Fresco's cache on Android and the shared `URLCache` on iOS; the web's
  `<img>` leaves it in the browser's cache the same way. Neither is emptied when a sign-in
  ends. Whether a member's picture is among what a sign-in's end removes (D-187, D-161) was
  decided nowhere: **item 29**, whose screens first draw one on a device, puts it to the
  product's rules, for both clients, a link that answers otherwise being the object store's
  `ResponseCacheControl` to sign.
- **No device run reads the HTTP cache.** That the API's header keeps it empty is held on the
  server and read of the two clients. The line that would show it is the emulator job's, after
  the stack's flows, as root: no file under the app's `cache/http-cache` but the cache's own
  journal.
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
- **Run on a device, as of CI's eighth run (38126916736, 2026-10-11, on `cb26a93`), the first
  to pass whole, every job.** This bullet says what that run and the seven before it showed,
  and nothing later: it is brought up to date from the last green run before the pull request
  is marked ready. That run was of the tree before the first review round's fixes (`fc4e1df`).
  What that round changed was first on a device in the tenth run (38131404522, on `d5e4788`),
  which was not green: `harness` failed on both platforms for the list row (above), `sign-out`
  on the emulator for the keyboard that stayed up (the seam item 29 takes, below), and
  `primitives` on both for lines of the flow's own and the dev toolbar's scale; `launch`,
  `engine`, `theme`, `resolvers`, `shell` and `hold` passed on both, `link`, `stack`,
  `replica` and `held` on the emulator, and the server's two steps after them. What the second
  review round changed (`5d7b450`) was first on a device in the thirteenth run (38148919981,
  on `8b0936e`), which was not green either: all eleven of the simulator's flows passed, `row`,
  `stepper` and `toast` among them, and fourteen of the emulator's sixteen, `row`, `stepper`,
  `toast`, `held`, `stack`, `sign-out` and `replica` among them; `harness` failed there after
  some three minutes and `link` after it in 35 ms, the emulator having gone from under
  Maestro's driver (`device 'emulator-5554' not found`), as at the end of the eleventh run,
  and why it goes is not known. What the third review round changed (`9123bec`) was first on a
  device in the fifteenth run (38155421110, on `426838e`), not green either: the emulator's
  job passed, the two flows of the kept read's check and all twenty of the suite, four of
  them, `replica`, `launch`, `harness` and `link`, at a second asking after the driver had
  gone; and fourteen of the simulator's fifteen passed, `formats` failing there
  (`engine:formats:passed` not found), as it had in the run before (38152216148, on
  `3c14871`), of the same formatters, page and flow, where what the simulator wrote was read.
  Of its ten samples two were not Node's string, both the instant's: iOS's ICU wrote
  `Mar 3, 2026 at 6:41 PM`, with a narrow no-break space, where Node writes a comma and a
  plain one, and in Czech set narrow no-break spaces between the day's parts, the day, the
  month and the hour of the named zone right in both. Every sample FormatJS writes was Node's
  very string there, and on the emulator the whole line passed. So a date is the device's own
  to write, and that was no defect: the line holds a date to its fields now, and what FormatJS
  writes to the string still (`src/dev/engine/checks.ts`).
  `stepper` and `shell` passed on both, the second reading nothing of the bar whose room
  turns, which `turned` was written to read since. What the fourth review round changed
  (`9f8dd82`) was first on a device in the sixteenth run (38170218040, on `9448e7a`), **which
  passed whole, every job, as the eighth had**. All sixteen of the simulator's flows passed: `launch`,
  with the library that says whether there is a connection configured as the app starts,
  `shell`, with the two panes one tree, `turned`, and `formats` with its date held to its
  fields. On the emulator the two flows of the kept read's check passed and all twenty-one of
  the suite, `turned` and `formats` among them, two of them, `harness` and `link`, at a second
  asking after the driver had gone, as in the runs before. What the fifth round changed, a
  sheet and the toasts kept clear of a device's sides, has been on no device: the flow that
  turns one on its side (`sides`) was written after that run, and has run on none.
  In the eighth run, on the iOS simulator all eight of its
  flows passed: the app opens at sign-in with nothing kept; the engine screen's checks hold on
  Hermes, the vectors' 87 format cases and 8 match cases under the polyfills, the five families
  registered, the random source and the client's name; the theme changes at a press; the
  harness draws a cell of each kind at 200 % in both themes; a sheet opens and closes, and a
  menu's item opens a confirmation once its sheet has gone; a hold let go early completes
  nothing and one held completes; a slot opens its place and says so, Add's sheet opens over
  it, a module is hidden from its row's menu, the panes are one at a phone's width and two at a
  tablet's, and the neutral screen leads home; and a refused change is given up, its
  confirmation drawn inside its sheet, both leaving and a toast after them. The release
  build's `Info.plist` holds neither of the dev launcher's keys. On the Android emulator all
  twelve passed, as in no run before: those of the simulator, the resolvers' among them, and
  beside them a link in the app's scheme opens its screen; the dev form signs in against the
  real server over plain `http`, the household's Home is drawn in its frame over its tab bar,
  and drawn again after a restart, the pair read back from the keystore by a build without
  the biometric permissions; the bar's Today and More open their places, and More's sign-out
  leads back to sign-in; and **a member's replica opens on a device and receives**, with
  nothing in its inbox, reports itself when asked, and the offline bar arrives with the
  connection taken away and leaves when it is back. Then the job asked the server what the
  device had left there, in two steps that had run in no run before: the account lists the
  device that signed in, the emulator by its name, on Android at the app's version, and **the
  household's clients name the replica that reported as a client of type `mobile` at the
  app's version**, `mobile/0.1.0` (D-178). The built APK asked for eight permissions, each
  with its reason. In the seventh run the resolvers' flow had failed on Android, and it was
  the flow's to mend, nothing of the app's: its tap landed on the band behind the three
  navigation buttons, the control's bounds being `[87,2223][642,2347]` on a screen of
  1080 × 2400 and the tap at `(364, 2285)`, since the flow's scroll stopped as soon as its
  control was in the display and the app draws under the band; a scroll that the next
  command presses now brings its control clear of the band first. A flow having failed, the
  two steps after the flows did not run in that run; they are asked now whatever became of
  the flows. In the fifth and sixth runs the sync dev screen drew on neither platform: a
  fixture called `Array.prototype.toSorted` at its module's scope, which Node has and the
  Hermes this React Native ships lacks, so every Jest test passed, and `e2e/engine.test.ts`
  now reads the sources for such a built-in.
- **Not run on a device: the session and the API on iOS.** A macOS runner has no Docker, so no
  flow signs in on iOS: the keychain, the bearer, the renewal, the household's frame and the
  replica have run there on nothing. On neither platform has a renewal at a token's real lapse
  run, nor a sign-in ended from elsewhere and the removal that follows, nor a restore from a
  backup, nor what a start removes of a member the device holds no sign-in of, nor a keychain
  that is shut while its device is locked; that the native half of `expo/fetch` honours
  `credentials: 'omit'` is read. A member's own sign-out is read by a flow, on Android.
- **Run on Android, and on no iOS device: the replica.** Its flow is the Android job's, with
  the stack. In the seventh run and in the eighth a member's replica opened and received, its
  inbox was read, it reported when asked, and the offline bar arrived with the connection taken
  away and left when it was back: op-sqlite, PowerSync's extension and the SDK link and run
  there. The step after the flows, which asks the server for a client named `mobile/<version>`,
  ran for the first time in the eighth, and the server named one. No flow reads a replica's
  removal: that op-sqlite's own deletion removes PowerSync's file, that a file it could not
  remove still opens when it is asked for again, and that expo-router loads every route's
  file as the app starts, so that the forgetter is registered before a sign-in can end, are
  read. And no flow opens a replica on iOS, where it is believed from the
  conformance suite, which holds the library on Node's SQLite, and from Jest.
- **Not run at all: an upload, a push, and EAS.** No route takes a file, so `File.upload` has
  met no server. No EAS project exists, so no permission was asked for, no token registered,
  no notification shown or pressed, and no build made from `eas.json`.
- **Not run on a device: links beyond one.** A link on iOS, which asks first; a link the
  system hands over that names another household, which under Jest is asked of the router as a
  pressed notification asks it; a cold start by a pressed notification; and an address held
  while the app was left to sign in.
- **Run on the dev screens, and little of it around a real household: the shell and the
  overlays.** Two flows read some of it on the dev screens, with no server. On both platforms:
  a slot opening its place and saying that it is open, Add's sheet, a module hidden from a
  menu's item, the panes at a phone's width and at a tablet's, the neutral screen's way out;
  and, on the emulator too since the eighth run, a refused change given up, its confirmation
  drawn inside its sheet, both leaving and a toast after them. With the stack, on Android, two
  flows read the frame and the bar around a real household, two of its places and the way out.
  No flow reads the frame's inset meeting the bar's, the bar's measured height reaching the
  toasts, a tab's screen keeping its place, a real tablet, a toast inside an open sheet, the
  keyboard under a sheet on Android, or the focus given back on Android to an opener that is
  named, where the modal's host restores none by itself *(read)*.
- **Heard by nobody: everything a screen reader does.** No run has VoiceOver or TalkBack on.
  A screen's title as a header, the hold's three activations, the tab bar's traits, the
  adjustable handle and its two actions, a field's label read once on each platform, the focus
  on a modal's title and back, a refusal's focus, every announcement, which of an announcement
  and a focus move made together is heard, what a reader makes of a value that can be selected,
  and a toast that stays while a reader is on are held by Jest to what the app declares, and by
  reading React Native to what a platform makes of it.
- **Seen by nobody: what only glass shows.** That nothing is clipped at 200 % on a narrow
  phone, the ring's fill and its steps, the dashed column, a shadow and an outline as the
  tokens say, and Android's weight of a face whose one file is another weight. What CI's
  screenshots did show is above: the band behind Android's navigation buttons, and a list
  row's title at 200 % as it stood before the row was mended, which no screenshot has shown
  since.
