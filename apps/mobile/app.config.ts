// The mobile app's configuration (plan item 28), read by Expo's tools as they bundle, prebuild
// and build: the one place the app's identity is written. An identifier here is a placeholder
// until the app is published under its publisher's own: changing one is changing this file.
//
// A build is one of three variants, which `APP_VARIANT` names (eas.json's profiles set it, and
// a tool run by hand with none is development's). Each has an identifier, a scheme and a name
// of its own, so the three install side by side on one device.
//
// What a build is told beside its variant, all through the environment:
// - `HOUSEHOLD_MOBILE_API_URL`: the API's base, `https://…/api/v1`. A development build told
//   none asks the developer's own machine (src/api/client.ts); any other is refused here, since
//   a build with no API to ask is found out only on a device. The sync service's address is
//   never configured: it arrives with the credentials the API mints (ADR 0014).
// - `HOUSEHOLD_MOBILE_LINK_HOST`: the host whose `https` links open the app, a universal link
//   on iOS and an app link on Android. No host, no associated domain: the scheme alone opens it.
// - `EAS_PROJECT_ID`: the EAS project a build belongs to and a push token is asked for. None
//   exists yet, and nothing here needs one to bundle or to prebuild.
//
// Expo's loader compiles this file alone, so it imports nothing of the workspace's: what it
// shares with the app is held to it by a test (src/config.test.ts).
import type { ExpoConfig } from 'expo/config'
import { version } from './package.json'

const identifier = 'com.kareltilcer.household'
const scheme = 'household'
const name = 'Household'

/** What a variant adds to the identifier and the scheme, and to the name under the icon. */
const variants = {
  development: { suffix: 'dev', label: 'Dev' },
  staging: { suffix: 'staging', label: 'Staging' },
  production: undefined,
} as const

export type Variant = keyof typeof variants

function variantOf(value: string | undefined): Variant {
  if (value === undefined || value === '') return 'development'
  if (value in variants) return value as Variant
  throw new Error(
    `APP_VARIANT is ${JSON.stringify(value)}: one of ${Object.keys(variants).join(', ')}`,
  )
}

/**
 * The static file of each family the type scale names (@household/tokens' fonts.ts), as a path
 * into the package that holds it. iOS registers a file under the PostScript name it carries,
 * which the tokens' own test holds to the family; Android registers it under the family and
 * the weight given here.
 */
const fonts = [
  {
    family: 'IBMPlexSans-Regular',
    weight: 400,
    file: '@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf',
  },
  {
    family: 'IBMPlexSans-Medium',
    weight: 500,
    file: '@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf',
  },
  {
    family: 'IBMPlexSans-SemiBold',
    weight: 600,
    file: '@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf',
  },
  {
    family: 'IBMPlexMono-Regular',
    weight: 400,
    file: '@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf',
  },
  {
    family: 'IBMPlexMono-Medium',
    weight: 500,
    file: '@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf',
  },
] as const

/** What the app reads of its build at run time, through expo-constants (src/api/client.ts). */
export interface Extra {
  readonly variant: Variant
  readonly apiUrl?: string
  readonly linkHost?: string
  readonly eas?: { readonly projectId: string }
}

function setting(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

export default function config(): ExpoConfig {
  const variant = variantOf(process.env.APP_VARIANT)
  const flavour = variants[variant]
  const apiUrl = setting(process.env.HOUSEHOLD_MOBILE_API_URL)
  const linkHost = setting(process.env.HOUSEHOLD_MOBILE_LINK_HOST)
  const projectId = setting(process.env.EAS_PROJECT_ID)
  if (variant !== 'development' && apiUrl === undefined) {
    throw new Error(`HOUSEHOLD_MOBILE_API_URL is not set, and a ${variant} build has no default`)
  }

  const id = flavour === undefined ? identifier : `${identifier}.${flavour.suffix}`
  const extra: Extra = {
    variant,
    ...(apiUrl === undefined ? {} : { apiUrl }),
    ...(linkHost === undefined ? {} : { linkHost }),
    ...(projectId === undefined ? {} : { eas: { projectId } }),
  }

  return {
    name: flavour === undefined ? name : `${name} ${flavour.label}`,
    slug: 'household',
    // The version `Household-Client` names (src/api/client.ts) is the one a store shows.
    version,
    scheme: flavour === undefined ? scheme : `${scheme}-${flavour.suffix}`,
    platforms: ['ios', 'android'],
    // Tablet is a layout of this app (PL-5), so it turns with its device.
    orientation: 'default',
    // Light, dark and the system's (06-clients §3): the app is told which the system is in.
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: id,
      supportsTablet: true,
      ...(linkHost === undefined ? {} : { associatedDomains: [`applinks:${linkHost}`] }),
    },
    android: {
      package: id,
      ...(linkHost === undefined
        ? {}
        : {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [{ scheme: 'https', host: linkHost }],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }),
    },
    plugins: [
      'expo-router',
      [
        'expo-build-properties',
        {
          // 06-clients: iOS 16 and Android 10 at the least. Expo SDK 57 builds for no iOS
          // before 16.4, so that is the minimum until the PRD or the SDK moves.
          ios: { deploymentTarget: '16.4' },
          android: { minSdkVersion: 29 },
        },
      ],
      [
        'expo-font',
        {
          ios: { fonts: fonts.map(({ file }) => file) },
          android: {
            fonts: fonts.map(({ family, weight, file }) => ({
              fontFamily: family,
              fontDefinitions: [{ path: file, weight }],
            })),
          },
        },
      ],
      // The keychain is not opened behind Face ID, so no build asks for it (FR-PR1).
      ['expo-secure-store', { faceIDPermission: false }],
      'expo-notifications',
    ],
    extra,
  }
}
