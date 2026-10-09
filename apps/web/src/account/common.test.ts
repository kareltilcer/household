// What the account's screens and a household's share that draws nothing (common.ts): whether two
// ids are one, several reads drawn as one body, and how data is drawn under the pseudo-locale.
import { pseudoLocale } from '@household/i18n/lazy'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider.tsx'
import { sameId, together, useData } from './common.ts'

describe('two ids', () => {
  const here = '0190a000-0000-7000-8000-0000000000d1'
  const laptop = '0190a000-0000-7000-8000-0000000000d2'

  it('are one in either case, and never where one is missing', () => {
    expect(sameId(here, here)).toBe(true)
    expect(sameId(here, here.toUpperCase())).toBe(true)
    expect(sameId(here, laptop)).toBe(false)
    expect(sameId(undefined, undefined)).toBe(false)
    expect(sameId(null, null)).toBe(false)
    expect(sameId(null, here)).toBe(false)
    expect(sameId(here, undefined)).toBe(false)
  })
})

describe('several reads drawn as one body', () => {
  const read = { data: {}, isError: false, fetchStatus: 'idle' } as const
  const unread = { data: undefined, isError: false, fetchStatus: 'fetching' } as const

  it('are read once every one of them is', () => {
    expect(together([read, read]).data).toBeDefined()
    expect(together([read, unread]).data).toBeUndefined()
  })

  it('have failed, or wait for a connection, where one still unread has or does', () => {
    expect(together([read, { ...unread, isError: true }]).isError).toBe(true)
    expect(together([read, { ...unread, fetchStatus: 'paused' }]).fetchStatus).toBe('paused')
    expect(together([read, unread])).toMatchObject({ isError: false, fetchStatus: 'idle' })
  })

  it('say nothing of one that was read and could not be read again', () => {
    const stale = { ...read, isError: true, fetchStatus: 'paused' } as const
    expect(together([stale, read])).toMatchObject({ isError: false, fetchStatus: 'idle' })
    expect(together([stale, read]).data).toBeDefined()
  })
})

describe('what is data and no word', () => {
  const drawnIn = (locale: 'en' | typeof pseudoLocale) =>
    renderHook(() => useData(), {
      wrapper: ({ children }: { readonly children: ReactNode }) =>
        createElement(I18nProvider, { locale, children }),
    }).result.current

  it('is drawn as it is in a language of the app’s', () => {
    const data = drawnIn('en')
    expect(data('0.1.0+008f0f94379a5b41')).toBe('0.1.0+008f0f94379a5b41')
    expect(data('{"entity_type": "shopping.item"}')).toBe('{"entity_type": "shopping.item"}')
  })

  // The pseudo-locale's pass takes a run of four plain letters for a word nobody translated: an
  // id's `beef`, a zone's name, a household's code, an archive's entry, a bundle's own names.
  it('has every letter accented under the pseudo-locale, and nothing else of it touched', () => {
    const data = drawnIn(pseudoLocale)
    const text = '{\n  "entity_type": "shopping.item",\n  "id": "0190beef-cafe", "it’s": \'x\'\n}'
    const drawn = data(text)
    expect(drawn).not.toMatch(/[A-Za-z]/)
    expect(drawn).toHaveLength(text.length)
    expect(drawn.replace(/\p{L}/gu, '')).toBe(text.replace(/\p{L}/gu, ''))
    expect(data('Europe/Prague')).toBe('Éúŕóþé/Þŕáĝúé')
    expect(data('KMPQ-RSTU')).toBe('ĶṀÞǪ-ŔŠŢÚ')
    expect(data('manifest.json')).toBe('ɱáñíƒéšţ.ĵšóñ')
  })

  // A message's syntax is no syntax in it: what the server gave is never read as a message.
  it('takes a brace and an apostrophe as they are', () => {
    expect(drawnIn(pseudoLocale)('{files}/it’s {0}')).toBe('{ƒíľéš}/íţ’š {0}')
    expect(drawnIn(pseudoLocale)("'{")).toBe("'{")
  })
})
