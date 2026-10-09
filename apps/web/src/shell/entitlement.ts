// Which banner a household's entitlement asks for, and of what (A-30; PRD 04 §3; D-114; DD-9).
// The state is resolved by the server, once for each request, and rides on the household's own
// answer: precedence is not worked out again here. This file reads that answer and nothing else,
// and draws nothing: the banner is EntitlementBanner.tsx's, the lockout Lockout.tsx's.
//
// `active` has no banner, and neither has a trial in its first twenty days: the absence of one is
// the state. `suspended` is no banner either: its household answers nothing at all, and the
// shell draws the lockout in its place. `past_due` restricts nothing and is its owners' to know
// (PRD 04 §6), so a member who is none is shown none.
import type { Household } from '../household/households.ts'

export type Entitlement = NonNullable<Household['entitlement']>
export type Restriction = NonNullable<Entitlement['restriction']>

/** What a banner is of: the state, with the facts of it that the household's answer carries. */
export type Shown =
  /** The trial's last ten days (DD-9): a notice that can be put away, then a banner that stays. */
  | { readonly kind: 'trial'; readonly stage: 'notice' | 'banner'; readonly endsAt: string }
  | { readonly kind: 'past_due' }
  | { readonly kind: 'grace'; readonly endsAt: string | null }
  /** A lapse: it alone carries a day of deletion, and who restricted the household beside it. */
  | {
      readonly kind: 'read_only' | 'canceled'
      readonly retainedUntil: string | null
      readonly restriction: Restriction | null
    }
  | { readonly kind: 'restricted'; readonly restriction: Restriction | null }

/** The banner `entitlement` asks for, to a reader who is an owner or is not: one, or none. */
export function bannerOf(entitlement: Entitlement | undefined, owner: boolean): Shown | null {
  const restriction = entitlement?.restriction ?? null
  switch (entitlement?.state) {
    case 'trialing': {
      const stage = entitlement.trial_notice
      const endsAt = entitlement.trial_ends_at
      // The stage is the server's to say: the days are never counted here to decide it.
      if ((stage !== 'notice' && stage !== 'banner') || typeof endsAt !== 'string') return null
      return { kind: 'trial', stage, endsAt }
    }
    case 'past_due':
      return owner ? { kind: 'past_due' } : null
    case 'grace':
      return { kind: 'grace', endsAt: entitlement.grace_ends_at ?? null }
    case 'read_only':
    case 'canceled':
      return {
        kind: entitlement.state,
        retainedUntil: entitlement.data_retained_until ?? null,
        restriction,
      }
    case 'restricted':
      return { kind: 'restricted', restriction }
    case 'active':
    case 'suspended':
    case undefined:
      return null
  }
}

/**
 * What tells one banner from another: a banner that takes another's place is a new one, and is
 * announced as it arrives. A restriction that arrives under a lapse's banner makes it another.
 */
export function bannerId(shown: Shown): string {
  switch (shown.kind) {
    case 'trial':
      return `trial ${shown.stage} ${shown.endsAt}`
    case 'read_only':
    case 'canceled':
    case 'restricted':
      return `${shown.kind} ${shown.restriction?.restricted_at ?? ''}`
    case 'past_due':
    case 'grace':
      return shown.kind
  }
}

const dayMs = 24 * 60 * 60 * 1000

/** The calendar day `at` falls on in `zone`, counted in days. */
function dayIn(at: Date, zone: string): number {
  // English's own calendar and digits, whatever the member's: the parts are read as numbers.
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value)
  return Math.round(Date.UTC(part('year'), part('month') - 1, part('day')) / dayMs)
}

/**
 * The whole days from `now` to the day the trial ends, as a calendar counts them in `zone`: the
 * zone its day is shown in, so that the count and the day agree. Never below zero: a trial that
 * has ended reads `trialing` until the server's hourly job moves it. A time that is no time
 * counts none.
 */
export function daysLeft(endsAt: string, now: number, zone: string): number {
  const ends = new Date(endsAt)
  if (Number.isNaN(ends.getTime())) return 0
  return Math.max(0, dayIn(ends, zone) - dayIn(new Date(now), zone))
}

/**
 * Where a member's putting away of a household's first trial notice is kept: in this browser,
 * for each member and each household, as their arrangement is (D-155). No operation stores it.
 */
export function trialNoticeKey(user: string, household: string): string {
  return `household.trial_notice.${user.toLowerCase()}.${household.toLowerCase()}`
}

/**
 * The trial's end as it was when the member put the notice away, or null where they have not.
 * It is held against the end the household names now: a trial that staff extended ends on
 * another day, and its notice is said again.
 */
export function putAway(user: string, household: string): string | null {
  try {
    return window.localStorage.getItem(trialNoticeKey(user, household))
  } catch {
    return null
  }
}

/** Keeps that the notice of the trial that ends at `endsAt` was put away. */
export function putAwayNow(user: string, household: string, endsAt: string): void {
  try {
    window.localStorage.setItem(trialNoticeKey(user, household), endsAt)
  } catch {
    // A browser that keeps nothing is told again on its next visit.
  }
}
