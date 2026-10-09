// The words this page holds. The web app loads one language at a time, and a language in parts
// (D-159, @household/i18n's parts.ts): the entry fetches the app's own words in the language it
// starts in before it draws one (main.tsx), a route names the parts its screen reads beside them
// and they are fetched with the screen's file (app/routes.tsx), and a language chosen later is
// fetched when it is chosen, in every part this page has needed so far. What has arrived is kept
// here, outside React, so that the provider reads it as it draws, is told when a part arrives,
// and a switch back to a language already fetched is immediate.
import {
  catalogLocale,
  loadCatalog,
  type CatalogPart,
  type DisplayLocale,
  type Locale,
  type Part,
} from '@household/i18n/lazy'

/** What this page holds of one language: its messages together, and which parts they are. */
interface Held {
  readonly messages: CatalogPart
  readonly parts: ReadonlySet<Part>
}

const held = new Map<Locale, Held>()

/** The app's own words, which every screen reads: needed from the first. */
const first: Part = 'app'

/** The parts this page has needed so far: the app's own, and each a screen it opened reads. */
const needed = new Set<Part>([first])

/** The languages being fetched, each with the fetch that is on its way. */
const fetching = new Map<Locale, Promise<void>>()

const listeners = new Set<() => void>()

/** Tells `listener` whenever what this page holds changes, until the answer is called. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function keep(language: Locale, messages: CatalogPart, parts: readonly Part[]): void {
  const before = held.get(language)
  // New messages, and never the ones held changed: whoever reads them is told by their identity.
  held.set(language, {
    messages: { ...before?.messages, ...messages },
    parts: new Set([...(before?.parts ?? []), ...parts]),
  })
  for (const listener of [...listeners]) listener()
}

/** Keeps `messages` as `parts` of the catalog `locale` is shown from, beside what is held of it. */
export function holdCatalog(
  locale: DisplayLocale,
  messages: CatalogPart,
  parts: readonly Part[],
): void {
  keep(catalogLocale(locale), messages, parts)
}

/**
 * What this page holds of the catalog `locale` is shown from, every part that has arrived
 * together, or undefined where it holds none. The same messages until a part arrives.
 */
export function heldCatalog(locale: DisplayLocale): CatalogPart | undefined {
  return held.get(catalogLocale(locale))?.messages
}

/** The parts this page has needed so far that it does not hold of `language`. */
function lacking(language: Locale): Part[] {
  const parts = held.get(language)?.parts
  return [...needed].filter((part) => parts?.has(part) !== true)
}

/**
 * Whether this page holds every part it has needed so far of the catalog `locale` is shown from:
 * whether every screen it has opened can be drawn in it at once.
 */
export function holdsCatalog(locale: DisplayLocale): boolean {
  return lacking(catalogLocale(locale)).length === 0
}

/** Fetches `part` of `language` and keeps it, where this page does not hold it. */
async function fetchPart(language: Locale, part: Part): Promise<void> {
  if (held.get(language)?.parts.has(part) === true) return
  const messages = await loadCatalog(language, part)
  // Asked for twice while it was on its way, it is kept once.
  if (held.get(language)?.parts.has(part) !== true) keep(language, messages, [part])
}

async function fetchNeeded(language: Locale): Promise<void> {
  // A part that came to be needed while the others were on their way is fetched before this
  // ends: the language is shown once it is whole, to a screen that opened meanwhile too.
  for (let parts = lacking(language); parts.length > 0; parts = lacking(language)) {
    await Promise.all(parts.map((part) => fetchPart(language, part)))
  }
}

/**
 * Fetches the catalog `locale` is shown from, in every part this page has needed so far, and
 * keeps it. It rejects where a file cannot be fetched: with no connection, or after a newer build
 * took it away.
 */
export function fetchCatalog(locale: DisplayLocale): Promise<void> {
  const language = catalogLocale(locale)
  const before = fetching.get(language)
  if (before !== undefined) return before
  const fetched = fetchNeeded(language).finally(() => {
    if (fetching.get(language) === fetched) fetching.delete(language)
  })
  fetching.set(language, fetched)
  return fetched
}

/**
 * Says that this page needs `parts` from now on, a screen that reads them being on its way, and
 * fetches them in every language it holds or is fetching, so that the screen has its words in
 * whichever of them is shown when it is drawn: a language may be switched to while a screen
 * loads, and a screen opened while a language does. It rejects where a file cannot be fetched.
 */
export async function needWords(parts: readonly Part[]): Promise<void> {
  for (const part of parts) needed.add(part)
  const languages = new Set([...held.keys(), ...fetching.keys()])
  await Promise.all(
    [...languages].flatMap((language) => parts.map((part) => fetchPart(language, part))),
  )
}

/**
 * Forgets every catalog, and that any part was needed but the app's own: a test starts with none
 * it did not hold itself.
 */
export function dropCatalogs(): void {
  held.clear()
  fetching.clear()
  needed.clear()
  needed.add(first)
}
