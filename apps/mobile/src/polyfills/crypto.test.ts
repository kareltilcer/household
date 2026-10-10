// The generator's installer, run as Hermes runs it: with no `crypto` to find. Jest's own engine
// has one, Node's, which the installer leaves in place and every other test draws its ids from.
import { afterEach, expect, it, jest } from '@jest/globals'

const host = globalThis as { crypto?: { getRandomValues?: unknown } | undefined }
const nodes = host.crypto

afterEach(() => {
  host.crypto = nodes
})

/** Loads the installer afresh, and says what it left as the generator beside expo-crypto's own. */
function installed(): { generator: unknown; expo: unknown } {
  let expo: unknown
  jest.isolateModules(() => {
    expo = jest.requireActual<typeof import('expo-crypto')>('expo-crypto').getRandomValues
    jest.requireActual('./crypto.ts')
  })
  return { generator: host.crypto?.getRandomValues, expo }
}

it('installs expo-crypto’s generator where the engine has none', () => {
  Reflect.deleteProperty(host, 'crypto')
  const { generator, expo } = installed()
  expect(generator).toBe(expo)
})

it('leaves an engine’s own generator where it is', () => {
  const { generator, expo } = installed()
  expect(generator).toBe(nodes?.getRandomValues)
  expect(generator).not.toBe(expo)
})
