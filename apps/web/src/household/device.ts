// What this device says of where its member is, which a household starts from (A-22, DD-6): the
// country its languages name, the zone its clock is in, and what a list of languages or of zones
// offers to choose from. A household's country, timezone and language are confirmed, not asked
// (03-patterns §6): the form opens with what is read here, and every one of them can be changed.
import type { Locale } from '@household/i18n/lazy'
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

/**
 * The zones a household can be set in, as this browser names them, with `own` among them though
 * the browser does not list it: `UTC` is in no list of the zones of places.
 */
export function timeZones(own: string): readonly string[] {
  const known = Intl.supportedValuesOf('timeZone')
  return known.includes(own) ? known : [own, ...known]
}

/** A language's own name for itself, as `Intl` has it, with a capital as a list of names has. */
export function ownName(locale: Locale): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}
