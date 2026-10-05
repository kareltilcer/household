/**
 * The illustration kit (DD-5), ported from design/v1's `illustration.js`: one systematic
 * construction language, not bespoke artwork per module. The unit of work is a part, not a
 * picture: an empty state or a setup answer is a composition of the parts below, and none of them
 * is drawn. That is what lets seventeen of them survive translation, dark theme and the schedule.
 *
 * The eight rules, each held by a test where a test can hold it:
 *
 * 1. **One frame.** 200 × 140, and the illustration never sets its own height. It sits above the
 *    empty state's sentence at 100 % text and is hidden entirely at 200 %: the sentence is what
 *    teaches. Hiding it is the screen's, which knows the text scale.
 * 2. **Four parts, at most.** A fifth means the sentence is doing too little.
 * 3. **Quarter-step scales only**: 0.75, 1, 1.25, 1.5. The stroke is compensated per instance,
 *    so the whole composition holds one 2-unit weight.
 * 4. **Two tones.** Ink (`text-muted`) and one accent, the module's family accent, never a second
 *    hue. Fills are the same accent at 12 %, and only inside a closed part.
 * 5. **The slot is the vocabulary.** The dashed slot is the one part that means *nothing here
 *    yet*, and it is in every empty state. It is how an empty state reads as empty, not broken.
 * 6. **No faces, no hands, no perspective.** No gradients, no shadows, no rendered form. A figure
 *    is a circle and an arc: a member, not a person, and it needs no skin tone.
 * 7. **No text, ever.** Not a letter, not a digit, not a currency mark.
 * 8. **Dark is the same shapes.** Only the tokens change. No part relies on a light ground.
 *
 * A composition carries no words. Its sentence, example and action are its screen's, in the
 * catalogs (the prototype's are the copy intent, by ledger id), and it is decoration to assistive
 * technology: the sentence beside it says everything it shows.
 */
import type { ColorName, ColorToken } from '@household/tokens'
import type { Drawing, Group, Path } from './svg.ts'

export const frame = { width: 200, height: 140, stroke: 2, partBox: 48 } as const

/** The quarter steps a part is placed at. */
export const partScales = [0.75, 1, 1.25, 1.5] as const
export type PartScale = (typeof partScales)[number]

/** The share of the accent a closed part is filled with. */
export const fillOpacity = 0.12

/** The slot's dash and gap, in the frame's units, compensated per instance as the stroke is. */
const dash = [5, 4] as const

export interface Part {
  /** Ink is `text-muted`; accent is the composition's own. */
  readonly tone: 'ink' | 'accent'
  readonly dashed: boolean
  /** Strokes, on a 48-unit box. */
  readonly paths: readonly string[]
  /** Closed areas filled with the accent at 12 %. */
  readonly fills: readonly string[]
}

