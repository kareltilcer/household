# Mobile builds: the three variants, EAS, and what CI builds

The mobile app is an Expo app in the managed workflow (PL-5): its native projects are no files of
the repository, and Expo writes them from `apps/mobile/app.config.ts` each time a build is made.
A build is one of three variants, made by EAS Build from one of three profiles; CI makes a fourth
kind of its own, for its emulator and its simulator, which no member is served. Read this before
the first EAS build, when a build must be told a new API or a link host, when a permission is added
or a library is, when one of CI's mobile jobs fails, and when a pin of theirs is moved.

**No EAS project exists yet, and nothing of `eas.json` has been run**: plan item 30 makes the first
staging build. What this says of EAS is how the configuration was written to be used, and each
command's first use is where it is checked.

## What is where

| | |
|---|---|
| The app's identity | `apps/mobile/app.config.ts`: the identifier `com.kareltilcer.household`, the scheme `household`, the name, each with a variant's suffix. A placeholder until the app is published under its publisher's own: changing one is changing that file, and the `appId` of each flow, which a test holds to it |
| The variant | `APP_VARIANT`: `development` (the default), `staging` or `production`. Each profile of `eas.json` sets it |
| The API | `HOUSEHOLD_MOBILE_API_URL`, `https://…/api/v1`. A staging or a production build that is told none is refused as it is configured; a development build told none asks the developer's machine (`10.0.2.2:8080` from an Android emulator, `127.0.0.1:8080` from an iOS simulator). The sync service's address is never configured: it arrives with the credentials the API mints, so it is the server's `HOUSEHOLD_POWERSYNC_URL` that a device must be able to reach |
| The link host | `HOUSEHOLD_MOBILE_LINK_HOST`: the host whose `https` links open the app. None is set, and the scheme alone opens it |
| The EAS project | `EAS_PROJECT_ID`, which `app.config.ts` reads into `extra.eas.projectId`. None exists |
| The store pages | `HOUSEHOLD_MOBILE_STORE_URL_IOS` and `HOUSEHOLD_MOBILE_STORE_URL_ANDROID`: the app's own page in each store, which *please update* opens on that platform. Neither is set, the app being in no store: the screen is then drawn with no control, since one that cannot act is absent. Set each in the `env` of the `staging` and `production` profiles once its page exists |
| What a build asks of its device | `apps/mobile/build/asked.ts`, with what each permission is for, and `unusedPermissions` in `apps/mobile/app.config.ts`, which every build removes |
| The profiles | `apps/mobile/eas.json`: `development`, `staging`, `production`, on the Node and the pnpm the workspace names |
| The generated sources | `packages/*/src/generated/` is never committed, so it is in no upload: `apps/mobile/package.json`'s `eas-build-post-install` runs the workspace's `gen` on the builder, after its install |
| The bundle budget | `apps/mobile/build/budget.ts`: each platform's bytecode, and what it measured when the budget was set |
| The flows | `apps/mobile/e2e/flows`, run by `apps/mobile/e2e/run.ts` under Maestro, whose version is `apps/mobile/e2e/install-maestro.sh`'s |
| CI | `.github/workflows/ci.yml`: `mobile-changes`, `mobile`, `mobile-android`, `mobile-ios` |

## The three variants

| | development | staging | production |
|---|---|---|---|
| Identifier | `com.kareltilcer.household.dev` | `com.kareltilcer.household.staging` | `com.kareltilcer.household` |
| Scheme | `household-dev` | `household-staging` | `household` |
| Name under the icon | Household Dev | Household Staging | Household |
| The API | the developer's machine, unless told | told, or the build is refused | told, or the build is refused |
| Plain `http` on Android | allowed | refused | refused |
| EAS profile | `development`: a development client, internal distribution | `staging`: internal distribution | `production`: the stores', the build number raised by EAS |

The three install side by side on one device. On iOS every variant may ask an address on its own
network over plain `http` and no other, which is the template's setting and how a simulator
reaches the developer's machine.

## Before the first EAS build

1. **`eas init`**, from `apps/mobile`, signed in to the Expo account that will own the project. It
   makes the project and gives its id. The app's configuration is a program and not a JSON file, so
   `eas init` cannot write into it: it prints what to add. What it prints is the id, and for a
   project an organisation owns, an `owner`.
2. **The id** reaches a build through `EAS_PROJECT_ID`. It is no secret. Set it where each build
   reads its environment: in `eas.json`, in the `env` of the `base` profile, which the three extend;
   and in the shell of whoever runs `pnpm start` for a development build, since a development
   build's configuration is evaluated on the developer's machine. Without it a build is still made,
   and the app says of notifications that they are not set up in this build.
