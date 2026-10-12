// The twelve-state harness's model, ported from design/v1's `components.js` by way of the web's
// (apps/web/src/dev/harness/model.ts): the data-bearing bodies of 02-components §3 that a phone
// draws, each with the shape of its skeleton and a sentence of its own for every state that has
// one. The data table is the web's alone (02-components names it so), which leaves eight. Eight
// bodies by twelve treatments (ui/states.ts) is ninety-six cells, each in both themes, all built
// from this data, which is what makes the coverage counted and not asserted.
//
// Everything written here is a fixture: sample household content and the sentences a screen
// would say about it, in English, for a route that is in no build a member is served. It is no
// part of the catalogs, which hold what ships in five languages (D-154). Under the pseudo-locale
// the harness accents and pads it with the rest (index.tsx), so a layout that only survives
// English, and a string that escaped the catalogs, show here too.
//
// Where the prototype's sentences said what the product does not, these say what it does: a
// withdrawn body names nothing that was withdrawn and no author (03-patterns §8), a read-only
// one is the household's state and no payment's, a refusal is its own reason and never a
// conflict's, and a file may be 100 MB.
//
// This file is data, with nothing of React Native's.
import type { DataState } from '../../ui/states.ts'

export const bodyIds = [
  'list',
  'kv',
  'money',
  'metric',
  'series',
  'composition',
  'flow',
  'search',
] as const

export type BodyId = (typeof bodyIds)[number]

export interface Body {
  readonly name: string
  /** What the body is, and the rule of 02-components §3 it has to keep. */
  readonly note: string
  /** The skeleton's bars: width in percent, height in rem. */
  readonly skeleton: readonly (readonly [width: number, height: number])[]
  /** The teaching empty state: one sentence, one example, one action. */
  readonly empty: { readonly sentence: string; readonly example: string; readonly action: string }
  readonly error: string
  readonly rejected: string
  readonly withdrawn: string
  readonly readonly: string
}

export const bodies: Readonly<Record<BodyId, Body>> = {
  list: {
    name: 'List row',
    note: 'The workhorse. Title, optional secondary line, optional module chip, optional member avatar, sync mark, trailing action. A row wraps and grows with its words, and is never held to a height.',
    skeleton: [
      [58, 1],
      [34, 0.8125],
      [70, 1],
      [42, 0.8125],
      [50, 1],
    ],
    empty: {
      sentence: 'No readings on this meter yet.',
      example: 'Petr reads the cellar meter on the first of each month.',
      action: 'Add a reading',
    },
    error: 'Could not load the readings. Nothing was lost: they are stored on this device.',
    rejected: 'That reading is lower than the one on 3 March. Is it a rollover, or a typo?',
    withdrawn: 'Your access to this list changed, so it was removed from this device.',
    readonly:
      'This household is read-only for now. Everything is readable, and no reading can be added until it can be changed again.',
  },
  kv: {
    name: 'Key–value detail block',
    note: 'The pane beside every asset, document and service. A value that does not exist is a dash with a word, never an empty cell.',
    skeleton: [
      [38, 0.8125],
      [62, 1],
      [30, 0.8125],
      [54, 1],
      [44, 0.8125],
      [58, 1],
    ],
    empty: {
      sentence: 'Nothing recorded for this car yet.',
      example: 'Registration and the next STK date are enough to make the reminders work.',
      action: 'Add details',
    },
    error: 'Could not load the car’s details. Its service history is unaffected.',
    rejected: 'That STK date is before the last one. Check the year on the certificate.',
    withdrawn: 'Your access to these details changed, so they were removed from this device.',
    readonly: 'Read-only for now: the details are readable, and cannot be edited.',
  },
  money: {
    name: 'Money value',
    note: 'Amount and currency, with the original currency and the stored rate where one was used. Negative is carried by a sign and a word, never by colour alone.',
    skeleton: [
      [46, 1.25],
      [34, 0.8125],
    ],
    empty: {
      sentence: 'No amount yet.',
      example: 'A trip summary can offer the total straight to Finance.',
      action: 'Enter an amount',
    },
    error: 'Could not read the balance. The last figure this device holds is shown in Today.',
    rejected: 'That split does not add up to the total. One remainder rule per source.',
    withdrawn: 'Your access to this amount changed, so it was removed from this device.',
    readonly: 'Read-only for now: the amount is readable, and cannot be changed.',
  },
  metric: {
    name: 'Metric tile',
    note: 'A catalog metric rendered: label, value, optional trend, and the not-enough-information state, which is a different thing from a genuine zero.',
    skeleton: [
      [52, 0.8125],
      [40, 1.25],
      [46, 0.8125],
    ],
    empty: {
      sentence: 'Not enough information yet.',
      example: 'Two readings on the same meter produce the first figure.',
      action: 'Add a reading',
    },
    error: 'Could not compute this figure. The readings behind it are intact.',
    rejected:
      'That reading would put the meter below its last one, so the figure was not worked out again.',
    withdrawn: 'Your access to this figure changed, so it was removed from this device.',
    readonly: 'Read-only for now: the figure stays as it is until readings can be added again.',
  },
  series: {
    name: 'Chart: time series',
    note: 'Interpolated points carry the estimated style and are excluded from every money figure; monthly aggregates can be marked approximate.',
    skeleton: [
      [100, 4.5],
      [70, 0.8125],
    ],
    empty: {
      sentence: 'No history yet.',
      example: 'The chart appears with the second reading on this meter.',
      action: 'Add a reading',
    },
    error: 'Could not load the consumption series. Your readings are unaffected.',
    rejected: 'That reading is lower than the one on 3 March, so the series was not extended.',
    withdrawn: 'Your access to this chart changed, so it was removed from this device.',
    readonly: 'Read-only for now: the chart shows what was recorded, and no reading can be added.',
  },
  composition: {
    name: 'Chart: composition',
    note: 'One bar, a legend that names every segment with its figure, and derived overhead shown as its own segment and not folded into the total.',
    skeleton: [
      [100, 1.5],
      [64, 0.8125],
      [58, 0.8125],
      [50, 0.8125],
    ],
    empty: {
      sentence: 'Nothing stored yet.',
      example: 'The first document upload gives this its first segment.',
      action: 'Upload a document',
    },
    error: 'Could not measure storage. Nothing has been deleted.',
    rejected:
      'That file is larger than 100 MB, which is the most one file may be. It was not sent.',
    withdrawn:
      'This module was turned off for the household. Nothing was deleted, and it comes back if it is turned on again.',
    readonly: 'Read-only for now: what is stored stays readable, and nothing can be uploaded.',
  },
  flow: {
    name: 'Chart: flow',
    note: 'N sources to M accounts, reconciling exactly. The shell only: the readable diagram is Finance’s own work. On a phone the second list stands under the first.',
    skeleton: [
      [44, 1],
      [44, 1],
      [100, 1.5],
      [44, 1],
      [44, 1],
    ],
    empty: {
      sentence: 'No allocation rules yet.',
      example: 'One rule, 60 % of Jana’s salary to the household account, is a working start.',
      action: 'Add a rule',
    },
    error: 'Could not build the flow. Your rules and incomes are unaffected.',
    rejected: 'Two remainder rules on Jana’s salary. Exactly one is allowed per source.',
    withdrawn: 'Your access to this month’s flow changed, so it was removed from this device.',
    readonly: 'Read-only for now: the rules are readable, and cannot be changed.',
  },
  search: {
    name: 'Search result row',
    note: 'One uniform shape across every module. A snippet and a path are both nullable, and the row reads as a result without either.',
    skeleton: [
      [30, 0.8125],
      [66, 1],
      [82, 0.8125],
    ],
    empty: {
      sentence: 'Nothing matches “jistič”.',
      example: 'Search covers every module you have access to. Try “electricity”.',
      action: 'Clear the search',
    },
    error: 'Could not search. Results already on this device are still listed under Today.',
    rejected: 'Another document in that folder has this name already, so it was not renamed.',
    withdrawn:
      'That result pointed at something you can no longer open, so it was removed from this device.',
    readonly: 'Read-only for now: searching still works, and what it finds cannot be changed.',
  },
}

