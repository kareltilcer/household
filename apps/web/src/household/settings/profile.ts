// What the household's profile (C-49) and its modules (C-51) share that draws nothing: the banner
// a refusal of no field's is said in, where the focus goes once the controls that held it have
// left, and how the profile draws what no catalog holds, a word `Intl` gives (i18n/names.ts) and
// the household's code. And what every screen of the settings shares with them: which refusals
// are about where the member stands, and how each is said.
//
// Every change of these screens is an owner's, in a household that takes writes, and is asked
// of the server at once (D-170): nothing waits on the device. So a refusal says one of two
// kinds of thing. What was sent was not taken, which is said beside what sent it and leaves it
// there to be put right. Or the member no longer stands where the control was drawn for: they
// are an owner no longer, the household takes no writes now, or what was to be changed is not
// there. That is said on the page, the household is read again, and the controls leave with
// what it then says (absence, not disabling), the focus they held among them.
import { pseudoLocale, pseudolocalize } from '@household/i18n/lazy'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { refocus } from '../../account/common.ts'
import { problemIn } from '../../api/problem.ts'
import { useI18n, useTranslate } from '../../i18n/I18nProvider.tsx'

/**
 * Whether a refused write is about where the member stands and not about what they sent: `403`
 * to a member who was an owner when the page was read, `402` from a household that became
 * read-only or restricted meanwhile, and `404` for what is no longer there. The one list of
 * them, for every screen of the settings: whoever is told one reads the household again, which
 * takes away the controls that are theirs no longer.
 */
export function isStandingRefusal(error: unknown): boolean {
  switch (problemIn(error)?.code) {
    case 'forbidden':
    case 'entitlement_read_only':
    case 'entitlement_restricted':
    case 'not_found':
      return true
    default:
      return false
  }
}

/** The sentence for a refusal that is about where the member stands, or undefined for any other. */
export function useStandingRefusal(): (error: unknown) => string | undefined {
  const t = useTranslate()
  return useCallback(
    (error) => {
      switch (problemIn(error)?.code) {
        case 'forbidden':
          return t('household.settings.refused.not_owner')
        case 'entitlement_read_only':
        case 'entitlement_restricted':
          return t('household.settings.refused.read_only')
        case 'not_found':
          return t('household.settings.refused.gone')
        default:
          return undefined
      }
    },
    [t],
  )
}

/** What a panel or a confirmation that asks for a change is told by the screen that opened it. */
export interface AskedProps {
  /** Put away: by its member, or once what it asked for is done. */
  readonly onClose: () => void
  /**
   * Refused for where its member now stands, in `text`: whoever opened it closes it, says so on
   * the page and reads the household again.
   */
  readonly onEnded: (text: string) => void
}

/** A refusal a screen says in a banner: one of its own for each, so that a second is said again. */
export interface Said {
  /** The banner's key: another for each refusal. */
  readonly id: number
  readonly text: string
}

/** What the screen was last refused with, and how it is told of the next, or of none. */
export function useSaid(): readonly [Said | null, (text: string | null) => void] {
  const count = useRef(0)
  const [said, setSaid] = useState<Said | null>(null)
  const say = useCallback((text: string | null) => {
    count.current += 1
    setSaid(text === null ? null : { id: count.current, text })
  }, [])
  return [said, say]
}

/**
 * Where the focus goes when a control that held it has left with the rest: to the screen's own
 * place, which takes the ref this answers and a `tabIndex` of -1. `changes` is whether the
 * controls are drawn, and `open` what the screen has open over itself, a dialog or none. The
 * focus is looked for when either changes, since a control that leaves under an open dialog is
 * missed only when the dialog closes and the platform has nothing to give the focus back to.
 *
 * It is moved only where it was on something that is no longer on the page. A member who was
 * elsewhere when the controls left keeps their place, and so does one who was nowhere: on a
 * second visit this browser may draw an owner's page from what it kept, and take the controls
 * away once the household is read, from a member whose focus was never on one.
 */
export function useFocusKept(changes: boolean, open: unknown): RefObject<HTMLDivElement | null> {
  const view = useRef<HTMLDivElement>(null)
  /** What took the focus last, wherever on the page it was. */
  const last = useRef<Element | null>(null)
  useEffect(() => {
    const note = (event: FocusEvent) => {
      last.current = event.target instanceof Element ? event.target : null
    }
    document.addEventListener('focusin', note)
    return () => {
      document.removeEventListener('focusin', note)
    }
  }, [])
  useEffect(() => {
    if (changes) return
    if (last.current?.isConnected === false) refocus(view.current)
  }, [changes, open])
  return view
}

/**
 * A word that is no catalog's, as the page draws it: a day of the week or a language's own name
 * as `Intl` gives it, a timezone or the household's code as the server keeps it. In a language
 * of the app's it is drawn as it is given. The pseudo-locale accents it as it accents every word
 * of the catalogs and of the reference data (`useLocalized`, data.ts), so that its pass tells
 * what was given from a word nobody translated. `text` holds nothing of a message's syntax.
 */
export function useGiven(): (text: string) => string {
  const { locale } = useI18n()
  return useCallback((text) => (locale === pseudoLocale ? pseudolocalize(text) : text), [locale])
}

/**
 * The household's code as it is shown and copied: its eight characters in two groups of four
 * (FR-CH1). A sign-in takes it with the dash or without.
 */
export function grouped(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}
