// What this device says of where its member is, which a household starts from (A-22, DD-6): the
// country its languages name. A household's country, timezone and language are confirmed, not
// asked (03-patterns §6): the form opens with what is read here, and every one of them can be
// changed. What a list of languages or of zones offers to choose from is `Intl`'s to name
// (i18n/names.ts).
import type { Country } from './data.ts'

/**
 * The country of `countries` that `languages` name first: the region each tag carries, or the
 * one its language is most likely spoken in where it carries none (`cs` is Czechia's). Undefined
 * where none of them is a country Household has a profile of.
 */
export function deviceCountry(
  countries: readonly Country[],
  languages: readonly string[] = window.navigator.languages,
): Country | undefined {
  for (const tag of languages) {
    let region: string | undefined
    try {
      region = new Intl.Locale(tag).maximize().region
    } catch {
      // No language tag at all: the next one is asked.
      continue
    }
    const found = countries.find((country) => country.code === region)
    if (found !== undefined) return found
  }
  return undefined
}