/** The kit of parts. */
export const parts = {
  /** Nothing here yet. The only part that carries a meaning of its own. */
  slot: { tone: 'ink', dashed: true, paths: ['M5 12h38v24H5z'], fills: [] },
  /** A place things belong. Grounds a composition without a floor line. */
  shelf: { tone: 'ink', dashed: false, paths: ['M4 34h40', 'M11 34v7', 'M37 34v7'], fills: [] },
  /** A container of many. Storage, stock, an archive. */
  crate: { tone: 'ink', dashed: false, paths: ['M8 16h32v24H8z', 'M8 24h32'], fills: [] },
  /** Shopping, and the only part with a handle: the thing you carry out. */
  bag: {
    tone: 'accent',
    dashed: false,
    paths: ['M12 18h24l-3 22H15z', 'M18 18a6 6 0 0 1 12 0'],
    fills: ['M14 26h20l-2 12H16z'],
  },
  /** A held amount. The money parts are jars, never coins with a currency mark on them. */
  jar: {
    tone: 'accent',
    dashed: false,
    paths: ['M12 16h24v24a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z', 'M10 10h28v6H10z'],
    fills: ['M12 28h24v12a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z'],
  },
  /** Garden's own container, and the tier the median household starts at. */
  pot: { tone: 'accent', dashed: false, paths: ['M12 20h24l-4 20H16z', 'M9 20h30'], fills: [] },
  /** Growth, one stem and two leaves. The same construction as the Garden icon at 2×. */
  leaves: {
    tone: 'accent',
    dashed: false,
    paths: [
      'M24 41V24',
      'M24 24c-8 0-13-4.6-13-11.6 8.4 0 13 4.6 13 11.6z',
      'M24 24c8 0 13-4.6 13-11.6-8.4 0-13 4.6-13 11.6z',
    ],
    fills: [],
  },
  /** Repetition of a record: readings, entries, rows. */
  stack: {
    tone: 'ink',
    dashed: false,
    paths: ['M12 33h24v7H12z', 'M12 24h24v7H12z', 'M12 15h24v7H12z'],
    fills: [],
  },
  /** A payment instrument, an account, a subscription. */
  card: { tone: 'accent', dashed: false, paths: ['M8 15h32v18H8z', 'M8 21h32'], fills: [] },
  /** One written thing: a note, a document, a bill. */
  sheet: {
    tone: 'ink',
    dashed: false,
    paths: ['M12 7h24v34H12z', 'M18 17h12', 'M18 24h12', 'M18 31h8'],
    fills: [],
  },
  /** Custody. What is filed, and who may see it. */
  folder: { tone: 'accent', dashed: false, paths: ['M6 13h14l4 5h18v23H6z'], fills: [] },
  /** A time that has come. Used for due, never for late: lateness is a status, not an illustration. */
  clock: {
    tone: 'ink',
    dashed: false,
    paths: ['M24 8a16 16 0 1 0 0 32a16 16 0 1 0 0-32', 'M24 15v9l7 4'],
    fills: [],
  },
  /** A register with a needle. Utilities' whole vocabulary in one part. */
  dial: {
    tone: 'accent',
    dashed: false,
    paths: ['M8 34a16 16 0 1 1 32 0', 'M24 34L34 22', 'M6 40h36'],
    fills: [],
  },
  /** Movement from one place to another. Never drawn as money moving by itself. */
  flow: {
    tone: 'accent',
    dashed: false,
    paths: ['M8 34C8 18 24 18 37 18', 'M32 13l5 5-5 5'],
    fills: [],
  },
  /** One source, two destinations. The allocation editor's shape. */
  fork: {
    tone: 'accent',
    dashed: false,
    paths: [
      'M9 24h11c6 0 6-10 12-10h5',
      'M20 24c6 0 6 10 12 10h5',
      'M32 9l5 5-5 5',
      'M32 29l5 5-5 5',
    ],
    fills: [],
  },
  /** A member. A circle and an arc, so it needs no face and no skin tone. */
  figure: {
    tone: 'ink',
    dashed: false,
    paths: ['M24 10a5 5 0 1 0 0 10a5 5 0 1 0 0-10', 'M13 41c0-7 5-12 11-12s11 5 11 12'],
    fills: [],
  },
  /** The household itself, or a property in it. */
  house: { tone: 'ink', dashed: false, paths: ['M6 26L24 12l18 14v15H6z'], fills: [] },
  /** History that exists. Pointedly absent from every no-history composition. */
  bars: {
    tone: 'ink',
    dashed: false,
    paths: ['M8 40h32', 'M13 40V28', 'M21 40V19', 'M29 40V32', 'M37 40V23'],
    fills: [],
  },
} as const satisfies Record<string, Part>

export type PartId = keyof typeof parts

/** A part placed in the frame: its top-left corner, and its scale. */
export type Placement = readonly [part: PartId, x: number, y: number, scale: PartScale]

export interface Composition {
  /** An empty state teaches a module; an answer is a choice a setup offers, with its consequence. */
  readonly kind: 'empty' | 'answer'
  /** The family accent of the module it belongs to. */
  readonly accent: ColorToken
  readonly parts: readonly Placement[]
}

/**
 * The compositions the prototype's screens reached. The other modules' empty states are composed
 * with their own screens, the only stage at which the sentence can be checked against what the
 * module does.
 */
