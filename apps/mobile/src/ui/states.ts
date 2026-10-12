// The twelve states every data-bearing component has (02-components §0), and what each one does
// to a body: the treatment. Twelve states are not twelve drawings. A state replaces the body, or
// wraps it, or marks a row of it, and says whether the affordances that write are drawn at all.
// Ported from design/v1's `components.js`, which builds its cells from the same table, and the
// same as the web's (apps/web/src/ui/states.ts): one design, drawn by two clients that share no
// code (D-36). This file is data, with nothing of React Native's: `StateFrame` applies it.

export const dataStates = [
  'loading',
  'empty',
  'populated',
  'error',
  'offline',
  'pending',
  'syncing',
  'conflicted',
  'rejected',
  'absent',
  'withdrawn',
  'readonly',
] as const

export type DataState = (typeof dataStates)[number]

export interface Treatment {
  /**
   * What stands where the body would: a skeleton of its shape, the teaching empty state, a
   * message in words, nothing at all, or the body itself.
   */
  readonly kind: 'skeleton' | 'teach' | 'message' | 'absent' | 'body'
  /** The sync mark a row of the body carries. No mark is the synced state. */
  readonly mark?: 'pending' | 'syncing' | 'conflict' | 'rejected'
  /** A strip above the body, in words, and its tone. */
  readonly banner?: 'danger' | 'warning'
  /** The tone of the message that stands in the body's place. */
  readonly message?: 'danger' | 'neutral'
  /** Whether the persistent offline bar is up. */
  readonly offline: boolean
  /** Whether the affordances that write are drawn. Where they are not, they are absent, never disabled. */
  readonly writes: boolean
}

export const treatments = {
  loading: {
    kind: 'skeleton',
    offline: false,
    writes: true,
  },
  empty: {
    kind: 'teach',
    offline: false,
    writes: true,
  },
  populated: {
    kind: 'body',
    offline: false,
    writes: true,
  },
  error: {
    kind: 'message',
    message: 'danger',
    offline: false,
    writes: true,
  },
  offline: {
    kind: 'body',
    offline: true,
    writes: true,
  },
  pending: {
    kind: 'body',
    mark: 'pending',
    offline: false,
    writes: true,
  },
  syncing: {
    kind: 'body',
    mark: 'syncing',
    offline: false,
    writes: true,
  },
  conflicted: {
    kind: 'body',
    mark: 'conflict',
    offline: false,
    writes: true,
  },
  rejected: {
    kind: 'body',
    mark: 'rejected',
    banner: 'danger',
    offline: false,
    writes: true,
  },
  absent: {
    kind: 'absent',
    offline: false,
    writes: false,
  },
  withdrawn: {
    kind: 'message',
    message: 'neutral',
    offline: false,
    writes: false,
  },
  readonly: {
    kind: 'body',
    banner: 'warning',
    offline: false,
    writes: false,
  },
} as const satisfies Record<DataState, Treatment>
