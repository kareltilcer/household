// What the screens of a household's sync stand on that draws nothing: what a diagnostic bundle
// carries and what it never does, what is said of a version, how data is drawn under the
// pseudo-locale, and two things every screen of the directory is held to: a write that is asked
// at once, and a control whose drawn word is in its name.
import { catalogs, locales } from '@household/i18n'
import { pseudoLocale } from '@household/i18n/lazy'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider.tsx'
import {
  bodyOf,
  compose,
  factsOf,
  heldParts,
  lineOf,
  linesOf,
  outcomesCarried,
  screenLimit,
  textOf,
  type Known,
  type ReplicaFacts,
} from './bundle.ts'
import { sameId } from './data.ts'
import { useData } from './names.ts'
import { here, home, jana, laptop, outcome, report, standIn } from './testing.tsx'
import { isUnder, numbersOf, ownVersion } from './versions.ts'

const facts: ReplicaFacts = {
  held: 'open',
  id: here,
  queued: 2,
  heldBack: 1,
  receiving: true,
  outcomes: [outcome()],
}

const known: Known = {
  screen: `/households/${home}/settings/sync`,
  household: home,
  member: jana.id,
  client: { name: 'web/0.1.0+008f0f94379a5b41', browser: 'chrome', system: 'windows' },
  locale: { language: 'en', formats: 'en-GB', time_zone: 'Europe/Prague' },
  online: true,
  replica: facts,
  reports: [
    report({ replica_id: laptop }),
    report({ checksum_failures: 3, digest_mismatch_entity_types: ['shopping.item'] }),
  ],
}

describe('an answer, as a bundle carries it', () => {
  it('is what the answer was, and nothing of what it held', () => {
    const recorded = outcome()
    expect(lineOf(recorded)).toEqual({
      mutation_id: recorded.mutation_id,
      entity_type: 'shopping.item',
      op: 'update',
      outcome: 'rejected',
      code: 'validation_failed',
      answered_at: '2026-09-08T16:31:00Z',
    })
  })

  // The replica keeps the row an answer carried, the mutation it answered and the server's own
  // message about them: what a member wrote is in all three, and in no bundle.
  it('leaves the row, the mutation and the server’s message out of everything that is sent', () => {
    const body = bodyOf(compose(known), 'an-id', new Set(), '')
    const text = JSON.stringify(body)
    for (const written of ['Ovesné', 'mléko', 'cukru', 'quantity', '-3', '"fields"', '"row"']) {
      expect(text).not.toContain(written)
    }
    expect(text).not.toContain(outcome().entity_id)
    const { outcomes } = body.payload as { outcomes: object[] }
    expect(outcomes.map((each) => Object.keys(each).sort())).toEqual([
      ['answered_at', 'code', 'entity_type', 'mutation_id', 'op', 'outcome'],
    ])
  })

  it('is the last forty of them, oldest first as the replica keeps them', () => {
    const many = Array.from({ length: outcomesCarried + 5 }, (_, index) =>
      outcome({ mutation_id: `m-${String(index)}` }),
    )
    const lines = linesOf(many)
    expect(lines).toHaveLength(outcomesCarried)
    expect(lines[0]?.mutation_id).toBe('m-5')
    expect(lines.at(-1)?.mutation_id).toBe(`m-${String(outcomesCarried + 4)}`)
  })

  it('stays far under the server’s limit with every answer it carries', () => {
    const full = compose({
      ...known,
      replica: { ...facts, outcomes: Array.from({ length: 500 }, () => outcome()) },
    })
    const sent = JSON.stringify(bodyOf(full, here, new Set(), 'x'.repeat(200)))
    expect(new TextEncoder().encode(sent).length).toBeLessThan(256 * 1024)
  })
})

