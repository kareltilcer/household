// What the account's screens share that draws nothing: which state a read is in, the zone a
// member's times are said in, and whether a refusal is of what was sent. Which field a `422`
// names is read as the screens before sign-in read it (auth/fields.tsx), and a write is asked
// as they ask theirs, at once (api/query.ts, `askedNow`).
//
// A member's account is no household's (A-19): its reads and writes are plain requests, and none
// of them is a mutation a replica holds. So of the twelve states (02-components §0) these screens
// reach the ones a request can be in, and the rest have nothing to be: nothing is `absent` or
// `withdrawn`, there being no grant over one's own account to lack or to lose, nothing is
// `conflicted`, one person changing their own account from one place at a time, and nothing waits
// `pending` on the device to be sent later.
import type { FetchStatus } from '@tanstack/react-query'
import { problemIn } from '../api/problem.ts'
import { deviceTimeZone } from '../api/problemText.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import type { StateText } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'

/**
 * The query that holds where the account is signed in, its browsers and its phones and tablets
 * (Devices.tsx): read by key wherever something signs one of them out.
 */
export const signedInKey = ['me', 'signed-in'] as const

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

/**
 * Puts `text` on the clipboard. It rejects where the browser has none to give, a page that is
 * not served securely, or refuses.
 */
export function copyText(text: string): Promise<void> {
  if (!('clipboard' in navigator)) return Promise.reject(new Error('no clipboard'))
  return navigator.clipboard.writeText(text)
}
