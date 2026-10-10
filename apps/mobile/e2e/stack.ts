// `pnpm --filter @household/mobile run e2e:stack <member|devices|clients>`: what the flows with
// the stack need made on it before they run, and what is asked of it after them (plan item 28),
// through the API the way the web's suite makes its people (apps/web/e2e/stack.ts). The API is
// the run's own, started from source where the device reaches it
// (docs/runbooks/mobile-builds.md); this asks it from the machine, on its loopback.
//
// - `member`: a person nobody has registered, and a household they own: who the flows sign in
//   as. It says what it made in the environment of the steps after it, where CI gives it a
//   file to write to (`GITHUB_ENV`), and on its output otherwise: `HOUSEHOLD_E2E_EMAIL`,
//   `HOUSEHOLD_E2E_PASSWORD` and `HOUSEHOLD_E2E_HOUSEHOLD`, which e2e/run.ts hands the flows.
// - `devices`: after a flow signed that member in on a device, the account's own list of
//   devices names an installation with the app's version (PRD 02 FR-ID3): the sign-in the
//   device sent was the contract's, and named the app as `Household-Client` does.
// - `clients`: after a flow opened the household's replica, the household's clients name
//   `mobile/<version>` (D-178): the replica's own requests named the app. A replica reports
//   itself once it has caught up, so this asks until it is there, for a minute.
//
// It asks as a device does, by a bearer, and names itself no client: a household's clients are
// its replicas' own reports, and this opens none. Each time it signs in it is a device of its
// own, which sends no version, so the one in the list that has the app's is the app's.
import { randomBytes, randomInt } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createApiClient, newId } from '@household/api'
import { setting, version } from './app.ts'

/** Where the run's API answers the machine it runs on. */
const api = createApiClient({
  baseUrl: setting('HOUSEHOLD_E2E_API_URL') ?? 'http://127.0.0.1:8080/api/v1',
})

/** What the script's own sign-ins are called in the account's list of devices. */
const label = 'e2e/stack.ts'

/** A request's answer, which must have the status the script expects of it. */
function expecting<T extends { response: Response; error?: unknown }>(
  answer: T,
  status: number,
  what: string,
): T {
  if (answer.response.status !== status) {
    throw new Error(
      `${what} answered ${String(answer.response.status)}, not ${String(status)}: ` +
        JSON.stringify(answer.error),
    )
  }
  return answer
}

/** One of the three the `member` command named, which the commands after it are told. */
function told(name: string): string {
  const value = setting(name)
  if (value === undefined) {
    throw new Error(`${name} is not set: \`pnpm run e2e:stack member\` makes the member first`)
  }
  return value
}

/**
 * Signs in as a device of the script's own, which is not the installation a flow signs in on:
 * a device signs in once at a time, and that one's sign-in is the app's to make. It answers
 * what a request is authorised by.
 */
async function signIn(email: string, password: string): Promise<{ Authorization: string }> {
  const signedIn = expecting(
    await api.POST('/auth/login', {
      body: {
        email,
        password,
        client_type: 'mobile',
        device: { id: newId(), label, platform: 'android' },
      },
    }),
    200,
    'signing in',
  )
  const token = signedIn.data?.tokens?.access_token
  if (token === undefined) throw new Error('signing in gave no access token')
  return { Authorization: `Bearer ${token}` }
}

/**
 * Registers a person and makes them a household. Their address is left unconfirmed: such an
 * account signs in and makes a household like any other (FR-ID1), and nothing the flows do
 * extends trust beyond it.
 */
async function member(): Promise<void> {
  // Theirs alone, in this run and any other against the same database, and a password that is
  // long and in no list of breached ones: it is drawn at random.
  const email = `e2e-${String(randomInt(1, 2 ** 47)).padStart(15, '0')}@hh9.io`
  const password = `e2e-${randomBytes(12).toString('base64url')}`

  expecting(
    await api.POST('/auth/register', {
      body: { email, password, display_name: 'Áňa Dvořáčková', locale: 'en' },
    }),
    202,
    'registering',
  )
  const household = newId()
  expecting(
    await api.POST('/households', {
      headers: await signIn(email, password),
      body: {
        id: household,
        name: 'Dům č. 7',
        country: 'CZ',
        timezone: 'Europe/Prague',
        base_currency: 'CZK',
        locale: 'cs',
      },
    }),
    201,
    'creating a household',
  )

  const made = {
    HOUSEHOLD_E2E_EMAIL: email,
    HOUSEHOLD_E2E_PASSWORD: password,
    HOUSEHOLD_E2E_HOUSEHOLD: household,
  }
  const lines = Object.entries(made).map(([name, value]) => `${name}=${value}`)
  const later = setting('GITHUB_ENV')
  if (later === undefined) {
    for (const line of lines) console.log(line)
    return
  }
  appendFileSync(later, `${lines.join('\n')}\n`)
  // Not the password: a job's log is public, and the environment file is not shown in it.
  console.log(`e2e:stack: made ${email} and the household ${household}`)
}

/** The account's devices, which must name an installation that signed in as this app. */
async function devices(): Promise<void> {
  const { data } = expecting(
    await api.GET('/me/devices', {
      headers: await signIn(told('HOUSEHOLD_E2E_EMAIL'), told('HOUSEHOLD_E2E_PASSWORD')),
    }),
    200,
    'reading the devices',
  )
  const listed = data?.items ?? []
  const own = listed.find((device) => device.app_version === version() && device.label !== label)
  if (own === undefined) {
    throw new Error(
      `no device of the account signed in as the app at ${version()}: ${JSON.stringify(listed)}`,
    )
  }
  console.log(
    `e2e:stack: the account lists ${JSON.stringify(own.label)} (${own.platform ?? 'no platform'}) ` +
      `at ${version()}`,
  )
}

/** The household's clients, which must name a replica of this app's. */
async function clients(): Promise<void> {
  const headers = await signIn(told('HOUSEHOLD_E2E_EMAIL'), told('HOUSEHOLD_E2E_PASSWORD'))
  const household = told('HOUSEHOLD_E2E_HOUSEHOLD')
  let listed: unknown = []
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { data } = expecting(
      await api.GET('/households/{household_id}/clients', {
        headers,
        params: { path: { household_id: household } },
      }),
      200,
      'reading the clients',
    )
    const own = data?.items.find(
      (client) => client.type === 'mobile' && client.version === version(),
    )
    if (own !== undefined) {
      console.log(
        `e2e:stack: the household lists the replica ${own.replica_id} of mobile/${version()}`,
      )
      return
    }
    listed = data?.items ?? []
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(
    `no replica of the household reported as mobile/${version()}: ${JSON.stringify(listed)}`,
  )
}

const commands: Readonly<Record<string, () => Promise<void>>> = { member, devices, clients }
const [named = ''] = process.argv.slice(2)
const command = commands[named]
if (command === undefined) {
  console.error(`e2e:stack: which? One of ${Object.keys(commands).join(', ')}.`)
  process.exit(2)
}
await command()
