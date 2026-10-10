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
//
// A flow that failed because Maestro's driver on the device was gone is run again, once, with
// the others it took, in a session of their own (dist/e2e/again): on iOS a crash of the app
// in one flow takes the driver a minute or two later, and every flow after it (maestro.ts,
// `outcome`). A flow that failed for itself is not run again, and fails the run.
//
// What the flows are told is written by Maestro beside each of them, the member's password
// among it, and CI keeps the folder where anybody can read it. It is a password to nothing,
// an account in the job's own database, which goes with the runner; it is taken out of what
// the run wrote all the same, so that no artifact holds anything that reads as a credential.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { app, setting, version } from './app.ts'
import { outcome, platforms, test, type Run } from './maestro.ts'

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

/** Runs Maestro over `run`, and answers its exit status: 0 where every flow passed. */
function maestro(run: Run): number {
  const ran = spawnSync('maestro', test(run), { stdio: 'inherit' })
  if (ran.error !== undefined) {
    console.error(
      `e2e: Maestro did not start (${ran.error.message}). ` +
        '`bash e2e/install-maestro.sh` installs the version the flows are written for.',
    )
    process.exit(1)
  }
  return ran.status ?? 1
}

const device = setting('HOUSEHOLD_E2E_DEVICE')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

const flows = join(app, 'e2e', 'flows')
const run: Run = {
  platform,
  ...(device === undefined ? {} : { device }),
  stack,
  flows,
  output,
  told: { CLIENT: `mobile/${version()}`, ...(stack ? member() : {}) },
}

/** Takes `secret` out of every file of text the run wrote, the device's logs among them. */
function redact(secret: string): void {
  for (const entry of readdirSync(output, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(json|log|txt|xml)$/.test(entry.name)) continue
    const file = join(entry.parentPath, entry.name)
    const text = readFileSync(file, 'utf8')
    if (text.includes(secret)) writeFileSync(file, text.replaceAll(secret, '***'))
  }
}

/** The run's own way out: with what it wrote fit to be kept. */
function leave(status: number): never {
  const secret = run.told.PASSWORD
  if (secret !== undefined) redact(secret)
  process.exit(status)
}

const status = maestro(run)
const written = join(output, 'report.xml')
const { failed, lost } = outcome(existsSync(written) ? readFileSync(written, 'utf8') : '')
if (lost.length === 0) leave(status)

// The flows the driver's death took, in a folder of their own with the steps they share: a
// folder is what Maestro runs as a suite, with a report, as it ran the first time.
const again = join(output, 'again')
const taken = join(again, 'flows')
mkdirSync(taken, { recursive: true })
cpSync(join(flows, 'parts'), join(taken, 'parts'), { recursive: true })
for (const name of lost) cpSync(join(flows, `${name}.yaml`), join(taken, `${name}.yaml`))

const own = failed.filter((name) => !lost.includes(name))
console.error(
  `e2e: Maestro's driver on the device was gone under ${lost.join(', ')}, ` +
    'which failed for no reason of their own: they are run again, once.' +
    (own.length === 0 ? '' : ` Failed for itself, and not run again: ${own.join(', ')}.`),
)
const second = maestro({ ...run, flows: taken, output: again })
leave(own.length > 0 ? 1 : second)
