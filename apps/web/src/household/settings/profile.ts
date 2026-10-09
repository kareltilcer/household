// What the household's profile (C-49) and its modules (C-51) share that draws nothing: how the
// profile draws the household's code. And what every screen of the settings shares with them:
// which refusals are about where the member stands, and how each is said. The banner a refusal
// of no field's is said in, where the focus goes once the controls that held it have left, and
// how the page draws a word that is no catalog's are every screen's, an account's among them,
// and are in account/common.ts (`useSaid`, `useFocusKept`, `useData`).
//
// Every change of these screens is an owner's, in a household that takes writes, and is asked
// of the server at once (D-170): nothing waits on the device. So a refusal says one of two
// kinds of thing. What was sent was not taken, which is said beside what sent it and leaves it
// there to be put right. Or the member no longer stands where the control was drawn for: they
// are an owner no longer, the household takes no writes now, or what was to be changed is not
// there. That is said on the page, the household is read again, and the controls leave with
// what it then says (absence, not disabling), the focus they held among them.
import { useCallback } from 'react'
import { problemIn } from '../../api/problem.ts'
import { useTranslate } from '../../i18n/I18nProvider.tsx'

/**
 * The refusals that are about where the member stands and not about what they sent, each with
 * the sentence it is said in: `403` to a member who was an owner when the page was read, `402`
 * from a household that became read-only or restricted meanwhile, and `404` for what is no
 * longer there. The one list of them, for every screen of the settings.
 */
function standingSentence(error: unknown) {
  switch (problemIn(error)?.code) {
    case 'forbidden':
      return 'household.settings.refused.not_owner'
    case 'entitlement_read_only':
    case 'entitlement_restricted':
      return 'household.settings.refused.read_only'
    case 'not_found':
      return 'household.settings.refused.gone'
    default:
      return undefined
  }
}

/**
 * Whether a refused write is about where the member stands: whoever is told one reads the
 * household again, which takes away the controls that are theirs no longer.
 */
export function isStandingRefusal(error: unknown): boolean {
  return standingSentence(error) !== undefined
}

/** The sentence for a refusal that is about where the member stands, or undefined for any other. */
export function useStandingRefusal(): (error: unknown) => string | undefined {
  const t = useTranslate()
  return useCallback(
    (error) => {
      const sentence = standingSentence(error)
      return sentence === undefined ? undefined : t(sentence)
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

/**
 * The household's code as it is shown and copied: its eight characters in two groups of four
 * (FR-CH1). A sign-in takes it with the dash or without.
 */
export function grouped(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}
