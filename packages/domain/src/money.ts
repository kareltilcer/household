// Money, once (PRD modules/09-finance): an integer in the currency's minor unit plus an ISO
// 4217 code, never a float. The exponent comes from ISO 4217's own data and is never assumed
// to be 2. A value is rounded half-up to the minor unit once, where it is materialised, never
// on intermediates; ties round away from zero, so a refund rounds as its charge did (D-94).
//
// The server's twin is server/internal/platform/money. Both are held to
// packages/test-vectors/vectors/money.json (D-37), so a preview never disagrees with the
// saved result.
import iso4217 from './iso4217.json'

/** An amount of money, in the contract's shape: `{ amount_minor, currency }`. */
export interface Money {
  readonly amount_minor: number
  readonly currency: string
}

/**
 * What a money operation refused, as a stable code both implementations share: the Go twin
 * refuses the same inputs with the same codes, and the vectors hold them to it.
 */
export type MoneyErrorCode =
  | 'unknown_currency'
  | 'not_minor_units'
  | 'out_of_range'
  | 'currency_mismatch'
  | 'malformed_decimal'
  | 'invalid_rate'
  | 'no_participants'
  | 'duplicate_participant'
  | 'not_in_order'
  | 'invalid_weight'

export class MoneyError extends Error {
  override readonly name = 'MoneyError'
  readonly code: MoneyErrorCode

  constructor(code: MoneyErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const exponents: Readonly<Record<string, number>> = iso4217.exponents

/**
 * The largest amount either side can hold exactly: a JavaScript number is exact up to 2^53−1,
 * so the server refuses what a client could not represent (about 90 trillion euros).
 */
export const maxMinor = Number.MAX_SAFE_INTEGER

/** The ISO 4217 codes this build knows, in alphabetical order. */
export const currencyCodes: readonly string[] = Object.keys(exponents).sort()

/** The number of decimal places in `currency`'s minor unit: 2 for EUR, 0 for JPY, 3 for BHD. */
export function exponent(currency: string): number {
  const e = Object.hasOwn(exponents, currency) ? exponents[currency] : undefined
  if (e === undefined) {
    throw new MoneyError('unknown_currency', `${JSON.stringify(currency)} is not an ISO 4217 code`)
  }
  return e
}

/** `amountMinor` of `currency`, checked: a whole number of minor units, of a known currency. */
export function money(amountMinor: number, currency: string): Money {
  exponent(currency)
  if (!Number.isInteger(amountMinor)) {
    throw new MoneyError(
      'not_minor_units',
      `${String(amountMinor)} is not a whole number of minor units`,
    )
  }
  return { amount_minor: checked(BigInt(amountMinor)), currency }
}

/** `a + b`, in their one currency. */
export function add(a: Money, b: Money): Money {
  const currency = same(a, b)
  return { amount_minor: checked(minor(a) + minor(b)), currency }
}

/** `a − b`, in their one currency. */
export function subtract(a: Money, b: Money): Money {
  const currency = same(a, b)
  return { amount_minor: checked(minor(a) - minor(b)), currency }
}

/**
 * `amount × factor`, rounded half-up to the minor unit once. `factor` is a decimal string, as
 * the contract carries every non-integer near money: `"0.2"` is a fifth, `"-1"` negates.
 */
export function multiply(amount: Money, factor: string): Money {
  const f = decimal(factor)
  return {
    amount_minor: checked(roundHalfUp(minor(amount) * f.coefficient, f.denominator)),
    currency: amount.currency,
  }
}

/**
 * `amount` in currency `to`, at `rate` units of `to` per unit of `amount`'s currency, rounded
 * half-up to `to`'s minor unit once. `rate` is a positive decimal string, as a transaction
 * stores it (D-55): ¥1 000 at `"0.0062"` EUR/JPY is €6.20.
 */
export function convert(amount: Money, rate: string, to: string): Money {
  const r = decimal(rate)
  if (r.coefficient <= 0n) {
    throw new MoneyError('invalid_rate', `rate ${JSON.stringify(rate)} is not positive`)
  }
  const from = 10n ** BigInt(exponent(amount.currency))
  const into = 10n ** BigInt(exponent(to))
  return {
    amount_minor: checked(roundHalfUp(minor(amount) * r.coefficient * into, r.denominator * from)),
    currency: to,
  }
}

/** One participant's part of a split. */
export interface Share {
  readonly participant: string
  readonly amount: Money
}

/**
 * `total` split between `participants` in proportion to `weights` (one each when omitted: an
 * equal split), exactly: the parts sum to the total. Each part is its proportion rounded down;
 * the minor units left over go one each to the participants in the household's member order,
 * `order`, first to last (D-57). So €10.00 three ways is 3.34 / 3.33 / 3.33, and the 3.34 is
 * the same member's however the participants are listed. A negative total splits as its
 * positive counterpart, negated, so a refund returns to each member what they paid (D-94).
 * The shares come back in the household's order.
 */
export function split(
  total: Money,
  participants: readonly string[],
  order: readonly string[],
  weights?: readonly number[],
): readonly Share[] {
  const amount = minor(total)
  if (participants.length === 0) {
    throw new MoneyError('no_participants', 'a split needs at least one participant')
  }
  if (weights !== undefined && weights.length !== participants.length) {
    throw new MoneyError('invalid_weight', 'a split needs one weight per participant')
  }
  const rank = new Map<string, number>()
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i)
  })
  const parts = participants.map((participant, i) => {
    const position = rank.get(participant)
    if (position === undefined) {
      throw new MoneyError(
        'not_in_order',
        `${JSON.stringify(participant)} is not in the household's order`,
      )
    }
    const weight = weights?.[i] ?? 1
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new MoneyError(
        'invalid_weight',
        `weight ${String(weight)} is not a positive whole number`,
      )
    }
    return { participant, position, weight: BigInt(weight) }
  })
  parts.sort((a, b) => a.position - b.position)
  for (let i = 1; i < parts.length; i++) {
    if (parts[i]?.participant === parts[i - 1]?.participant) {
      throw new MoneyError(
        'duplicate_participant',
        `${JSON.stringify(parts[i]?.participant)} is listed twice`,
      )
    }
  }

  const sign = amount < 0n ? -1n : 1n
  const magnitude = amount * sign
  const sum = parts.reduce((s, p) => s + p.weight, 0n)
  const floors = parts.map((p) => (magnitude * p.weight) / sum)
  let left = magnitude - floors.reduce((s, f) => s + f, 0n)
  for (let i = 0; left > 0n; i = (i + 1) % floors.length, left--) {
    floors[i] = (floors[i] ?? 0n) + 1n
  }
  return parts.map((p, i) => ({
    participant: p.participant,
    amount: { amount_minor: Number(sign * (floors[i] ?? 0n)), currency: total.currency },
  }))
}

