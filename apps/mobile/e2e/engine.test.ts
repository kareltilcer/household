// The engine a device runs the app on is not the one its tests run on. Jest is Node's, and a
// device's is Hermes, which has less: a built-in Node has and Hermes lacks passes every test
// here and is `undefined is not a function` on a device, where a release build has no screen
// to say so on and the app is gone. The sync dev screen never opened on either platform for
// one such call in a fixture it reads as it is loaded (run 38066536920).
//
// So what a device's bundle is made of is read here for the built-ins its engine is known to
// lack, with no device: the app's sources and those of the workspace's packages it bundles,
// fixtures and dev screens among them, since the end-to-end build holds those too. The list
// is the engine screen's (src/dev/engine/builtins.ts, which says where each name was read),
// and that screen asks the engine itself whether the list is right, on a device
// (e2e/flows/engine.yaml): what is read here is held to a run there.
//
// The list is of what is absent, and no longer than what could be confirmed so. Four that a
// reader might add are there on a device, and are in the list's other half for the screen to
// confirm: `Promise.withResolvers` is Hermes's own at this version, and `structuredClone`,
// `AbortSignal.timeout` and `AbortSignal.any` are installed by Expo's runtime as the app
// starts.
import { describe, expect, it } from '@jest/globals'
import { globSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { held, lacking } from '../src/dev/engine/builtins.ts'

/** apps/mobile: Jest runs in it. */
const app = resolve('.')

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
    const calls = sources()
      // The list itself names each, in the pattern that finds it.
      .filter((file) => file !== 'src/dev/engine/builtins.ts')
      .flatMap((file) => {
        const source = readFileSync(join(app, file), 'utf8')
        return lacking.filter(({ call }) => call.test(source)).map(({ name }) => `${file}: ${name}`)
      })
    expect(calls).toEqual([])
  })

  it('names a built-in in one half of its list alone', () => {
    const names = [...lacking, ...held].map(({ name }) => name)
    expect(new Set(names).size).toBe(names.length)
  })
})
