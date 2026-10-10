// `pnpm --filter @household/mobile run e2e <android|ios> [--stack]`: Maestro's flows (e2e/flows)
// over the app's end-to-end build, on the emulator or the simulator that is up with that build
// installed (PL-3, 06-clients §8). The build is a release one of the development variant with
// the dev screens in it (`EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS=1`), which is what the flows walk:
// docs/runbooks/mobile-builds.md says how CI makes it and how a developer does.
//
// It builds nothing and starts no device: it runs the flows, keeps what the device logged
// meanwhile, and leaves everything under dist/e2e, which CI keeps as an artifact. Where more
// than one device is up, `HOUSEHOLD_E2E_DEVICE` names the one: a simulator's id, an emulator's
// serial. `--stack` says the API and the sync service are up and the environment names a
// member to sign in as (e2e/stack.ts), which only CI's Android job can say.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { platforms, test, type Platform } from './maestro.ts'

const [named, ...flags] = process.argv.slice(2)
const platform = platforms.find((known) => known === named)
if (platform === undefined) {
  console.error(`e2e: which device? One of ${platforms.join(', ')}.`)
  process.exit(2)
}
const stack = flags.includes('--stack')

/** apps/mobile: pnpm runs the script in it. */
const app = resolve('.')
const output = join(app, 'dist', 'e2e')

/** One of the settings the run is told through the environment, or undefined for none. */
function setting(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

/** The app's own version, which the engine screen shows after `mobile/` (src/api/client.ts). */
function version(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
  const found =
    typeof manifest === 'object' && manifest !== null && 'version' in manifest
      ? manifest.version
      : undefined
  if (typeof found !== 'string') throw new Error('package.json names no version')
  return found
}

/** The member the stack's flow signs in as, whom e2e/stack.ts made and the environment names. */
function member(): Record<string, string> {
  const told = {
    EMAIL: setting('HOUSEHOLD_E2E_EMAIL'),
    PASSWORD: setting('HOUSEHOLD_E2E_PASSWORD'),
    HOUSEHOLD: setting('HOUSEHOLD_E2E_HOUSEHOLD'),
  }
  const entries = Object.entries(told).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  )
  if (entries.length < Object.keys(told).length) {
    console.error('e2e: --stack needs a member: run `pnpm run e2e:stack member` first.')
    process.exit(2)
  }
  return Object.fromEntries(entries)
}

/**
 * What follows the device's log as the flows run: the emulator's own, or the simulator's lines
 * of this app, whose process is named for it in every variant (app.config.ts).
 */
function following(on: Platform, device: string | undefined): [string, string[]] {
  return on === 'android'
    ? ['adb', [...(device === undefined ? [] : ['-s', device]), 'logcat', '-v', 'time']]
    : [
        'xcrun',
        [
          'simctl',
          'spawn',
          device ?? 'booted',
          'log',
          'stream',
          '--style',
          'compact',
          '--predicate',
          'processImagePath CONTAINS "Household"',
        ],
      ]
}

const device = setting('HOUSEHOLD_E2E_DEVICE')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

// The log is written by its own process straight to the file, so it is kept while this one
// waits on Maestro, and it is a help to whoever reads a failure, never a reason for one.
const log = openSync(join(output, 'device.log'), 'w')
const [command, watching] = following(platform, device)
const follower = spawn(command, watching, { stdio: ['ignore', log, log] })
follower.on('error', (error) => {
  console.error(`e2e: the device's log is not kept: ${error.message}`)
})

const ran = spawnSync(
  'maestro',
  test({
    platform,
    ...(device === undefined ? {} : { device }),
    stack,
    flows: join(app, 'e2e', 'flows'),
    output,
    told: { CLIENT: `mobile/${version()}`, ...(stack ? member() : {}) },
  }),
  { stdio: 'inherit' },
)

follower.kill()
closeSync(log)

if (ran.error !== undefined) {
  console.error(
    `e2e: Maestro did not start (${ran.error.message}). ` +
      '`bash e2e/install-maestro.sh` installs the version the flows are written for.',
  )
  process.exit(1)
}
process.exit(ran.status ?? 1)
