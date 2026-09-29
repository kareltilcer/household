import { describe, expect, it } from 'vitest'
import { catalogs, locales } from './catalogs.ts'
import { formatMessage, MessageError, parseMessage, signature } from './message.ts'
import { pseudoLocale, pseudolocalize } from './pseudo.ts'
import { createTranslator } from './translator.ts'

describe('a translator', () => {
  it.each(locales)('renders %s from its own catalog', (locale) => {
    expect(createTranslator(locale)('module.shopping.name')).toBe(
      catalogs[locale]['module.shopping.name'],
    )
  })

  it('renders the Czech module names of the prototype', () => {
    const t = createTranslator('cs')
    expect(t('module.utilities.name')).toBe('Energie a služby')
    expect(t('module.admin.name')).toBe('Nastavení domácnosti')
  })
})

describe('the pseudo-locale', () => {
  it('accents, brackets and pads English', () => {
    const shown = createTranslator(pseudoLocale)('module.shopping.name')
    expect(shown).toMatch(/^⟦Šĥóþþíñĝ ·+⟧$/)
    expect(shown.length).toBeGreaterThan('Shopping'.length * 1.3)
  })

  // The padding is 40 % of every letter the message holds, in every branch.
  it('leaves arguments, plurals and quoting working', () => {
    const message = "{n, plural, one {# task for {name}} other {# tasks for {name}}}, it''s '{x}'"
    const pseudo = pseudolocalize(message)
    expect(formatMessage('en', pseudo, { n: 2, name: 'Jana' })).toBe(
      "⟦2 ţášķš ƒóŕ Jana, íţ'š {ẋ} ········⟧",
    )
  })

  // Apostrophes beside arguments and quoted syntax: FormatJS's own printer re-quotes the
  // argument after a lone apostrophe, which showed `{name}` instead of the name.
  it.each([
    ["''{name}'' was added", { name: 'Jana' }, "⟦'Jana' ŵáš áððéð ····⟧"],
    ["{a}''{b}", { a: 1, b: 2 }, "⟦1'2⟧"],
    ["Say ''{word}''", { word: 'hi' }, "⟦Šáý 'hi' ··⟧"],
    ["a '{''}' b, it''s", {}, "⟦á {'} ƀ, íţ'š ··⟧"],
    [
      "{n, plural, offset:1 other {'#'# {g, select, a {# a} other {x}}}}",
      { n: 5, g: 'a' },
      '⟦#4 # á ·⟧',
    ],
    ['{n, selectordinal, other {#.}} {m, number}', { n: 2, m: 1000 }, '⟦2. 1,000⟧'],
  ])('keeps %j meaning what it meant', (message, args, shown) => {
    expect(formatMessage('en', pseudolocalize(message), args)).toBe(shown)
  })

  // Each with the arguments its English takes, a number where it formats one, as the
  // pseudo-locale's translator formats it; a message may run over several lines, an email's body.
  it('renders every key of the catalogs', () => {
    for (const key of Object.keys(catalogs.en) as (keyof typeof catalogs.en)[]) {
      const english = catalogs.en[key]
      const args = Object.fromEntries(
        [...signature(parseMessage(english))].map(([name, kind]) => [
          name,
          kind === 'number' ? 1 : 'x',
        ]),
      )
      expect(formatMessage('en', pseudolocalize(english), args)).toMatch(/^⟦[\s\S]*⟧$/)
    }
  })
})

describe('a message', () => {
  it('refuses syntax outside the subset with a code', () => {
    expect(() => formatMessage('en', '<b>bold</b> {d, time}', { d: 0 })).toThrow(MessageError)
  })
})
