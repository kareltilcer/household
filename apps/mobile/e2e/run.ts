// `pnpm --filter @household/mobile run e2e <android|ios> [--stack]`: Maestro's flows (e2e/flows)
// over the app's end-to-end build, on the emulator or the simulator that is up with that build
// installed (PL-3, 06-clients §8). The build is a release one of the development variant with
// the dev screens in it (`EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS=1`), which is what the flows walk:
// docs/runbooks/mobile-builds.md says how CI makes it and how a developer does.
//
// It builds nothing and starts no device: it runs the flows and leaves what they left under
// dist/e2e, which CI keeps as an artifact. Maestro keeps the device's own log beside each
// flow, so nothing here follows it. Where more than one device is up, `HOUSEHOLD_E2E_DEVICE`
// names the one: a simulator's id, an emulator's serial. `--stack` says the API and the sync
// service are up and the environment names a member to sign in as (e2e/stack.ts), which only
// CI's Android job can say.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, setting, version } from './app.ts'
import { platforms, test } from './maestro.ts'

const [named, ...flags] = process.argv.slice(2)
const platform = platforms.find((known) => known === named)
if (platform === undefined) {
  console.error(`e2e: which device? One of ${platforms.join(', ')}.`)
  process.exit(2)
}
const stack = flags.includes('--stack')
const output = join(app, 'dist', 'e2e')

/** The member the stack's flows sign in as, whom e2e/stack.ts made and the environment names. */
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

const device = setting('HOUSEHOLD_E2E_DEVICE')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

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

if (ran.error !== undefined) {
  console.error(
    `e2e: Maestro did not start (${ran.error.message}). ` +
      '`bash e2e/install-maestro.sh` installs the version the flows are written for.',
  )
  process.exit(1)
}
process.exit(ran.status ?? 1)
