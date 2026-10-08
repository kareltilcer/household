// What an account's deletion does to each household its member is in (PRD 05 §4 FR-PR3, D-137),
// resolved from what a member can read before anything is asked: the households they are in, and
// for those they own, who else is in them, who else owns them and who pays. The server resolves
// them again when it is asked (`postMeDeletion`) and is the one that decides; this is so that the
// four situations are stated up front, and not met one refusal at a time.
//
// It follows the server's own resolution (internal/platform/privacy `resolve`):
//
// - a household the member is the only member of goes with the account, unasked;
// - one they are the only owner of, with other people in it, blocks until someone else is an
//   owner or they choose to delete it with the account;
// - one they pay for blocks while it goes on without them; where it goes with the account it
//   blocks only while its subscription will charge again, which nothing here can read, so that
//   is said as a condition and left to the server to refuse;
// - in every other, the membership ends when the account does.
//
// One household's members a member cannot read: a suspended one's, whose every route answers
// `404` (D-115) while the list still names it. Where they stand in one they own is then the
// server's alone to say, but for its only member, whom the list itself counts.
import type { components } from '@household/api'
import type { HouseholdSummary } from '../household/households.ts'

export type Membership = components['schemas']['Membership']

export type Standing =
  /** The member is its only member: it goes with the account. */
  | { readonly kind: 'alone'; readonly household: HouseholdSummary; readonly payer: boolean }
  /** The member is its only owner, and other people are in it. */
  | { readonly kind: 'sole'; readonly household: HouseholdSummary; readonly payer: boolean }
  /** It has another owner, and the member pays for it: billing is settled first. */
  | { readonly kind: 'payer'; readonly household: HouseholdSummary }
  /** The membership ends, and the household goes on. */
  | { readonly kind: 'leaves'; readonly household: HouseholdSummary }
  /**
   * The member owns it with others in it, and who they are could not be read: it is suspended.
   * The server says which of the above it is when it is asked, and the member may name it to be
   * deleted with their account meanwhile, as its only owner would.
   */
  | { readonly kind: 'unread'; readonly household: HouseholdSummary }

function same(one: string | undefined, other: string): boolean {
  return one?.toLowerCase() === other.toLowerCase()
}

/**
 * Where `user` stands in `household`. `members` is the household's members as its member reads
 * them, which a household the member owns needs and any other does not: only an owner can be the
 * last owner, or pay. Left out for a household they own, its members could not be read.
 */
export function standingOf(
  household: HouseholdSummary,
  user: string,
  members: readonly Membership[] | undefined,
): Standing {
  if (household.my_role !== 'owner') return { kind: 'leaves', household }
  if (members === undefined) {
    return household.member_count === 1
      ? { kind: 'alone', household, payer: false }
      : { kind: 'unread', household }
  }
  const payer = members.some((member) => same(member.user_id, user) && member.is_billing_payer)
  const others = members.filter((member) => !same(member.user_id, user))
  if (others.length === 0) return { kind: 'alone', household, payer }
  if (!others.some((member) => member.role === 'owner')) return { kind: 'sole', household, payer }
  return payer ? { kind: 'payer', household } : { kind: 'leaves', household }
}

/**
 * Whether `standing` stands in the way for certain, `chosen` being the households the member
 * chose to delete with their account: a household that would be left with no owner, or one that
 * goes on with nobody paying for it. One that could not be read is no certainty: the server says.
 */
export function blocks(standing: Standing, chosen: ReadonlySet<string>): boolean {
  switch (standing.kind) {
    case 'payer':
      return true
    case 'sole':
      return !chosen.has(standing.household.id)
    case 'alone':
    case 'leaves':
    case 'unread':
      return false
  }
}

/** What a `409 account_deletion_blocked` names: the households that stand in the way. */
export interface Blocked {
  /** Those the member is the only owner of, by name. */
  readonly soleOwned: readonly { readonly id: string; readonly name: string }[]
  /** The ids of those the member pays for. */
  readonly payerFor: readonly string[]
}

function record(value: unknown): Partial<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null ? { ...value } : undefined
}

/**
 * The households a `409 account_deletion_blocked` names, read from the problem document as it
 * came: the contract's `AccountDeletionBlocked`, whose members a client older than the server
 * may find otherwise than it expects, and then reads as naming none.
 */
export function blockedBy(problem: unknown): Blocked {
  const document = record(problem)
  const sole = Array.isArray(document?.sole_owned_households) ? document.sole_owned_households : []
  const payer = Array.isArray(document?.billing_payer_for) ? document.billing_payer_for : []
  return {
    soleOwned: sole.flatMap((entry: unknown) => {
      const household = record(entry)
      return typeof household?.household_id === 'string'
        ? [
            {
              id: household.household_id,
              name: typeof household.name === 'string' ? household.name : '',
            },
          ]
        : []
    }),
    payerFor: payer.filter((id: unknown): id is string => typeof id === 'string'),
  }
}
