/**
 * @household/i18n/lazy — the package for a client that loads one language at a time (plan item
 * 25). Everything the package's own entry gives but the five catalogs held together: a bundle
 * that imports this holds none of them, and `loadCatalog` fetches the one a member reads as a
 * file of its own. The web app's first download is counted (D-153), and five languages of every
 * screen's words are most of what it would otherwise be.
 *
 * Nothing here may import catalogs.ts, or the entry that does: a test holds this module's
 * imports to that.
 */
import { locales, type Catalog, type Locale } from './locales.ts'

export { locales, sourceLocale, type Catalog, type Locale, type MessageKey } from './locales.ts'
export type { MessageArgs } from './generated/messages.ts'
export { matchLocale } from './locale.ts'
export { pseudoLocale, pseudolocalize } from './pseudo.ts'
export { catalogLocale, translatorOver, type DisplayLocale, type Translate } from './translate.ts'

/**
 * Each language's catalog, fetched when it is asked for. Written out, one import a language: a
 * bundler makes a file of each import it can read, and reads none it has to compute.
 */
const loaders: Readonly<Record<Locale, () => Promise<{ readonly default: Catalog }>>> = {
  en: () => import('../catalogs/en.json'),
  cs: () => import('../catalogs/cs.json'),
  sk: () => import('../catalogs/sk.json'),
  de: () => import('../catalogs/de.json'),
  pl: () => import('../catalogs/pl.json'),
}

/** `locale`'s catalog, fetched once and kept: a second call answers with the first one's. */
const loaded = new Map<Locale, Promise<Catalog>>()

/**
 * `locale`'s catalog. It rejects where the file cannot be fetched, with no connection or after a
 * newer build took it away, and a later call tries again.
 */
export function loadCatalog(locale: Locale): Promise<Catalog> {
  let catalog = loaded.get(locale)
  if (catalog === undefined) {
    catalog = loaders[locale]().then((module) => module.default)
    loaded.set(locale, catalog)
    catalog.catch(() => {
      if (loaded.get(locale) === catalog) loaded.delete(locale)
    })
  }
  return catalog
}

/** Whether `value` names a language Household ships. */
export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale === value)
}
