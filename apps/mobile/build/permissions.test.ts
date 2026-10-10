// What a build of each variant asks of its device (05-privacy, FR-PR1: a permission no module
// uses is removed), by name: read off the native projects' own files as Expo's tools would
// write them for the variant (`expo config --type introspect`, which runs every plugin of
// app.config.ts over the template and writes nothing).
//
// It reads what the configuration decides: what the template asks for, and what the manifest
// says is removed, whichever library asks for it. What the libraries' own manifests add as a
// build is merged is in no file of this repository: CI's Android job reads the list off the
// build it makes and holds it to asked.ts, and its iOS job reads the built app's Info.plist
// (docs/runbooks/mobile-builds.md).
import { describe, expect, it } from '@jest/globals'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { developmentPermissions, unusedPermissions, type Variant } from '../app.config.ts'
import { asked, developmentAsked } from './asked.ts'

/** apps/mobile: Jest runs in it. */
const app = resolve('.')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `value.a.b…`, or undefined where a step of the path is no object. */
function field(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((at, key) => (isRecord(at) ? at[key] : undefined), value)
}

/** The native projects' files for `variant`, as the configuration's plugins leave them. */
function introspected(variant: Variant): unknown {
  // Told its variant and an API, and nothing else of the machine's: a link host or a project
  // in a developer's own environment would be read as the build's.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== 'HOUSEHOLD_MOBILE_LINK_HOST' && name !== 'EAS_PROJECT_ID',
    ),
  )
  const run = spawnSync(
    process.execPath,
    [join(app, 'node_modules', 'expo', 'bin', 'cli'), 'config', '--type', 'introspect', '--json'],
    {
      cwd: app,
      encoding: 'utf8',
      env: {
        ...environment,
        APP_VARIANT: variant,
        HOUSEHOLD_MOBILE_API_URL: 'https://api.household.test/api/v1',
        EXPO_NO_TELEMETRY: '1',
      },
    },
  )
  if (run.status !== 0) throw new Error(`expo config: ${run.stderr}`)
  // The configuration itself, after whatever the tool says before it.
  const config: unknown = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')))
  return field(config, '_internal', 'modResults')
}

/**
 * The permissions the Android manifest names, apart: those it asks for, and those it says are
 * removed, whichever library asks for one (`tools:node="remove"`).
 */
function permissions(native: unknown): { asks: string[]; removes: string[] } {
  const listed = field(native, 'android', 'manifest', 'manifest', 'uses-permission')
  const entries = (Array.isArray(listed) ? (listed as unknown[]) : []).map((entry) => ({
    name: String(field(entry, '$', 'android:name')),
    removed: field(entry, '$', 'tools:node') === 'remove',
  }))
  const names = (removed: boolean) =>
    entries
      .filter((entry) => entry.removed === removed)
      .map((entry) => entry.name)
      .sort()
  return { asks: names(false), removes: names(true) }
}

const variants: readonly Variant[] = ['development', 'staging', 'production']

describe('what a build asks for and what it removes', () => {
  it('are two lists: nothing that has a reason is removed', () => {
    const removed: readonly string[] = [...unusedPermissions, ...developmentPermissions]
    expect(Object.keys(asked).filter((name) => removed.includes(name))).toEqual([])
    expect(new Set(unusedPermissions).size).toBe(unusedPermissions.length)
  })

  it('agree on what a development build alone keeps', () => {
    // asked.ts is read by a script Node runs, which cannot read app.config.ts: each says it.
    expect(Object.keys(developmentAsked)).toEqual([...developmentPermissions])
  })
})

describe.each(variants)('a %s build', (variant) => {
  const member = variant !== 'development'
  // Once a variant: the tool is a process of its own.
  const native = introspected(variant)

  it('asks Android for what it uses, and says of the rest that it is removed', () => {
    expect(permissions(native)).toEqual({
      // Of the five the template declares: the two that have a reason, and in a development
      // build the one React Native's own overlay is drawn by.
      asks: member
        ? ['android.permission.INTERNET', 'android.permission.VIBRATE']
        : [
            'android.permission.INTERNET',
            'android.permission.SYSTEM_ALERT_WINDOW',
            'android.permission.VIBRATE',
          ],
      // And everything nothing uses, the template's and every library's, by name.
      removes: [...unusedPermissions, ...(member ? developmentPermissions : [])].sort(),
    })
    // What is left of the template is on the list of what a build asks for, with its reason.
    const reasons = { ...asked, ...developmentAsked }
    expect(permissions(native).asks.filter((name) => !(name in reasons))).toEqual([])
  })

  it('speaks plain http only where its API is a developer’s machine', () => {
    const application = field(native, 'android', 'manifest', 'manifest', 'application')
    const attributes = field(Array.isArray(application) ? application[0] : undefined, '$')
    expect(field(attributes, 'android:usesCleartextTraffic')).toBe(member ? undefined : 'true')
  })

  it('gives iOS no reason for a permission but the dev launcher’s own', () => {
    const plist = field(native, 'ios', 'infoPlist')
    const reasons = Object.keys(isRecord(plist) ? plist : {}).filter((key) =>
      key.endsWith('UsageDescription'),
    )
    // No Face ID, no camera, no photographs, no location, no contacts (05-privacy). The one
    // that is there is expo-dev-launcher's, with its Bonjour service, for finding the
    // developer's machine: the plugin that writes them also adds the build phase that takes
    // both out of every build but a debug one, which CI's iOS job reads off the app it built.
    expect(reasons).toEqual(['NSLocalNetworkUsageDescription'])
    expect(field(plist, 'NSBonjourServices')).toEqual(['_expo._tcp'])
  })
})
