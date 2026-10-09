// The model of the sync UI's dev page: each state the page draws, with its name, the rule it
// keeps, and the facts that put the UI in it. The inbox's states are F-5's required ones, the
// twelve but pending, syncing, absent and withdrawn, and with them the one that is the inbox's
// own, a tab that does not hold the household's replica. A test holds each case to the state it
// is named for, so that the page's coverage is counted and not asserted.
//
// Everything written here is a fixture, in English and in no catalog (harness/model.ts says
// why). This file is data, with nothing of the DOM's: the end-to-end suite reads it on Node.
import type { RecordedOutcome, RowState } from '@household/sync'
import type { InboxFacts, InboxState } from '../../sync/Inbox.tsx'
import { rejectionCodes } from '../../sync/rejection.ts'
import { cellThemes, type CellTheme } from '../harness/model.ts'
import {
  conflict,
  conflictWithDeletion,
  everything,
  overriddenMerge,
  rejectionWith,
  replacingMerge,
} from './fixtures.ts'

export { cellThemes, type CellTheme }

/** A cell's name in the page: what the end-to-end suite finds it by. */
export function cellId(section: string, state: string, theme: CellTheme): string {
  return `${section}:${state}:${theme}`
}

export interface Case {
  readonly name: string
  /** The rule the state keeps, from the PRD or the design. */
  readonly rule: string
}

export const inboxStates = [
  'loading',
  'empty',
  'populated',
  'error',
  'offline',
  'conflicted',
  'rejected',
  'readonly',
  'elsewhere',
] as const satisfies readonly InboxState[]

export type InboxCell = (typeof inboxStates)[number]

export interface InboxCase extends Case {
  readonly facts: Omit<InboxFacts, 'entries'> & { readonly entries: readonly RecordedOutcome[] }
  /** Whether the replica is receiving the household's changes (D-105). */
  readonly receiving: boolean | null
}

const open = { phase: 'open', online: true, writes: true } as const

export const inboxCases: Readonly<Record<InboxCell, InboxCase>> = {
  loading: {
    name: 'Loading',
    rule: 'The replica is being opened. The inbox is its own table, so there is nothing to fetch: the shape of two rows, and no spinner.',
    facts: { ...open, phase: 'opening', entries: [] },
    receiving: null,
  },
  empty: {
    name: 'Empty',
    rule: 'In sync is the absence of an indicator. No teaching, no example: one calm sentence.',
    facts: { ...open, entries: [] },
    receiving: true,
  },
  populated: {
    name: 'Populated',
    rule: 'One inbox across every module, oldest first. Here it holds only merges, which ask nothing: each says what became of the change and is put away.',
    facts: { ...open, entries: [overriddenMerge, replacingMerge] },
    receiving: true,
  },
  error: {
    name: 'Error',
    rule: 'This browser could not open its copy of the household. Nothing was lost, and the sentence says what to do.',
    facts: { ...open, phase: 'unavailable', entries: [] },
    receiving: null,
  },
  offline: {
    name: 'Offline',
    rule: 'The list reads the same. Deciding is a local write, so nothing is taken away, and a sentence says changes go when the connection is back.',
    facts: { ...open, online: false, entries: [conflict, rejectionWith('forbidden')] },
    receiving: null,
  },
  conflicted: {
    name: 'Conflicted',
    rule: 'A flag and an entry, never a modal at reconnect. The mark opens the comparison: both values, both authors, both times.',
    facts: { ...open, entries: [conflictWithDeletion, conflict] },
    receiving: true,
  },
  rejected: {
    name: 'Rejected',
    rule: 'Everything at once: a refusal for every code, with the conflicts and the merges. Each mark opens the actual reason in a sentence.',
    facts: { ...open, entries: everything },
    receiving: true,
  },
  readonly: {
    name: 'Read-only',
    rule: 'The household does not write. What is held is kept and sent when it does (FR-BI2), and nothing is answered meanwhile: each panel reads, and draws no control.',
    facts: {
      ...open,
      writes: false,
      entries: [conflict, rejectionWith('entitlement_read_only'), rejectionWith('forbidden')],
    },
    receiving: true,
  },
  elsewhere: {
    name: 'Open in another tab',
    rule: 'One tab keeps a household’s replica at a time. Another says so, and what to do.',
    facts: { ...open, phase: 'elsewhere', entries: [] },
    receiving: null,
  },
}

/** The refusals the resolver has a sentence for, and one it has none for. */
export const refusalCodes: readonly string[] = [...rejectionCodes, 'teapot']

export const rowStates = [
  'pending',
  'syncing',
  'conflict',
  'rejected',
  'merged',
  'withdrawn-access',
  'withdrawn-module',
] as const

export type RowCell = (typeof rowStates)[number]

export interface RowCase extends Case {
  readonly state: RowState
}

export const rowCases: Readonly<Record<RowCell, RowCase>> = {
  pending: {
    name: 'Pending',
    rule: 'A quiet mark, and nothing to open: the write is safe, it is simply still here.',
    state: { kind: 'pending', op: 'update', held: null },
  },
  syncing: {
    name: 'Syncing',
    rule: 'Shown only once it has taken longer than a moment, counted from when the write began.',
    state: { kind: 'syncing', op: 'update' },
  },
  conflict: {
    name: 'Conflict',
    rule: 'The mark is a control, named for the row, and opens the comparison.',
    state: { kind: 'conflict', outcome: conflict },
  },
  rejected: {
    name: 'Rejected',
    rule: 'The mark is a control and opens the reason.',
    state: { kind: 'rejected', outcome: rejectionWith('monotonicity_violation') },
  },
  merged: {
    name: 'Merged',
    rule: 'No mark: a banner over the row, here it is, and no question.',
    state: { kind: 'merged', outcome: overriddenMerge },
  },
  'withdrawn-access': {
    name: 'Withdrawn, access changed',
    rule: 'Not an error, not an empty state, not somebody else’s deletion. It says which of the two causes it was, and names nothing.',
    state: { kind: 'withdrawn', reason: 'access' },
  },
  'withdrawn-module': {
    name: 'Withdrawn, module turned off',
    rule: 'The data is kept on the server, and the sentence says so.',
    state: { kind: 'withdrawn', reason: 'module' },
  },
}

/** The table and the id the page's one watched row is asked for by. */
export const watched = { table: 'settlements', id: 'row' } as const

/** Every sentence of the model, for the test that holds them to what the pseudo-locale can accent. */
export function texts(): string[] {
  return [...Object.values(inboxCases), ...Object.values(rowCases)].flatMap((entry) => [
    entry.name,
    entry.rule,
  ])
}