3. **`owner`**, where `eas init` printed one, is a line of `app.config.ts`, beside `slug`.
4. **The two addresses in `eas.json`** are the contract's example servers and answer nothing. Staging's
   and production's own replace them when each exists (plan items 30 and 88).
5. **Credentials** are EAS's to keep: an Android keystore for each identifier, and for iOS a
   distribution certificate and a provisioning profile for each identifier, each with the Push
   Notifications capability. `eas build` asks for them the first time and makes them.
6. **Android push** needs the Firebase project's `google-services.json` in the build and its service
   account key at EAS. Neither is configured: until they are, an Android build registers no push
   token.

EAS's command line is no dependency of the workspace: install it as Expo's documentation says, and
pin it in this runbook once a version has made a build. Check a profile's configuration before
building it, which costs nothing:

```bash
cd apps/mobile
eas config --profile staging --platform android
```

## Making a build

```bash
cd apps/mobile
eas build --profile development --platform android   # or ios, or all
eas build --profile staging --platform all
eas build --profile production --platform all
```

- **A development build** holds the dev client and no JavaScript: it loads the app from Metro on the
  developer's machine. Start that with `pnpm exec turbo run gen` and then
  `pnpm --filter @household/mobile start`. A phone in the hand is told the machine's address on
  its network, `HOUSEHOLD_MOBILE_API_URL=http://192.168.x.y:8080/api/v1 pnpm --filter
  @household/mobile start`, with no new build; the API must then listen there
  (`HOUSEHOLD_HTTP_ADDR=0.0.0.0:8080`), and so must the address it gives a replica for the sync
  service (`HOUSEHOLD_POWERSYNC_URL`).
- **A staging and a production build** hold their JavaScript, ask the API they were built for, and
  carry no dev screen: `pnpm --filter @household/mobile run export` and `run check` hold the same
  bundle to that, and to its budget, with no build at all.
- **Without EAS**, on a machine with Android Studio or Xcode: `pnpm --filter @household/mobile exec
  expo prebuild --platform android`, then `expo run:android` (or `ios`). The folders it writes,
  `apps/mobile/android` and `apps/mobile/ios`, are ignored by git, ESLint and Prettier; delete them
  after a change to `app.config.ts`, or pass `--clean`. Expo writes no iOS project on Windows.

## What a build asks of its device

FR-PR1: every permission the apps request is justified in a table in the release notes, and one no
module uses is removed. On Android the list a build ends with is in no file: the manifests of
Expo's template and of every library are merged as the build is made. Two files decide it, and CI
holds a build to them.

