// What holds of this directory's screens as they are written, which no screen's own test sees:
// that every write of theirs is asked at once, and that a control drawn as one word holds that
// word in its name in every language.
import { catalogs, locales } from '@household/i18n'
import { describe, expect, it } from 'vitest'

/** The screens of a household's data and of the privacy centre, each file as it is written. */
const screens = import.meta.glob<string>(['./*.{ts,tsx}', '!./*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

// The test beside the query client holds the screens before sign-in, a member's own account and
// a household's own to this (api/api.test.ts). These are both a household's and an account's,
// in a directory of their own, and are held to it here.
describe('a write of a household’s data or of the privacy centre', () => {
  // An export asked for, a restriction, a deletion scheduled or a consent given when a
  // connection returns, minutes after the press and with nobody at the screen, is not what was
  // asked for (D-164, D-170).
  it('is asked at once, connection or none', () => {
    const writes = Object.entries(screens).flatMap(([path, source]) =>
      [...source.matchAll(/useMutation\(\{\s*(\S+)/g)].map(([, first = '']) => ({ path, first })),
    )
    // The sources were read at all: each of the seven is among them, a download's read of its
    // job, which is asked as a write is, with them.
    expect(writes.map(({ path }) => path).sort()).toEqual([
      './Consents.tsx',
      './DataDelete.tsx',
      './DataRestrict.tsx',
      './DataRestrict.tsx',
      './DeletionNotice.tsx',
      './ExportList.tsx',
      './ExportList.tsx',
    ])
    expect(writes.filter(({ first }) => first !== '...askedNow,')).toEqual([])
  })
})

// A row's own control is drawn as a word and named in full for what it acts on. What is drawn is
// what somebody who speaks to their device says to press it, so the name holds the drawn word,
// together and in order (WCAG 2.1, 2.5.3), as the catalogs' own test holds the pairs it lists
// (packages/i18n/src/catalogs.test.ts).
describe('a control drawn as a word and named in full', () => {
  const drawnInNamed: readonly (readonly [string, string])[] = [
    ['data.exports.download.word', 'data.exports.download.named'],
  ]

  it.each(locales)('holds the word it is drawn as in its name, in %s', (locale) => {
    const catalog: Readonly<Record<string, string>> = catalogs[locale]
    const apart = drawnInNamed.filter(([drawn, named]) => {
      const word = (catalog[drawn] ?? '').toLocaleLowerCase(locale)
      return word === '' || !(catalog[named] ?? '').toLocaleLowerCase(locale).includes(word)
    })
    expect(apart).toEqual([])
  })
})
