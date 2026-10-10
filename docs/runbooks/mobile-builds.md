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
module uses is removed. Three places decide the list.

- **`app.config.ts`** removes from a staging and a production build what Expo's template declares
  for every app and nothing here uses: `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` and
  `SYSTEM_ALERT_WINDOW`. The manifest says of each that it is removed, whichever library asks for
  it. A development build keeps the template's own. `apps/mobile/build/permissions.test.ts` holds
  each variant to its list, by name.
- **The libraries' own manifests** add theirs as a build is merged: `ACCESS_NETWORK_STATE` and
  `ACCESS_WIFI_STATE` (NetInfo: whether the device is online), `POST_NOTIFICATIONS` and
  `RECEIVE_BOOT_COMPLETED` (expo-notifications), and whatever the Firebase messaging and badge
  libraries under it declare, which are in no file of the repository. So the list a build ends with
  is read off the build:

  ```bash
  "$ANDROID_HOME"/build-tools/<version>/aapt2 dump permissions app.apk
  ```

  CI's `mobile-android` job prints it for the build it makes, which is the development variant: a
  staging or a production build asks for that less the three above.
- **iOS** asks through a sentence in `Info.plist`, and the configuration writes none of its own:
  no Face ID (`expo-secure-store` is told so), no camera, no photographs, no location, no contacts.
  The dev client's plugin writes one, `NSLocalNetworkUsageDescription`, with its Bonjour service,
  into every variant's `Info.plist`, for finding the developer's machine, and adds the build phase
  that takes both out of every build that is not a debug one. CI's `mobile-ios` job reads the
  release build it makes and fails if either is still there. Read any build the same way:

  ```bash
  plutil -p Household.app/Info.plist | grep -E 'UsageDescription|NSBonjourServices'
  ```

A new library is a new reader of this section: read what it declares before it is merged.

## What CI builds

Nothing on a developer's machine need be able to launch the app, so CI is where it is seen on a
device. The jobs run only when the app can have changed: `mobile-changes` reads the diff, and the
three others are skipped unless it names `apps/mobile/`, `packages/`, the lockfile, the workspace's
settings, the root `package.json` or the workflow itself. The app's unit tests are Jest's and run in
the `typescript` job, whatever changed.

| Job | Runner | What it does |
|---|---|---|
| `mobile` | Linux | `export` and `check`: the production bundles of both platforms, under their budget and with no dev screen |
| `mobile-android` | Linux, KVM | writes the Android project, builds a release APK for `x86_64`, starts the development services and the API, makes a member, boots an emulator at API 29 and runs the flows |
| `mobile-ios` | `macos-26` | writes the iOS project, installs the pods, builds a release app for a simulator of its own, runs the flows, and reads the built `Info.plist` |

**The build the flows walk** is the development variant, as a release build with its JavaScript in
it, made with `EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS=1`: the dev screens are in it, which is what a
flow opens. It is installed nowhere else. Metro keeps what it transformed and does not know of that
variable, so on one machine an export made with it and one made without are made with the cache
cleared between them (`expo export --clear`, which the `export` script passes); CI makes each in a
job of its own.

**The flows** select by `testID` and never by a word. `apps/mobile/e2e/flows.test.ts` holds each to
the app's own names, since nothing here runs them. Two tags keep a flow out of a run: `awaiting`, on
a flow written ahead of its screens, and `stack`, on one that needs the API and a member, which
only the Android job has (a macOS runner has no Docker).

**What a run leaves** is the artifact `mobile-android-e2e` or `mobile-ios-e2e`, for seven days:
Maestro's report (`report.xml`), its log and a screenshot of each failure (`debug/`), the
screenshots the flows took (`kept/`), and the device's log (`device.log`); on iOS Xcode's whole
output and the log of Maestro's driver too. It is kept of a run that passed as well: a screenshot is
the one place the app's faces and its two themes are seen.

### On a developer's machine

With an emulator or a simulator up and the end-to-end build installed on it, on macOS or Linux:

```bash
bash apps/mobile/e2e/install-maestro.sh "$HOME/.local/share"   # once; then put its maestro/bin on PATH
pnpm --filter @household/mobile run e2e android                # or ios
```

The build is the one the job makes, by the same commands, which are the job's steps: read them in
the workflow.

### Moving a pin

| Pin | Where | How |
|---|---|---|
| Maestro | `apps/mobile/e2e/install-maestro.sh` | the version, and the digest GitHub publishes for the release's `maestro.zip` (the script says how to read it) |
| An action | `.github/workflows/ci.yml` | the release's commit, `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`, with the version in the comment |
| The emulator | `mobile-android`: `api-level`, `target`, `arch`, `profile` | API 29 is the oldest Android the app supports. Raise it only if that image stops booting, and say so here |
| Xcode and the simulator | `mobile-ios`: `runs-on`, `XCODE`, `IOS_RUNTIME`, `IOS_DEVICE` | together: an Xcode the image holds, the runtime it builds for, a device type of that runtime (`xcrun simctl list runtimes` is printed by the job) |
| The budget | `apps/mobile/build/budget.ts` | `pnpm --filter @household/mobile run export`, then `run check`, and write what it measured |
