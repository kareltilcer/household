// The catalogs this page holds. The web app loads one language at a time (D-159): the entry
// fetches the catalog of the language it starts in before it draws a word (main.tsx), and a
// language chosen later is fetched when it is chosen. What has arrived is kept here, outside
// React, so that the provider reads it as it draws and a switch back to a language already
// fetched is immediate.
import { catalogLocale, loadCatalog, type Catalog, type DisplayLocale } from '@household/i18n/lazy'

const held = new Map<string, Catalog>()

/** Keeps `catalog` as the one `locale` is shown from. */
export function holdCatalog(locale: DisplayLocale, catalog: Catalog): void {
  held.set(catalogLocale(locale), catalog)
}

/** The catalog `locale` is shown from, where this page holds it. */
export function heldCatalog(locale: DisplayLocale): Catalog | undefined {
  return held.get(catalogLocale(locale))
}

/**
 * Fetches the catalog `locale` is shown from, and keeps it. It rejects where the file cannot be
 * fetched: with no connection, or after a newer build took it away.
 */
export async function fetchCatalog(locale: DisplayLocale): Promise<Catalog> {
  const catalog = heldCatalog(locale) ?? (await loadCatalog(catalogLocale(locale)))
  holdCatalog(locale, catalog)
  return catalog
}

/** Forgets every catalog: a test starts with none it did not hold itself. */
export function dropCatalogs(): void {
  held.clear()
}