describe('a bundle', () => {
  it('is put together from what this browser knows, a part to a name', () => {
    expect(compose(known)).toEqual({
      screen: `/households/${home}/settings/sync`,
      household: home,
      parts: {
        client: known.client,
        locale: known.locale,
        ids: { member: jana.id, household: home, replica: here },
        sync: { replica: 'open', online: true, receiving: true, queued: 2, held: 1 },
        report: {
          reported_at: '2026-09-08T16:41:00Z',
          checkpoint: '184402',
          checksum_failures: 3,
          digest_mismatch_entity_types: ['shopping.item'],
          marked_to_download_again: false,
        },
        outcomes: [lineOf(outcome())],
      },
    })
  })

  it('holds the last report of this browser’s own replica, and of no other', () => {
    const others = compose({ ...known, reports: [report({ replica_id: laptop })] })
    expect(others.parts.report).toBeUndefined()
    expect(heldParts(others)).toEqual(['client', 'locale', 'ids', 'sync', 'outcomes'])
    // Nor where the server could not be asked, or this tab holds no replica to know its own by.
    expect(compose({ ...known, reports: undefined }).parts.report).toBeUndefined()
    expect(
      compose({ ...known, replica: { ...facts, held: 'elsewhere', id: null } }).parts.report,
    ).toBeUndefined()
  })

  it('names a screen in no more characters than the server takes', () => {
    const long = compose({ ...known, screen: `/${'é'.repeat(300)}` })
    expect(Array.from(long.screen)).toHaveLength(screenLimit)
  })

  it('is sent whole, under the id it was given, with nothing named as taken out', () => {
    const bundle = compose(known)
    expect(bodyOf(bundle, 'an-id', new Set(), '  ')).toEqual({
      id: 'an-id',
      screen: bundle.screen,
      household_id: home,
      payload: bundle.parts,
      redacted_fields: [],
    })
  })

  it('is sent without a part that was taken out, which is then named and really absent', () => {
    const bundle = compose(known)
    const body = bodyOf(bundle, 'an-id', new Set(['outcomes', 'ids']), ' T-41 ')
    expect(Object.keys(body.payload)).toEqual(['client', 'locale', 'sync', 'report'])
    expect(body.redacted_fields).toEqual(['ids', 'outcomes'])
    expect(body.ticket_reference).toBe('T-41')
    const text = textOf(body)
    expect(text).not.toContain(jana.id)
    expect(text).not.toContain('mutation_id')
  })

  it('names no part as taken out that it never held', () => {
    const bundle = compose({ ...known, reports: [] })
    expect(bodyOf(bundle, 'an-id', new Set(['report']), '').redacted_fields).toEqual([])
  })

  it('is drawn as the text of the very object that is sent', () => {
    const body = bodyOf(compose(known), 'an-id', new Set(['locale']), '')
    expect(JSON.parse(textOf(body))).toEqual(body)
  })
})

describe('what a replica says of itself for a bundle', () => {
  it('is its id, what it has waiting and what it recorded, where this tab holds it', async () => {
    const stand = standIn({ queued: 2, held: 1, outcomes: [outcome()] })
    expect(await factsOf(stand.opened.replica, false, false)).toEqual({
      held: 'open',
      id: here,
      queued: 2,
      heldBack: 1,
      receiving: false,
      outcomes: [outcome()],
    })
  })

  it('is nothing where this tab holds none, with why', async () => {
    const nothing = { id: null, queued: null, heldBack: null, receiving: null, outcomes: [] }
    expect(await factsOf(undefined, true, null)).toEqual({ held: 'elsewhere', ...nothing })
    expect(await factsOf(undefined, false, null)).toEqual({ held: 'unavailable', ...nothing })
    // A database that fails under the questions says as little as one never opened.
    expect(await factsOf(standIn({ broken: true }).opened.replica, false, true)).toEqual({
      held: 'unavailable',
      ...nothing,
    })
  })
})

