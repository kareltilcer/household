// The stack the end-to-end suite runs the app against (plan item 25): the API, which the suite
// starts itself (playwright.config.ts) on the development services (`pnpm run up`,
// `pnpm run db:setup`, `pnpm run up:sync`), behind the preview server's proxy, so that a page is
// same-origin with it as a deployment's is. This file is how a test makes what it needs there:
// a person, their session, a household, the link an email carried, a second step's code, and
// who is in a household (plan item 26): an invitation, a member who joined by one, another
// owner, a child profile. And what no screen does (plan item 27): what the payment processor
// does on its own, asked of the suite's stand-in for it; time passing, a household's dates
// moved in PostgreSQL and the hourly job brought forward; a suspension, which is staff's; and
// what a household stores, which no module writes yet.
//
// Each test is a network of its own to the server. Registering, signing in and asking for an
// email are limited by the client's network (PRD 02 §9), and every test comes from this machine:
// the suite's API trusts the address `X-Forwarded-For` names, and each test names its own, so no
// test spends another's limits, in one run or across runs against the same database.
import { execFile } from 'node:child_process'
import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { entityTag, newId } from '@household/api'
import type { Page } from '@playwright/test'
import { previewOrigin, stripeStandInOrigin } from '../build/preview.ts'
import { csrfCookie } from '../src/api/names.ts'

/** Where the development stack's mail catcher answers: every email the API sends is kept there. */
export const mailOrigin = 'http://127.0.0.1:8025'

/** An address no other test of any run comes from: a private one, drawn at random. */
export function network(): string {
  return `10.${String(randomInt(1, 255))}.${String(randomInt(1, 255))}.${String(randomInt(1, 255))}`
}

export interface Person {
  readonly name: string
  readonly email: string
  readonly password: string
}

/**
 * A person nobody has registered: their address is theirs alone, in this run and any other.
 *
 * What a member wrote is drawn as they wrote it, in every language, the pseudo-locale among
 * them, and the pseudo-locale pass takes a run of four plain letters for a word nobody
 * translated (fixtures.ts). So the suite's people and households are named in words that hold no
 * such run: a name with its diacritics, an address of digits.
 */
export function person(name = 'Áňa Dvořáčková'): Person {
  const tag = String(randomInt(1, 2 ** 47)).padStart(15, '0')
  return {
    name,
    email: `e2e-${tag}@hh9.io`,
    // Long, and in no list of breached passwords: it is drawn at random.
    password: `e2e ${randomBytes(12).toString('base64url')}`,
  }
}

export interface Answer {
  readonly status: number
  /** The answer's JSON, or undefined where it had none. */
  readonly body: unknown
}

/**
 * Asks the API from the page, as the app's own client does: same-origin, with the browser's
 * cookies, and the CSRF token with an unsafe request. The page must be at the app's origin.
 * `headers` are what the request says beside those: the version a change is held against.
 */
export function call(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<Answer> {
  return page.evaluate(
    async ([cookie, method, path, body, headers]) => {
      const token = document.cookie
        .split(';')
        .map((pair) => pair.trim())
        .find((pair) => pair.startsWith(`${cookie}=`))
        ?.slice(cookie.length + 1)
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token === undefined || method === 'GET' ? {} : { 'X-CSRF-Token': token }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = text === '' ? undefined : JSON.parse(text)
      } catch {
        parsed = undefined
      }
      return { status: response.status, body: parsed }
    },
    [csrfCookie, method, path, body, headers] as const,
  )
}

/** `answer`, which must have the status a test expects of it. */
function expecting(answer: Answer, status: number, what: string): Answer {
  if (answer.status !== status) {
    throw new Error(
      `${what} answered ${String(answer.status)}, not ${String(status)}: ${JSON.stringify(answer.body)}`,
    )
  }
  return answer
}

interface Message {
  readonly ID: string
}

