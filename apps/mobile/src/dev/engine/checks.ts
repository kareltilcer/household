// What only a device can show of the foundation, as checks the engine screen runs on whatever
// engine it is drawn on (plan item 28): Jest runs the same code on Node, over an `Intl` cut down
// to Hermes's (src/test/hermes.ts), and the end-to-end flow reads the screen on a phone, where
// the engine is Hermes itself and the fonts are the binary's own.
import { newId, isUuid } from '@household/api'
import { money } from '@household/domain'
import { formatMessage, matchLocale, MessageError } from '@household/i18n'
import { vectors } from '@household/test-vectors'
import { fonts } from '@household/tokens'
import { isLoaded } from 'expo-font'
import { clientName } from '../../api/client.ts'
import { createFormatters, type Formatters } from '../../i18n/format.ts'
import { held, lacking, type BuiltIn } from './builtins.ts'

/** One line of the engine screen: what was checked, how much of it held, and what did not. */
export interface Check {
  /** The line's name, which its `testID` is made of. */
  readonly id: string
  /** How many things the line checked. */
  readonly cases: number
  /** Each thing that did not hold, by a name a reader can find it by. */
  readonly failed: readonly string[]
  /** What the line found, for a reader: a value, where the check is of one. */
  readonly found?: string
  /** A line that says how it came out under its own name alone, and not in the page's verdict. */
  readonly apart?: boolean
}

/** A case's outcome as the vector states one: what it gives, or the code it is refused with. */
function outcome(run: () => string): string {
  try {
    return JSON.stringify({ output: run() })
  } catch (error) {
    return JSON.stringify({ error: error instanceof MessageError ? error.code : undefined })
  }
}

function stated(vector: { output?: unknown; error?: unknown }): string {
  return JSON.stringify('error' in vector ? { error: vector.error } : { output: vector.output })
}

/**
 * vectors/i18n.json, every case, through @household/i18n on this engine's `Intl`: the rule the
 * server and both clients share (D-37), where it meets the polyfills on a device.
 */
export function i18nVectors(): readonly Check[] {
  const { format, match } = vectors.i18n.groups
  return [
    {
      id: 'vectors-format',
      cases: format.length,
      failed: format
        .filter((vector) => {
          const { locale, message, args } = vector.input
          return outcome(() => formatMessage(locale, message, args)) !== stated(vector)
        })
        .map((vector) => vector.name),
    },
    {
      id: 'vectors-match',
      cases: match.length,
      failed: match
        .filter((vector) => outcome(() => matchLocale(vector.input)) !== stated(vector))
        .map((vector) => vector.name),
    },
  ]
}

/** Every family the type scale names, each registered with the device under that name. */
export function fontFamilies(loaded: (family: string) => boolean = isLoaded): Check {
  const families = Object.values(fonts).flatMap((face) => Object.values<string>(face.native))
  return {
    id: 'fonts',
    cases: families.length,
    failed: families.filter((family) => {
      try {
        return !loaded(family)
      } catch {
        return true
      }
    }),
  }
}

/** `crypto.getRandomValues`, by what it gives: two identifiers, each a UUIDv7, and not the same. */
export function randomSource(): Check {
  const failed: string[] = []
  try {
    const [one, other] = [newId(), newId()]
    if (!isUuid(one) || one.charAt(14) !== '7') failed.push('uuid')
    if (one.slice(-12) === other.slice(-12)) failed.push('random')
  } catch {
    failed.push('crypto')
  }
  return { id: 'random', cases: 2, failed }
}

/** The name the app gives itself to the server, which must be one the server reads. */
export function client(): Check {
  const name = clientName()
  return {
    id: 'client',
    cases: 1,
    failed: /^mobile\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(name) ? [] : ['name'],
    found: name,
  }
}

/**
 * The engine's built-ins, held to the list the sources are read by (builtins.ts): each one the
 * list says a device lacks is absent here, and each newer one it says a device has is here. A
 * line that fails is a list to correct, and on Node, where Jest runs, it always fails: Node has
 * them all, which is why a list is kept.
 */
export function builtIns(has: (builtIn: BuiltIn) => boolean = (builtIn) => builtIn.has()): Check {
  return {
    id: 'built-ins',
    cases: lacking.length + held.length,
    failed: [
      // Listed as lacking, and here: the engine has gained it.
      ...lacking.filter(has).map(({ name }) => `gained: ${name}`),
      // Listed as held, and not here.
      ...held.filter((builtIn) => !has(builtIn)).map(({ name }) => `absent: ${name}`),
    ],
  }
}

/**
 * Who writes a sample on a device (polyfills/intl.ts), which is what it is held to.
 *
 * - `formatjs`: a number, an amount and a size are FormatJS's on every device, forced, with one
 *   CLDR, as they are in Jest. Such a sample is held to the very string, and one that differs
 *   is a defect of the app's: the polyfill not reached on some path, or a language's data
 *   missing.
 * - `engine`: a date is the engine's own `Intl.DateTimeFormat`, which is the operating
 *   system's ICU, of whatever age that system is; and so is a list wherever an engine has
 *   `Intl.ListFormat`, which Hermes has not yet. Such a sample is held to its fields
 *   (`fields`), and not to what Node's ICU puts between them.
 */
