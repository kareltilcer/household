// What a build asks of its device on Android, by name, each with what it is for (05-privacy,
// FR-PR1: every permission the apps request is justified in a table in the release notes, and
// one no module uses is removed). This is that table's source.
//
// The list a build ends with is in no file: the manifests of the template and of every library
// are merged as the build is made. CI's Android job reads it off the build it makes
// (`aapt2 dump permissions`) and holds it to this file (apk.ts): a permission a new library
// brings fails the job until it is either given its reason here or removed in app.config.ts
// (`unusedPermissions`), which is the decision FR-PR1 asks for.

/** What every build asks for, and what for. */
export const asked: Readonly<Record<string, string>> = {
  'android.permission.INTERNET': 'The API and the sync service.',
  'android.permission.ACCESS_NETWORK_STATE':
    'Whether the device is online: the offline bar, and a read that waits for a connection (NetInfo).',
  'android.permission.POST_NOTIFICATIONS':
    'Showing a notification, which its member is asked for at a press and never at launch (expo-notifications).',
  // The template's own, and no library's. expo-notifications declares none and calls no
  // vibrator, and of everything the app links only React Native's `Vibration` does, which the
  // app never calls (read in their sources). Whether Android still makes a notification felt
  // for an app that does not hold it is the platform's to say, and is in none of them: it is
  // kept until a device has shown one felt without it (plan item 30), and removed then in
  // app.config.ts.
  'android.permission.VIBRATE':
    'A notification that is felt. Expo’s template asks for it and no library does: kept until a device has shown one felt without it.',
  'android.permission.WAKE_LOCK':
    'The device stays awake for as long as a push takes to arrive (Firebase messaging, under expo-notifications).',
  'com.google.android.c2dm.permission.RECEIVE':
    'A push is received from Google’s messaging service (Firebase messaging, under expo-notifications).',
}

/**
 * What a development build asks for beside those, and no build a member installs
 * (app.config.ts, `developmentPermissions`, which a test holds to this).
 */
export const developmentAsked: Readonly<Record<string, string>> = {
  'android.permission.SYSTEM_ALERT_WINDOW':
    'React Native draws its errors and its menu over the app in a debug build.',
}

/**
 * The app's own permission, which it declares and is the only holder of: androidx's guard over
 * the receivers the app registers as it runs, so that no other app can send to them. It is
 * named for the app, `<identifier>.` and this, and asks its member nothing.
 */
export const ownPermission = 'DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'

export type Built = 'development' | 'staging' | 'production'

/**
 * What `aapt2 dump permissions` printed of a build: whose it is, and each permission it uses.
 * A manifest asks for one in either of two elements, and the list prints each under its own
 * name (aapt2's DumpManifest.cpp): `uses-permission`, and `uses-permission-sdk-23`, which asks
 * from Android 6 on and so of every device this app runs on. Both are read: one a library
 * declared the second way would otherwise pass with no reason.
 */
export function read(dump: string): { readonly identifier: string | undefined; names: string[] } {
  return {
    identifier: /^package: (\S+)$/m.exec(dump)?.[1],
    names: [...dump.matchAll(/^uses-permission(?:-sdk-23)?: name='([^']+)'/gm)].map(
      ([, name = '']) => name,
    ),
  }
}

/**
 * What is wrong with what a build of `variant` asks for, a sentence a failure: a permission it
 * uses that has no reason here, and one this file says it asks for that it does not.
 */
export function judge(dump: string, variant: Built): string[] {
  const { identifier, names } = read(dump)
  if (identifier === undefined || names.length === 0) {
    return ['this is no list of a build’s permissions: `aapt2 dump permissions <apk>` prints one']
  }
  const expected = new Set([
    ...Object.keys(asked),
    ...(variant === 'development' ? Object.keys(developmentAsked) : []),
    `${identifier}.${ownPermission}`,
  ])
  const used = new Set(names)
  return [
    ...[...used]
      .filter((name) => !expected.has(name))
      .map(
        (name) =>
          `the build asks for ${name}, which has no reason: give it one in build/asked.ts, ` +
          'or remove it in app.config.ts (unusedPermissions)',
      ),
    ...[...expected]
      .filter((name) => !used.has(name))
      .map((name) => `the build does not ask for ${name}: take it out of build/asked.ts`),
  ]
}
