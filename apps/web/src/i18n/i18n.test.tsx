import { currencyCodes, exponent, money } from '@household/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { draw, Press } from '../test/render.tsx'
import { createFormatters } from './format.ts'
import { I18nProvider, useI18n } from './I18nProvider.tsx'
import { formattingLocale, initialLocale, storageKey } from './locale.ts'

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
      expect(fraction?.length ?? 0, code).toBe(exponent(code))
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
  it('is the one kept in this browser, the pseudo-locale among them', () => {
    window.localStorage.setItem(storageKey, 'pl')
    expect(initialLocale()).toBe('pl')
    window.localStorage.setItem(storageKey, 'en-XA')
    expect(initialLocale()).toBe('en-XA')
  })

  it('is the device’s first language that Household ships, else English', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'sk-SK', 'de'])
    expect(initialLocale()).toBe('sk')
    window.localStorage.setItem(storageKey, 'fr')
    expect(initialLocale()).toBe('sk')
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR'])
    expect(initialLocale()).toBe('en')
  })
})

function Probe() {
  const { locale, setLocale, t, format } = useI18n()
  return (
    <div>
      <p>{t('ui.offline.bar')}</p>
      <output>{`${locale} ${format.locale}`}</output>
      <Press
        name="cs"
        onPress={() => {
          setLocale('cs')
        }}
      />
      <Press
        name="pseudo"
        onPress={() => {
          setLocale('en-XA')
        }}
      />
    </div>
  )
}

describe('the language switch', () => {
  it('shows every word in the language chosen, at once, and says so on the page', async () => {
    draw(<Probe />)
    expect(screen.getByText('Offline — changes are saved and will sync')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'en')

    await userEvent.click(screen.getByRole('button', { name: 'cs' }))
    expect(
      screen.getByText('Offline — změny jsou uložené a synchronizují se později'),
    ).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'cs')
    expect(window.localStorage.getItem(storageKey)).toBe('cs')
    expect(screen.getByRole('status')).toHaveTextContent('cs cs')
  })

  it('has the pseudo-locale behind it: accented, bracketed and padded English', async () => {
    draw(<Probe />)
    await userEvent.click(screen.getByRole('button', { name: 'pseudo' }))
    const text = screen.getByText(/^⟦.*⟧$/).textContent
    expect(text).toMatch(/^⟦Óƒƒľíñé — çĥáñĝéš áŕé šáṽéð áñð ŵíľľ šýñç ·+⟧$/)
    expect(text).not.toMatch(/[A-Za-z]/)
    expect(document.documentElement).toHaveAttribute('lang', 'en-XA')
    expect(screen.getByRole('status')).toHaveTextContent(/^en-XA en/)
  })

  it('starts in this browser’s own language when it is given none', () => {
    window.localStorage.setItem(storageKey, 'de')
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(
      screen.getByText('Offline — Änderungen sind gespeichert und werden später synchronisiert'),
    ).toBeInTheDocument()
  })
})
