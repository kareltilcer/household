// What the two scripts of this folder read of the app and of the machine: its version, and a
// setting the environment may hold. Both are run by pnpm in apps/mobile.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** apps/mobile. */
export const app = resolve('.')

/** One of the settings a run is told through the environment, or undefined for none. */
export function setting(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

/**
 * The app's own version, which it names itself by after `mobile/` (src/api/client.ts) and
 * which a sign-in records as its device's.
 */
export function version(): string {
  const manifest: unknown = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8'))
  const found =
    typeof manifest === 'object' && manifest !== null && 'version' in manifest
      ? manifest.version
      : undefined
  if (typeof found !== 'string') throw new Error('package.json names no version')
  return found
}