describe('a client’s version', () => {
  it('is read by its three numbers, whatever follows them', () => {
    expect(numbersOf('0.1.0')).toEqual([0, 1, 0])
    expect(numbersOf('1.6.12+008f0f94379a5b41')).toEqual([1, 6, 12])
    expect(numbersOf('2.0.0-beta.3')).toEqual([2, 0, 0])
    expect(numbersOf('1.6')).toBeUndefined()
    expect(numbersOf('1.6.0.1')).toBeUndefined()
    expect(numbersOf('v1.6.0')).toBeUndefined()
    expect(numbersOf('')).toBeUndefined()
  })

  it('is under a minimum by those numbers alone, compared as numbers', () => {
    expect(isUnder('0.9.0', '1.0.0')).toBe(true)
    expect(isUnder('1.5.9', '1.6.0')).toBe(true)
    expect(isUnder('1.6.0', '1.6.1')).toBe(true)
    // Ten is more than nine, which a comparison of the text would not say.
    expect(isUnder('1.10.0', '1.9.0')).toBe(false)
    expect(isUnder('1.6.0', '1.6.0')).toBe(false)
    expect(isUnder('1.6.0+008f', '1.6.0')).toBe(false)
    expect(isUnder('1.6.0-beta.1', '1.6.0')).toBe(false)
    expect(isUnder('2.0.0', '1.6.0')).toBe(false)
  })

  it('is under nothing where either cannot be compared', () => {
    expect(isUnder('nightly', '1.6.0')).toBe(false)
    expect(isUnder('1.0.0', 'latest')).toBe(false)
  })

  it('is this page’s own as a report of it names it', () => {
    expect(ownVersion('web/0.1.0+008f0f94379a5b41')).toBe('0.1.0+008f0f94379a5b41')
    expect(ownVersion('web/0.1.0')).toBe('0.1.0')
  })
})

describe('two ids', () => {
  it('are one in either case, and never where one is missing', () => {
    expect(sameId(here, here.toUpperCase())).toBe(true)
    expect(sameId(here, laptop)).toBe(false)
    expect(sameId(undefined, undefined)).toBe(false)
    expect(sameId(null, here)).toBe(false)
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
  // id's `beef`, a zone's name, a bundle's own names.
  it('has every letter accented under the pseudo-locale, and nothing else of it touched', () => {
    const data = drawnIn(pseudoLocale)
    const text = '{\n  "entity_type": "shopping.item",\n  "id": "0190beef-cafe", "it’s": \'x\'\n}'
    const drawn = data(text)
    expect(drawn).not.toMatch(/[A-Za-z]/)
    expect(drawn).toHaveLength(text.length)
    expect(drawn.replace(/\p{L}/gu, '')).toBe(text.replace(/\p{L}/gu, ''))
    expect(data('Europe/Prague')).toBe('Éúŕóþé/Þŕáĝúé')
  })
})

/** The screens of this directory, each file as it is written. */
const screens = import.meta.glob<string>(['./*.{ts,tsx}', '!./*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Nothing of a household's sync health is written offline: a copy asked to download itself
// again, or a bundle sent, when a connection returns and with nobody at the screen, is not what
// was asked for (D-170). The same test holds household/ to it (api/api.test.ts).
describe('a write of these screens', () => {
  it('is asked at once, every one of them', () => {
    const writes = Object.entries(screens).flatMap(([path, source]) =>
      [...source.matchAll(/useMutation\(\{\s*(\S+)/g)].map(([, first = '']) => ({ path, first })),
    )
    // The sources were read at all: the two screens that write are among them.
    expect(writes.map(({ path }) => path).sort()).toEqual(['./Diagnostics.tsx', './SyncHealth.tsx'])
    expect(writes.filter(({ first }) => first !== '...askedNow,')).toEqual([])
  })
})

// The catalogs' own test holds each such pair of the app's (packages/i18n, WCAG 2.5.3): this
// directory's is held here until it is listed there.
describe('a control drawn as a word and named in full', () => {
  it.each(locales)('holds the word it is drawn as in its name, in %s', (locale) => {
    const catalog: Readonly<Record<string, string>> = catalogs[locale]
    const word = (catalog['health.sync.again.word'] ?? '').toLocaleLowerCase(locale)
    expect(word).not.toBe('')
    expect((catalog['health.sync.again.named'] ?? '').toLocaleLowerCase(locale)).toContain(word)
  })
})
