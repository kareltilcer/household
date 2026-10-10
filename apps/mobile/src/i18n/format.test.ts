// The web's formatter tests (apps/web/src/i18n/i18n.test.tsx), case for case: the rules are one
// product's. Here a number, an amount and a list go through FormatJS, as on a device, over an
// `Intl` cut down to Hermes's (src/test/hermes.ts); a date goes through Node's `Intl`, where a
// device has its operating system's, so what a date prints is held for Node alone.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { currencyCodes, exponent, money } from '@household/domain'
import { createFormatters } from './format.ts'
import { formattingLocale, initialLocale } from './locale.ts'

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a list of things', () => {
  it('is joined as the language joins one', () => {
    expect(createFormatters('en').list(['Tasks', 'Notes', 'Chat'])).toBe('Tasks, Notes, and Chat')
    // Czech keeps its one-letter *a* with the word after it.
    expect(createFormatters('cs').list(['Úkoly', 'Poznámky', 'Konverzace'])).toBe(
      'Úkoly, Poznámky a Konverzace',
    )
    expect(createFormatters('en').list(['Tasks'])).toBe('Tasks')
    expect(createFormatters('en').list([])).toBe('')
  })
})

describe('money', () => {
  const en = createFormatters('en')
  const cs = createFormatters('cs')

  it('is formatted from whole minor units, by the currency’s own exponent', () => {
    expect(en.money(money(124000, 'CZK'))).toBe('CZK 1,240.00')
    expect(en.money(money(1240, 'JPY'))).toBe('JPY 1,240')
    expect(en.money(money(1240, 'BHD'))).toBe('BHD 1.240')
    expect(en.money(money(5, 'EUR'))).toBe('EUR 0.05')
    expect(en.money(money(0, 'EUR'))).toBe('EUR 0.00')
  })

  it('shows every currency’s minor units, where `Intl`’s own table would round them away', () => {
    expect(en.money(money(12345, 'HUF'))).toBe('HUF 123.45')
    expect(cs.money(money(150, 'HUF'))).toBe('1,50 HUF')
    expect(en.money(money(1250, 'IQD'))).toBe('IQD 1.250')
    for (const code of currencyCodes) {
      const fraction = en
        .moneyParts(money(1, code))
        .map((part) => part.value)
        .join('')
        .split('.')[1]
      expect([code, fraction?.length ?? 0]).toEqual([code, exponent(code)])
    }
  })

  it('never passes through a float: the largest amount keeps its last minor unit', () => {
    expect(en.money(money(Number.MAX_SAFE_INTEGER, 'EUR'))).toBe('EUR 90,071,992,547,409.91')
    expect(en.money(money(-Number.MAX_SAFE_INTEGER, 'EUR'))).toBe('-EUR 90,071,992,547,409.91')
  })

  it('is in the member’s locale: its separators, its order and its sign', () => {
    // Czech groups with a no-break space and writes the code after the amount.
    expect(cs.money(money(-148200, 'CZK'))).toBe('-1 482,00 CZK')
  })

  it('comes in pieces, so the number and the code can be set apart', () => {
    expect(en.moneyParts(money(-34000, 'CZK'))).toEqual([
      { type: 'sign', value: '-' },
      { type: 'currency', value: 'CZK' },
      { type: 'literal', value: ' ' },
      { type: 'number', value: '340' },
      { type: 'number', value: '.' },
      { type: 'number', value: '00' },
    ])
  })

  it('refuses an amount that is not whole minor units, and a currency ISO 4217 has not', () => {
    expect(() => en.money({ amount_minor: 12.5, currency: 'EUR' })).toThrow(RangeError)
    expect(() => en.money({ amount_minor: 100, currency: 'XXY' })).toThrow(/ISO 4217/)
  })
})

