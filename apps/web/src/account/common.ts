// What the account's screens share that draws nothing: which state a read is in, the zone a
// member's times are said in, and whether a refusal is of what was sent. Which field a `422`
// names is read as the screens before sign-in read it (auth/fields.tsx), and a write is asked
// as they ask theirs, at once (api/query.ts, `askedNow`).
//
// And what a household's screens share with them: whether two ids are one, the banner a refusal
// of no field's is said in, where the focus goes once the controls that held it have left, and
// how the page draws what is data and no word. This file reads no word of a household's, so a
// screen of either kind may import it: the catalog comes in parts, and an account's screen
// fetches none of a household's (i18n/words.test.ts).
//
// A member's account is no household's (A-19): its reads and writes are plain requests, and none
// of them is a mutation a replica holds. So of the twelve states (02-components §0) these screens
// reach the ones a request can be in, and the rest have nothing to be: nothing is `absent` or
// `withdrawn`, there being no grant over one's own account to lack or to lose, nothing is
// `conflicted`, one person changing their own account from one place at a time, and nothing waits
// `pending` on the device to be sent later.
import { pseudoLocale, pseudolocalize } from '@household/i18n/lazy'
import type { FetchStatus } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { problemIn } from '../api/problem.ts'
import { deviceTimeZone } from '../api/problemText.ts'
import { useI18n, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import type { StateText } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'

/**
 * The query that holds where the account is signed in, its browsers and its phones and tablets
 * (Devices.tsx): read by key wherever something signs one of them out.
 */
export const signedInKey = ['me', 'signed-in'] as const

/**
 * Whether two ids are one: a UUID is written in either case, and the contract's are compared
 * without it. Never where either is missing.
 */
export function sameId(one: string | null | undefined, other: string | null | undefined): boolean {
  return typeof one === 'string' && typeof other === 'string'
    ? one.toLowerCase() === other.toLowerCase()
    : false
}

/** The zone a member's times are said in: their own where the account names one, else this device's. */
export function useOwnZone(): string {
  const me = useMe()
  return me.timezone ?? deviceTimeZone()
}

/** What a read tells of itself, as TanStack Query holds it. */
export interface Read {
  readonly data: unknown
  readonly isError: boolean
  readonly fetchStatus: FetchStatus
}

/**
 * The state of a body that is read from the server. With nothing kept, a read that failed and
 * one that cannot be made for want of a connection are the same to a member: the body could not
 * be read. With something kept it is drawn, and `offline` where it is as it was last read.
 */
export function readState(read: Read, online: boolean, empty = false): DataState {
  if (read.data === undefined) {
    return read.isError || read.fetchStatus === 'paused' ? 'error' : 'loading'
  }
  if (empty) return 'empty'
  return online ? 'populated' : 'offline'
}

/**
 * Several reads that one body is drawn from, as the one read the body's state is told by
 * (`readState`): read once every one of them is, and until then failed or waiting for a
 * connection where any of those still unread is. One that was read and could not be read again
 * says nothing here: what this browser kept of it is drawn.
 */
export function together(reads: readonly Read[]): Read {
  const unread = reads.filter((read) => read.data === undefined)
  return {
    data: unread.length === 0 ? reads : undefined,
    isError: unread.some((read) => read.isError),
    fetchStatus: unread.some((read) => read.fetchStatus === 'paused') ? 'paused' : 'idle',
  }
}

/**
 * The frame asks every body for the sentence of a row that was taken back from its member
 * (ui/StateFrame.tsx). Nothing of an account is: there is no grant over one's own account to
 * lose. The neutral sentence stands where the type wants one, and is never drawn.
 */
export function useNoWithdrawal(): StateText {
  const t = useTranslate()
  return { text: t('ui.not_available.title') }
}

/** Whether `error` is a `422` at all: a refusal of what was sent, whatever field it names. */
export function isRefusedAsSent(error: unknown): boolean {
  return problemIn(error)?.code === 'validation_failed'
}

/** The images the server makes a picture of (`putMeAvatar`, `putChildrenByUserIdAvatar`). */
export const pictureTypes = 'image/jpeg,image/png,image/gif,image/webp'

/**
 * Puts the focus on `target` where it has dropped to the page: the control that held it left
 * with what it stood in, and nothing else says where the member is (D-166). A focus that is
 * anywhere else is its member's, and is left alone.
 */
export function refocus(target: HTMLElement | null): void {
  const focused = document.activeElement
  if (focused === null || focused === document.body) target?.focus()
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
 *
 * It is the screen's whole page that is watched, and one place that the focus is given. A screen
 * of several parts, each with a place of its own, keeps the focus by part (`usePartFocusKept`).
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
 * Where the focus goes when a control of one part of a screen has left the page with the focus
 * on it: to the part's own place, which takes the ref this answers and a `tabIndex` of -1. A
 * button gives its place to the payment form, the form to a sentence, *Cancel* to *Resume*, a
 * question closes over a control that is gone: each took the focus with it, and nothing else
 * says where its member is (D-166).
 *
 * It is moved only where it was last on something inside the part that is on the page no
 * longer. A focus that went anywhere else meanwhile is its member's and is left alone, and so
 * is one that was never here: what changes under a member who is reading moves nothing. The
 * look is taken after every drawing of the part, since a control may leave under a question
 * that is still open and be missed only when the question closes.
 *
 * It is one part that is watched, of a screen that has several, each with a place of its own:
 * billing's sections (billing/parts.tsx names it `useFocusKept` there), and the bodies of the
 * privacy centre, each of which reads for itself. A screen with one place for its whole page,
 * whose controls leave together, keeps the focus by whether they are drawn (`useFocusKept`,
 * above): the two are not one hook, since that one watches the whole page and would move the
 * focus to the wrong part here. The look is this component's own, after each of its drawings: a
 * part whose read is another component's is not seen from here, and has a place of its own.
 */
export function usePartFocusKept(): RefObject<HTMLDivElement | null> {
  const place = useRef<HTMLDivElement>(null)
  /** The control inside the part that took the focus last, until the focus goes elsewhere. */
  const held = useRef<Element | null>(null)
  useEffect(() => {
    const note = (event: FocusEvent) => {
      const part = place.current
      const target = event.target instanceof Element ? event.target : null
      held.current = target !== null && target !== part && part?.contains(target) ? target : null
    }
    document.addEventListener('focusin', note)
    return () => {
      document.removeEventListener('focusin', note)
    }
  }, [])
  useEffect(() => {
    if (held.current?.isConnected !== false) return
    held.current = null
    refocus(place.current)
  })
  return place
}

/** A run of plain letters, each accented as the pseudo-locale accents it, and nothing added. */
function accented(run: string): string {
  // The pseudo-locale brackets and pads a message: the letters between are the run's own, one
  // for one.
  return pseudolocalize(run).slice(1, 1 + run.length)
}

/**
 * What is data and no word of a catalog's, as the page draws it: a version, an id, a zone's
 * name, a household's code, an archive's own name for an entry, a word `Intl` gives, and the
 * text of a bundle exactly as it is sent. In a language of the app's it is drawn as it is. The
 * pseudo-locale accents its letters, as it accents every word of the catalogs and of the
 * reference data (`useLocalized`, household/data.ts), so that its pass tells data from a word
 * nobody translated; it adds no bracket and no padding, data being no sentence that could be
 * cut off. The text may hold anything, a brace or an apostrophe among it: it is never read as a
 * message.
 */
export function useData(): (text: string) => string {
  const { locale } = useI18n()
  return useCallback(
    (text) => (locale === pseudoLocale ? text.replace(/[A-Za-z]+/g, accented) : text),
    [locale],
  )
}

/**
 * Puts `text` on the clipboard. It rejects where the browser has none to give, a page that is
 * not served securely, or refuses.
 */
export function copyText(text: string): Promise<void> {
  if (!('clipboard' in navigator)) return Promise.reject(new Error('no clipboard'))
  return navigator.clipboard.writeText(text)
}
