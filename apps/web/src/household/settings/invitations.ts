// What the two screens of a household's invitations share that draws nothing (A-23, A-25; PRD 02
// §3): how an invitation stands at a given moment, which addresses have been asked again since
// somebody declined at them, what the composer is handed when it is opened from a declined
// invitation, and what a refused write of either screen is said to have come to.
import { accessLevels } from '@household/domain'
import { useState } from 'react'
import { problemIn } from '../../api/problem.ts'
import { useProblemText } from '../../api/problemText.ts'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import type { Invitation } from '../data.ts'
import { defaultsFor, levelsOf, type Levels } from '../grants.ts'
import type { AccessLevel } from '../households.ts'

export type InvitationStatus = NonNullable<Invitation['status']>

/**
 * Whether the invitations have been this member's to read at any time while the screen was open,
 * `holds` being whether they are now (`useStanding().invitations`). One who never held them is
 * drawn the neutral *not available*, and nothing is asked for them; one who held them and no
 * longer does was here when their access changed, and is told that it did (03-patterns §2).
 */
export function useEverHeld(holds: boolean): boolean {
  const [held, setHeld] = useState(holds)
  if (holds && !held) setHeld(true)
  return held || holds
}

/**
 * How `invitation` stands at `now`. The server answers `expired` for one that is `pending` past
 * its time, but it computes that as it reads, and this browser may be drawing what it kept from
 * an earlier day: one still said to be waiting whose time has passed is read as expired here too.
 */
export function statusAt(invitation: Invitation, now: number): InvitationStatus {
  const status = invitation.status ?? 'pending'
  if (status !== 'pending' || invitation.expires_at === undefined) return status
  return Date.parse(invitation.expires_at) <= now ? 'expired' : 'pending'
}

/** The address an email invitation was sent to. A link names nobody, and has none. */
export function addressOf(invitation: Invitation): string | null {
  const email = invitation.kind === 'link' ? '' : (invitation.email ?? '')
  return email === '' ? null : email
}

/**
 * The addresses, in lower case as the server compares them, that an invitation waits for or
 * brought somebody in at. An older invitation to one of them is answered `404` when it is sent
 * again (the waiting one is the one to send, and a member's address is invited nowhere), and
 * whoever declined at one has been asked again since: the row draws no *Send again*, and the
 * decline is no longer news.
 */
export function settledAddresses(list: readonly Invitation[], now: number): ReadonlySet<string> {
  const settled = new Set<string>()
  for (const each of list) {
    const address = addressOf(each)
    const status = statusAt(each, now)
    if (address !== null && (status === 'pending' || status === 'accepted')) {
      settled.add(address.toLowerCase())
    }
  }
  return settled
}

/** What the composer starts from when a declined invitation's notice opens it. */
export interface Again {
  readonly kind: 'email' | 'link'
  /** The address that declined; empty for a link. */
  readonly email: string
  readonly role: 'owner' | 'member'
  readonly levels: Levels
}

/** What the notice of `invitation` hands the composer, as the router's `state`. */
export function againState(invitation: Invitation): { readonly again: unknown } {
  return {
    again: {
      kind: invitation.kind,
      email: addressOf(invitation) ?? '',
      role: invitation.role,
      grants: invitation.grants,
    },
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

/**
 * What a router's `state` says the composer starts from. The state is whatever the history entry
 * holds, which is no type's: anything not shaped as `againState` shapes it is ignored whole, and
 * the composer starts as it does for anybody. An owner holds everything, so an invitation that
 * proposed one hands on no levels: the matrix, should the role be changed, starts at a member's
 * defaults.
 */
export function readAgain(state: unknown): Again | undefined {
  if (!isRecord(state) || !isRecord(state.again)) return undefined
  const { kind, email, role, grants } = state.again
  if (kind !== 'email' && kind !== 'link') return undefined
  if (role !== 'owner' && role !== 'member') return undefined
  if (typeof email !== 'string' || !isRecord(grants)) return undefined
  const given: Record<string, AccessLevel> = {}
  for (const [module, level] of Object.entries(grants)) {
    const known = accessLevels.find((each) => each === level)
    if (known === undefined) return undefined
    given[module] = known
  }
  return {
    kind,
    email: kind === 'email' ? email : '',
    role,
    levels: role === 'owner' ? defaultsFor('member') : levelsOf(given),
  }
}

/**
 * Whether a refused write says that what the screen shows is no longer how things stand: the
 * member is no owner any more, the household takes no writes, or what was named is gone. The
 * household is read again, and the screen draws what it reads.
 */
export function isStale(error: unknown): boolean {
  const problem = problemIn(error)
  return (
    problem?.code === 'forbidden' ||
    problem?.code === 'not_found' ||
    problem?.code === 'entitlement_read_only' ||
    problem?.code === 'entitlement_restricted'
  )
}

/**
 * What a write of these screens that was refused, for no field's sake, is said to have come to:
 * by the problem's `code`, in the settings' own sentences, and for anything else what every
 * screen says of a request that failed. `timeZone` is the zone a `429`'s time is said in.
 */
export function useRefusal(timeZone: string): (error: unknown) => string {
  const t = useTranslate()
  const say = useProblemText(timeZone)
  return (error) => {
    switch (problemIn(error)?.code) {
      case 'forbidden':
        return t('household.settings.refused.not_owner')
      case 'not_found':
        return t('household.settings.refused.gone')
      case 'entitlement_read_only':
      case 'entitlement_restricted':
        return t('household.settings.refused.read_only')
      default:
        return say(error)
    }
  }
}
