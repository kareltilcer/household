// The names `Intl` gives and no catalog holds: a language's own name for itself, the days of the
// week, a currency's name, and the zones this browser knows. A member's account and a
// household's profile offer the same lists to choose from, and are named here once.
import type { Locale } from '@household/i18n/lazy'

/** A language's own name for itself, as `Intl` has it, with a capital as a list of names has. */
export function ownName(locale: Locale): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

/** A Sunday, at noon in UTC: the day the days of the week are counted from, 0 for Sunday. */
const aSunday = Date.UTC(2026, 0, 4, 12)

/** The days of the week as the contract numbers them, Monday first as a list of them reads. */
export const weekdays = [1, 2, 3, 4, 5, 6, 0] as const

/** What names a day of the week in each language asked for: made once, as a list of seven asks. */
const dayNamers = new Map<string, Intl.DateTimeFormat>()

/** The name of the day the contract numbers `day`, 0 for Sunday to 6 for Saturday, in `locale`. */
export function dayName(locale: string, day: number): string {
  let named = dayNamers.get(locale)
  if (named === undefined) {
    named = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
    dayNamers.set(locale, named)
  }
  return named.format(aSunday + day * 24 * 60 * 60 * 1000)
}

/** What names a currency in each language asked for: made once, as a list of them asks. */
const currencyNamers = new Map<string, Intl.DisplayNames>()

/** The name of the currency `code` in `locale`, or undefined where `Intl` has none but its code. */
export function currencyName(locale: string, code: string): string | undefined {
  let named = currencyNamers.get(locale)
  if (named === undefined) {
    named = new Intl.DisplayNames([locale], { type: 'currency' })
    currencyNamers.set(locale, named)
  }
  const name = named.of(code)
  return name === undefined || name === code ? undefined : name
}

/**
 * The zones this browser names, with `own` among them though the browser does not list it: `UTC`
 * is in no list of the zones of places. `null` is no zone of one's own, and gives the browser's
 * list as it is.
 */
export function timeZones(own: string | null): readonly string[] {
  const known = Intl.supportedValuesOf('timeZone')
  return own === null || known.includes(own) ? known : [own, ...known]
}
