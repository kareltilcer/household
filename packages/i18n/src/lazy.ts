/**
 * @household/i18n/lazy — the package for a client that loads one language at a time (plan item
 * 25), and a language in parts (parts.ts). Everything the package's own entry gives but the five
 * catalogs held together: a bundle that imports this holds none of them, and `loadCatalog`
 * fetches one part of the one a member reads as a file of its own. The web app's first download
 * is counted (D-153), and five languages of every screen's words are most of what it would
 * otherwise be.
 *
 * Nothing here may import catalogs.ts, or the entry that does: a test holds this module's
 * imports to that.
 */
import { loaders } from './generated/loaders.ts'
import { locales, type Locale } from './locales.ts'
import type { CatalogPart, Part } from './parts.ts'

export { locales, sourceLocale, type Catalog, type Locale, type MessageKey } from './locales.ts'
export type { MessageArgs } from './generated/messages.ts'
export { matchLocale } from './locale.ts'
export {
  clientParts,
  deviceSegments,
  partOf,
  parts,
  serverSegments,
  type CatalogPart,
  type Part,
} from './parts.ts'
export { pseudoLocale, pseudolocalize } from './pseudo.ts'
export { catalogLocale, translatorOver, type DisplayLocale, type Translate } from './translate.ts'

/** Each part fetched, by its language and name: a second call answers with the first one's. */
const loaded = new Map<string, Promise<CatalogPart>>()

/**
 * `part` of `locale`'s catalog, fetched once and kept. It rejects where the file cannot be
 * fetched, with no connection or after a newer build took it away, and a later call imports it
 * again. Whether that asks the network again is the browser's: Chromium keeps an import that
 * failed and answers the next one of the same file with that failure, for as long as the page
 * lives, so a caller whose fetch failed loads the page again, or tells its member to.
 */
export function loadCatalog(locale: Locale, part: Part): Promise<CatalogPart> {
  const file = `${locale}.${part}`
  let messages = loaded.get(file)
  if (messages === undefined) {
    messages = loaders[locale][part]().then((module) => module.default)
    loaded.set(file, messages)
    messages.catch(() => {
      if (loaded.get(file) === messages) loaded.delete(file)
    })
  }
  return messages
}

/** Whether `value` names a language Household ships. */
export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale === value)
}
