// Sample text as a dev page shows it. The dev pages' words are fixtures, in English and in no
// catalog (harness/model.ts says why); under the pseudo-locale they are accented and padded as a
// catalog's message is, so the pass that looks for a layout that only survives English, and for a
// string that escaped the catalogs, covers them too.
import { pseudoLocale, pseudolocalize } from '@household/i18n/lazy'
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
