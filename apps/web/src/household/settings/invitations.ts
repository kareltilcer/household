// What the two screens of a household's invitations share that draws nothing (A-23, A-25; PRD 02
// §3): how an invitation stands at a given moment, which addresses have been asked again since
// somebody declined at them, what the composer is handed when it is opened from a declined
// invitation, and what a refused write of either screen is said to have come to.
import { accessLevels } from '@household/domain'
import { useState } from 'react'
import { useProblemText } from '../../api/problemText.ts'
import type { Invitation } from '../data.ts'
import { defaultsFor, levelsOf, type Levels } from '../grants.ts'
import type { AccessLevel } from '../households.ts'
import { useStandingRefusal } from './profile.ts'

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
 * that are a member's. An invitation to one of them is answered `404` when it is sent again (the
 * waiting one is the one to send, and a member's address is invited nowhere), and whoever
 * declined at one has been asked again since, or is in: the row draws no *Send again*, and the
 * decline is no longer news.
 *
 * `members` are the addresses of the household's members, as an owner reads them. Somebody who
 * joined by an invitation and has left since is no member, and their address is asked again as
 * any other is: an invitation that was accepted says who came, not who is here. While the
 * members are unread, undefined, it is all there is to go by, and it is held to say so.
 */
export function settledAddresses(
  list: readonly Invitation[],
  now: number,
  members?: readonly string[],
): ReadonlySet<string> {
  const settled = new Set<string>(members?.map((address) => address.toLowerCase()))
  for (const each of list) {
    const address = addressOf(each)
    const status = statusAt(each, now)
    if (
      address !== null &&
      (status === 'pending' || (members === undefined && status === 'accepted'))
    ) {
      settled.add(address.toLowerCase())
    }
  }
  return settled
}

/**
 * The declined invitations an owner is still to be told of (A-25, D-171), `list` being newest
 * first as the server lists it and `settled` its addresses that an invitation waits for or
 * that are a member's. An address is answered for by the newest invitation to it: asked
 * again since it declined, the earlier decline is news no longer, whatever became of the
 * asking. A link names nobody, and each declined link stands for itself.
 */
export function declinedNotices(
  list: readonly Invitation[],
  now: number,
  settled: ReadonlySet<string>,
): Invitation[] {
  const asked = new Set<string>()
  return list.filter((each) => {
    const address = addressOf(each)?.toLowerCase()
    const newest = address === undefined || !asked.has(address)
    if (address !== undefined) asked.add(address)
    return (
      newest &&
      statusAt(each, now) === 'declined' &&
      (address === undefined || !settled.has(address))
    )
  })
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
 * What a write of these screens that was refused, for no field's sake, is said to have come to:
 * in the settings' own sentence where it is about where the member stands, and for anything
 * else what every screen says of a request that failed. `timeZone` is the zone a `429`'s time
 * is said in.
 */
export function useRefusal(timeZone: string): (error: unknown) => string {
  const standing = useStandingRefusal()
  const say = useProblemText(timeZone)
  return (error) => standing(error) ?? say(error)
}
