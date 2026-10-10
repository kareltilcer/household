// The rule both clients and the server share (D-37), run through what a device formats with:
// the polyfills Jest's setup loads are the app's own (src/polyfills), over an `Intl` cut down to
// Hermes's (src/test/hermes.ts). @household/i18n runs the same file on Node's ICU, and the
// server on its own renderer: a case that passes there and fails here is FormatJS's data
// disagreeing with ICU's, and is the case to read, not the vector to change.
import { describe, expect, it } from '@jest/globals'
import { formatMessage, matchLocale, MessageError } from '@household/i18n'
import { vectors } from '@household/test-vectors'

const { format, match } = vectors.i18n.groups

/** A case's outcome as the vector states one: what it gives, or the code it is refused with. */
function outcome(run: () => string): { output: string } | { error: string | undefined } {
  try {
    return { output: run() }
  } catch (error) {
    return { error: error instanceof MessageError ? error.code : undefined }
  }
}

/** What a vector's case says it comes to, in the same shape. */
function stated(vector: { output?: unknown; error?: unknown }): object {
  return 'error' in vector ? { error: vector.error } : { output: vector.output }
}

describe('the polyfills', () => {
  it('are FormatJS’s for plurals and numbers, whatever the engine has', () => {
    expect('polyfilled' in Intl.PluralRules).toBe(true)
    expect('polyfilled' in Intl.NumberFormat).toBe(true)
  })

  it('fill what Hermes lacks', () => {
    expect(new Intl.Locale('cs-CZ').language).toBe('cs')
    expect(new Intl.ListFormat('cs', { type: 'conjunction' }).format(['a', 'b', 'c'])).toMatch(
      /^a, b a\sc$/,
    )
    expect(new Intl.DisplayNames('cs', { type: 'region' }).of('PL')).toBe('Polsko')
    expect(Intl.supportedValuesOf('timeZone')).toContain('Europe/Prague')
  })
})

describe('vectors/i18n.json on a device’s Intl', () => {
  it.each(format.map((vector) => [vector.name, vector] as const))('format: %s', (_, vector) => {
    const { locale, message, args } = vector.input
    expect(outcome(() => formatMessage(locale, message, args))).toEqual(stated(vector))
  })

  it.each(match.map((vector) => [vector.name, vector] as const))('match: %s', (_, vector) => {
    expect(outcome(() => matchLocale(vector.input))).toEqual(stated(vector))
  })
})
