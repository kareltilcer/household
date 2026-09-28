import { catalogs, sourceLocale, type Locale, type MessageKey } from './catalogs.ts'
import type { MessageArgs } from './generated/messages.ts'
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

/**
 * A Translate for `locale`. Each message is parsed the first time it is asked for and kept.
 * The pseudo-locale formats pseudo-localised English with English's rules.
 */
export function createTranslator(locale: DisplayLocale): Translate {
  const pseudo = locale === pseudoLocale
  const catalog = catalogs[pseudo ? sourceLocale : locale]
  const compiled = new Map<MessageKey, CompiledMessage>()
  function translate(key: MessageKey, args?: MessageArgs[KeyWithArgs]): string {
    let message = compiled.get(key)
    if (message === undefined) {
      const text = catalog[key]
      message = compileMessage(pseudo ? sourceLocale : locale, pseudo ? pseudolocalize(text) : text)
      compiled.set(key, message)
    }
    return message.format(args)
  }
  return translate
}