/**
 * `numerator / denominator` rounded half-up to an integer, ties away from zero: 2.5 → 3 and
 * −2.5 → −3. The denominator is positive.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const twice = 2n * denominator
  return numerator >= 0n
    ? (2n * numerator + denominator) / twice
    : -((-2n * numerator + denominator) / twice)
}

const decimalPattern = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/

/** A decimal string as coefficient / denominator, exactly: `"-1.25"` is −125 / 100. */
function decimal(text: string): { coefficient: bigint; denominator: bigint } {
  if (!decimalPattern.test(text)) {
    throw new MoneyError('malformed_decimal', `${JSON.stringify(text)} is not a decimal`)
  }
  const point = text.indexOf('.')
  const places = point < 0 ? 0 : text.length - point - 1
  return { coefficient: BigInt(text.replace('.', '')), denominator: 10n ** BigInt(places) }
}

/** `m`'s amount, checked as money() checks it. */
function minor(m: Money): bigint {
  return BigInt(money(m.amount_minor, m.currency).amount_minor)
}

function same(a: Money, b: Money): string {
  exponent(a.currency)
  exponent(b.currency)
  if (a.currency !== b.currency) {
    throw new MoneyError('currency_mismatch', `${a.currency} and ${b.currency} do not add`)
  }
  return a.currency
}

function checked(value: bigint): number {
  if (value > BigInt(maxMinor) || value < -BigInt(maxMinor)) {
    throw new MoneyError('out_of_range', `${value.toString()} minor units is out of range`)
  }
  return Number(value)
}
