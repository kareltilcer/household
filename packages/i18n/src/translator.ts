import { catalogs, sourceLocale, type Locale, type MessageKey } from './catalogs.ts'
import type { MessageArgs } from './generated/messages.ts'
import { compileMessage, type CompiledMessage } from './message.ts'
import { pseudoLocale, pseudolocalize } from './pseudo.ts'

/** A language the UI can be shown in: a shipped one, or the pseudo-locale. */
export type DisplayLocale = Locale | typeof pseudoLocale

/**
 * The message `key` in the translator's language, formatted with the arguments its English
 * message takes. A key the catalogs do not have, or a missing argument, fails the type check.
 */
export type Translate = <K extends MessageKey>(
  key: K,
  ...args: MessageArgs[K] extends undefined ? [] : [MessageArgs[K]]
) => string

/**
 * A Translate for `locale`. Each message is parsed the first time it is asked for and kept.
 * The pseudo-locale formats pseudo-localised English with English's rules.
 */
export function createTranslator(locale: DisplayLocale): Translate {
  const pseudo = locale === pseudoLocale
  const catalog = catalogs[pseudo ? sourceLocale : locale]
  const compiled = new Map<MessageKey, CompiledMessage>()
  return (key, ...args) => {
    let message = compiled.get(key)
    if (message === undefined) {
      const text = catalog[key]
      message = compileMessage(pseudo ? sourceLocale : locale, pseudo ? pseudolocalize(text) : text)
      compiled.set(key, message)
    }
    return message.format(args[0])
  }
}