describe('dates and numbers', () => {
  const en = createFormatters('en-GB')

  it('shows a calendar day as the day written, wherever it is read', () => {
    expect(en.day('2026-03-01', 'long')).toBe('1 March 2026')
    expect(en.day('2026-12-31')).toBe('31 Dec 2026')
    expect(() => en.day('2026-3-1')).toThrow(RangeError)
    expect(() => en.day('2026-03-01T00:00:00Z')).toThrow(RangeError)
  })

  it('refuses a day no calendar has, and never shows the one it would roll over to', () => {
    for (const day of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-00']) {
      expect(() => en.day(day)).toThrow(RangeError)
    }
    expect(en.day('2024-02-29', 'long')).toBe('29 February 2024')
  })

  it('reads a year as it is written, the first hundred among them', () => {
    expect(en.day('0099-12-31', 'long')).toBe('31 December 99')
    expect(en.day('0001-01-01', 'long')).toBe('1 January 1')
  })

  it('shows an instant in the zone its caller names, and assumes none', () => {
    const at = '2026-03-28T23:30:00Z'
    expect(en.instant(at, 'Europe/Prague')).toBe('29 Mar 2026, 00:30')
    expect(en.instant(at, 'America/New_York')).toBe('28 Mar 2026, 19:30')
    expect(en.instant(new Date(at), 'UTC')).toBe('28 Mar 2026, 23:30')
  })

  it('reads a decimal the contract carries as a string exactly', () => {
    expect(en.decimal('25.5200')).toBe('25.52')
    // Every digit it was written with: a rate of a small currency is not rounded to three.
    expect(en.decimal('0.0000365')).toBe('0.0000365')
    expect(en.decimal('1234567.123456789')).toBe('1,234,567.123456789')
    expect(en.decimal('12')).toBe('12')
    expect(() => en.decimal('1e3')).toThrow(RangeError)
    expect(() => en.decimal('twelve')).toThrow(RangeError)
  })

  it('rounds a decimal only where its caller says how many digits to show', () => {
    expect(en.decimal('0.1234567', { maximumFractionDigits: 6 })).toBe('0.123457')
    expect(en.decimal('25.5', { minimumFractionDigits: 2 })).toBe('25.50')
  })

  it('shows the day an instant falls on in the zone its caller names', () => {
    const at = '2026-03-04T23:30:00Z'
    expect(en.dayOf(at, 'Europe/Prague')).toBe('5 Mar 2026')
    expect(en.dayOf(at, 'America/New_York', 'long')).toBe('4 March 2026')
    expect(en.dayOf(new Date(at), 'UTC')).toBe('4 Mar 2026')
  })

  it('formats a number and a share in the locale', () => {
    expect(createFormatters('de').number(148320)).toBe('148.320')
    expect(en.percent(0.44)).toBe('44%')
  })

  it('says a size in the largest unit it fills one of, as storage is sold, to one decimal place', () => {
    expect(en.bytes(19_400_000_000)).toBe('19.4 GB')
    expect(en.bytes(1_000_000_000)).toBe('1 GB')
    expect(en.bytes(412_000_000)).toBe('412 MB')
    expect(en.bytes(2_300)).toBe('2.3 kB')
    // The unit is the one of what is written: what rounds to a thousand of one is one of the next.
    expect(en.bytes(999_950_000)).toBe('1 GB')
    expect(en.bytes(999_940_000)).toBe('999.9 MB')
    expect(en.bytes(999_960)).toBe('1 MB')
    // In the member's locale: its decimal sign, and the space it sets before a unit.
    expect(createFormatters('de').bytes(19_400_000_000)).toMatch(/^19,4\sGB$/)
  })

  // `Intl` writes a count of bytes as the English word in whichever language, which a screen in
  // another language, and the pseudo-locale's pass, would show as a word nobody translated.
  it('says nothing in bytes: nothing at all in the unit a plan is sold in, and less than a thousand in thousands', () => {
    expect(en.bytes(0)).toBe('0 GB')
    expect(en.bytes(512)).toBe('0.5 kB')
    expect(en.bytes(40)).toBe('0 kB')
    for (const locale of ['en', 'cs', 'sk', 'de', 'pl']) {
      for (const bytes of [0, 1, 999, 1_000, 1_000_000, 1_000_000_000]) {
        expect(createFormatters(locale).bytes(bytes)).not.toMatch(/[A-Za-z]{4,}/)
      }
    }
  })

  it('makes a formatter once for each way it is asked to format, however many rows ask', () => {
    const dates = jest.spyOn(Intl, 'DateTimeFormat')
    const numbers = jest.spyOn(Intl, 'NumberFormat')
    const format = createFormatters('en-GB')
    // The percent's, which every set of formatters starts with.
    numbers.mockClear()
    const at = '2026-03-04T23:30:00Z'
    for (const day of ['2026-03-01', '2026-03-02', '2026-03-03']) {
      format.day(day)
      format.instant(at, 'Europe/Prague')
      format.dayOf(at, 'Europe/Prague')
      format.number(148320)
      format.number(1.8, { style: 'unit', unit: 'gigabyte' })
      format.decimal('25.5200')
    }
    // A calendar day, an instant and the day of one: three ways, whatever the count of rows.
    expect(dates).toHaveBeenCalledTimes(3)
    expect(numbers).toHaveBeenCalledTimes(3)
    // Another style, another zone and other options are other ways, and still right.
    expect(format.day('2026-03-01', 'long')).toBe('1 March 2026')
    expect(format.instant(at, 'America/New_York')).toBe('4 Mar 2026, 18:30')
    expect(format.number(0.5, { maximumFractionDigits: 0 })).toBe('1')
    expect(format.number(0.5)).toBe('0.5')
    expect(dates).toHaveBeenCalledTimes(5)
  })
})

describe('the formatting locale', () => {
  it('is the device’s own tag for the language the app is shown in', () => {
    expect(formattingLocale('de', ['cs-CZ', 'de-AT', 'de'])).toBe('de-AT')
    expect(formattingLocale('cs', ['cs'])).toBe('cs')
  })

  it('is the language’s own where the device writes another', () => {
    expect(formattingLocale('pl', ['en-GB', 'de'])).toBe('pl')
    expect(formattingLocale('sk', [])).toBe('sk')
    expect(formattingLocale('de', ['de_AT'])).toBe('de')
  })

  it('is English for the pseudo-locale, which is derived from it', () => {
    expect(formattingLocale('en-XA', ['en-GB', 'cs'])).toBe('en-GB')
    expect(formattingLocale('en-XA', ['cs'])).toBe('en')
  })
})

describe('the language the app starts in', () => {
  it('is the one kept on this device, the pseudo-locale among them', () => {
    expect(initialLocale('pl', ['de'])).toBe('pl')
    expect(initialLocale('en-XA', ['de'])).toBe('en-XA')
  })

  it('is the device’s first language that Household ships, else English', () => {
    expect(initialLocale(null, ['fr-FR', 'sk-SK', 'de'])).toBe('sk')
    expect(initialLocale('fr', ['fr-FR', 'sk-SK', 'de'])).toBe('sk')
    expect(initialLocale(null, ['fr-FR'])).toBe('en')
    expect(initialLocale(null, [])).toBe('en')
  })
})
