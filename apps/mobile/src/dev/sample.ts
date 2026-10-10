// Sample text as a dev screen shows it. The dev screens' words are fixtures, in English and in
// no catalog (D-154); under the pseudo-locale they are accented and padded as a catalog's
// message is, so a layout that only survives English, and a string that escaped the catalogs,
// show on a dev screen as they would on a member's. What a shipped component says itself still
// comes from the catalogs.
import { pseudoLocale, pseudolocalize } from '@household/i18n'
import { useMemo } from 'react'
import { useI18n } from '../i18n/I18nProvider.tsx'

export type Sample = (text: string) => string

export function useSample(): Sample {
  const { locale } = useI18n()
  return useMemo(
    () => (locale === pseudoLocale ? pseudolocalize : (text: string) => text),
    [locale],
  )
}
