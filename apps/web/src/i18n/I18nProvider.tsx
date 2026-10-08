// The app's language at run time: @household/i18n's translator behind a switch, its pseudo-locale
// among the choices, and the `Intl` formatters for the same member. No component holds a word of
// its own: each asks `useTranslate` for a key of the catalogs. One language's catalog is held at
// a time (catalogs.ts): the one the app starts in is fetched before anything is drawn, and one
// chosen later is fetched before the words change.
import {
  translatorOver,
  type Catalog,
  type DisplayLocale,
  type Translate,
} from '@household/i18n/lazy'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { fetchCatalog, heldCatalog } from './catalogs.ts'
import { createFormatters, type Formatters } from './format.ts'
import { formattingLocale, initialLocale, storeLocale } from './locale.ts'

export interface I18n {
  readonly locale: DisplayLocale
  /**
   * Shows the app in `locale` from now on, in this browser: at once where its catalog is held,
   * and once it has been fetched where it is not. It rejects, and the language stays as it was,
   * where the catalog cannot be fetched.
   */
  readonly setLocale: (locale: DisplayLocale) => Promise<void>
  readonly t: Translate
  readonly format: Formatters
  /**
   * The tag the member's account formats dates, numbers and money in (`Me.locale`), or undefined
   * for a visitor: it comes before the device's own tags for the language the app is shown in.
   */
  readonly setFormatting: (tag: string | undefined) => void
}

const I18nContext = createContext<I18n | null>(null)

export interface I18nProviderProps {
  readonly children: ReactNode
  /** The language to start in. Left out, this browser's own (locale.ts). */
  readonly locale?: DisplayLocale
}

interface Shown {
  readonly locale: DisplayLocale
  readonly catalog: Catalog
}

/** The language to start in with its catalog, which whoever draws the app holds already. */
function starting(given: DisplayLocale | undefined): Shown {
  const locale = given ?? initialLocale()
  const catalog = heldCatalog(locale)
  if (catalog === undefined) {
    throw new Error(`I18nProvider: no catalog is held for ${locale}; fetch it before drawing`)
  }
  return { locale, catalog }
}

export function I18nProvider({ children, locale: given }: I18nProviderProps) {
  const [shown, setShown] = useState<Shown>(() => starting(given))
  const [account, setFormatting] = useState<string | undefined>(undefined)
  // The language asked for last: a catalog that arrives for one asked for before it is not shown.
  const asked = useRef<DisplayLocale>(shown.locale)

  useEffect(() => {
    document.documentElement.lang = shown.locale
  }, [shown.locale])

  const setLocale = useCallback(async (next: DisplayLocale) => {
    asked.current = next
    const catalog = heldCatalog(next) ?? (await fetchCatalog(next))
    if (asked.current !== next) return
    storeLocale(next)
    setShown({ locale: next, catalog })
  }, [])

  const value = useMemo<I18n>(() => {
    const device = window.navigator.languages
    return {
      locale: shown.locale,
      setLocale,
      t: translatorOver(shown.locale, shown.catalog),
      format: createFormatters(
        formattingLocale(shown.locale, account === undefined ? device : [account, ...device]),
      ),
      setFormatting,
    }
  }, [shown, setLocale, account])
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
