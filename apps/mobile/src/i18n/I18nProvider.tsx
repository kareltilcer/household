// The app's language at run time: @household/i18n's translator behind a switch, its pseudo-locale
// among the choices, and the `Intl` formatters for the same member. No component holds a word of
// its own: each asks `useTranslate` for a key of the catalogs. All five catalogs are in the
// bundle (the package's own entry): a device downloads the app once and changes language with
// no connection, so a language chosen is shown at once and nothing here waits on a fetch.
import {
  createTranslator,
  matchLocale,
  pseudoLocale,
  type DisplayLocale,
  type Translate,
} from '@household/i18n'
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createFormatters, type Formatters } from './format.ts'
import { deviceLanguages, formattingLocale, storeLocale } from './locale.ts'

export interface I18n {
  readonly locale: DisplayLocale
  /** Shows the app in `locale` from now on, and keeps the choice on this device. */
  readonly setLocale: (locale: DisplayLocale) => void
  readonly t: Translate
  readonly format: Formatters
  /**
   * What the session says once it knows whose account this is: the tag the account formats
   * dates, numbers and money in (`Me.locale`), or undefined where nobody is signed in. The tag
   * comes before the device's own for the language shown, and the language follows the account
   * when its tag is learned or changes: not the pseudo-locale, which is nobody's, and not a
   * language chosen here since, which the account's own settings write to the account.
   */
  readonly followAccount: (tag: string | undefined) => void
}

const I18nContext = createContext<I18n | null>(null)

export interface I18nProviderProps {
  readonly children: ReactNode
  /** The language to start in (locale.ts's `readLocale`). Left out, the device's own. */
  readonly locale?: DisplayLocale
  /** The device's languages, the one it prefers first. Left out, what the device says. */
  readonly languages?: readonly string[]
}

export function I18nProvider({ children, locale: given, languages }: I18nProviderProps) {
  const device = useMemo(() => languages ?? deviceLanguages(), [languages])
  const [locale, setShown] = useState<DisplayLocale>(() => given ?? matchLocale(device))
  const [account, setAccount] = useState<string | undefined>(undefined)
  // The account's tag as it was last followed: the same one told again changes no language.
  const followed = useRef<string | undefined>(undefined)

  // The language shown, as `followAccount` reads it when the session calls.
  const shown = useRef(locale)

  const setLocale = useCallback((next: DisplayLocale) => {
    shown.current = next
    storeLocale(next)
    setShown(next)
  }, [])

  const followAccount = useCallback(
    (tag: string | undefined) => {
      setAccount(tag)
      if (tag === followed.current) return
      followed.current = tag
      if (tag === undefined || shown.current === pseudoLocale) return
      // Kept as a language chosen here is: the app then starts in its member's language, before
      // the session has read whose account this is.
      const language = matchLocale([tag])
      if (language !== shown.current) setLocale(language)
    },
    [setLocale],
  )

  const format = useMemo(
    () =>
      createFormatters(
        formattingLocale(locale, account === undefined ? device : [account, ...device]),
      ),
    [locale, account, device],
  )
  const t = useMemo(() => createTranslator(locale), [locale])
  const value = useMemo<I18n>(
    () => ({ locale, setLocale, t, format, followAccount }),
    [locale, setLocale, t, format, followAccount],
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
