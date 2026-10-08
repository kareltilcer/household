import { locales, sourceLocale, type Locale } from './locales.ts'

/**
 * The language to show a member who prefers `preferences`, most preferred first, as BCP 47
 * tags (`navigator.languages`, `Accept-Language`, a member's setting): the first whose
 * language is one Household ships, else English. Only the language counts: `de-AT` is German.
 * The Go renderer's Match chooses the same way, so an email and the app agree.
 */
export function matchLocale(preferences: readonly string[]): Locale {
  for (const tag of preferences) {
    const language = tag.trim().split('-')[0]?.toLowerCase()
    const match = locales.find((locale) => locale === language)
    if (match !== undefined) return match
  }
  return sourceLocale
}
