// The catalogs, one per language, with English the source (D-29). Every catalog holds exactly
// English's keys, which the type check enforces: a key missing from any catalog, or one no
// English message has, fails the build (PRD 03 §9).
import cs from '../catalogs/cs.json'
import de from '../catalogs/de.json'
import en from '../catalogs/en.json'
import pl from '../catalogs/pl.json'
import sk from '../catalogs/sk.json'
import type { Catalog, Locale, MessageKey } from './locales.ts'

export { locales, sourceLocale, type Catalog, type Locale, type MessageKey } from './locales.ts'

/**
 * `catalogs`, held to English's keys: each must have every key (a Catalog) and no other, so
 * a key removed from English cannot linger in a translation.
 */
export function defineCatalogs<const C extends Readonly<Record<Locale, Catalog>>>(
  catalogs: C & {
    readonly [L in Locale]: [Exclude<keyof C[L], MessageKey>] extends [never] ? unknown : never
  },
): Readonly<Record<Locale, Catalog>> {
  return catalogs
}

export const catalogs = defineCatalogs({ en, cs, sk, de, pl })

/** Whether `key` is a key of the catalogs. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(catalogs.en, key)
}
