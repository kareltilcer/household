// What only a device can show of the foundation, as checks the engine screen runs on whatever
// engine it is drawn on (plan item 28): Jest runs the same code on Node, over an `Intl` cut down
// to Hermes's (src/test/hermes.ts), and the end-to-end flow reads the screen on a phone, where
// the engine is Hermes itself and the fonts are the binary's own.
import { newId, isUuid } from '@household/api'
import { formatMessage, matchLocale, MessageError } from '@household/i18n'
import { vectors } from '@household/test-vectors'
import { fonts } from '@household/tokens'
import { isLoaded } from 'expo-font'
import { clientName } from '../../api/client.ts'

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

export function allChecks(): readonly Check[] {
  return [...i18nVectors(), fontFamilies(), randomSource(), client()]
}