export const compositions = {
  /** Shopping, a list with nothing on it: a place things belong, the thing you carry, and the slot. */
  'shopping.empty': {
    kind: 'empty',
    accent: 'accent-family-keeping',
    parts: [
      ['shelf', 20, 62, 1.5],
      ['bag', 30, 26, 1],
      ['slot', 104, 44, 1.25],
    ],
  },
  /** Finance setup, "everything comes out of one pot": one jar, two members. */
  'finance.setup.pooled': {
    kind: 'answer',
    accent: 'accent-family-money',
    parts: [
      ['jar', 76, 40, 1.25],
      ['figure', 16, 52, 0.75],
      ['figure', 148, 52, 0.75],
    ],
  },
  /** Finance setup, "we split what we share": the fork is the allocation editor's own shape. */
  'finance.setup.split': {
    kind: 'answer',
    accent: 'accent-family-money',
    parts: [
      ['jar', 8, 46, 0.75],
      ['fork', 62, 46, 1],
      ['jar', 148, 46, 0.75],
    ],
  },
  /** Finance setup, "one of us handles the money": a member, a movement, a held amount. */
  'finance.setup.allowance': {
    kind: 'answer',
    accent: 'accent-family-money',
    parts: [
      ['figure', 12, 46, 1],
      ['flow', 68, 44, 1],
      ['jar', 132, 44, 1],
    ],
  },
  /** Finance setup, "we keep it separate and settle up": the shared thing does not exist yet. */
  'finance.setup.separate': {
    kind: 'answer',
    accent: 'accent-family-money',
    parts: [
      ['jar', 6, 40, 1],
      ['slot', 62, 52, 0.75],
      ['jar', 122, 40, 1],
    ],
  },
  /** Garden setup, pots: the tier is the container, and there is no ground in the picture. */
  'garden.setup.pots': {
    kind: 'answer',
    accent: 'accent-garden',
    parts: [
      ['pot', 40, 44, 1.25],
      ['leaves', 96, 30, 1],
      ['pot', 140, 48, 0.75],
    ],
  },
  /** Garden setup, beds: a place things belong, with two stems in it. */
  'garden.setup.beds': {
    kind: 'answer',
    accent: 'accent-garden',
    parts: [
      ['shelf', 14, 64, 1.5],
      ['leaves', 46, 26, 1.25],
      ['leaves', 116, 34, 1],
    ],
  },
  /** Garden setup, a plot: the only Garden composition with bars, the only tier with history. */
  'garden.setup.plot': {
    kind: 'answer',
    accent: 'accent-garden',
    parts: [
      ['shelf', 8, 80, 1.25],
      ['shelf', 104, 80, 1.25],
      ['leaves', 40, 30, 1],
      ['bars', 120, 24, 1],
    ],
  },
  /** Garden's plan check with no history. No bars: it never shows history in outline. */
  'garden.no_history': {
    kind: 'empty',
    accent: 'accent-garden',
    parts: [
      ['pot', 22, 50, 1.25],
      ['leaves', 66, 12, 1],
      ['slot', 116, 46, 1.25],
    ],
  },
  /** Documents, an empty folder: custody, an example of custody, and room for more. */
  'documents.empty': {
    kind: 'empty',
    accent: 'accent-family-keeping',
    parts: [
      ['folder', 14, 44, 1.25],
      ['sheet', 78, 34, 1],
      ['slot', 124, 48, 1],
    ],
  },
  /** Utilities, not enough information: the slot stands where the figure would be. */
  'utilities.not_enough': {
    kind: 'empty',
    accent: 'accent-family-money',
    parts: [
      ['dial', 22, 46, 1.25],
      ['stack', 96, 34, 0.75],
      ['slot', 132, 48, 1],
    ],
  },
} as const satisfies Record<string, Composition>

export type CompositionId = keyof typeof compositions

/** How a client names a colour: a custom property on the web, a theme's value natively. */
export type Paint = (name: ColorName) => string

/** A number as a drawing states it: to the hundredth, without a float's tail. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

function instance(placement: Placement, accent: ColorToken, paint: Paint): Group {
  const [id, x, y, scale] = placement
  const part: Part = parts[id]
  const stroke = paint(part.tone === 'accent' ? accent : 'text-muted')
  const filled = part.fills.map((d): Path => ({
    tag: 'path',
    d,
    fill: paint(accent),
    fillOpacity,
    stroke: 'none',
  }))
  const stroked = part.paths.map((d): Path => ({
    tag: 'path',
    d,
    fill: 'none',
    stroke,
    // The frame's stroke, whatever the part's scale: a scaled-up part brings no fatter line.
    strokeWidth: round(frame.stroke / scale),
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...(part.dashed
      ? { strokeDasharray: dash.map((length) => String(round(length / scale))).join(' ') }
      : {}),
  }))
  return {
    tag: 'g',
    transform: `translate(${String(x)}, ${String(y)}) scale(${String(scale)})`,
    children: [...filled, ...stroked],
  }
}

/**
 * A composition as a drawing, in the frame's coordinates. With a width it is drawn at that width
 * and the frame's proportion; with none it fills the width it is given.
 */
export function illustration(id: CompositionId, paint: Paint, width?: number): Drawing {
  const composition: Composition = compositions[id]
  return {
    viewBox: `0 0 ${String(frame.width)} ${String(frame.height)}`,
    ...(width === undefined ? {} : { width, height: round((width * frame.height) / frame.width) }),
    children: composition.parts.map((placement) => instance(placement, composition.accent, paint)),
  }
}
