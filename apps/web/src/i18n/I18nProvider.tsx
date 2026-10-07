// The app's language at run time (plan item 24): @household/i18n's translator behind a switch, its
// pseudo-locale among the choices, and the `Intl` formatters for the same member. No component
// holds a word of its own: each asks `useTranslate` for a key of the catalogs.
import { createTranslator, type DisplayLocale, type Translate } from '@household/i18n'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createFormatters, type Formatters } from './format.ts'
import { formattingLocale, initialLocale, storeLocale } from './locale.ts'

export interface I18n {
  readonly locale: DisplayLocale
  /** Shows the app in `locale` from now on, in this browser. */
  readonly setLocale: (locale: DisplayLocale) => void
  readonly t: Translate
  readonly format: Formatters
}

const I18nContext = createContext<I18n | null>(null)

export interface I18nProviderProps {
  readonly children: ReactNode
  /** The language to start in. Left out, this browser's own (locale.ts). */
  readonly locale?: DisplayLocale
}

export function I18nProvider({ children, locale: given }: I18nProviderProps) {
  const [locale, setCurrent] = useState<DisplayLocale>(() => given ?? initialLocale())

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: DisplayLocale) => {
    storeLocale(next)
    setCurrent(next)
  }, [])

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(locale),
      format: createFormatters(formattingLocale(locale, window.navigator.languages)),
    }),
    [locale, setLocale],
  )
  return <I18nContext value={value}>{children}</I18nContext>
}

export function useI18n(): I18n {
  const i18n = use(I18nContext)
  if (i18n === null) throw new Error('useI18n: no I18nProvider above this component')
  return i18n
}

/** The translator for the language the app is shown in. */
export function useTranslate(): Translate {
  return useI18n().t
}

/** The formatters for the locale the app formats in. */
export function useFormat(): Formatters {
  return useI18n().format
}