/**
 * The token of the link the newest email to `email` carries to the web client's `route`
 * (`verify-email`, `reset/set`, `account/deletion/cancel`, `invitation`, `graduate`), waited
 * for: the API sends its mail after it has answered.
 */
export async function linkToken(email: string, route: string): Promise<string> {
  // The route is looked for as it is written, and no pattern is made of it: only what follows
  // it, the token, is matched.
  const link = `/${route}#token=`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const found = (await (
      await fetch(`${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    ).json()) as { readonly messages?: readonly Message[] }
    // Newest first, as the catcher lists them.
    for (const { ID } of found.messages ?? []) {
      const message = (await (await fetch(`${mailOrigin}/api/v1/message/${ID}`)).json()) as {
        readonly Text?: string
      }
      const text = message.Text ?? ''
      const at = text.indexOf(link)
      const token =
        at === -1 ? undefined : /^[A-Za-z0-9_-]+/.exec(text.slice(at + link.length))?.[0]
      if (token !== undefined) return token
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`no email to ${email} carries a link to ${route}`)
}

/**
 * Waits for an email to `email` that links to `path` of the web client with no token: a link
 * whose reader has to be signed in to follow it, an offer of billing's or a ready export's. It
 * answers the path, which is what the link opens.
 */
export async function linked(email: string, path: string): Promise<string> {
  const address = `${previewOrigin}${path}`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const found = (await (
      await fetch(`${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    ).json()) as { readonly messages?: readonly Message[] }
    for (const { ID } of found.messages ?? []) {
      const message = (await (await fetch(`${mailOrigin}/api/v1/message/${ID}`)).json()) as {
        readonly Text?: string
      }
      const text = message.Text ?? ''
      const at = text.indexOf(address)
      // The address itself, and no longer one that begins as it does.
      if (at !== -1 && !/^[\w/#?-]/.test(text.slice(at + address.length))) return path
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`no email to ${email} links to ${path}`)
}

/**
 * Registers `who` and leaves their address unconfirmed: the link their email carried is not
 * opened. Such an account signs in and makes a household like any other, and waits for a proven
 * address where trust is extended beyond it: joining a household, inviting into one (FR-ID1).
 */
export async function registerUnverified(page: Page, who: Person): Promise<void> {
  expecting(
    await call(page, 'POST', '/auth/register', {
      email: who.email,
      password: who.password,
      display_name: who.name,
      locale: 'en',
    }),
    202,
    'registering',
  )
}

/** Registers `who` and confirms their address, as the link in their email would. */
export async function register(page: Page, who: Person): Promise<void> {
  await registerUnverified(page, who)
  const token = await linkToken(who.email, 'verify-email')
  expecting(await call(page, 'POST', '/auth/verify-email', { token }), 204, 'verifying')
}

/** Signs `who` in to the page's browser: its cookies are the session from here on. */
export async function signIn(page: Page, who: Person): Promise<void> {
  expecting(
    await call(page, 'POST', '/auth/login', {
      email: who.email,
      password: who.password,
      client_type: 'web',
    }),
    200,
    'signing in',
  )
}

/**
 * Signs the page's browser out, at the server: the session its cookies were is ended. What the
 * app kept in this browser of the member it drew is not removed, as its own way out removes it
 * (the account's *Sign out*), so this is for a browser that has not drawn the app as them: one
 * that is still making what a test needs. A test that changes who is at the screen signs out
 * there, as a member does.
 */
export async function signOut(page: Page): Promise<void> {
  expecting(await call(page, 'POST', '/auth/logout'), 204, 'signing out')
}

/** The id of the person the page's browser is signed in as. */
export async function whoAmI(page: Page): Promise<string> {
  const { body } = expecting(await call(page, 'GET', '/me'), 200, 'reading the account')
  const { id } = body as { readonly id?: unknown }
  if (typeof id !== 'string') throw new Error('the account has no id')
  return id
}

/** Makes a household the signed-in person owns, and returns its id. */
export async function createHousehold(page: Page, name = 'Dům č. 7'): Promise<string> {
  const id = newId()
  expecting(
    await call(page, 'POST', '/households', {
      id,
      name,
      country: 'CZ',
      timezone: 'Europe/Prague',
      base_currency: 'CZK',
      locale: 'cs',
    }),
    201,
    'creating a household',
  )
  return id
}

/** A level on a module, as the contract names it. */
export type Level = 'none' | 'view' | 'contribute' | 'manage'

/**
 * Invites `email` to `household` by email, as the signed-in person, who owns it and whose own
 * address is verified: as a member with a member's defaults and `grants` over them, `message`
 * in the email. It answers the token of the link the email carried, which the page that link
 * opens reads from its address's fragment.
 */
export async function invite(
  page: Page,
  household: string,
  email: string,
  { grants, message }: { readonly grants?: Readonly<Record<string, Level>>; message?: string } = {},
): Promise<string> {
  expecting(
    await call(page, 'POST', `/households/${household}/invitations`, {
      id: newId(),
      kind: 'email',
      role: 'member',
      email,
      ...(grants === undefined ? {} : { grants }),
      ...(message === undefined ? {} : { message }),
    }),
    201,
    'inviting by email',
  )
  return linkToken(email, 'invitation')
}

/** Joins the household the invitation `token` opens, as the signed-in person. */
export async function acceptInvitation(page: Page, token: string): Promise<void> {
  expecting(await call(page, 'POST', `/me/invitations/${token}/accept`), 200, 'joining')
}

/**
 * Brings `who`, whom nobody has registered, into `household` as a member, and returns their id:
 * invited by `owner` with a member's defaults and `grants` over them, registered, and joined by
 * the link their email carried. The page's browser is signed in as `owner` before and after, and
 * has not drawn the app as anybody yet (`signOut`).
 */
export async function join(
  page: Page,
  owner: Person,
  household: string,
  who: Person,
  grants?: Readonly<Record<string, Level>>,
): Promise<string> {
  const token = await invite(page, household, who.email, grants === undefined ? {} : { grants })
  await signOut(page)
  await register(page, who)
  await signIn(page, who)
  await acceptInvitation(page, token)
  const id = await whoAmI(page)
  await signOut(page)
  await signIn(page, owner)
  return id
}

/**
 * Changes what `path` names under the version it has now, behind the back of a page that read
 * it before, as another owner's device would: it is read for its version, and `change` is sent
 * with that as its `If-Match`. A save from the page is then held against a version that has
 * passed.
 */
export async function changeMeanwhile(page: Page, path: string, change: unknown): Promise<void> {
  const { body } = expecting(await call(page, 'GET', path), 200, 'reading what is to be changed')
  const { version } = body as { readonly version?: unknown }
  if (typeof version !== 'number') throw new Error(`${path} has no version`)
  expecting(
    await call(page, 'PATCH', path, change, { 'If-Match': entityTag(version) }),
    200,
    'changing it meanwhile',
  )
}

/** Makes `user`, a member of `household`, an owner of it too, as the signed-in person, who is one. */
export async function makeOwner(page: Page, household: string, user: string): Promise<void> {
  expecting(
    await call(page, 'POST', `/households/${household}/ownership/transfer`, { user_id: user }),
    200,
    'making an owner',
  )
}

/**
 * Makes a child profile in `household`, as the signed-in person, who owns it, and returns its
 * id: a name and a PIN, a child's defaults, and no address, which a child profile has none of.
 */
export async function createChild(page: Page, household: string, name = 'Ádík'): Promise<string> {
  const id = newId()
  expecting(
    await call(page, 'POST', `/households/${household}/children`, {
      id,
      display_name: name,
      // Six digits drawn at random: no test signs in with it.
      pin: String(randomInt(0, 1_000_000)).padStart(6, '0'),
    }),
    201,
    'making a child profile',
  )
  return id
}

/** How a household stands, as far as a test asks it (`EntitlementSummary`). */
export interface Standing {
  /** `trialing`, `active`, `past_due`, `grace`, `read_only`, `canceled` or `restricted`. */
  readonly state: string
  readonly can_write: boolean
  readonly trial_ends_at: string | null
  readonly grace_ends_at: string | null
  readonly data_retained_until: string | null
  /** Who stopped all changes in it and when, with the reason they gave, while that stands. */
  readonly restriction: { readonly restricted_at: string; readonly reason: string | null } | null
}

/**
 * How `household` stands, as the signed-in person, who is in it, reads it: its entitlement,
 * which is what its banner and every screen of it draw by, with the days it carries.
 */
export async function standingOf(page: Page, household: string): Promise<Standing> {
  const { body } = expecting(
    await call(page, 'GET', `/households/${household}`),
    200,
    'reading the household',
  )
  const { entitlement } = body as { readonly entitlement?: Standing }
  if (typeof entitlement?.state !== 'string') throw new Error('the household says no state')
  return entitlement
}

/** What Stripe does to a subscription on its own, as the suite's stand-in for it names each. */
export type ProcessorAct = 'fail-payment' | 'give-up' | 'end-period' | 'clear-debit' | 'fail-debit'

/**
 * Has the payment processor do `act` to `household`'s subscription, as Stripe does on its own:
 * a renewal that fails (`fail-payment`, and again for a retry; `again: false` says Stripe will
 * not try once more), the retries given up (`give-up`), the paid period ending (`end-period`:
 * a subscription set to cancel ends, any other renews), a bank debit clearing or failing. It is
 * asked of the stand-in for Stripe (server/cmd/stripe-standin), from Node, since it answers no
 * page, and it answers once the API has taken every event the act caused: the household's row
 * is settled, and what a page reads next is true.
 */
export async function processor(
  household: string,
  act: ProcessorAct,
  body?: { readonly again: boolean },
): Promise<void> {
  const response = await fetch(`${stripeStandInOrigin}/_standin/households/${household}/${act}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (response.status !== 200) {
    throw new Error(
      `the processor's ${act} answered ${String(response.status)}: ${await response.text()}`,
    )
  }
}

/**
 * Subscribes `household`, paid by the `interval`, as the signed-in person, who pays for it and
 * whose address is verified, with no screen: the API is asked for what a payment form would
 * confirm, and the stand-in for Stripe is told that a customer confirmed it `by` a card, which
 * is taken, or by a bank debit, which is then on its way. For a test that starts from a
 * household that is subscribed, and proves nothing of subscribing.
 */
export async function subscribeNow(
  page: Page,
  household: string,
  interval: 'year' | 'month' = 'year',
  by: 'card' | 'debit' = 'card',
): Promise<void> {
  const { body } = expecting(
    await call(page, 'POST', `/households/${household}/billing/subscription`, { interval }),
    200,
    'asking for a subscription',
  )
  const { client_secret: handed } = body as { readonly client_secret?: unknown }
  const response = await fetch(`${stripeStandInOrigin}/_standin/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_secret: handed, with: by }),
  })
  const confirmed = (await response.json()) as { readonly status?: unknown }
  if (response.status !== 200 || typeof confirmed.status !== 'string') {
    throw new Error(`confirming the payment answered ${JSON.stringify(confirmed)}`)
  }
}

/** The repository's root, where `docker compose` finds the development stack. */
const root = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Runs `statement` in the development database as its superuser, who passes the row-level
 * security every tenant table is under, and answers what it printed: for what no operation of
 * the API does, a clock moved, a suspension, a file's row. It goes through `docker compose
 * exec`, which works here and in CI with nothing installed for it. `values` are what the
 * statement reads as `:'name'`, which psql writes into it as literals: nothing a test made is
 * ever part of a statement's own text.
 */
function sql(statement: string, values: Readonly<Record<string, string>> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'postgres',
        'psql',
        '--username=postgres',
        '--dbname=household',
        '--no-psqlrc',
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--set=ON_ERROR_STOP=1',
        ...Object.entries(values).map(([name, value]) => `--set=${name}=${value}`),
        '--file=-',
      ],
      { cwd: root },
      (error, printed, complaint) => {
        if (error === null) resolve(printed.trim())
        else reject(new Error(`psql: ${complaint === '' ? error.message : complaint}`))
      },
    )
    child.stdin?.end(statement)
  })
}

/**
 * Lets the fourteen days of `household`'s grace pass, and waits until it is read-only: the day
 * its grace ends is moved into the past on its row, and the hourly job that reads the clocks
 * (`entitlement.transitions`) is brought forward, which the suite's API runs within a tick of
 * its scheduler, fifteen seconds. No setting moves the served API's clock, and a state is read
 * off the row and never worked out on a read (docs/runbooks/billing.md, *Making time pass in a
 * spec*).
 *
 * The job is brought forward again each time the household is looked at and has not moved: a
 * run that was under way already, another test's, did not read this household's new day, and
 * records its next slot, an hour on, over the time just set as it ends.
 */
export async function passGrace(household: string): Promise<void> {
  await sql(
    `UPDATE households SET grace_ends_at = now() - interval '1 minute'
      WHERE id = :'household'::uuid AND billing_state = 'grace'`,
    { household },
  )
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await sql(`SELECT billing_state FROM households WHERE id = :'household'::uuid`, {
      household,
    })
    if (state === 'read_only') return
    if (state !== 'grace') throw new Error(`the household is ${state}, and in no grace to end`)
    await sql(
      `UPDATE scheduler_jobs SET next_run_at = now() WHERE name = 'entitlement.transitions'`,
    )
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('the hourly job did not run: does another API lead the scheduler?')
}

/**
 * Writes `household` as read-only on its own row, as the hourly job leaves one whose grace ran
 * out, with the day its data is kept until: for a test that starts from the state, and proves
 * nothing of the way into it (`passGrace` does). The next request reads it. Not for a household
 * that has a subscription at the processor, which the next event of it would make active again.
 */
export async function lapse(household: string): Promise<void> {
  await sql(
    `UPDATE households
        SET billing_state = 'read_only', lapsed_at = now(),
            retained_until = now() + interval '395 days'
      WHERE id = :'household'::uuid`,
    { household },
  )
}

/**
 * Moves the end of `household`'s trial to `days` days from now, on its own row: with five or
 * fewer left its banner stays, with ten or fewer its notice is shown, which the server works
 * out as it is read (DD-9). A trial that began today says nothing for twenty days.
 */
export async function trialEndsIn(household: string, days: number): Promise<void> {
  await sql(
    `UPDATE households SET trial_ends_at = now() + make_interval(days => :'days'::int)
      WHERE id = :'household'::uuid AND billing_state = 'trialing'`,
    { household, days: String(days) },
  )
}

/**
 * Suspends `household`, as a member of the platform's staff does, with what its members are
 * told of why: every route of it then answers `404`, and the list of a member's households
 * still names it, with the day and the notice (D-115). No route of a member's suspends one.
 */
export async function suspend(household: string, notice: string): Promise<void> {
  await sql(
    `UPDATE households SET suspended_at = now(), suspension_notice = :'notice'
      WHERE id = :'household'::uuid`,
    { household, notice },
  )
}

/** A file a household stores, as a test has it: whose it is, in which module, and how large. */
export interface Stored {
  readonly module: string
  /** The name it was uploaded under, which the largest items are listed by. */
  readonly name: string
  /** Whose it is: a member's id. */
  readonly owner: string
  readonly bytes: number
  /** The thumbnail made from it, in bytes: a derived copy, counted with it. None where 0. */
  readonly thumbnail: number
}

/**
 * Has `household` store `files`, and gives it a measurement for each of the last `days` UTC
 * days, the newest today's, each a little under the one after it: the picture its storage
 * screen draws. No module writes a file yet (D-107), so the rows are written as the files
 * pipeline and the nightly sampler write them, and no object is put in the store: the screen
 * reads the rows.
 */
export async function store(
  household: string,
  files: readonly Stored[],
  days: number,
): Promise<void> {
  let total = 0
  for (const file of files) {
    total += file.bytes + file.thumbnail
    await sql(
      `INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size,
                          sha256, filename, owner_id, variants)
       VALUES (:'household'::uuid, :'module', :'entity'::uuid, 'original', 'application/pdf',
               :'bytes'::bigint, decode(repeat('ab', 32), 'hex'), :'name', :'owner'::uuid,
               :'variants');
       INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size,
                          sha256, owner_id)
       SELECT :'household'::uuid, :'module', :'entity'::uuid, 'thumbnail', 'image/jpeg',
              :'thumbnail'::bigint, decode(repeat('cd', 32), 'hex'), :'owner'::uuid
        WHERE :'thumbnail'::bigint > 0`,
      {
        household,
        module: file.module,
        entity: newId(),
        bytes: String(file.bytes),
        name: file.name,
        owner: file.owner,
        variants: file.thumbnail > 0 ? 'ready' : 'none',
        thumbnail: String(file.thumbnail),
      },
    )
  }
  await sql(
    `INSERT INTO usage_samples (household_id, sampled_on, sampled_at, stored_bytes,
                                derived_bytes, object_count)
     SELECT :'household'::uuid, (now() AT TIME ZONE 'UTC')::date - back, now(),
            (:'total'::bigint * (100 - back) / 100), 0, :'objects'::bigint
       FROM generate_series(0, :'days'::int - 1) AS back`,
    { household, total: String(total), objects: String(files.length), days: String(days) },
  )
}

const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** The bytes a base32 secret stands for (RFC 4648), spaces and padding passed over. */
function fromBase32(secret: string): Buffer {
  let bits = ''
  for (const character of secret.toUpperCase().replace(/[\s=]/g, '')) {
    const value = base32.indexOf(character)
    if (value === -1) throw new Error(`${character} is no base32 digit`)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = bits.match(/.{8}/g) ?? []
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)))
}

/**
 * The six-digit code an authenticator shows for `secret` at `at` (RFC 6238: HMAC-SHA-1 over the
 * count of thirty-second steps), as the member reads it off their phone.
 */
export function totp(secret: string, at: number = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const digest = createHmac('sha1', fromBase32(secret)).update(counter).digest()
  const offset = (digest.at(-1) ?? 0) & 0x0f
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return code.toString().padStart(6, '0')
}

/**
 * Signs `who` in on a phone of theirs, beside the browser: a device the account's own list then
 * shows, named `label`. The phone's tokens are its own and are not kept: the page's session is
 * untouched.
 */
export async function signInOnPhone(page: Page, who: Person, label = 'Áňin 5a'): Promise<void> {
  expecting(
    await call(page, 'POST', '/auth/login', {
      email: who.email,
      password: who.password,
      client_type: 'mobile',
      device: { id: newId(), label, platform: 'ios' },
    }),
    200,
    'signing in on a phone',
  )
}

/** A PNG chunk: its length, its type and data, and the checksum of those two. */
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, sum])
}

/** A picture to upload: a PNG of one colour, `side` pixels square. */
export function picture(side = 48): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  // Eight bits a channel, in red, green and blue.
  header.writeUInt8(8, 8)
  header.writeUInt8(2, 9)
  // Each row is its filter, none, and then its pixels.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(side * 3, 0x7a)])
  const rows = Buffer.concat(Array.from({ length: side }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