type Writer = 'formatjs' | 'engine'

/**
 * A sample of each thing the app's own formatters write (src/i18n/format.ts), in two of its
 * languages, with what Node writes for it: read off Jest's run of the same calls, which the
 * test beside the engine screen holds these to, to the very string. The instant is asked in a
 * zone that is no runner's own: 17:41 UTC is 18:41 in Prague, and the hour is among the fields.
 */
const samples: readonly {
  readonly kind: string
  readonly by: Writer
  readonly write: (format: Formatters) => string
  readonly written: Readonly<Record<string, string>>
}[] = [
  {
    kind: 'money',
    by: 'formatjs',
    write: (format) => format.money(money(124000, 'CZK')),
    written: { en: 'CZK 1,240.00', cs: '1 240,00 CZK' },
  },
  {
    kind: 'day',
    by: 'engine',
    write: (format) => format.day('2026-03-03', 'long'),
    written: { en: 'March 3, 2026', cs: '3. března 2026' },
  },
  {
    kind: 'instant',
    by: 'engine',
    write: (format) => format.instant('2026-03-03T17:41:00Z', 'Europe/Prague', 'medium'),
    written: { en: 'Mar 3, 2026, 6:41 PM', cs: '3. 3. 2026 18:41' },
  },
  {
    kind: 'bytes',
    by: 'formatjs',
    write: (format) => format.bytes(1536000),
    written: { en: '1.5 MB', cs: '1,5 MB' },
  },
  {
    kind: 'list',
    by: 'engine',
    write: (format) => format.list(['Petr', 'Jana', 'Tomáš']),
    written: { en: 'Petr, Jana, and Tomáš', cs: 'Petr, Jana a Tomáš' },
  },
]

/**
 * The word a language joins a day to its time with, where an ICU writes one between them. An
 * iPhone's writes *Mar 3, 2026 at 6:41 PM* where Node's writes a comma (run 38152216148, the
 * simulator of iOS 26); no other was seen, and one that is met is added here.
 */
const joining: Readonly<Record<string, readonly string[]>> = { en: ['at'] }

/**
 * What stands between two fields beside a joining word, each folded to a plain space: the
 * spaces an ICU writes, by code point, since none of them shows in a source, a comma and a
 * full stop.
 */
const between: readonly string[] = [
  String.fromCharCode(0x00a0), // no-break
  String.fromCharCode(0x2009), // thin
  String.fromCharCode(0x202f), // narrow no-break
  ',',
  '.',
]

/**
 * What every ICU writes alike of a date, a time or a list: its fields, in their order. What
 * stands between two fields is each ICU's own, by the age of its CLDR, and all of it is
 * folded to one space here, and nothing else is:
 *
 * - a space of any kind: plain, no-break (U+00A0), thin (U+2009) or narrow no-break (U+202F,
 *   which the same simulator writes before *PM* and after the full stops of a Czech day,
 *   where Node writes a plain one);
 * - a comma and a full stop: after a day, after an abbreviation, before a list's last *and*;
 * - the joining word above.
 *
 * A digit, the colon of a time, a month's name and *PM* are fields, each as it was written.
 * So the wrong hour for the zone, a day that is one off, a field out of its place and a
 * month named in another language differ still, on any ICU.
 */
function fields(written: string, locale: string): string {
  const joiners = joining[locale] ?? []
  return between
    .reduce((text, mark) => text.split(mark).join(' '), written)
    .split(' ')
    .filter((field) => field !== '' && !joiners.includes(field))
    .join(' ')
}

/**
 * The app's formatters, on this engine: each sample as Node writes it, to the string where
 * FormatJS writes it and to its fields where the engine does, or named in `failed` with what
 * this engine wrote instead. A sample of the engine's that holds by its fields and is not
 * Node's very string is named in `found`, with what was written: what a device's ICU varies
 * is let, and is shown to whoever reads the screen. A line apart from the page's one verdict:
 * what it finds is a formatter's, and no reason for the page to say that the engine has failed.
 */
export function formats(make: (locale: string) => Formatters = createFormatters): Check {
  const failed: string[] = []
  const varied: string[] = []
  for (const { kind, by, write, written } of samples) {
    for (const [locale, expected] of Object.entries(written)) {
      let found: string
      try {
        found = write(make(locale))
      } catch {
        found = 'threw'
      }
      if (found === expected) continue
      const name = `${locale} ${kind}: ${found}`
      if (by === 'engine' && fields(found, locale) === fields(expected, locale)) varied.push(name)
      else failed.push(name)
    }
  }
  return {
    id: 'formats',
    cases: samples.reduce((count, { written }) => count + Object.keys(written).length, 0),
    failed,
    ...(varied.length === 0 ? {} : { found: varied.join('\n') }),
    apart: true,
  }
}

export function allChecks(): readonly Check[] {
  return [...i18nVectors(), fontFamilies(), randomSource(), client(), builtIns(), formats()]
}
