// The stack the end-to-end suite runs the app against (plan item 25): the API, which the suite
// starts itself (playwright.config.ts) on the development services (`pnpm run up`,
// `pnpm run db:setup`, `pnpm run up:sync`), behind the preview server's proxy, so that a page is
// same-origin with it as a deployment's is. This file is how a test makes what it needs there:
// a person, their session, a household, the link an email carried, a second step's code.
//
// Each test is a network of its own to the server. Registering, signing in and asking for an
// email are limited by the client's network (PRD 02 §9), and every test comes from this machine:
// the suite's API trusts the address `X-Forwarded-For` names, and each test names its own, so no
// test spends another's limits, in one run or across runs against the same database.
import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import { newId } from '@household/api'
import type { Page } from '@playwright/test'
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
 */
export function call(page: Page, method: string, path: string, body?: unknown): Promise<Answer> {
  return page.evaluate(
    async ([cookie, method, path, body]) => {
      const token = document.cookie
        .split(';')
        .map((pair) => pair.trim())
        .find((pair) => pair.startsWith(`${cookie}=`))
        ?.slice(cookie.length + 1)
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
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
    [csrfCookie, method, path, body] as const,
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
 * (`verify-email`, `reset/set`, `account/deletion/cancel`), waited for: the API sends its mail
 * after it has answered.
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

/** Registers `who` and confirms their address, as the link in their email would. */
export async function register(page: Page, who: Person): Promise<void> {
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
