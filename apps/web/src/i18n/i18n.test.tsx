import { currencyCodes, exponent, money } from '@household/domain'
import { catalogs } from '@household/i18n'
import * as lazy from '@household/i18n/lazy'
import { partOf, type CatalogPart, type Locale, type Part } from '@household/i18n/lazy'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { draw, Press } from '../test/render.tsx'
import {
  dropCatalogs,
  fetchCatalog,
  heldCatalog,
  holdCatalog,
  holdsCatalog,
  needWords,
} from './catalogs.ts'
import { createFormatters } from './format.ts'
import { I18nProvider, useI18n, useTranslate } from './I18nProvider.tsx'
import { formattingLocale, initialLocale, storageKey } from './locale.ts'

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

  it('refuses a day no calendar has, and never shows the one it would roll over to', () => {
    for (const day of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-00']) {
      expect(() => en.day(day), day).toThrow(RangeError)
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

  // `Intl` writes a count of bytes as the English word in whichever language, which a page in
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
    const dates = vi.spyOn(Intl, 'DateTimeFormat')
    const numbers = vi.spyOn(Intl, 'NumberFormat')
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
          void setLocale('cs')
        }}
      />
      <Press
        name="pseudo"
        onPress={() => {
          void setLocale('en-XA')
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

/** `part` of `locale`'s catalog, as the package holds it whole. */
function partOfCatalog(locale: Locale, part: Part): CatalogPart {
  return Object.fromEntries(
    Object.entries(catalogs[locale]).filter(([key]) => partOf(key) === part),
  )
}

/** A language's own words and a household's together: what a household's screen is drawn from. */
function withHousehold(locale: Locale): CatalogPart {
  return { ...partOfCatalog(locale, 'app'), ...partOfCatalog(locale, 'household') }
}

/**
 * Holds back every part of a catalog fetched from here on, until the test says what becomes of
 * it, by its language and its name: it arrives, or fails as a file that could not be fetched. A
 * part is a file fetched when it is needed, and the test answers for the fetch itself.
 */
function heldBack() {
  interface File {
    readonly fetched: Promise<CatalogPart>
    readonly arrive: () => void
    readonly fail: () => void
  }
  const files = new Map<string, File>()
  // One fetch for each file, however often it is asked for, as the package's own keeps it.
  vi.spyOn(lazy, 'loadCatalog').mockImplementation((locale, part) => {
    const name = `${locale}.${part}`
    let file = files.get(name)
    if (file === undefined) {
      let arrive: () => void = () => undefined
      let fail: () => void = () => undefined
      const fetched = new Promise<CatalogPart>((resolve, reject) => {
        arrive = () => {
          resolve(partOfCatalog(locale, part))
        }
        fail = () => {
          reject(new TypeError('Failed to fetch dynamically imported module'))
        }
      })
      file = { fetched, arrive, fail }
      files.set(name, file)
    }
    return file.fetched
  })
  const settle = (name: string, how: 'arrive' | 'fail') =>
    act(async () => {
      const file = files.get(name)
      if (file === undefined) throw new Error(`${name} was not asked for`)
      file[how]()
      // Long enough for whatever waited for the file to have gone on.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  return {
    /** The files asked for so far, in the order they were first asked for. */
    asked: () => [...files.keys()],
    arrive: (name: string) => settle(name, 'arrive'),
    fail: (name: string) => settle(name, 'fail'),
  }
}

const householdWord = 'household.invitation.none.title'

/**
 * A word of a household's own, where the part that has it is held, and nothing where it is not:
 * a screen is drawn once its words have come, and this says whether they have.
 */
function ScreenWord() {
  const t = useTranslate()
  let word = ''
  try {
    word = t(householdWord)
  } catch {
    // Its part is not held.
  }
  return <p>{word}</p>
}

describe('the words this page holds', () => {
  it('are the app’s own in the language it starts in, and with the next every part needed since', async () => {
    const load = vi.spyOn(lazy, 'loadCatalog')
    dropCatalogs()
    await fetchCatalog('en')
    expect(heldCatalog('en')).toEqual(partOfCatalog('en', 'app'))
    // A screen that reads a household's words is on its way.
    await needWords(['household'])
    expect(heldCatalog('en')).toEqual(withHousehold('en'))
    await fetchCatalog('cs')
    expect(heldCatalog('cs')).toEqual(withHousehold('cs'))
    expect(load.mock.calls).toEqual([
      ['en', 'app'],
      ['en', 'household'],
      ['cs', 'app'],
      ['cs', 'household'],
    ])
    // The pseudo-locale is shown from English, which is held whole.
    await fetchCatalog('en-XA')
    await needWords(['household'])
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('are drawn as they arrive: a part that comes makes its words of what is drawn already', async () => {
    dropCatalogs()
    holdCatalog('en', partOfCatalog('en', 'app'), ['app'])
    draw(<ScreenWord />)
    expect(screen.queryByText(catalogs.en[householdWord])).not.toBeInTheDocument()
    await act(() => needWords(['household']))
    expect(screen.getByText(catalogs.en[householdWord])).toBeInTheDocument()
  })

  it('are fetched in a language switched to, every part needed, before it is shown', async () => {
    dropCatalogs()
    // A household's screen is drawn, in English.
    holdCatalog('en', withHousehold('en'), ['app', 'household'])
    await needWords(['household'])
    const files = heldBack()
    draw(
      <>
        <Probe />
        <ScreenWord />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'cs' }))
    expect(files.asked()).toEqual(['cs.app', 'cs.household'])
    await files.arrive('cs.app')
    // Not yet: a screen that is drawn reads the part that has not come.
    expect(holdsCatalog('cs')).toBe(false)
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    expect(screen.getByText(catalogs.en[householdWord])).toBeInTheDocument()
    await files.arrive('cs.household')
    expect(await screen.findByText(catalogs.cs[householdWord])).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('cs cs')
  })

  // A language may be switched to while a screen is on its way, and a screen opened while a
  // language is: either way the screen is drawn with its words in the language then shown.
  it('are a screen’s in the language shown when it is drawn, one switched to while it loaded', async () => {
    dropCatalogs()
    holdCatalog('en', partOfCatalog('en', 'app'), ['app'])
    const files = heldBack()
    draw(
      <>
        <Probe />
        <ScreenWord />
      </>,
    )
    // The screen first, and then the language.
    let drawn = false
    const words = needWords(['household']).then(() => {
      drawn = true
    })
    await userEvent.click(screen.getByRole('button', { name: 'cs' }))
    expect(files.asked()).toEqual(['en.household', 'cs.app', 'cs.household'])
    await files.arrive('cs.app')
    await files.arrive('cs.household')
    // Czech came whole, the screen's part with it, and is shown. The screen still waits for
    // what it asked for, its words in the language that was shown then.
    expect(await screen.findByText(catalogs.cs[householdWord])).toBeInTheDocument()
    expect(drawn).toBe(false)
    await files.arrive('en.household')
    await words
    expect(heldCatalog('en')).toEqual(withHousehold('en'))
    expect(heldCatalog('cs')).toEqual(withHousehold('cs'))
  })

  it('are a screen’s in the language shown when it is drawn, one opened while a language loaded', async () => {
    dropCatalogs()
    holdCatalog('en', partOfCatalog('en', 'app'), ['app'])
    const files = heldBack()
    draw(
      <>
        <Probe />
        <ScreenWord />
      </>,
    )
    // The language first, and then the screen.
    await userEvent.click(screen.getByRole('button', { name: 'cs' }))
    expect(files.asked()).toEqual(['cs.app'])
    let drawn = false
    const words = needWords(['household']).then(() => {
      drawn = true
    })
    // In the language that is shown and in the one on its way.
    expect(files.asked()).toEqual(['cs.app', 'en.household', 'cs.household'])
    await files.arrive('en.household')
    // The screen waits: Czech may be shown by the time it is drawn, and has not its words.
    expect(drawn).toBe(false)
    await files.arrive('cs.app')
    // And Czech waits for them too, the screen's part being needed since it was asked for.
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    await files.arrive('cs.household')
    await words
    expect(await screen.findByText(catalogs.cs[householdWord])).toBeInTheDocument()
    expect(heldCatalog('cs')).toEqual(withHousehold('cs'))
  })

  it('are refused to a screen whose part cannot be fetched, and to a language that lacks one', async () => {
    dropCatalogs()
    holdCatalog('en', partOfCatalog('en', 'app'), ['app'])
    const files = heldBack()
    const words = needWords(['household'])
    const refused = expect(words).rejects.toThrow('Failed to fetch')
    await files.fail('en.household')
    await refused
    expect(heldCatalog('en')).toEqual(partOfCatalog('en', 'app'))
    // The part is needed still: a language fetched now is whole with it, or is not shown.
    const czech = fetchCatalog('cs')
    const unfetched = expect(czech).rejects.toThrow('Failed to fetch')
    await files.arrive('cs.app')
    await files.fail('cs.household')
    await unfetched
    expect(holdsCatalog('cs')).toBe(false)
    expect(holdsCatalog('en')).toBe(false)
  })

  // A fetch that fails part-way leaves the language held in part. A browser may answer a file
  // asked for again with the failure it kept, as the files here do: asked for in that language
  // again with a later screen, the part that failed would fail the screen, in a language that
  // is shown and whole.
  it('are a screen’s in the language shown, where a switch to another failed part-way', async () => {
    dropCatalogs()
    // A household's screen is drawn, in English.
    holdCatalog('en', withHousehold('en'), ['app', 'household'])
    await needWords(['household'])
    const files = heldBack()
    const czech = fetchCatalog('cs')
    const unfetched = expect(czech).rejects.toThrow('Failed to fetch')
    await files.arrive('cs.app')
    await files.fail('cs.household')
    await unfetched
    // What arrived of Czech is held, and Czech is shown to nobody.
    expect(heldCatalog('cs')).toEqual(partOfCatalog('cs', 'app'))
    expect(holdsCatalog('cs')).toBe(false)

    // A screen that reads the part that failed, and one more, opens in English.
    const words = needWords(['household', 'billing'])
    expect(files.asked()).toEqual(['cs.app', 'cs.household', 'en.billing'])
    await files.arrive('en.billing')
    await words
    expect(holdsCatalog('en')).toBe(true)
    expect(heldCatalog('en')).toEqual({ ...withHousehold('en'), ...partOfCatalog('en', 'billing') })
  })

  it('are fetched again in a language whose fetch failed part-way once it has come whole', async () => {
    dropCatalogs()
    holdCatalog('en', partOfCatalog('en', 'app'), ['app'])
    // Of Czech the app's own words arrive, and no other part until the connection is back.
    let reachable = false
    const load = vi
      .spyOn(lazy, 'loadCatalog')
      .mockImplementation((locale, part) =>
        reachable || locale === 'en' || part === 'app'
          ? Promise.resolve(partOfCatalog(locale, part))
          : Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
      )
    await needWords(['household'])
    await expect(fetchCatalog('cs')).rejects.toThrow('Failed to fetch')
    expect(heldCatalog('cs')).toEqual(partOfCatalog('cs', 'app'))
    load.mockClear()
    await needWords(['billing'])
    expect(load.mock.calls).toEqual([['en', 'billing']])
    // Asked for again, Czech is fetched in every part needed by then, and is whole.
    reachable = true
    await fetchCatalog('cs')
    expect(holdsCatalog('cs')).toBe(true)
    // From then on a part a screen needs is fetched in it too: it may be shown.
    load.mockClear()
    await needWords(['storage'])
    expect(load.mock.calls).toEqual([
      ['en', 'storage'],
      ['cs', 'storage'],
    ])
  })
})
