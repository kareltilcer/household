// A translator over one catalog, with no catalog imported: what createTranslator is made of
// (translator.ts), and what a client that loads one language at a time makes its own from
// (lazy.ts).
import type { MessageArgs } from './generated/messages.ts'
import { sourceLocale, type Catalog, type Locale, type MessageKey } from './locales.ts'
import { compileMessage, type CompiledMessage } from './message.ts'
import { pseudoLocale, pseudolocalize } from './pseudo.ts'

/** A language the UI can be shown in: a shipped one, or the pseudo-locale. */
export type DisplayLocale = Locale | typeof pseudoLocale

/** The keys whose English message takes no argument. */
type PlainKey = {
  [K in MessageKey]: MessageArgs[K] extends undefined ? K : never
}[MessageKey]

/** The keys whose English message takes arguments. */
type KeyWithArgs = Exclude<MessageKey, PlainKey>

/**
 * The message `key` in the translator's language, formatted with the arguments its English
 * message takes. A key the catalogs do not have, or a missing argument, fails the type check.
 * Two signatures rather than one with a conditional rest parameter: with one, a key the catalogs
 * do not have was reported as a missing argument, once some key took one, and the key went
 * unnamed.
 */
export interface Translate {
  (key: PlainKey): string
  <K extends KeyWithArgs>(key: K, args: MessageArgs[K]): string
}

/** The language whose catalog `locale` is shown from: its own, or English for the pseudo-locale. */
export function catalogLocale(locale: DisplayLocale): Locale {
  return locale === pseudoLocale ? sourceLocale : locale
}

/**
 * A Translate for `locale` over `catalog`, which is `catalogLocale(locale)`'s. Each message is
 * parsed the first time it is asked for and kept. The pseudo-locale formats pseudo-localised
 * English with English's rules.
 */
export function translatorOver(locale: DisplayLocale, catalog: Catalog): Translate {
  const pseudo = locale === pseudoLocale
  const language = catalogLocale(locale)
  const compiled = new Map<MessageKey, CompiledMessage>()
  function translate(key: MessageKey, args?: MessageArgs[KeyWithArgs]): string {
    let message = compiled.get(key)
    if (message === undefined) {
      const text = catalog[key]
      message = compileMessage(language, pseudo ? pseudolocalize(text) : text)
      compiled.set(key, message)
    }
    return message.format(args)
  }
  return translate
}
