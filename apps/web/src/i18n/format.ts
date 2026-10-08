// Every date, number and amount of money the app shows is formatted here, through `Intl`, in the
// member's locale (06-accessibility-and-i18n §2: never hand-rolled). The catalogs' messages format
// no date and no money themselves: a caller formats one here and passes the string.
//
// Two rules of the platform are held by the signatures. Money is an integer of minor units and is
// never made a float on its way to the screen: its digits are placed as a decimal string, which
// `Intl.NumberFormat` reads exactly. And a timezone is never assumed: an instant is formatted in
// the zone its caller names, and a calendar day has none.
import { exponent, type Money } from '@household/domain'

/** A piece of a formatted amount, so that a screen can set the number in mono and the code beside it. */
export interface MoneyPart {
  readonly type: 'sign' | 'number' | 'currency' | 'literal'
  readonly value: string
}

export type DateStyle = 'short' | 'medium' | 'long'

export interface Formatters {
  /** The BCP 47 tag the formatters were made for. */
  readonly locale: string
  readonly number: (value: number, options?: Intl.NumberFormatOptions) => string
  /**
   * A decimal the contract carries as a string, an exchange rate or a quantity, read exactly:
   * `"25.5200"` never passes through a float, and every digit it was written with is shown
   * unless `options` says how many are.
   */
  readonly decimal: (value: string, options?: Intl.NumberFormatOptions) => string
  /** `fraction` as a percentage: 0.44 is 44 %. */
  readonly percent: (fraction: number) => string
  readonly money: (amount: Money) => string
  /** The amount in the locale's own order, piece by piece. */
  readonly moneyParts: (amount: Money) => readonly MoneyPart[]
  /** A calendar day, `YYYY-MM-DD`: the same day wherever it is read. */
  readonly day: (day: string, style?: DateStyle) => string
  /** An instant, in the zone `timeZone` names: the household's, or the member's own. */
  readonly instant: (at: Date | string, timeZone: string, style?: DateStyle) => string
  /** The calendar day an instant falls on in the zone `timeZone` names, with no time of day. */
  readonly dayOf: (at: Date | string, timeZone: string, style?: DateStyle) => string
  /** The time of day of an instant in the zone `timeZone` names, with no date: *16:42*. */
  readonly time: (at: Date | string, timeZone: string) => string
}

/** `amountMinor` of a currency with `digits` decimal places, as an exact decimal: 123456 → 1234.56. */
function decimal(amountMinor: number, digits: number): Intl.StringNumericLiteral {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`${String(amountMinor)} is not a whole number of minor units`)
  }
  const sign = amountMinor < 0 ? '-' : ''
  const magnitude = (amountMinor < 0 ? -BigInt(amountMinor) : BigInt(amountMinor))
    .toString()
    .padStart(digits + 1, '0')
  const whole = magnitude.slice(0, magnitude.length - digits)
  const fraction = digits === 0 ? '' : `.${magnitude.slice(-digits)}`
  return `${sign}${whole}${fraction}` as Intl.StringNumericLiteral
}

const calendarDay = /^(\d{4})-(\d{2})-(\d{2})$/
const plainDecimal = /^-?\d+(?:\.(\d+))?$/

/** The most fraction digits every `Intl` takes: past them a decimal is rounded. */
const mostFractionDigits = 20

/**
 * `make`, asked once for each set of options: making a formatter is what `Intl` costs, and a
 * table makes the same one for every row it draws.
 */
function once<Options extends object, Format>(
  make: (options: Options) => Format,
): (options: Options) => Format {
  const made = new Map<string, Format>()
  return (options) => {
    const key = JSON.stringify(options)
    let format = made.get(key)
    if (format === undefined) {
      format = make(options)
      made.set(key, format)
    }
    return format
  }
}

export function createFormatters(locale: string): Formatters {
  const numbers = once(
    (options: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options),
  )
  const dates = once(
    (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options),
  )
  const currencies = new Map<string, Intl.NumberFormat>()
  const currency = (code: string) => {
    let format = currencies.get(code)
    if (format === undefined) {
      // The currency's minor unit is ISO 4217's, which the amount is counted in. `Intl` has a
      // table of its own, which shows some currencies with fewer places than they have (the
      // forint and the Iraqi dinar among them) and would round their minor units away.
      const digits = exponent(code)
      // The ISO code, not a symbol: a household may hold kr of three countries, and $ of more.
      format = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        currencyDisplay: 'code',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
      currencies.set(code, format)
    }
    return format
  }
  const instantOf = (at: Date | string) => (typeof at === 'string' ? new Date(at) : at)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const partsOf = (amount: Money) =>
    currency(amount.currency).formatToParts(decimal(amount.amount_minor, exponent(amount.currency)))

  return {
    locale,
    number: (value, options = {}) => numbers(options).format(value),
    decimal: (value, options) => {
      const match = plainDecimal.exec(value)
      if (match === null) throw new RangeError(`${JSON.stringify(value)} is no decimal`)
      // `Intl` by itself keeps three fraction digits and rounds the rest away.
      const written = Math.min(match[1]?.length ?? 0, mostFractionDigits)
      const most = Math.max(written, options?.minimumFractionDigits ?? 0)
      return numbers({ maximumFractionDigits: most, ...options }).format(
        value as Intl.StringNumericLiteral,
      )
    },
    percent: (fraction) => percent.format(fraction),
    money: (amount) =>
      partsOf(amount)
        .map((part) => part.value)
        .join(''),
    moneyParts: (amount) =>
      partsOf(amount).map((part): MoneyPart => {
        if (part.type === 'currency') return { type: 'currency', value: part.value }
        if (part.type === 'minusSign' || part.type === 'plusSign') {
          return { type: 'sign', value: part.value }
        }
        return { type: part.type === 'literal' ? 'literal' : 'number', value: part.value }
      }),
    day: (day, style = 'medium') => {
      const match = calendarDay.exec(day)
      if (match === null) throw new RangeError(`${JSON.stringify(day)} is not a calendar day`)
      const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])]
      // A UTC midnight, formatted in UTC, so the day shown is the day written. The year is set
      // as it is written: `Date.UTC` reads one under a hundred as a year of the 1900s.
      const midnight = new Date(0)
      midnight.setUTCFullYear(year, month - 1, date)
      // A day no calendar has, the thirty-first of February, is no day: `Date` would roll it
      // over into the month after, and the day shown would not be the day written.
      if (midnight.getUTCMonth() !== month - 1 || midnight.getUTCDate() !== date) {
        throw new RangeError(`${JSON.stringify(day)} is not a calendar day`)
      }
      return dates({ dateStyle: style, timeZone: 'UTC' }).format(midnight)
    },
    instant: (at, timeZone, style = 'medium') =>
      dates({ dateStyle: style, timeStyle: 'short', timeZone }).format(instantOf(at)),
    dayOf: (at, timeZone, style = 'medium') =>
      dates({ dateStyle: style, timeZone }).format(instantOf(at)),
    time: (at, timeZone) => dates({ timeStyle: 'short', timeZone }).format(instantOf(at)),
  }
}
