import type { ColorToken } from './color.ts'

/**
 * The thirteen status tokens (01-foundations §1), each the name of one status state and an alias
 * of the colour it is drawn in. Five values across thirteen names: aliasing is fine, absence is
 * not, since a state without a token has no declared pair and fails no build. A status is always
 * colour and icon and word (N2): @household/icons draws the thirteen and names each one's word.
 */
export const statuses = {
  /** No row carries it: absence is the synced state. Drawn only where sync is stated in words. */
  'status-synced': 'positive',
  /** Quiet by design. The row stays fully editable, so it must not read as an error. */
  'status-pending': 'text-muted',
  /** Only past the 800 ms threshold. Also carries re-snapshot needed, which adds no fourteenth state. */
  'status-syncing': 'info',
  /** Row flag plus a conflict-inbox entry. Never a modal at reconnect. */
  'status-conflict': 'warning',
  /** A different category of event from conflict, not a worse severity of it. */
  'status-rejected': 'danger',
  /** The offline bar. Neither a problem nor a success, which is why info exists. */
  'status-offline': 'info',
  /** Shown once, then quiet. Chores and Reminders. */
  'status-overdue': 'danger',
  /** Utilities settlement without a closing reading; a task whose dependency is unmet. */
  'status-blocked': 'warning',
  /** Informational, never alarming, and an estimated reading never enters a money figure. */
  'status-estimated': 'info',
  /** Calendar busy blocks: unmistakable and uninspectable. */
  'status-private': 'text-muted',
  /** A child's locked dashboard layout. Absence, not disabling, wherever possible. */
  'status-locked': 'text-muted',
  /** Calendar connection health, sync health. */
  'status-stale': 'warning',
  /** Every derived figure with nothing behind it. Distinguishable from a genuine zero. */
  'status-no-history': 'text-muted',
} as const satisfies Record<string, ColorToken>

export type StatusToken = keyof typeof statuses
