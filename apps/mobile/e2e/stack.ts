// `pnpm --filter @household/mobile run e2e:stack member`: who the flow with the stack signs in
// as (plan item 28), made on the development stack through the API the way the web's suite
// makes its people (apps/web/e2e/stack.ts): a person nobody has registered, and a household
// they own. The API is the run's own, started from source where the device reaches it
// (docs/runbooks/mobile-builds.md); this asks it from the machine, on its loopback.
//
// It says what it made in the environment of the steps after it, where CI gives it a file to
// write to (`GITHUB_ENV`), and on its output otherwise: `HOUSEHOLD_E2E_EMAIL`,
// `HOUSEHOLD_E2E_PASSWORD` and `HOUSEHOLD_E2E_HOUSEHOLD`, which e2e/run.ts hands the flows.
//
// It asks as a device does, by a bearer, and names itself no client: a household's clients are
// its replicas' own reports, and this opens none.
import { randomBytes, randomInt } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createApiClient, newId } from '@household/api'

/** Where the run's API answers the machine it runs on. */
const api = createApiClient({
  baseUrl: process.env.HOUSEHOLD_E2E_API_URL ?? 'http://127.0.0.1:8080/api/v1',
})

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

/**
 * Registers a person and makes them a household. Their address is left unconfirmed: such an
 * account signs in and makes a household like any other (FR-ID1), and nothing the flow does
 * extends trust beyond it.
 */
async function member(): Promise<Record<string, string>> {
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
  // A device of the script's own, which is not the installation the flow signs in on: a device
  // signs in once at a time, and that one's sign-in is the app's to make.
  const signedIn = expecting(
    await api.POST('/auth/login', {
      body: {
        email,
        password,
        client_type: 'mobile',
        device: { id: newId(), label: 'e2e/stack.ts', platform: 'android' },
      },
    }),
    200,
    'signing in',
  )
  const token = signedIn.data?.tokens?.access_token
  if (token === undefined) throw new Error('signing in gave no access token')

  const household = newId()
  expecting(
    await api.POST('/households', {
      headers: { Authorization: `Bearer ${token}` },
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
  return {
    HOUSEHOLD_E2E_EMAIL: email,
    HOUSEHOLD_E2E_PASSWORD: password,
    HOUSEHOLD_E2E_HOUSEHOLD: household,
  }
}

const [command] = process.argv.slice(2)
if (command !== 'member') {
  console.error('e2e:stack: what to make? `member`: a person and a household they own.')
  process.exit(2)
}
const made = await member()
const lines = Object.entries(made).map(([name, value]) => `${name}=${value}`)
const later = process.env.GITHUB_ENV
if (later === undefined) {
  for (const line of lines) console.log(line)
} else {
  appendFileSync(later, `${lines.join('\n')}\n`)
  // Not the password: a job's log is public, and the environment file is not shown in it.
  console.log(
    `e2e:stack: made ${made.HOUSEHOLD_E2E_EMAIL ?? ''} and the household ` +
      (made.HOUSEHOLD_E2E_HOUSEHOLD ?? ''),
  )
}
