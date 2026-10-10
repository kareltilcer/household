// app.config.ts is compiled by Expo's loader on its own, so it imports nothing of the
// workspace's and states again what the app and the tokens know. This holds it to them.
import { afterEach, describe, expect, it } from '@jest/globals'
import { fonts } from '@household/tokens'
import config, { type Extra } from '../app.config.ts'
import { version } from '../package.json'
import { clientName } from './api/client.ts'
import { storeUrl } from './update/store.ts'

const told = [
  'APP_VARIANT',
  'HOUSEHOLD_MOBILE_API_URL',
  'HOUSEHOLD_MOBILE_LINK_HOST',
  'EAS_PROJECT_ID',
  'HOUSEHOLD_MOBILE_STORE_URL_IOS',
  'HOUSEHOLD_MOBILE_STORE_URL_ANDROID',
]

/** The configuration a tool reads when the environment names `settings` and nothing else. */
function configured(settings: Record<string, string> = {}): ReturnType<typeof config> {
  for (const name of told) Reflect.deleteProperty(process.env, name)
  Object.assign(process.env, settings)
  return config()
}

afterEach(() => {
  for (const name of told) Reflect.deleteProperty(process.env, name)
})

/** The options a plugin of the configuration was given. */
function plugin(name: string, of = configured()): unknown {
  const entry = (of.plugins ?? []).find((item) => Array.isArray(item) && item[0] === name)
  return Array.isArray(entry) ? entry[1] : undefined
}

describe('app.config.ts', () => {
  it('gives the app the version it names itself by', () => {
    expect(configured().version).toBe(version)
    expect(clientName()).toBe(`mobile/${version}`)
  })

  it('embeds the file of every family the type scale names, under that family', () => {
    const faces = Object.values(fonts).flatMap((face) => {
      const families: Readonly<Record<number, string>> = face.native
      const files: Readonly<Record<number, string>> = face.files
      return face.weights.map((weight) => ({
        family: families[weight],
        weight,
        file: files[weight],
      }))
    })
    expect(plugin('expo-font')).toEqual({
      // iOS registers a file under the PostScript name it carries: the tokens' own test holds
      // each file's to its family.
      ios: { fonts: faces.map(({ file }) => file) },
      android: {
        fonts: faces.map(({ family, weight, file }) => ({
          fontFamily: family,
          fontDefinitions: [{ path: file, weight }],
        })),
      },
    })
  })

  it.each([
    ['development', 'com.kareltilcer.household.dev', 'household-dev'],
    ['staging', 'com.kareltilcer.household.staging', 'household-staging'],
    ['production', 'com.kareltilcer.household', 'household'],
  ])('gives the %s variant an identity of its own', (variant, identifier, scheme) => {
    const built = configured({
      APP_VARIANT: variant,
      HOUSEHOLD_MOBILE_API_URL: 'https://api.household.test/api/v1',
    })
    expect([built.ios?.bundleIdentifier, built.android?.package, built.scheme]).toEqual([
      identifier,
      identifier,
      scheme,
    ])
    expect((built.extra as Extra).variant).toBe(variant)
  })

  it('is development’s when it is told no variant, and refuses one it does not know', () => {
    expect((configured().extra as Extra).variant).toBe('development')
    expect(() => configured({ APP_VARIANT: 'preview' })).toThrow(/APP_VARIANT/)
  })

  it('refuses a build other than development’s that is told no API', () => {
    expect(configured().extra).toEqual({ variant: 'development' })
    expect(() => configured({ APP_VARIANT: 'staging' })).toThrow(/HOUSEHOLD_MOBILE_API_URL/)
    expect(() => configured({ APP_VARIANT: 'production' })).toThrow(/HOUSEHOLD_MOBILE_API_URL/)
  })

  it('declares no associated domain and no EAS project until it is told one', () => {
    const bare = configured()
    expect(bare.ios?.associatedDomains).toBeUndefined()
    expect(bare.android?.intentFilters).toBeUndefined()

    const linked = configured({
      HOUSEHOLD_MOBILE_LINK_HOST: 'app.household.test',
      EAS_PROJECT_ID: '0198c0de-0000-7000-8000-000000000000',
    })
    expect(linked.ios?.associatedDomains).toEqual(['applinks:app.household.test'])
    expect(linked.android?.intentFilters).toEqual([
      expect.objectContaining({
        autoVerify: true,
        data: [{ scheme: 'https', host: 'app.household.test' }],
      }),
    ])
    expect(linked.extra).toEqual({
      variant: 'development',
      linkHost: 'app.household.test',
      eas: { projectId: '0198c0de-0000-7000-8000-000000000000' },
    })
  })

  // *Please update* opens the app's page in the store of the device it runs on, and draws no
  // control where the build names none: what the screen reads is what this gives (src/update).
  it('names the app’s page in a store for each platform it is told one for, and none by default', () => {
    expect(storeUrl(configured().extra, 'ios')).toBeUndefined()
    expect(storeUrl(configured().extra, 'android')).toBeUndefined()

    const android = 'https://play.google.com/store/apps/details?id=com.kareltilcer.household'
    const one = configured({ HOUSEHOLD_MOBILE_STORE_URL_ANDROID: android })
    expect(one.extra).toEqual({ variant: 'development', storeUrl: { android } })
    expect(storeUrl(one.extra, 'android')).toBe(android)
    expect(storeUrl(one.extra, 'ios')).toBeUndefined()

    const ios = 'https://apps.apple.com/app/id0000000000'
    const both = configured({
      HOUSEHOLD_MOBILE_STORE_URL_IOS: ios,
      HOUSEHOLD_MOBILE_STORE_URL_ANDROID: android,
    })
    expect((both.extra as Extra).storeUrl).toEqual({ ios, android })
    expect(storeUrl(both.extra, 'ios')).toBe(ios)
  })
})
