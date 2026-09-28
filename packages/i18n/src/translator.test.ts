import { describe, expect, it } from 'vitest'
import { catalogs, locales } from './catalogs.ts'
import { formatMessage, MessageError } from './message.ts'
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

  it('renders every key of the catalogs', () => {
    const t = createTranslator(pseudoLocale)
    for (const key of Object.keys(catalogs.en) as (keyof typeof catalogs.en)[]) {
      expect(t(key)).toMatch(/^⟦.*⟧$/)
    }
  })
})

describe('a message', () => {
  it('refuses syntax outside the subset with a code', () => {
    expect(() => formatMessage('en', '<b>bold</b> {d, time}', { d: 0 })).toThrow(MessageError)
  })
})