/** Each state's name, and the sentence it has to obey. */
export const states: Readonly<Record<DataState, { readonly name: string; readonly rule: string }>> =
  {
    loading: {
      name: 'Loading',
      rule: 'Skeleton, shape-matched to the content it replaces: never a spinner, and still under reduced motion.',
    },
    empty: {
      name: 'Empty',
      rule: 'One sentence, one example, one action (03-patterns §4). The example is what stops it reading as a fault.',
    },
    populated: {
      name: 'Populated',
      rule: 'No mark. The absence of the sync mark is the synced state: there is no green tick on every row.',
    },
    error: {
      name: 'Error',
      rule: 'Named in words, with an action, and it says what was not lost.',
    },
    offline: {
      name: 'Offline',
      rule: 'The read is identical to the online read. The bar is the only difference, and it never blocks content.',
    },
    pending: {
      name: 'Pending',
      rule: 'A queued local write, fully editable: edits merge into the queued mutation. It must not read as an error.',
    },
    syncing: {
      name: 'Syncing',
      rule: 'Only past the 800 ms threshold. Below it, nothing is shown at all.',
    },
    conflicted: {
      name: 'Conflicted',
      rule: 'A row flag that opens the comparison, plus an inbox entry. Never a modal at reconnect (DD-4).',
    },
    rejected: {
      name: 'Rejected',
      rule: 'The actual reason in a sentence, plus retry, edit and discard. A different category of event from a conflict.',
    },
    absent: {
      name: 'Permission-absent',
      rule: 'Gone, not disabled. No label, no placeholder, no greyed control: the member has no way to know it exists.',
    },
    withdrawn: {
      name: 'Withdrawn',
      rule: 'Taken back while the member held it. Not an error, not an empty state, not somebody else’s delete: it names nothing that was withdrawn.',
    },
    readonly: {
      name: 'Read-only (entitlement)',
      rule: 'Content visible, writes absent, banner explains. Absent rather than disabled, as everywhere else, and no link to a purchase.',
    },
  }

/** The populated cases 02-components §3 names beside the full one: the nullable and the signed. */
export const variantIds = [
  'money-negative',
  'metric-none',
  'search-bare',
  'search-unfiled',
] as const

export type VariantId = (typeof variantIds)[number]

export const variants: Readonly<
  Record<VariantId, { readonly body: BodyId; readonly name: string }>
> = {
  'money-negative': { body: 'money', name: 'Negative: a sign and a word, not a colour' },
  'metric-none': { body: 'metric', name: 'Not enough information: not a zero' },
  'search-bare': { body: 'search', name: 'No snippet' },
  'search-unfiled': { body: 'search', name: 'No path' },
}

/** The two themes every cell is drawn in. */
export const cellThemes = ['light', 'dark'] as const

export type CellTheme = (typeof cellThemes)[number]

/** A cell's `testID`: what a test and the end-to-end flow find it by. */
export function cellId(body: BodyId, state: DataState, theme: CellTheme): string {
  return `${body}:${state}:${theme}`
}

/** A variant cell's `testID`. */
export function variantId(variant: VariantId, theme: CellTheme): string {
  return `variant:${variant}:${theme}`
}
