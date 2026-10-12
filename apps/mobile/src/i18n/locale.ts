// Which language the app is shown in, and which locale it formats in. The language is the
// member's (06-accessibility-and-i18n §2): one of the five Household ships, or the pseudo-locale,
// kept on this device, and read from their account once they are signed in (session/). The
// formatting locale is the same language as the account or the device writes it: a member who
// reads German on a device set to `de-AT` is given Austria's tag, and the engine does with it
// what its data can (polyfills/intl.ts).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { locales, matchLocale, pseudoLocale, type DisplayLocale } from '@household/i18n'
import { getLocales } from 'expo-localization'

/** Where the chosen language is kept: the name the web keeps its own under. */
export const storageKey = 'household.locale'

function isDisplayLocale(value: unknown): value is DisplayLocale {
  return value === pseudoLocale || locales.some((locale) => locale === value)
}

/** The device's languages as BCP 47 tags, the one it prefers first. */
export function deviceLanguages(): readonly string[] {
  try {
    return getLocales().map((locale) => locale.languageTag)
  } catch {
    return []
  }
}

/** The language `kept` names, or the device's first that Household ships, else English. */
export function initialLocale(
  kept: string | null,
  device: readonly string[] = deviceLanguages(),
): DisplayLocale {
  return isDisplayLocale(kept) ? kept : matchLocale(device)
}

/** The language the app starts in, read before the first screen is drawn (app/Root.tsx). */
export async function readLocale(): Promise<DisplayLocale> {
  try {
    return initialLocale(await AsyncStorage.getItem(storageKey))
  } catch {
    return initialLocale(null)
  }
}

export function storeLocale(locale: DisplayLocale): void {
  AsyncStorage.setItem(storageKey, locale).catch(() => undefined)
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
