// The engine a device runs the app on is not the one its tests run on. Jest is Node's, and a
// device's is Hermes, which has less: a built-in Node has and Hermes lacks passes every test
// here and is `undefined is not a function` on a device, where a release build has no screen
// to say so on and the app is gone. The sync dev screen never opened on either platform for
// one such call in a fixture it reads as it is loaded (run 38066536920).
//
// So what a device's bundle is made of is read here for the built-ins its engine is known to
// lack, with no device: the app's sources and those of the workspace's packages it bundles,
// fixtures and dev screens among them, since the end-to-end build holds those too. That the
// engine has what the app needs of it otherwise, the fonts and `Intl` among it, is the engine
// screen's to show on a device (src/dev/engine, e2e/flows/engine.yaml).
import { describe, expect, it } from '@jest/globals'
import { globSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** apps/mobile: Jest runs in it. */
const app = resolve('.')

/**
 * What Hermes lacks, at the version the build compiles for (`hermes-compiler` 250829098.0.17,
 * React Native 0.86): each a method of its arrays, objects or maps, which it implements
 * natively and names in one list (`include/hermes/VM/PredefinedStrings.def`); these are in
 * none. The first was also met on a device. Read the list again when React Native moves:
 * a name the engine has gained leaves this one, and its neighbours are worth a look.
 */
const lacking: readonly { readonly name: string; readonly call: RegExp }[] = [
  { name: 'Array.prototype.toSorted', call: /\.toSorted\(/ },
  { name: 'Array.fromAsync', call: /\bArray\.fromAsync\b/ },
  { name: 'Object.groupBy, Map.groupBy', call: /\b(?:Object|Map)\.groupBy\b/ },
]

/** The workspace's packages the app bundles: those its manifest depends on, and no tool's. */
function bundled(): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
  const dependencies =
    typeof manifest === 'object' && manifest !== null && 'dependencies' in manifest
      ? manifest.dependencies
      : undefined
  const scope = '@household/'
  return Object.keys(typeof dependencies === 'object' && dependencies !== null ? dependencies : {})
    .filter((name) => name.startsWith(scope))
    .map((name) => name.slice(scope.length))
}

/** Every source a device's bundle can hold, by its path from apps/mobile. */
function sources(): string[] {
  return [
    'index.ts',
    ...globSync('{src,app}/**/*.{ts,tsx}', { cwd: app }),
    ...bundled().flatMap((name) =>
      globSync(`../../packages/${name}/src/**/*.{ts,tsx}`, { cwd: app }),
    ),
  ]
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => !file.includes('.test.'))
}

describe('what a device runs', () => {
  it('is read: the app’s sources, and those of the packages it bundles', () => {
    const read = sources()
    expect(bundled()).toContain('sync')
    expect(read).toContain('src/sync/sync.fixtures.ts')
    expect(read.some((file) => file.startsWith('../../packages/sync/src/'))).toBe(true)
  })

  it('calls no built-in the device’s engine lacks, which Node would let pass', () => {
    const calls = sources().flatMap((file) => {
      const source = readFileSync(join(app, file), 'utf8')
      return lacking.filter(({ call }) => call.test(source)).map(({ name }) => `${file}: ${name}`)
    })
    expect(calls).toEqual([])
  })
})
