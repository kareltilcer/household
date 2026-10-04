/**
 * The declared contrast pairs: which tokens are meant to be used together, and the minimum each
 * pair clears in both themes (01-foundations §1). CI tests this list, and a failing pair fails
 * the build (06-clients §4). A combination that is not on it is not available to a screen
 * (07-delivery §3). 4.5:1 for body text, 3:1 for large text and the boundaries of UI components.
 * Ported from design/v1's `foundations.js`.
 */
import { families } from './accent.ts'
import type { ColorToken } from './color.ts'
import { statuses, type StatusToken } from './status.ts'

export interface Pair {
  readonly fg: ColorToken | StatusToken
  readonly bg: ColorToken
  readonly min: 3 | 4.5
  readonly use: string
}

/** The three surfaces a screen's own content is drawn on. */
export const grounds = [
  'surface',
  'surface-raised',
  'surface-sunken',
] as const satisfies readonly ColorToken[]

const accents: readonly ColorToken[] = ['accent', ...Object.values(families)]

const charts = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
] as const satisfies readonly ColorToken[]

function declare(): Pair[] {
  const pairs: Pair[] = []
  const pair = (fg: Pair['fg'], bg: ColorToken, min: Pair['min'], use: string) => {
    pairs.push({ fg, bg, min, use })
  }

  for (const bg of [...grounds, 'surface-overlay'] as const) {
    pair('text-primary', bg, 4.5, 'Body and heading text')
    pair('text-muted', bg, 4.5, 'Secondary line, captions, metadata')
  }
  for (const bg of grounds) {
    pair('text-link', bg, 4.5, 'Inline link')
    for (const accent of accents) pair(accent, bg, 3, 'Module identity mark and emphasis')
    for (const status of ['danger', 'warning', 'positive', 'info'] as const) {
      pair(status, bg, 4.5, 'Status word beside its icon')
    }
    pair('border-strong', bg, 3, 'Input and table boundary')
    pair('focus', bg, 3, 'Focus ring')
  }
  for (const accent of accents) pair('text-on-accent', accent, 4.5, 'Ink on an accent fill')
  pair('text-on-danger', 'danger', 4.5, 'Ink on a danger fill')
  pair('text-inverse', 'surface-inverse', 4.5, 'Tooltip and inverse chip')
  for (const chart of charts) {
    pair(chart, 'surface-raised', 3, "Series against the chart's own surface")
    pair(chart, 'surface-sunken', 3, 'Series in a sunken well')
  }
  pair('chart-axis', 'surface-raised', 3, 'Axis and ticks')
  // Under its own name, on all three grounds. A status is spent under its own name as often as
  // under the token it aliases, and a list that named only the alias would not test the name the
  // screens use. The alias's own pairs are above.
  for (const status of Object.keys(statuses) as StatusToken[]) {
    for (const bg of grounds) pair(status, bg, 4.5, `${status}, under its own name`)
  }
  return pairs
}

export const pairs: readonly Pair[] = declare()

/**
 * The tokens that are deliberately in no declared pair, each with its reason. A colour token is
 * in a pair, is drawn as one that is (`sameAs`, `drawnAs`), or is here: a test fails one that is
 * none of the three.
 */
export const exempt = {
  'text-disabled':
    '2.2:1 by intent. Never the sole carrier; absence is preferred to disabling, so this token appears rarely and never alone.',
  border:
    'A decorative separator. The boundary that must be seen is border-strong, which is tested.',
  'border-subtle':
    'A decorative separator. The boundary that must be seen is border-strong, which is tested.',
  divider:
    'A decorative separator. The boundary that must be seen is border-strong, which is tested.',
  'chart-grid': 'Grid lines behind data. Series colours and axis carry the meaning and are tested.',
  'focus-ring-offset':
    'The gap, not the ink. It is tested implicitly by the focus pair on each surface.',
  'skeleton-bg': 'A loading shape with no text on it.',
} as const satisfies Partial<Record<ColorToken, string>>

/**
 * The colour spends the screens introduced after the token file was first settled, each with the
 * design stage that drew it (design/v1 `conformance.js`). Every one is in the declared list, and
 * a test holds that: a spend drawn late is the one a list written early would miss.
 */
export const lateSpends: readonly (Omit<Pair, 'use'> & {
  readonly stage: number
  readonly use: string
})[] = [
  {
    fg: 'accent-family-things',
    bg: 'surface',
    min: 3,
    stage: 19,
    use: "The asset engine's identity mark, three modules deep",
  },
  {
    fg: 'accent-family-things',
    bg: 'surface-raised',
    min: 3,
    stage: 19,
    use: 'Row rules and chips on the entity list',
  },
  {
    fg: 'text-on-accent',
    bg: 'accent-family-things',
    min: 4.5,
    stage: 19,
    use: 'Ink on the primary button in Property, Vehicles and Pets',
  },
  {
    fg: 'status-stale',
    bg: 'surface-raised',
    min: 4.5,
    stage: 18,
    use: 'The calendar connection staleness badge',
  },
  {
    fg: 'status-rejected',
    bg: 'surface-sunken',
    min: 4.5,
    stage: 19,
    use: 'The refused odometer reading, on a sunken row',
  },
  {
    fg: 'warning',
    bg: 'surface-sunken',
    min: 4.5,
    stage: 17,
    use: 'Overdue and frost, both drawn in a well',
  },
  {
    fg: 'positive',
    bg: 'surface-raised',
    min: 4.5,
    stage: 16,
    use: 'Reconciles / settled, on a card',
  },
  {
    fg: 'accent-garden',
    bg: 'surface-sunken',
    min: 3,
    stage: 17,
    use: "Garden's own accent, outside the five families",
  },
  {
    fg: 'chart-2',
    bg: 'surface-raised',
    min: 3,
    stage: 18,
    use: 'Member colour on the who-overlay',
  },
  {
    fg: 'chart-3',
    bg: 'surface-raised',
    min: 3,
    stage: 18,
    use: 'Member colour on the who-overlay',
  },
  {
    fg: 'chart-4',
    bg: 'surface-raised',
    min: 3,
    stage: 18,
    use: 'Member colour on the who-overlay',
  },
  {
    fg: 'chart-5',
    bg: 'surface-raised',
    min: 3,
    stage: 18,
    use: 'Member colour on the who-overlay',
  },
  {
    fg: 'chart-6',
    bg: 'surface-sunken',
    min: 3,
    stage: 15,
    use: 'Sixth series in the consumption chart',
  },
  { fg: 'chart-7', bg: 'surface-sunken', min: 3, stage: 15, use: 'Seventh series' },
  {
    fg: 'chart-8',
    bg: 'surface-sunken',
    min: 3,
    stage: 17,
    use: 'Eighth series, the season chart',
  },
  {
    fg: 'status-conflict',
    bg: 'surface-raised',
    min: 4.5,
    stage: 13,
    use: "The preserved loser's banner",
  },
  {
    fg: 'status-private',
    bg: 'surface',
    min: 4.5,
    stage: 18,
    use: 'The busy-block divider and the private mark',
  },
  {
    fg: 'text-on-danger',
    bg: 'danger',
    min: 4.5,
    stage: 8,
    use: 'Ink on the destructive confirm',
  },
]
