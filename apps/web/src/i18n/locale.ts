// Which language the app is shown in, and which locale it formats in. The language is the
// member's (06-accessibility-and-i18n §2): one of the five Household ships, or the pseudo-locale,
// kept in this browser until item 25 reads it from their account. The formatting locale is the
// same language as the device writes it: a member who reads German on a device set to `de-AT`
// sees Austria's numbers.
import { locales, matchLocale, pseudoLocale, type DisplayLocale } from '@household/i18n'
import { storageKey } from './storage.ts'

/** Where the chosen language is kept: the same key the end-to-end suite sets a language by. */
export { storageKey }

function isDisplayLocale(value: unknown): value is DisplayLocale {
  return value === pseudoLocale || locales.some((locale) => locale === value)
}

/** The language kept in this browser, or the device's first that Household ships, else English. */
export function initialLocale(): DisplayLocale {
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (isDisplayLocale(stored)) return stored
  } catch {
    // Nothing kept: the device's languages decide.
  }
  return matchLocale(window.navigator.languages)
}

export function storeLocale(locale: DisplayLocale): void {
  try {
    window.localStorage.setItem(storageKey, locale)
  } catch {
    // Kept for this page alone.
  }
}

/**
 * The tag dates, numbers and money are formatted in: the device's own tag for the language the
 * app is shown in, when it has one, and the language's otherwise. The pseudo-locale formats as
 * English, the language it is derived from.
 */
export function formattingLocale(locale: DisplayLocale, preferences: readonly string[]): string {
  const language = locale === pseudoLocale ? 'en' : locale
  const own = preferences.find((tag) => tag.trim().split('-')[0]?.toLowerCase() === language)
  if (own === undefined) return language
  try {
    return new Intl.Locale(own.trim()).toString()
  } catch {
    return language
  }
}