- **`apps/mobile/build/asked.ts`** is what a build asks for, by name, each with what it is for:
  `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK` and Google's
  messaging `RECEIVE`, and in a development build `SYSTEM_ALERT_WINDOW`, by which React Native
  draws its errors over the app. It is the source of the table in the release notes. Beside them
  every build holds one permission of its own making,
  `<identifier>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which asks its member nothing.
- **`apps/mobile/app.config.ts`** (`unusedPermissions`) is what every build removes, whichever
  library asks for it, each with why nothing needs it: shared storage (the template's and
  expo-file-system's), a fingerprint or a face (androidx.biometric's, under expo-secure-store), the
  Wi-Fi network's state (NetInfo's), the install referrer (under expo-application), being started
  with the device (`RECEIVE_BOOT_COMPLETED`, by which expo-notifications schedules again what an
  app had it hold to show later: the app has it hold nothing, a notification being a push), and
  sixteen that draw a count on the icon of one launcher or another (the badge library's, under
  expo-notifications). The first build on a runner asked for thirty-one; a development build is
  to ask for eight, and one a member installs for seven.
- **CI's `mobile-android` job** reads the list off the build it makes and fails on a permission that
  has no reason, and on a reason for a permission the build does not ask for. So **a new library
  that brings a permission fails that job** until somebody decides: its reason in `asked.ts`, or
  its name in `unusedPermissions`. The build is the development variant, and the flows run on it
  with everything unused already removed; `apps/mobile/build/permissions.test.ts` holds each
  variant's configuration to its list. To read any build:

  ```bash
  "$ANDROID_HOME"/build-tools/<version>/aapt2 dump permissions app.apk > asked.txt
  node apps/mobile/build/apk.ts asked.txt production
  ```

- **A count on the app's icon** is one thing here a later item may want back: it is taking the
  sixteen launchers' names out of `unusedPermissions`, and giving each its reason. **A
  notification the device itself shows at a time**, a reminder scheduled on it and not pushed, is
  the other: it is `RECEIVE_BOOT_COMPLETED`'s reason, without which what was scheduled is lost
  when the device restarts.

**iOS** asks through a sentence in `Info.plist`, and the configuration writes none of its own: no
Face ID (`expo-secure-store` is told so), no camera, no photographs, no location, no contacts. The
dev client's plugin writes one, `NSLocalNetworkUsageDescription`, with its Bonjour service, into
every variant's `Info.plist`, for finding the developer's machine, and adds the build phase that
takes both out of every build that is not a debug one. CI's `mobile-ios` job reads the release build
it makes and fails if either is still there: neither was, on the first run. Read any build the same
way:

```bash
plutil -p Household.app/Info.plist | grep -E 'UsageDescription|NSBonjourServices'
```

## What CI builds

Nothing on a developer's machine need be able to launch the app, so CI is where it is seen on a
device. The jobs run only when the app can have changed: `mobile-changes` reads the diff, and the
three others are skipped unless it names `apps/mobile/`, `packages/`, the lockfile, the workspace's
settings, the root `package.json` or the workflow itself. The app's unit tests are Jest's and run in
the `typescript` job, whatever changed.

| Job | Runner | What it does | The first run took |
|---|---|---|---|
| `mobile` | Linux | `export` and `check`: the production bundles of both platforms, under their budget and with no dev screen | 1 min |
| `mobile-android` | Linux, KVM | writes the Android project, builds a release APK for `x86_64`, starts the development services and the API, makes a member, boots an emulator at API 29, runs the flows, asks the server for the member's devices and for the household's clients, and holds the build's permissions to their reasons | 13 min: the build 9, with nothing cached; the services and the API under one; the emulator's boot and three flows two |
| `mobile-ios` | `macos-26` | writes the iOS project, installs the pods, builds a release app for a simulator of its own, runs the flows, and reads the built `Info.plist` | the pods 1 min, the build 8, Maestro's driver and the app's first start 1 |

**The build the flows walk** is the development variant, as a release build with its JavaScript in
it, made with `EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS=1`: the dev screens are in it, which is what a
flow opens. It is installed nowhere else. Metro keeps what it transformed and does not know of that
variable, so on one machine an export made with it and one made without are made with the cache
cleared between them (`expo export --clear`, which the `export` script passes); CI makes each in a
job of its own.

**The flows** (`apps/mobile/e2e/flows`) select by `testID` and never by a word.
`apps/mobile/e2e/flows.test.ts` holds each to the app's own names, since nothing here runs them.

| Flow | Reads | Runs on |
|---|---|---|
| `launch` | with nobody signed in, the app opens at sign-in | both |
| `engine` | the engine screen's checks all hold on Hermes itself: the i18n vectors, the fonts, the random source, the client's name | both |
| `theme` | the theme changes at a press | both |
| `harness` | a cell of each kind of the twelve-state harness, at 200 % text, in both themes | both |
| `primitives` | a sheet opens and closes; a menu's item opens a confirmation | both |
| `hold` | hold to complete: let go early, and held | both |
| `shell` | a tab bar's slot opens its place and says so, Add is a sheet over it; a module is hidden from its row's menu; one pane at a phone's width and two at a tablet's; *not available* leads home | both |
| `resolvers` | a change that was not accepted is given up: its sheet, the confirmation inside it, both gone and a toast | both |
| `link` | a link opens the app at its address | Android |
| `stack` | a member signs in against the real server, in their household's frame over its tab bar, and is signed in still after a restart. The job then asks the server for the account's devices (`e2e:stack devices`) | Android, with the stack |
| `sign-out` | the bar's Today and More each open their place, and More's sign-out leads back to sign-in | Android, with the stack |
| `replica` | the member's replica opens and receives, with nothing in its inbox, and reports itself; with the connection taken away the device says so and the household's bar comes, and goes when it is back. The job then asks the server for the household's clients (`e2e:stack clients`, D-178) | Android, with the stack |

Three tags keep a flow out of a run: `awaiting`, on a flow written ahead of its screens, which
none is now; `stack`, on one that needs the API and a member, which only the Android job has (a
macOS runner has no Docker); and `android`, on one that does what only Android lets a flow do:
send a link, or take the connection away. Maestro runs the flows in an order of its own, so none
leans on another: each starts the app with nothing kept, which on Android is a new installation
to the server, and `stack`'s sign-in is still there for the job to find whatever `sign-out` did.

**How a flow finds a thing**, each learnt from a run that failed:

- **By its own `testID`, and never as inside another** (`childOf`). React Native mounts the
  children of a view that is there only to be named beside it, in the nearest ancestor that
  draws something or is a control: a cell of a dev screen and what stands in it are neighbours
  in the tree Maestro reads, on both platforms. Where a name is drawn more than once the flow
  narrows the screen first, or takes the first (`index: 0`); and where a state is to be read,
  it is read off a name only that state draws (`hold:released`, `arrange:tasks:show`,
  `sync:live:online:no`), or off `selected`.
- **On a screen narrowed to one part.** The dev screens that are long, the page of primitives,
  the shell's and sync's, carry a row of controls at their head, `<page>:only:<part>` and
  `<page>:only:all` (`src/dev/Only.tsx`; the harness has its own, `harness:only:<body>`), and a
  flow presses one before it looks for anything. It is not only the time saved. **On Android a
  swipe that starts on a stepper's count scrolls nothing**: the field is a single line with its
  text centred, which Android's text field takes for one that scrolls sideways, and it keeps
  the touch. Maestro swipes from the middle of the screen, so a page of controls stopped under
  it with a stepper there, and every swipe after was the same one. It is a defect of the
  control and not of the flows, which a member's thumb meets as well.
- **Scrolled to once it is there, and waited for where it stands.** `scrollUntilVisible` swipes
  for as long as it has not found its element, one that has not come yet as one that is further
  down: so it is for a thing that is drawn already. What a screen draws later, a replica opened
  or a report answered, is waited for with `extendedWaitUntil`, after a scroll to a neighbour
  that is there from the start. The one such thing a flow does scroll to, the device's word
  that it is offline, which the bar that comes above it moves down the screen, is in the last
  part of a narrowed page: a swipe made early leads no further than to it.
- **What stays a few seconds is looked for at once.** After a tap Maestro waits for the screen
  to come to rest before the next command, which on a slow emulator is seconds of a toast's
  five: the tap that brings one says `waitToSettleTimeoutMs: 500`.
- **The connection is given back whatever became of the flow** (`onFlowComplete`, in
  `replica`): a flow that failed with the emulator in aeroplane mode would fail every flow after
  it that asks the server.

**The way to a dev screen is by presses, and not by a link.** The sign-in screen has a control that
leads to the dev sign-in form (`sign-in:dev`), and every dev screen leads to their index
(`dev-screen:index`): `flows/parts/dev.yaml` walks that, and each flow runs it. iOS asks before it
opens a link that came from outside the app, *Open in "Household Dev"?*, in a dialog of the
system's own, which carries no `testID` and stays over the app until it is answered: on the first
run it stayed over every flow after the one that sent a link. Answering it by its words is what
Maestro's own suite does, and what its issue 2610 reports failing on a hosted runner. So a link
is sent on Android alone, by `link`; that a link opens the app on iOS is for a person with a
device to see.

**What a run leaves** is the artifact `mobile-android-e2e` or `mobile-ios-e2e`, for seven days:
Maestro's report (`report.xml`) and a folder a flow under `debug/`, with the screenshots the flow
took (`takeScreenshot/`), what the device logged (`logs/`), and of a failure the screen and the
hierarchy Maestro saw (`screenshots/`, `screen-hierarchy/`), which is where to look first: it says
whether the app drew something else or something stood over it. Xcode's whole output is there
where the build is what failed. It is kept of a run that passed as well: a screenshot is the one
place the app's faces and its two themes are seen. A simulator's log is the whole simulator's,
some hundred megabytes a flow before it is packed.

### On a developer's machine

With an emulator or a simulator up and the end-to-end build installed on it, on macOS or Linux:

```bash
bash apps/mobile/e2e/install-maestro.sh "$HOME/.local/share"   # once; then put its maestro/bin on PATH
pnpm --filter @household/mobile run e2e android                # or ios
```

The build is the one the job makes, by the same commands, which are the job's steps: read them in
the workflow. The flows that sign in want the stack and a member: `pnpm run up`, `db:setup` and
`up:sync`, the API started as the job starts it, `pnpm --filter @household/mobile run e2e:stack
member`, its three lines exported, and `--stack` after the platform.

### Moving a pin

| Pin | Where | How |
|---|---|---|
| Maestro | `apps/mobile/e2e/install-maestro.sh` | the version, and the digest GitHub publishes for the release's `maestro.zip` (the script says how to read it) |
| An action | `.github/workflows/ci.yml` | the release's commit, `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`, with the version in the comment |
| The emulator | `mobile-android`: `api-level`, `target`, `arch`, `profile` | API 29 is the oldest Android the app supports, and on the first run its image booted in a quarter of a minute and ran the flows. Raise it only if that image stops booting, and say so here |
| Xcode and the simulator | `mobile-ios`: `runs-on`, `XCODE`, `IOS_RUNTIME`, `IOS_DEVICE` | together: an Xcode the image holds, the runtime it builds for, a device type of that runtime (`xcrun simctl list runtimes` is printed by the job). `macos-26`, Xcode 26.6, `iOS26.5` and `iPhone 17` were right on the first run |
| The budget | `apps/mobile/build/budget.ts` | `pnpm --filter @household/mobile run export`, then `run check`, and write what it measured |
| A permission | `apps/mobile/build/asked.ts`, or `unusedPermissions` in `apps/mobile/app.config.ts` | [above](#what-a-build-asks-of-its-device) |
