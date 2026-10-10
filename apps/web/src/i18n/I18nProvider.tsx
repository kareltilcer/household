// The app's language at run time: @household/i18n's translator behind a switch, its pseudo-locale
// among the choices, and the `Intl` formatters for the same member. No component holds a word of
// its own: each asks `useTranslate` for a key of the catalogs. One language's catalog is held at
// a time, in the parts this page has needed (catalogs.ts): the app's own words in the language
// it starts in are fetched before anything is drawn, a screen's with its file, and a language
// chosen later is fetched before the words change.
import {
  translatorOver,
  type CatalogPart,
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
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { fetchCatalog, heldCatalog, holdsCatalog, subscribe } from './catalogs.ts'
import { createFormatters, type Formatters } from './format.ts'
import { formattingLocale, initialLocale, storeLocale } from './locale.ts'

export interface I18n {
  readonly locale: DisplayLocale
  /**
   * Shows the app in `locale` from now on, in this browser: at once where its catalog is held,
   * every part this page has needed, and once it has been fetched where it is not. It rejects,
   * and the language stays as it was, where the catalog cannot be fetched.
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

/** What this page holds of the catalog `locale` is shown from: whoever draws in it fetched it. */
function held(locale: DisplayLocale): CatalogPart {
  const messages = heldCatalog(locale)
  if (messages === undefined) {
    throw new Error(`I18nProvider: no catalog is held for ${locale}; fetch it before drawing`)
  }
  return messages
}

/** The language to start in, which whoever draws the app holds the catalog of already. */
function starting(given: DisplayLocale | undefined): DisplayLocale {
  const locale = given ?? initialLocale()
  held(locale)
  return locale
}

export function I18nProvider({ children, locale: given }: I18nProviderProps) {
  const [locale, setShown] = useState<DisplayLocale>(() => starting(given))
  // What is held of the language shown, read where it is kept and not kept again here: a part
  // that arrives with a screen that reads it makes a new translator, and its words are drawn.
  const messages = useSyncExternalStore(subscribe, () => held(locale))
  const [account, setFormatting] = useState<string | undefined>(undefined)
  // The language asked for last: a catalog that arrives for one asked for before it is not shown.
  const asked = useRef<DisplayLocale>(locale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback(async (next: DisplayLocale) => {
    asked.current = next
    if (!holdsCatalog(next)) await fetchCatalog(next)
    if (asked.current !== next) return
    storeLocale(next)
    setShown(next)
  }, [])

  // The formatters are the language's and the account's, and no part's: a part of the catalog that
  // arrives with a screen makes a new translator, and leaves them, and whatever was made of them,
  // as they were.
  const format = useMemo(() => {
    const device = window.navigator.languages
    return createFormatters(
      formattingLocale(locale, account === undefined ? device : [account, ...device]),
    )
  }, [locale, account])
  const value = useMemo<I18n>(
    () => ({ locale, setLocale, t: translatorOver(locale, messages), format, setFormatting }),
    [locale, messages, setLocale, format],
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
