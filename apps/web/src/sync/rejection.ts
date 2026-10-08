// Why a change was not accepted, in a sentence a member can act on (F-7, 06-clients §5), by the
// code the answer was recorded with: the push's own for each mutation, and the connector's for a
// batch the server refused whole (ADR 0019). The server's `message` is a developer's English and
// is never shown, and nothing here reads it: the code alone says which sentence.
//
// design/v1 draws four reasons. `monotonicity_violation` is the push's, and `entitlement` is two
// codes, one for a household that is read-only and one for a household an owner restricted. Its
// `attachment_quota` and `reference_gone` are no codes: a file is refused in the attachment
// queue, which is no mutation's answer, and a row that is gone is `not_found`, which does not
// say what it pointed at. The five the prototype has no sentence for are written here.
import type { MessageKey } from '@household/i18n/lazy'

/** The codes a mutation's refusal is recorded with. Any other reads as `other`. */
export const rejectionCodes = [
  'monotonicity_violation',
  'entitlement_read_only',
  'entitlement_restricted',
  'forbidden',
  'not_found',
  'validation_failed',
  'fair_use_ceiling',
  'payload_too_large',
] as const

export type RejectionCode = (typeof rejectionCodes)[number]

export interface Rejection {
  /** The sentence: what happened, and what was not lost. */
  readonly reason: MessageKey & `sync.rejected.reason.${string}`
  /**
   * Whether sending the change again could be accepted. Absence, not disabling: where it could
   * not, no retry is drawn.
   */
  readonly retry: boolean
  /**
   * Whether the replica holds the change to send by itself once the household writes again
   * (FR-BI2). The sentence says so, and that is why it offers no retry.
   */
  readonly held: boolean
  /** Whether the answer carries the row the change is out of order with. */
  readonly neighbour: boolean
}

const rejections: Readonly<Record<RejectionCode | 'other', Rejection>> = {
  // The neighbour may be the one that is wrong: once it is corrected, the same change is taken.
  monotonicity_violation: {
    reason: 'sync.rejected.reason.monotonicity_violation',
    retry: true,
    held: false,
    neighbour: true,
  },
  // Held, and sent by the replica when the household writes again: a retry before then is a
  // second change that is refused as the first was.
  entitlement_read_only: {
    reason: 'sync.rejected.reason.entitlement_read_only',
    retry: false,
    held: true,
    neighbour: false,
  },
  entitlement_restricted: {
    reason: 'sync.rejected.reason.entitlement_restricted',
    retry: false,
    held: true,
    neighbour: false,
  },
  forbidden: {
    reason: 'sync.rejected.reason.forbidden',
    retry: true,
    held: false,
    neighbour: false,
  },
  not_found: {
    reason: 'sync.rejected.reason.not_found',
    retry: true,
    held: false,
    neighbour: false,
  },
  // Among its causes are two a retry clears: it is written again under a new id, against the
  // version the replica holds now.
  validation_failed: {
    reason: 'sync.rejected.reason.validation_failed',
    retry: true,
    held: false,
    neighbour: false,
  },
  fair_use_ceiling: {
    reason: 'sync.rejected.reason.fair_use_ceiling',
    retry: true,
    held: false,
    neighbour: false,
  },
  // One mutation the server will not take at its size: sent again it is the same size.
  payload_too_large: {
    reason: 'sync.rejected.reason.payload_too_large',
    retry: false,
    held: false,
    neighbour: false,
  },
  other: {
    reason: 'sync.rejected.reason.other',
    retry: true,
    held: false,
    neighbour: false,
  },
}

function isRejectionCode(code: string | null): code is RejectionCode {
  return rejectionCodes.some((known) => known === code)
}

/** What a refusal recorded with `code` says, and what can be done about it. */
export function rejectionOf(code: string | null): Rejection {
  return rejections[isRejectionCode(code) ? code : 'other']
}
