import { catalogs } from './catalogs.ts'
import { catalogLocale, translatorOver, type DisplayLocale, type Translate } from './translate.ts'

export type { DisplayLocale, Translate } from './translate.ts'

/**
 * A Translate for `locale`, over the catalogs this module holds: all five. A client that loads
 * one language at a time makes its translator from lazy.ts instead.
 */
export function createTranslator(locale: DisplayLocale): Translate {
  return translatorOver(locale, catalogs[catalogLocale(locale)])
}
